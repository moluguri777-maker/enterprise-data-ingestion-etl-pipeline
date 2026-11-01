import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import config from '../config/config.js';
import { runPipeline } from '../src/pipeline.js';
import db from '../src/database/db.js';

describe('Pipeline Edge Cases & Resilience Tests', () => {
  before(async () => {
    await db.initSchema();
    await db.execute('DELETE FROM transactions');
    await db.execute('DELETE FROM customers');
    await db.execute('DELETE FROM processed_files');
    await db.execute('DELETE FROM rejected_records');
    await db.execute('DELETE FROM pipeline_runs');
  });

  after(async () => {
    await db.close();
  });

  test('Gracefully handles empty incoming directory (Empty Batch)', async () => {
    // Clear incoming directory
    const incomingDir = config.storage.incoming;
    if (fs.existsSync(incomingDir)) {
      const files = fs.readdirSync(incomingDir);
      for (const f of files) {
        fs.unlinkSync(path.join(incomingDir, f));
      }
    }

    const runId = `RUN-EDGE-EMPTY-${Date.now()}`;
    const result = await runPipeline({ runId });
    assert.equal(result.status, 'COMPLETED');
    assert.equal(result.summary.counts.inputFilesCount, 0);
    assert.equal(result.summary.counts.inputRecordsCount, 0);
    assert.equal(result.summary.reconciliation.isReconciled, true);
  });

  test('Recovers from partial file failure without halting pipeline', async () => {
    const incomingDir = config.storage.incoming;

    // Write one valid file and one corrupt file
    const validFile = path.join(incomingDir, 'customers_partial_test.csv');
    fs.writeFileSync(
      validFile,
      'customer_id,customer_name,email,created_at\nCUST-EDGE-01,Edge User,edge@example.com,2026-01-01T00:00:00Z\n',
      'utf8'
    );

    const corruptFile = path.join(incomingDir, 'corrupt_data.json');
    fs.writeFileSync(corruptFile, '{ invalid json syntax without closing braces', 'utf8');

    const runId = `RUN-EDGE-PARTIAL-${Date.now()}`;
    const result = await runPipeline({ runId });

    assert.ok(result.summary.counts.inputFilesCount >= 1);
    assert.ok(result.summary.counts.rejectedRecordsCount >= 1, 'Corrupt file should be quarantined');
    assert.ok(result.summary.counts.insertedRecordsCount >= 1, 'Valid customers should be ingested');
    assert.equal(result.summary.reconciliation.isReconciled, true, 'Reconciliation should balance');

    // Clean up test files
    if (fs.existsSync(validFile)) fs.unlinkSync(validFile);
    if (fs.existsSync(corruptFile)) fs.unlinkSync(corruptFile);
  });

  test('Processes late-arriving and out-of-order events without state corruption', async () => {
    const incomingDir = config.storage.incoming;

    // Transaction with late-arriving timestamp (e.g. from 60 days ago)
    const lateTxFile = path.join(incomingDir, 'late_arriving_tx.json');
    const lateData = [
      {
        transaction_id: 'TXN-LATE-001',
        customer_id: 'CUST-EDGE-01',
        transaction_type: 'PAYMENT',
        amount: 250.00,
        currency: 'USD',
        transaction_timestamp: '2025-11-01T04:00:00.000Z'
      }
    ];
    fs.writeFileSync(lateTxFile, JSON.stringify(lateData), 'utf8');

    const runId = `RUN-EDGE-LATE-${Date.now()}`;
    const result = await runPipeline({ runId });
    assert.ok(result.summary.counts.insertedRecordsCount >= 1);

    // Verify it is queryable in curated DB with its historical date
    const rows = await db.query('SELECT transaction_date FROM transactions WHERE transaction_id = ?', ['TXN-LATE-001']);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].transaction_date, '2025-11-01');

    if (fs.existsSync(lateTxFile)) fs.unlinkSync(lateTxFile);
  });
});
