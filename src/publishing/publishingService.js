
import db from '../database/db.js';
import logger from '../monitoring/logger.js';
import config from '../../config/config.js';
import crypto from 'node:crypto';

/**
 * Generates a stable fingerprint for a rejected record.
 * Run-specific metadata is excluded so that replaying the same
 * rejected record does not create another quarantine entry.
 */
function createRejectionFingerprint(item) {
  let rawRecord = item.raw_record;

  if (typeof rawRecord === 'string') {
    try {
      rawRecord = JSON.parse(rawRecord);
    } catch {
      // Preserve original value if it is not valid JSON.
    }
  }

  if (
    rawRecord &&
    typeof rawRecord === 'object' &&
    !Array.isArray(rawRecord)
  ) {
    rawRecord = { ...rawRecord };

    // Remove run-specific metadata.
    delete rawRecord.ingestion_run_id;
    delete rawRecord.ingestion_timestamp;

    if (rawRecord._meta && typeof rawRecord._meta === 'object') {
      rawRecord._meta = { ...rawRecord._meta };
      delete rawRecord._meta.run_id;
      delete rawRecord._meta.ingestion_timestamp;
    }
  }

  const fingerprintData = JSON.stringify({
    source_file: item.source_file || 'unknown',
    entity_type: item.entity_type || 'UNKNOWN',
    record_id: item.record_id || null,
    rejection_reason: item.rejection_reason || 'Validation failure',
    raw_record: rawRecord
  });

  return crypto
    .createHash('sha256')
    .update(fingerprintData)
    .digest('hex');
}
export class PublishingService {
  constructor() {
    this.batchSize = config.pipeline.batchSize;
  }

  /**
   * Retrieves all existing customer IDs from the database to validate foreign keys.
   */
  async loadExistingCustomerIds() {
    try {
      const rows = await db.query('SELECT customer_id FROM customers');
      const set = new Set();

      for (const row of rows) {
        set.add(String(row.customer_id).trim());
      }

      return set;
    } catch (err) {
      logger.error('Failed to load existing customer IDs', {
        error: err.message
      });
      return new Set();
    }
  }

  /**
   * Checks file hash against processed_files ledger.
   */
  async checkFileProcessed(fileHash) {
    try {
      const rows = await db.query(
        'SELECT * FROM processed_files WHERE file_hash = ?',
        [fileHash]
      );

      return rows.length > 0 ? rows[0] : null;
    } catch (err) {
      logger.error('Failed to query processed_files table', {
        error: err.message
      });
      return null;
    }
  }

