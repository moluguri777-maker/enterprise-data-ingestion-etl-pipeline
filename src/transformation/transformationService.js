import path from 'path';
import fs from 'fs';
import config from '../../config/config.js';
import logger from '../monitoring/logger.js';

export class TransformationService {
  constructor(options = {}) {
    this.curatedDir = options.curatedDir || config.storage.curated;
  }

  /**
   * Normalizes an ISO timestamp or date string to strict UTC ISO-8601 format.
   */
  normalizeTimestampToUtc(timestampStr) {
    const d = new Date(timestampStr);
    return d.toISOString();
  }

  /**
   * Derives transaction_date (YYYY-MM-DD) from UTC ISO timestamp.
   */
  deriveDate(utcTimestamp) {
    return utcTimestamp.slice(0, 10);
  }

  /**
   * Normalizes monetary amount to fixed 2 decimal places.
   */
  normalizeAmount(amountVal) {
    const num = Number(amountVal);
    return Math.round((num + Number.EPSILON) * 100) / 100;
  }

  /**
   * Transforms and normalizes Customer records.
   */
  transformCustomer(record) {
    const utcCreatedAt = this.normalizeTimestampToUtc(record.created_at);

    return {
      customer_id: String(record.customer_id).trim(),
      customer_name: String(record.customer_name).trim(),
      email: String(record.email).trim().toLowerCase(),
      created_at: utcCreatedAt,
      updated_at: null,
      source_file: record._meta.source_file,
      ingestion_run_id: record._meta.run_id,
      ingestion_timestamp: record._meta.ingestion_timestamp
    };
  }

  /**
   * Transforms and normalizes Transaction records.
   */
  transformTransaction(record) {
    const utcTxTimestamp = this.normalizeTimestampToUtc(record.transaction_timestamp);
    const txDate = this.deriveDate(utcTxTimestamp);
    const normalizedAmount = this.normalizeAmount(record.amount);
    const normalizedType = String(record.transaction_type).trim().toUpperCase();
    const normalizedCurrency = String(record.currency).trim().toUpperCase();

    return {
      transaction_id: String(record.transaction_id).trim(),
      customer_id: String(record.customer_id).trim(),
      transaction_type: normalizedType,
      amount: normalizedAmount,
      currency: normalizedCurrency,
      transaction_timestamp: utcTxTimestamp,
      transaction_date: txDate,
      source_file: record._meta.source_file,
      ingestion_run_id: record._meta.run_id,
      ingestion_timestamp: record._meta.ingestion_timestamp
    };
  }

  /**
   * Sorts records chronologically to handle out-of-order and late-arriving events.
   */
  sortChronologically(records) {
    return [...records].sort((a, b) => {
      const timeA = new Date(a.transaction_timestamp).getTime();
      const timeB = new Date(b.transaction_timestamp).getTime();
      if (timeA !== timeB) return timeA - timeB;
      return a.transaction_id.localeCompare(b.transaction_id);
    });
  }

  /**
   * Partitions curated transaction records into file lake partitioned by date:
   * /data/curated/transactions/date=YYYY-MM-DD/part-{run_id}.json
   */
  async partitionToCuratedZone(transactions, runId) {
    if (!transactions || transactions.length === 0) return;

    const baseLakeDir = path.join(this.curatedDir, 'transactions');
    const partitions = new Map();

    for (const tx of transactions) {
      const datePart = tx.transaction_date;
      if (!partitions.has(datePart)) {
        partitions.set(datePart, []);
      }
      partitions.get(datePart).push(tx);
    }

    for (const [datePart, txList] of partitions.entries()) {
      const partDir = path.join(baseLakeDir, `date=${datePart}`);
      if (!fs.existsSync(partDir)) {
        fs.mkdirSync(partDir, { recursive: true });
      }
      const partFile = path.join(partDir, `part-${runId}.json`);
      fs.writeFileSync(partFile, JSON.stringify(txList, null, 2), 'utf8');
    }

    logger.debug(`Partitioned ${transactions.length} curated transactions across ${partitions.size} date partitions`, {
      runId,
      partitionCount: partitions.size
    });
  }
}

export default new TransformationService();
