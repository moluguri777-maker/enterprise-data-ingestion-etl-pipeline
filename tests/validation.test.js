import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import validationService from '../src/validation/validationService.js';

describe('Validation Service Unit Tests', () => {
  const validCustomerIds = new Set(['CUST-001', 'CUST-002']);

  test('Accepts perfectly valid customer record', () => {
    const record = {
      customer_id: 'CUST-001',
      customer_name: 'Priya Sharma',
      email: 'priya.sharma@example.com',
      created_at: '2026-01-15T10:30:00Z'
    };

    const res = validationService.validateCustomer(record);
    assert.equal(res.isValid, true);
    assert.equal(res.reasons.length, 0);
  });

  test('Rejects customer with missing required fields and invalid email', () => {
    const record = {
      customer_id: '',
      customer_name: 'Bob',
      email: 'not-an-email',
      created_at: 'invalid-date'
    };

    const res = validationService.validateCustomer(record);
    assert.equal(res.isValid, false);
    assert.ok(res.reasons.some((r) => r.includes('Missing required field: customer_id')));
    assert.ok(res.reasons.some((r) => r.includes('Invalid email format')));
    assert.ok(res.reasons.some((r) => r.includes('Invalid timestamp format')));
  });

  test('Detects unexpected schema changes / columns in customer record', () => {
    const record = {
      customer_id: 'CUST-001',
      customer_name: 'Priya Sharma',
      email: 'priya.sharma@example.com',
      created_at: '2026-01-15T10:30:00Z',
      unauthorized_credit_score: 850
    };

    const res = validationService.validateCustomer(record);
    assert.equal(res.isValid, false);
    assert.ok(res.reasons.some((r) => r.includes('Unexpected schema columns detected')));
  });

  test('Accepts valid transaction referencing an existing customer', () => {
    const record = {
      transaction_id: 'TXN-1001',
      customer_id: 'CUST-001',
      transaction_type: 'SALE',
      amount: 199.99,
      currency: 'USD',
      transaction_timestamp: '2026-02-01T14:20:00Z'
    };

    const res = validationService.validateTransaction(record, validCustomerIds);
    assert.equal(res.isValid, true);
  });

  test('Rejects transaction with invalid foreign key customer reference', () => {
    const record = {
      transaction_id: 'TXN-1002',
      customer_id: 'CUST-NONEXISTENT',
      transaction_type: 'PAYMENT',
      amount: 50.0,
      currency: 'INR',
      transaction_timestamp: '2026-02-01T14:20:00Z'
    };

    const res = validationService.validateTransaction(record, validCustomerIds);
    assert.equal(res.isValid, false);
    assert.ok(res.reasons.some((r) => r.includes('Invalid customer reference')));
  });

  test('Rejects negative transaction amount violation', () => {
    const record = {
      transaction_id: 'TXN-1003',
      customer_id: 'CUST-001',
      transaction_type: 'SALE',
      amount: -45.0,
      currency: 'USD',
      transaction_timestamp: '2026-02-01T14:20:00Z'
    };

    const res = validationService.validateTransaction(record, validCustomerIds);
    assert.equal(res.isValid, false);
    assert.ok(res.reasons.some((r) => r.includes('Negative amount violation')));
  });

  test('Rejects invalid currency and invalid transaction type', () => {
    const record = {
      transaction_id: 'TXN-1004',
      customer_id: 'CUST-001',
      transaction_type: 'BITCOIN_EXCHANGE',
      amount: 100.0,
      currency: 'EUR',
      transaction_timestamp: '2026-02-01T14:20:00Z'
    };

    const res = validationService.validateTransaction(record, validCustomerIds);
    assert.equal(res.isValid, false);
    assert.ok(res.reasons.some((r) => r.includes('Invalid transaction_type')));
    assert.ok(res.reasons.some((r) => r.includes('Invalid currency')));
  });

  test('Rejects null values for required fields', () => {
    const record = {
      transaction_id: 'TXN-1005',
      customer_id: 'CUST-001',
      transaction_type: 'SALE',
      amount: null,
      currency: 'USD',
      transaction_timestamp: '2026-02-01T14:20:00Z'
    };

    const res = validationService.validateTransaction(record, validCustomerIds);
    assert.equal(res.isValid, false);
    assert.ok(res.reasons.some((r) => r.includes('Missing required field: amount')));
  });
});
