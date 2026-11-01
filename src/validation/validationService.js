import path from 'path';
import fs from 'fs';
import config from '../../config/config.js';
import logger from '../monitoring/logger.js';

const EMAIL_REGEX = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}$/;

const EXPECTED_CUSTOMER_FIELDS = new Set([
  'customer_id',
  'customer_name',
  'email',
  'created_at'
]);

const EXPECTED_TRANSACTION_FIELDS = new Set([
  'transaction_id',
  'customer_id',
  'transaction_type',
  'amount',
  'currency',
  'transaction_timestamp'
]);

export class ValidationService {
  constructor(options = {}) {
    this.rejectedDir = options.rejectedDir || config.storage.rejected;
    this.validatedDir = options.validatedDir || config.storage.validated;
  }

  /**
   * Identifies whether a raw row belongs to the Customer or Transaction entity schema.
   */
  detectEntityType(record) {
    if (record.__malformed_raw !== undefined) {
      return 'MALFORMED';
    }
    if (record.transaction_id !== undefined || record.transaction_type !== undefined) {
      return 'TRANSACTION';
    }
    if (record.customer_name !== undefined || (record.email !== undefined && record.transaction_id === undefined)) {
      return 'CUSTOMER';
    }
    return 'UNKNOWN';
  }

  /**
   * Validates an ISO timestamp string.
   */
  isValidTimestamp(val) {
    if (!val || typeof val !== 'string') return false;
    const date = new Date(val);
    if (isNaN(date.getTime())) return false;
    // Check reasonable year range (e.g. 2000 to 2099)
    const year = date.getUTCFullYear();
    return year >= 2000 && year <= 2099;
  }

  /**
   * Validates Customer Entity records.
   */
  validateCustomer(record) {
    const reasons = [];

    // Check unknown/unexpected schema drift fields (excluding metadata tags)
    const keys = Object.keys(record).filter((k) => !k.startsWith('_'));
    const unexpectedFields = keys.filter((k) => !EXPECTED_CUSTOMER_FIELDS.has(k));
    if (unexpectedFields.length > 0) {
      reasons.push(`Unexpected schema columns detected: ${unexpectedFields.join(', ')}`);
    }

    // Required fields check
    if (!record.customer_id || String(record.customer_id).trim() === '') {
      reasons.push('Missing required field: customer_id');
    }
    if (!record.customer_name || String(record.customer_name).trim() === '') {
      reasons.push('Missing required field: customer_name');
    }
    if (!record.email || String(record.email).trim() === '') {
      reasons.push('Missing required field: email');
    } else if (!EMAIL_REGEX.test(String(record.email).trim())) {
      reasons.push(`Invalid email format: '${record.email}'`);
    }

    if (!record.created_at || String(record.created_at).trim() === '') {
      reasons.push('Missing required field: created_at');
    } else if (!this.isValidTimestamp(record.created_at)) {
      reasons.push(`Invalid timestamp format in created_at: '${record.created_at}'`);
    }

    return {
      isValid: reasons.length === 0,
      reasons,
      recordId: record.customer_id || null
    };
  }