  /**
   * Records or updates file processing state in the processed_files ledger.
   */
  async recordProcessedFile(
    fileInfo,
    fileHash,
    runId,
    recordCount,
    status = 'PROCESSED'
  ) {
    const existing = await this.checkFileProcessed(fileHash);
    const now = new Date().toISOString();

    if (existing) {
      await db.execute(
        `UPDATE processed_files
         SET last_processed_run_id = ?, status = ?, processed_at = ?
         WHERE file_hash = ?`,
        [runId, status, now, fileHash]
      );
    } else {
      await db.execute(
        `INSERT INTO processed_files
         (file_hash, file_name, file_size_bytes, record_count,
          first_processed_run_id, last_processed_run_id, status, processed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          fileHash,
          fileInfo.fileName,
          fileInfo.sizeBytes || 0,
          recordCount,
          runId,
          runId,
          status,
          now
        ]
      );
    }
  }

  /**
   * Publishes customer records with idempotency:
   * Inserts new customers, ignores exact duplicates, updates if name/email changed.
   */
  async publishCustomers(customers, runId) {
    if (!customers || customers.length === 0) {
      return { inserted: 0, duplicates: 0, updated: 0 };
    }

    let inserted = 0;
    let duplicates = 0;
    let updated = 0;

    // Check existing customers in batch
    const customerIds = customers.map((c) => c.customer_id);
    const placeholders = customerIds.map(() => '?').join(',');

    const existingRows = await db.query(
      `SELECT customer_id, customer_name, email
       FROM customers
       WHERE customer_id IN (${placeholders})`,
      customerIds
    );

    const existingMap = new Map();

    for (const row of existingRows) {
      existingMap.set(row.customer_id, row);
    }

    await db.withTransaction(async (tx) => {
      for (const cust of customers) {
        const existing = existingMap.get(cust.customer_id);

        if (!existing) {
          await tx.execute(
            `INSERT INTO customers
             (customer_id, customer_name, email, created_at,
              source_file, ingestion_run_id, ingestion_timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              cust.customer_id,
              cust.customer_name,
              cust.email,
              cust.created_at,
              cust.source_file,
              cust.ingestion_run_id,
              cust.ingestion_timestamp
            ]
          );

          inserted++;
          existingMap.set(cust.customer_id, cust);
        } else {
          if (
            existing.customer_name === cust.customer_name &&
            existing.email === cust.email
          ) {
            duplicates++;
          } else {
            await tx.execute(
              `UPDATE customers
               SET customer_name = ?, email = ?, updated_at = ?, ingestion_run_id = ?
               WHERE customer_id = ?`,
              [
                cust.customer_name,
                cust.email,
                new Date().toISOString(),
                runId,
                cust.customer_id
              ]
            );

            updated++;
          }
        }
      }
    });

    return { inserted, duplicates, updated };
  }

  /**
   * Publishes transaction records with strict idempotency and conflict detection.
   */
  async publishTransactions(transactions, runId) {
    if (!transactions || transactions.length === 0) {
      return {
        inserted: 0,
        duplicates: 0,
        conflicts: []
      };
    }

    let inserted = 0;
    let duplicates = 0;

    const conflicts = [];
    const validToInsert = [];

    // Query existing transactions in chunks
    const chunkSize = 1000;
    const existingTxMap = new Map();

    for (let i = 0; i < transactions.length; i += chunkSize) {
      const chunk = transactions.slice(i, i + chunkSize);
      const ids = chunk.map((t) => t.transaction_id);
      const placeholders = ids.map(() => '?').join(',');

      const existingRows = await db.query(
        `SELECT transaction_id, customer_id, transaction_type,
                amount, currency, transaction_timestamp
         FROM transactions
         WHERE transaction_id IN (${placeholders})`,
        ids
      );

      for (const row of existingRows) {
        existingTxMap.set(row.transaction_id, row);
      }
    }

    // In-memory deduplication and conflict evaluation
    const inBatchSeen = new Map();

    for (const tx of transactions) {
      const id = tx.transaction_id;

      // 1. Check in-batch duplicate / conflict
      if (inBatchSeen.has(id)) {
        const firstSeen = inBatchSeen.get(id);

        const isMatch =
          firstSeen.customer_id === tx.customer_id &&
          firstSeen.transaction_type === tx.transaction_type &&
          Math.abs(firstSeen.amount - tx.amount) < 0.001 &&
          firstSeen.currency === tx.currency;

        if (isMatch) {
          duplicates++;
          continue;
        }

        conflicts.push({
          record: tx,
          reason: `Conflicting in-batch duplicate: transaction_id '${id}' already present in batch with different attributes`
        });

        continue;
      }

      // 2. Check existing database duplicate / conflict
      if (existingTxMap.has(id)) {
        const existing = existingTxMap.get(id);
        const existingAmount = Number(existing.amount);

        const isMatch =
          existing.customer_id === tx.customer_id &&
          existing.transaction_type === tx.transaction_type &&
          Math.abs(existingAmount - tx.amount) < 0.001 &&
          existing.currency === tx.currency;

        if (isMatch) {
          duplicates++;
          inBatchSeen.set(id, tx);
          continue;
        }

        conflicts.push({
          record: tx,
          reason: `Primary key conflict: transaction_id '${id}' already exists in database with different attributes (DB Amount: ${existingAmount}, New: ${tx.amount})`
        });

        continue;
      }

      // Valid new record
      inBatchSeen.set(id, tx);
      validToInsert.push(tx);
    }

    // Batch insert new records in chunks within transactions
    for (let i = 0; i < validToInsert.length; i += chunkSize) {
      const batch = validToInsert.slice(i, i + chunkSize);

      await db.withTransaction(async (txContext) => {
        for (const tx of batch) {
          await txContext.execute(
            `INSERT INTO transactions
             (transaction_id, customer_id, transaction_type, amount,
              currency, transaction_timestamp, transaction_date,
              source_file, ingestion_timestamp, ingestion_run_id)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              tx.transaction_id,
              tx.customer_id,
              tx.transaction_type,
              tx.amount,
              tx.currency,
              tx.transaction_timestamp,
              tx.transaction_date,
              tx.source_file,
              tx.ingestion_timestamp,
              tx.ingestion_run_id
            ]
          );

          inserted++;
        }
      });
    }

    return {
      inserted,
      duplicates,
      conflicts
    };
  }

  /**
   * Publishes rejected records using fingerprint-based idempotency.
   * Replayed rejected records are ignored by the unique fingerprint index.
   */
  async publishRejectedRecords(rejectedRecords) {
    if (!rejectedRecords || rejectedRecords.length === 0) return;

    const chunkSize = 500;

    for (let i = 0; i < rejectedRecords.length; i += chunkSize) {
      const chunk = rejectedRecords.slice(i, i + chunkSize);

      await db.withTransaction(async (tx) => {
        for (const item of chunk) {
          const sourceFile = item.source_file || 'unknown';
          const entityType = item.entity_type || 'UNKNOWN';
          const recordId = item.record_id || null;
          const rejectionReason =
            item.rejection_reason || 'Validation failure';

          const rawRecord =
            typeof item.raw_record === 'string'
              ? item.raw_record
              : JSON.stringify(item.raw_record);

          const fingerprint = createRejectionFingerprint(item);

          await tx.execute(
            `INSERT IGNORE INTO rejected_records
             (run_id, source_file, entity_type, record_id,
              rejection_reason, raw_record, rejection_fingerprint,
              rejection_timestamp)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              item.run_id,
              sourceFile,
              entityType,
              recordId,
              rejectionReason,
              rawRecord,
              fingerprint,
              item.rejection_timestamp || new Date().toISOString()
            ]
          );
        }
      });
    }
  }

  /**
   * Initializes a pipeline run record with upsert semantics.
   */
  async createPipelineRun(runId, startTime) {
    await db.execute(
      `INSERT INTO pipeline_runs (run_id, start_time, execution_status)
       VALUES (?, ?, 'RUNNING')
       ON DUPLICATE KEY UPDATE start_time = ?, execution_status = 'RUNNING'`,
      [runId, startTime, startTime]
    );
  }

  /**
   * Finalizes a pipeline run record with complete counts and duration.
   */
  async finalizePipelineRun(metrics) {
    const counts = metrics.counts || {};

    const inputFiles = counts.inputFilesCount ?? metrics.inputFilesCount ?? 0;
    const inputRecords = counts.inputRecordsCount ?? metrics.inputRecordsCount ?? 0;
    const validRecords = counts.validRecordsCount ?? metrics.validRecordsCount ?? 0;
    const rejectedRecords = counts.rejectedRecordsCount ?? metrics.rejectedRecordsCount ?? 0;
    const duplicateRecords = counts.duplicateRecordsCount ?? metrics.duplicateRecordsCount ?? 0;
    const insertedRecords = counts.insertedRecordsCount ?? metrics.insertedRecordsCount ?? 0;
    const updatedRecords = counts.updatedRecordsCount ?? metrics.updatedRecordsCount ?? 0;
    const duration = metrics.durationMs ?? metrics.processingDurationMs ?? 0;

    await db.execute(
      `UPDATE pipeline_runs
       SET end_time = ?,
           execution_status = ?,
           input_files_count = ?,
           input_records_count = ?,
           valid_records_count = ?,
           rejected_records_count = ?,
           duplicate_records_count = ?,
           inserted_records_count = ?,
           updated_records_count = ?,
           processing_duration_ms = ?,
           failure_reason = ?,
           metadata_json = ?
       WHERE run_id = ?`,
      [
        metrics.endTime ?? null,
        metrics.executionStatus ?? 'COMPLETED',
        inputFiles,
        inputRecords,
        validRecords,
        rejectedRecords,
        duplicateRecords,
        insertedRecords,
        updatedRecords,
        duration,
        metrics.failureReason ?? null,
        JSON.stringify(metrics.metadata || {}),
        metrics.runId
      ]
    );
  }
}

export default new PublishingService();
