import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import fs from 'fs';

// Load .env
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');

const isTestEnv = process.env.NODE_ENV === 'test';

const config = {
  env: process.env.NODE_ENV || 'development',
  rootDirectory: ROOT_DIR,

  // Database Configuration: MySQL 8.0 ONLY
  db: {
    driver: 'mysql',
    mysql: {
      host: process.env.MYSQL_HOST || '127.0.0.1',
      port: parseInt(process.env.MYSQL_PORT || '3306', 10),
      user: process.env.MYSQL_USER || 'root',
      password: process.env.MYSQL_PASSWORD || '',
      database: isTestEnv
        ? (process.env.MYSQL_DATABASE_TEST || 'pipeline_curated_test')
        : (process.env.MYSQL_DATABASE || 'pipeline_curated'),
      testDatabase: process.env.MYSQL_DATABASE_TEST || 'pipeline_curated_test',
      productionDatabase: process.env.MYSQL_DATABASE || 'pipeline_curated',
      connectionLimit: parseInt(process.env.MYSQL_CONNECTION_LIMIT || '10', 10),
      waitForConnections: true,
      queueLimit: 0,
      decimalNumbers: true,
      multipleStatements: true,
      timezone: 'Z'
    }
  },

  // Storage / Data Lake Zone Paths (Object Storage Simulation)
  storage: {
    incoming: path.resolve(ROOT_DIR, process.env.STORAGE_INCOMING_DIR || './data/incoming'),
    raw: path.resolve(ROOT_DIR, process.env.STORAGE_RAW_DIR || './data/raw'),
    validated: path.resolve(ROOT_DIR, process.env.STORAGE_VALIDATED_DIR || './data/validated'),
    rejected: path.resolve(ROOT_DIR, process.env.STORAGE_REJECTED_DIR || './data/rejected'),
    curated: path.resolve(ROOT_DIR, process.env.STORAGE_CURATED_DIR || './data/curated'),
    reports: path.resolve(ROOT_DIR, process.env.STORAGE_REPORTS_DIR || './reports'),
    logs: path.resolve(ROOT_DIR, process.env.STORAGE_LOGS_DIR || './logs')
  },

  // Execution & Tuning
  pipeline: {
    chunkSize: parseInt(process.env.PIPELINE_CHUNK_SIZE || '1000', 10),
    batchSize: parseInt(process.env.PIPELINE_BATCH_SIZE || '2500', 10),
    allowedCurrencies: ['INR', 'USD'],
    allowedTransactionTypes: ['SALE', 'REFUND', 'PAYMENT'],
    supportedFileExtensions: ['.csv', '.json']
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    dir: path.resolve(ROOT_DIR, process.env.STORAGE_LOGS_DIR || './logs')
  }
};

// Ensure all essential directory paths exist
export function ensureDirectories() {
  const dirs = [
    config.storage.incoming,
    config.storage.raw,
    config.storage.validated,
    config.storage.rejected,
    config.storage.curated,
    config.storage.reports,
    config.storage.logs
  ];
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
  }
}

// Auto-ensure on load
ensureDirectories();

export default config;