  /**
   * Validates Transaction Entity records.
   * @param {Object} record - Transaction data with _meta
   * @param {Set<string>} validCustomerIds - Set of known valid customer IDs (from DB + current batch)
   */
  validateTransaction(record, validCustomerIds = null) {
    const reasons = [];

    // Check for malformed JSON raw lines
    if (record.__malformed_raw !== undefined) {
      return {
        isValid: false,
        reasons: [`Malformed JSON row at line ${record.__line_number}: ${record.__error}`],
        recordId: null
      };
    }

    // Check unexpected schema drift fields
    const keys = Object.keys(record).filter((k) => !k.startsWith('_'));
    const unexpectedFields = keys.filter((k) => !EXPECTED_TRANSACTION_FIELDS.has(k));
    if (unexpectedFields.length > 0) {
      reasons.push(`Unexpected schema columns detected: ${unexpectedFields.join(', ')}`);
    }

    // Required fields check
    if (!record.transaction_id || String(record.transaction_id).trim() === '') {
      reasons.push('Missing required field: transaction_id');
    }
    if (!record.customer_id || String(record.customer_id).trim() === '') {
      reasons.push('Missing required field: customer_id');
    } else if (validCustomerIds && !validCustomerIds.has(String(record.customer_id).trim())) {
      reasons.push(`Invalid customer reference: customer_id '${record.customer_id}' does not exist`);
    }

    // Transaction Type
    if (!record.transaction_type || String(record.transaction_type).trim() === '') {
      reasons.push('Missing required field: transaction_type');
    } else {
      const type = String(record.transaction_type).trim().toUpperCase();
      if (!config.pipeline.allowedTransactionTypes.includes(type)) {
        reasons.push(`Invalid transaction_type: '${record.transaction_type}'. Must be one of [${config.pipeline.allowedTransactionTypes.join(', ')}]`);
      }
    }

    // Amount validation
    if (record.amount === undefined || record.amount === null || String(record.amount).trim() === '') {
      reasons.push('Missing required field: amount');
    } else {
      const parsedAmount = Number(record.amount);
      if (isNaN(parsedAmount) || !isFinite(parsedAmount)) {
        reasons.push(`Invalid numeric amount: '${record.amount}'`);
      } else if (parsedAmount < 0) {
        reasons.push(`Negative amount violation: ${parsedAmount}. Amounts must be non-negative.`);
      }
    }

    // Currency validation
    if (!record.currency || String(record.currency).trim() === '') {
      reasons.push('Missing required field: currency');
    } else {
      const curr = String(record.currency).trim().toUpperCase();
      if (!config.pipeline.allowedCurrencies.includes(curr)) {
        reasons.push(`Invalid currency: '${record.currency}'. Allowed currencies: [${config.pipeline.allowedCurrencies.join(', ')}]`);
      }
    }

    // Transaction Timestamp
    if (!record.transaction_timestamp || String(record.transaction_timestamp).trim() === '') {
      reasons.push('Missing required field: transaction_timestamp');
    } else if (!this.isValidTimestamp(record.transaction_timestamp)) {
      reasons.push(`Invalid timestamp format in transaction_timestamp: '${record.transaction_timestamp}'`);
    }

    return {
      isValid: reasons.length === 0,
      reasons,
      recordId: record.transaction_id || null
    };
  }

  /**
   * Persists rejected records to the REJECTED zone partitioned by run_id.
   * Format: /data/rejected/{run_id}/rejected_records.json
   */
  async persistRejectedRecords(rejectedList, runId) {
    if (!rejectedList || rejectedList.length === 0) return;

    const runRejectedDir = path.join(this.rejectedDir, runId);
    if (!fs.existsSync(runRejectedDir)) {
      fs.mkdirSync(runRejectedDir, { recursive: true });
    }

    const filePath = path.join(runRejectedDir, 'rejected_records.json');
    fs.writeFileSync(filePath, JSON.stringify(rejectedList, null, 2), 'utf8');

    logger.warn(`Persisted ${rejectedList.length} rejected records to REJECTED zone`, {
      runId,
      path: filePath
    });
  }

  /**
   * Persists validated records to the VALIDATED zone partitioned by run_id.
   */
  async persistValidatedRecords(validatedList, runId, entityType) {
    if (!validatedList || validatedList.length === 0) return;

    const runValidatedDir = path.join(this.validatedDir, runId);
    if (!fs.existsSync(runValidatedDir)) {
      fs.mkdirSync(runValidatedDir, { recursive: true });
    }

    const filePath = path.join(runValidatedDir, `${entityType.toLowerCase()}_validated.json`);
    fs.writeFileSync(filePath, JSON.stringify(validatedList, null, 2), 'utf8');

    logger.debug(`Persisted ${validatedList.length} validated ${entityType} records to VALIDATED zone`, {
      runId,
      path: filePath
    });
  }
}

export default new ValidationService();
