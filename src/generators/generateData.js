import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { stringify } from 'csv-stringify/sync';
import config, { ensureDirectories } from '../../config/config.js';
import logger from '../monitoring/logger.js';

// Deterministic Pseudo-Random Number Generator (Mulberry32)
class SeededRNG {
  constructor(seed = 123456789) {
    this.s = seed >>> 0;
  }

  next() {
    this.s |= 0;
    this.s = (this.s + 0x6d2b79f5) | 0;
    let t = Math.imul(this.s ^ (this.s >>> 15), 1 | this.s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  nextInt(min, max) {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  pick(array) {
    return array[this.nextInt(0, array.length - 1)];
  }
}

const FIRST_NAMES = ['Aarav', 'Diya', 'Rahul', 'Priya', 'Aditya', 'Ananya', 'Rohan', 'Sneha', 'Vikram', 'Neha', 'Alex', 'Sarah', 'Michael', 'Emma', 'David'];
const LAST_NAMES = ['Sharma', 'Patel', 'Verma', 'Rao', 'Gupta', 'Singh', 'Nair', 'Mehta', 'Kulkarni', 'Joshi', 'Smith', 'Johnson', 'Williams', 'Brown', 'Jones'];
const CURRENCIES = ['INR', 'USD'];
const TX_TYPES = ['SALE', 'REFUND', 'PAYMENT'];

export function generateSyntheticDataset(options = {}) {
  ensureDirectories();

  const seed = options.seed || 42;
  const rng = new SeededRNG(seed);
  const customerCount = options.customerCount || 100;
  const transactionCount = options.transactionCount || 1000;
  const outputDir = options.outputDir || config.storage.incoming;
  const groundTruthDir = options.groundTruthDir || path.resolve(config.rootDirectory, 'data');

  logger.info('Generating synthetic dataset with reproducible seed', {
    seed,
    customerCount,
    transactionCount,
    outputDir
  });

  const groundTruth = {
    seed,
    counts: {
      totalCustomers: customerCount,
      totalTransactions: transactionCount,
      validTransactions: 0,
      identicalDuplicateTransactions: 0,
      conflictingDuplicateTransactions: 0,
      invalidCustomerRefTransactions: 0,
      negativeAmountTransactions: 0,
      malformedTypeTransactions: 0,
      nullAmountTransactions: 0,
      invalidTimestampTransactions: 0,
      unexpectedSchemaTransactions: 0
    },
    labeledRecords: []
  };

  // 1. Generate Customers
  const customers = [];
  const validCustomerIds = [];

  for (let i = 1; i <= customerCount; i++) {
    const custId = `CUST-${String(i).padStart(5, '0')}`;
    const firstName = rng.pick(FIRST_NAMES);
    const lastName = rng.pick(LAST_NAMES);
    const email = `${firstName.toLowerCase()}.${lastName.toLowerCase()}${i}@example.com`;
    const createdAt = new Date(Date.now() - rng.nextInt(30, 365) * 86400000).toISOString();

    customers.push({
      customer_id: custId,
      customer_name: `${firstName} ${lastName}`,
      email,
      created_at: createdAt
    });
    validCustomerIds.push(custId);
  }

  // Inject a few customer edge cases
  if (customerCount >= 10) {
    // Malformed email
    customers.push({
      customer_id: `CUST-ERR-001`,
      customer_name: 'Invalid Email User',
      email: 'not-an-email-at-all',
      created_at: new Date().toISOString()
    });
    // Missing name
    customers.push({
      customer_id: `CUST-ERR-002`,
      customer_name: '',
      email: 'noname@example.com',
      created_at: new Date().toISOString()
    });
  }

  // 2. Generate Transactions
  const rawTransactions = [];
  const baseTime = Date.now() - 30 * 86400000;

  for (let i = 1; i <= transactionCount; i++) {
    const txId = `TXN-${String(i).padStart(7, '0')}`;
    const customerId = rng.pick(validCustomerIds);
    const txType = rng.pick(TX_TYPES);
    const currency = rng.pick(CURRENCIES);
    const amount = rng.nextInt(100, 250000) / 100; // e.g. 1.00 to 2500.00
    // Generate timestamps with random offsets (including late-arriving & out-of-order events)
    const timestampOffsetMs = rng.nextInt(0, 30 * 86400000);
    const timestamp = new Date(baseTime + timestampOffsetMs).toISOString();

    // Edge-case injection probability ~ 4%
    const edgeCaseRoll = rng.next();

    if (edgeCaseRoll < 0.005) {
      // Negative amount
      rawTransactions.push({
        transaction_id: txId,
        customer_id: customerId,
        transaction_type: txType,
        amount: -amount,
        currency,
        transaction_timestamp: timestamp
      });
      groundTruth.counts.negativeAmountTransactions++;
      groundTruth.labeledRecords.push({ id: txId, status: 'INVALID', reason: 'NEGATIVE_AMOUNT' });
    } else if (edgeCaseRoll < 0.010) {
      // Invalid foreign key customer reference
      const invalidCustId = `CUST-GHOST-${rng.nextInt(90000, 99999)}`;
      rawTransactions.push({
        transaction_id: txId,
        customer_id: invalidCustId,
        transaction_type: txType,
        amount,
        currency,
        transaction_timestamp: timestamp
      });
      groundTruth.counts.invalidCustomerRefTransactions++;
      groundTruth.labeledRecords.push({ id: txId, status: 'INVALID', reason: 'INVALID_CUSTOMER_FK' });
    } else if (edgeCaseRoll < 0.015) {
      // Invalid transaction type
      rawTransactions.push({
        transaction_id: txId,
        customer_id: customerId,
        transaction_type: 'CRYPTOCURRENCY_TRADE',
        amount,
        currency,
        transaction_timestamp: timestamp
      });
      groundTruth.counts.malformedTypeTransactions++;
      groundTruth.labeledRecords.push({ id: txId, status: 'INVALID', reason: 'INVALID_TRANSACTION_TYPE' });
    } else if (edgeCaseRoll < 0.020) {
      // Missing / null amount
      rawTransactions.push({
        transaction_id: txId,
        customer_id: customerId,
        transaction_type: txType,
        amount: '',
        currency,
        transaction_timestamp: timestamp
      });
      groundTruth.counts.nullAmountTransactions++;
      groundTruth.labeledRecords.push({ id: txId, status: 'INVALID', reason: 'NULL_AMOUNT' });
    } else if (edgeCaseRoll < 0.025) {
      // Invalid timestamp
      rawTransactions.push({
        transaction_id: txId,
        customer_id: customerId,
        transaction_type: txType,
        amount,
        currency,
        transaction_timestamp: 'INVALID_DATE_TIME_STRING'
      });
      groundTruth.counts.invalidTimestampTransactions++;
      groundTruth.labeledRecords.push({ id: txId, status: 'INVALID', reason: 'INVALID_TIMESTAMP' });
    } else if (edgeCaseRoll < 0.030) {
      // Unexpected schema drift column
      rawTransactions.push({
        transaction_id: txId,
        customer_id: customerId,
        transaction_type: txType,
        amount,
        currency,
        transaction_timestamp: timestamp,
        unauthorized_discount_code: 'SUPER_DISCOUNT'
      });
      groundTruth.counts.unexpectedSchemaTransactions++;
      groundTruth.labeledRecords.push({ id: txId, status: 'INVALID', reason: 'UNEXPECTED_SCHEMA_DRIFT' });
    } else {
      // Normal valid transaction
      rawTransactions.push({
        transaction_id: txId,
        customer_id: customerId,
        transaction_type: txType,
        amount,
        currency,
        transaction_timestamp: timestamp
      });
      groundTruth.counts.validTransactions++;
      groundTruth.labeledRecords.push({ id: txId, status: 'VALID', reason: null });
    }
  }

  // 3. Inject Duplicate Transactions (Identical and Conflicting)
  const duplicateCount = Math.max(2, Math.floor(transactionCount * 0.02));
  for (let d = 0; d < duplicateCount; d++) {
    const target = rawTransactions[rng.nextInt(0, rawTransactions.length - 1)];
    if (!target || !target.transaction_id) continue;

    if (d % 2 === 0) {
      // Identical duplicate
      rawTransactions.push({ ...target });
      groundTruth.counts.identicalDuplicateTransactions++;
      groundTruth.labeledRecords.push({ id: target.transaction_id, status: 'DUPLICATE', reason: 'IDENTICAL_DUPLICATE' });
    } else {
      // Conflicting duplicate (same ID, different amount)
      rawTransactions.push({
        ...target,
        amount: Number(target.amount || 10) + 999.0
      });
      groundTruth.counts.conflictingDuplicateTransactions++;
      groundTruth.labeledRecords.push({ id: target.transaction_id, status: 'CONFLICT', reason: 'CONFLICTING_DUPLICATE' });
    }
  }

  // 4. Output Files in data/incoming
  // Save Customers as CSV
  const customersCsv = stringify(customers, { header: true });
  const customersFile = path.join(outputDir, 'customers_batch_01.csv');
  fs.writeFileSync(customersFile, customersCsv, 'utf8');

  // Save half transactions as CSV, half as JSON to test multi-format ingestion
  const splitIndex = Math.floor(rawTransactions.length / 2);
  const txCsvList = rawTransactions.slice(0, splitIndex);
  const txJsonList = rawTransactions.slice(splitIndex);

  const txCsvContent = stringify(txCsvList, { header: true });
  const txCsvFile = path.join(outputDir, 'transactions_batch_01.csv');
  fs.writeFileSync(txCsvFile, txCsvContent, 'utf8');

  const txJsonFile = path.join(outputDir, 'transactions_batch_02.json');
  fs.writeFileSync(txJsonFile, JSON.stringify(txJsonList, null, 2), 'utf8');

  // Save ground truth audit file separately
  const groundTruthFile = path.join(groundTruthDir, 'ground_truth_labels.json');
  fs.writeFileSync(groundTruthFile, JSON.stringify(groundTruth, null, 2), 'utf8');

  logger.info('Synthetic data generated successfully', {
    customersFile,
    txCsvFile,
    txJsonFile,
    groundTruthFile,
    summary: groundTruth.counts
  });

  return {
    customersFile,
    txCsvFile,
    txJsonFile,
    groundTruthFile,
    groundTruth
  };
}

// CLI Argument Handling
const isDirectCli = process.argv[1] && (
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
  process.argv[1].endsWith('generateData.js') ||
  process.argv[1].endsWith('generateData')
);

if (isDirectCli) {
  const args = process.argv.slice(2);
  let size = 'small';
  let custCount = 50;
  let txCount = 200;

  for (const arg of args) {
    if (arg.startsWith('--size=')) {
      size = arg.split('=')[1];
      if (size === 'medium') {
        custCount = 500;
        txCount = 5000;
      } else if (size === 'large' || size === 'benchmark') {
        custCount = 5000;
        txCount = 100000;
      }
    }
    if (arg.startsWith('--count=')) {
      txCount = parseInt(arg.split('=')[1], 10);
      custCount = Math.max(20, Math.floor(txCount / 20));
    }
  }

  console.log(`Generating [${size}] dataset: ${custCount} customers, ${txCount} transactions...`);
  generateSyntheticDataset({ customerCount: custCount, transactionCount: txCount });
  console.log('Data generation finished.');
}

export default generateSyntheticDataset;
