import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import db from '../src/database/db.js';
import publishingService from '../src/publishing/publishingService.js';

describe('Idempotency & Deduplication Integration Tests', () => {
  const TEST_RUN_ID = 'RUN-IDEMP-TEST-01';

  before(async () => {
    await db.initSchema();
    // Clean test tables to ensure test isolation across test runs
    await db.execute('DELETE FROM transactions');
    await db.execute('DELETE FROM customers');
    await db.execute('DELETE FROM processed_files');
    await db.execute('DELETE FROM rejected_records');
    await db.execute('DELETE FROM pipeline_runs');

    // Insert prerequisite customer
    await publishingService.publishCustomers([
      {
        customer_id: 'CUST-IDEMP-1',
        customer_name: 'Idempotency Tester',
        email: 'idemp@example.com',
        created_at: '2026-01-01T00:00:00Z',
        source_file: 'test_customers.csv',
        ingestion_run_id: TEST_RUN_ID,
        ingestion_timestamp: '2026-01-01T00:05:00Z'
      }
    ], TEST_RUN_ID);
  });

  after(async () => {
    await db.close();
  });

  test('Publishes initial transactions cleanly and counts inserted records', async () => {
    const transactions = [
      {
        transaction_id: 'TXN-IDEMP-100',
        customer_id: 'CUST-IDEMP-1',
        transaction_type: 'SALE',
        amount: 50.00,
        currency: 'USD',
        transaction_timestamp: '2026-01-10T10:00:00.000Z',
        transaction_date: '2026-01-10',
        source_file: 'batch_01.csv',
        ingestion_timestamp: '2026-01-10T10:05:00.000Z',
        ingestion_run_id: TEST_RUN_ID
      }
    ];

    const result = await publishingService.publishTransactions(transactions, TEST_RUN_ID);
    assert.equal(result.inserted, 1);
    assert.equal(result.duplicates, 0);
    assert.equal(result.conflicts.length, 0);
  });

  test('Re-running the identical record produces 0 inserts and 1 duplicate count (Strict Idempotency)', async () => {
    const transactions = [
      {
        transaction_id: 'TXN-IDEMP-100',
        customer_id: 'CUST-IDEMP-1',
        transaction_type: 'SALE',
        amount: 50.00,
        currency: 'USD',
        transaction_timestamp: '2026-01-10T10:00:00.000Z',
        transaction_date: '2026-01-10',
        source_file: 'batch_01.csv',
        ingestion_timestamp: '2026-01-10T10:05:00.000Z',
        ingestion_run_id: 'RUN-IDEMP-RERUN-02'
      }
    ];

    const result = await publishingService.publishTransactions(transactions, 'RUN-IDEMP-RERUN-02');
    assert.equal(result.inserted, 0, 'Must not insert duplicate record');
    assert.equal(result.duplicates, 1, 'Must count as duplicate record');
    assert.equal(result.conflicts.length, 0, 'Identical duplicate should not be flagged as conflict');
  });

  test('Detects conflicting duplicate record (same transaction_id with different amount) and quarantines as conflict', async () => {
    const conflictingTransactions = [
      {
        transaction_id: 'TXN-IDEMP-100',
        customer_id: 'CUST-IDEMP-1',
        transaction_type: 'SALE',
        amount: 9999.00, // Conflicting amount!
        currency: 'USD',
        transaction_timestamp: '2026-01-10T10:00:00.000Z',
        transaction_date: '2026-01-10',
        source_file: 'tampered_batch.csv',
        ingestion_timestamp: '2026-01-10T10:05:00.000Z',
        ingestion_run_id: 'RUN-CONFLICT-03'
      }
    ];

    const result = await publishingService.publishTransactions(conflictingTransactions, 'RUN-CONFLICT-03');
    assert.equal(result.inserted, 0);
    assert.equal(result.conflicts.length, 1);
    assert.ok(result.conflicts[0].reason.includes('Primary key conflict'));
  });

  test('Safely handles mixed batches containing both new and duplicate records', async () => {
    const mixedBatch = [
      // Duplicate
      {
        transaction_id: 'TXN-IDEMP-100',
        customer_id: 'CUST-IDEMP-1',
        transaction_type: 'SALE',
        amount: 50.00,
        currency: 'USD',
        transaction_timestamp: '2026-01-10T10:00:00.000Z',
        transaction_date: '2026-01-10',
        source_file: 'mixed.csv',
        ingestion_timestamp: '2026-01-10T10:05:00.000Z',
        ingestion_run_id: 'RUN-MIXED-04'
      },
      // Brand new transaction
      {
        transaction_id: 'TXN-IDEMP-101',
        customer_id: 'CUST-IDEMP-1',
        transaction_type: 'PAYMENT',
        amount: 75.25,
        currency: 'USD',
        transaction_timestamp: '2026-01-11T12:00:00.000Z',
        transaction_date: '2026-01-11',
        source_file: 'mixed.csv',
        ingestion_timestamp: '2026-01-11T12:05:00.000Z',
        ingestion_run_id: 'RUN-MIXED-04'
      }
    ];

    const result = await publishingService.publishTransactions(mixedBatch, 'RUN-MIXED-04');
    assert.equal(result.inserted, 1, 'Only the new transaction should be inserted');
    assert.equal(result.duplicates, 1, 'The existing transaction should be marked duplicate');
  });
});
