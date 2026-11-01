import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import config from '../../config/config.js';
import logger from '../monitoring/logger.js';

class DatabaseService {
  constructor() {
    this.driver = 'mysql';
    this.mysqlPool = null;
    this.initialized = false;
  }

  /**
   * Sanitizes bind parameters for MySQL:
   * 1. Converts undefined -> null
   * 2. Normalizes ISO-8601 strings (YYYY-MM-DDTHH:mm:ss.sssZ) to standard MySQL DATETIME format (YYYY-MM-DD HH:mm:ss.sss)
   */
  sanitizeParams(params = []) {
    return params.map((p) => {
      if (p === undefined) return null;
      if (typeof p === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(p)) {
        return p.replace('T', ' ').replace('Z', '');
      }
      return p;
    });
  }

  /**
   * Establishes connection pool with MySQL 8.0 server.
   * If MySQL is unreachable, fails with an informative error rather than falling back.
   */
  async getPool() {
    if (this.mysqlPool && this.initialized) {
      return this.mysqlPool;
    }

    const { host, port, user, password, database, connectionLimit, waitForConnections, queueLimit, decimalNumbers, multipleStatements, timezone } = config.db.mysql;

    try {
      this.mysqlPool = mysql.createPool({
        host,
        port,
        user,
        password,
        database,
        connectionLimit,
        waitForConnections,
        queueLimit,
        decimalNumbers,
        multipleStatements,
        timezone,
        dateStrings: true
      });

      // Verify connectivity to the database
      try {
        const testConn = await this.mysqlPool.getConnection();
        testConn.release();
      } catch (connErr) {
        // If target database does not exist yet (ER_BAD_DB_ERROR 1049), auto-provision it
        if (connErr.code === 'ER_BAD_DB_ERROR') {
          logger.info(`Database '${database}' does not exist on MySQL server. Auto-creating schema...`);
          const adminConn = await mysql.createConnection({ host, port, user, password });
          await adminConn.query(
            `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
          );
          await adminConn.end();
          logger.info(`Database '${database}' created successfully.`);

          const retryConn = await this.mysqlPool.getConnection();
          retryConn.release();
        } else {
          throw connErr;
        }
      }

      logger.info('Connected successfully to MySQL 8.0 database', { host, port, database, user });
      this.initialized = true;
      return this.mysqlPool;
    } catch (err) {
      const errorMessage = `MySQL Connection Failed: Unable to connect to MySQL 8.0 server at ${host}:${port} as user '${user}'. Please verify that the MySQL service is running and credentials in .env are valid. Details: ${err.message}`;
      logger.error(errorMessage, { error: err.message, code: err.code });
      throw new Error(errorMessage);
    }
  }

  /**
   * Initializes Curated Zone tables, constraints, foreign keys, and indexes on MySQL.
   */
  async initSchema() {
    const pool = await this.getPool();
    const schemaPath = path.resolve(config.rootDirectory, 'src/database/schema.sql');

    if (!fs.existsSync(schemaPath)) {
      throw new Error(`MySQL schema file not found at: ${schemaPath}`);
    }

    const rawSql = fs.readFileSync(schemaPath, 'utf8');

    // Strip comments to ensure clean execution of multi-statement DDL
    const cleanedSql = rawSql
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/--.*$/gm, '')
      .trim();

    const statements = cleanedSql
      .split(';')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);

    for (const statement of statements) {
      await pool.query(statement);
    }

    logger.info('MySQL 8.0 schema initialized successfully (pipeline_runs, processed_files, customers, transactions, rejected_records)');
  }

  /**
   * Executes a SELECT query with parameterized inputs on MySQL.
   */
  async query(sql, params = []) {
    const pool = await this.getPool();
    const sanitized = this.sanitizeParams(params);
    const [rows] = await pool.query(sql, sanitized);
    return rows;
  }

  /**
   * Executes an INSERT / UPDATE / DELETE statement on MySQL.
   */
  async execute(sql, params = []) {
    const pool = await this.getPool();
    const sanitized = this.sanitizeParams(params);
    const [result] = await pool.execute(sql, sanitized);
    return result;
  }

  /**
   * Executes a set of operations inside an ACID MySQL transaction.
   */
  async withTransaction(callback) {
    const pool = await this.getPool();
    const connection = await pool.getConnection();
    await connection.beginTransaction();

    try {
      const txContext = {
        query: async (sql, params = []) => {
          const sanitized = this.sanitizeParams(params);
          const [rows] = await connection.query(sql, sanitized);
          return rows;
        },
        execute: async (sql, params = []) => {
          const sanitized = this.sanitizeParams(params);
          const [result] = await connection.execute(sql, sanitized);
          return result;
        }
      };

      const result = await callback(txContext);
      await connection.commit();
      return result;
    } catch (err) {
      await connection.rollback();
      logger.error('MySQL transaction rolled back due to error', { error: err.message });
      throw err;
    } finally {
      connection.release();
    }
  }

  /**
   * Gracefully drains and closes the MySQL connection pool.
   */
  async close() {
    if (this.mysqlPool) {
      await this.mysqlPool.end();
      this.mysqlPool = null;
    }
    this.initialized = false;
    logger.info('MySQL connection pool closed.');
  }
}

export const db = new DatabaseService();
export default db;
