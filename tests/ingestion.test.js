import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import path from 'path';
import ingestionService from '../src/ingestion/ingestionService.js';

const TEST_DIR = path.resolve('data/test_ingestion_fixtures');

describe('Ingestion Service Unit Tests', () => {
  before(() => {
    if (!fs.existsSync(TEST_DIR)) {
      fs.mkdirSync(TEST_DIR, { recursive: true });
    }
  });

  after(() => {
    if (fs.existsSync(TEST_DIR)) {
      fs.rmSync(TEST_DIR, { recursive: true, force: true });
    }
  });

  test('Computes deterministic SHA-256 hash of a file', async () => {
    const filePath = path.join(TEST_DIR, 'sample.txt');
    fs.writeFileSync(filePath, 'Hello Data Engineering Pipeline', 'utf8');

    const hash1 = await ingestionService.computeFileHash(filePath);
    const hash2 = await ingestionService.computeFileHash(filePath);

    assert.equal(typeof hash1, 'string');
    assert.equal(hash1.length, 64);
    assert.equal(hash1, hash2, 'Hash should be deterministic');
  });

  test('Correctly parses valid CSV files into structured objects', async () => {
    const csvPath = path.join(TEST_DIR, 'valid_customers.csv');
    const content = 'customer_id,customer_name,email,created_at\nCUST-001,John Doe,john@example.com,2026-01-01T00:00:00Z\n';
    fs.writeFileSync(csvPath, content, 'utf8');

    const records = await ingestionService.parseFileRecords(csvPath, {
      fileName: 'valid_customers.csv',
      ext: '.csv'
    }, 'RUN-TEST-01');

    assert.equal(records.length, 1);
    assert.equal(records[0].customer_id, 'CUST-001');
    assert.equal(records[0].customer_name, 'John Doe');
    assert.equal(records[0]._meta.source_file, 'valid_customers.csv');
    assert.equal(records[0]._meta.run_id, 'RUN-TEST-01');
  });

  test('Correctly parses JSON array and NDJSON formats', async () => {
    // Array format
    const jsonPath = path.join(TEST_DIR, 'valid_tx.json');
    const arrayData = [
      { transaction_id: 'TXN-101', customer_id: 'CUST-001', amount: 150.0 }
    ];
    fs.writeFileSync(jsonPath, JSON.stringify(arrayData), 'utf8');

    const records = await ingestionService.parseFileRecords(jsonPath, {
      fileName: 'valid_tx.json',
      ext: '.json'
    }, 'RUN-TEST-02');

    assert.equal(records.length, 1);
    assert.equal(records[0].transaction_id, 'TXN-101');

    // NDJSON format
    const ndjsonPath = path.join(TEST_DIR, 'valid_tx.ndjson');
    fs.writeFileSync(ndjsonPath, '{"transaction_id":"TXN-102","amount":50}\n{"transaction_id":"TXN-103","amount":75}\n');
    const ndRecords = await ingestionService.parseFileRecords(ndjsonPath, {
      fileName: 'valid_tx.ndjson',
      ext: '.json'
    }, 'RUN-TEST-02');

    assert.equal(ndRecords.length, 2);
    assert.equal(ndRecords[1].transaction_id, 'TXN-103');
  });

  test('Handles malformed JSON syntax gracefully without crashing process', async () => {
    const badJsonPath = path.join(TEST_DIR, 'corrupt.json');
    fs.writeFileSync(badJsonPath, '[{"transaction_id": "TXN-999", UNQUOTED_BROKEN_SYNTAX', 'utf8');

    await assert.rejects(
      async () => {
        await ingestionService.parseFileRecords(badJsonPath, {
          fileName: 'corrupt.json',
          ext: '.json'
        }, 'RUN-TEST-03');
      },
      /Malformed JSON file syntax/
    );
  });
});
