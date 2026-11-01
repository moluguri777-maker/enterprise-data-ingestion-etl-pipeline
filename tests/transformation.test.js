import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import transformationService from '../src/transformation/transformationService.js';

describe('Transformation Service Unit Tests', () => {
  test('Normalizes timestamp to strict UTC ISO-8601 and derives transaction_date', () => {
    const rawTimestamp = '2026-05-14T18:45:30.000Z';
    const normalized = transformationService.normalizeTimestampToUtc(rawTimestamp);
    const derivedDate = transformationService.deriveDate(normalized);

    assert.equal(normalized, '2026-05-14T18:45:30.000Z');
    assert.equal(derivedDate, '2026-05-14');
  });

  test('Normalizes monetary amounts to 2 decimal places and handles floating point imprecision', () => {
    assert.equal(transformationService.normalizeAmount('120.5'), 120.5);
    assert.equal(transformationService.normalizeAmount(19.999), 20.0);
    assert.equal(transformationService.normalizeAmount(0.1 + 0.2), 0.3);
  });

  test('Transforms Customer record with casing normalization and lineage metadata', () => {
    const raw = {
      customer_id: '  CUST-009  ',
      customer_name: '  Rahul Patel  ',
      email: '  RAHUL.PATEL@EXAMPLE.COM  ',
      created_at: '2026-03-01T12:00:00Z',
      _meta: {
        source_file: 'cust_batch_1.csv',
        run_id: 'RUN-100',
        ingestion_timestamp: '2026-03-01T12:05:00Z'
      }
    };

    const transformed = transformationService.transformCustomer(raw);
    assert.equal(transformed.customer_id, 'CUST-009');
    assert.equal(transformed.customer_name, 'Rahul Patel');
    assert.equal(transformed.email, 'rahul.patel@example.com');
    assert.equal(transformed.source_file, 'cust_batch_1.csv');
    assert.equal(transformed.ingestion_run_id, 'RUN-100');
  });

  test('Correctly sorts out-of-order events chronologically', () => {
    const events = [
      { transaction_id: 'TXN-03', transaction_timestamp: '2026-04-10T15:00:00Z' },
      { transaction_id: 'TXN-01', transaction_timestamp: '2026-01-01T08:00:00Z' },
      { transaction_id: 'TXN-02', transaction_timestamp: '2026-02-15T12:00:00Z' }
    ];

    const sorted = transformationService.sortChronologically(events);
    assert.equal(sorted[0].transaction_id, 'TXN-01');
    assert.equal(sorted[1].transaction_id, 'TXN-02');
    assert.equal(sorted[2].transaction_id, 'TXN-03');
  });
});
