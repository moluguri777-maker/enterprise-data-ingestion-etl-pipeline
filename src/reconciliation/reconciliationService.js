import db from '../database/db.js';
import logger from '../monitoring/logger.js';

export class ReconciliationService {
  /**
   * Executes reconciliation SQL queries against Curated Zone and Audit tables.
   */
  async runAuditReconciliation() {
    await db.initSchema();

    // 1. Total transaction count in Curated DB
    const [totTxRow] = await db.query('SELECT COUNT(*) AS total_transactions FROM transactions');
    const totalTransactions = Number(totTxRow.total_transactions || 0);

    // 2. Total customers in Curated DB
    const [totCustRow] = await db.query('SELECT COUNT(*) AS total_customers FROM customers');
    const totalCustomers = Number(totCustRow.total_customers || 0);

    // 3. Transactions grouped by date
    const dateBreakdown = await db.query(
      `SELECT transaction_date, COUNT(*) AS count, ROUND(SUM(amount), 2) AS total_amount
       FROM transactions 
       GROUP BY transaction_date 
       ORDER BY transaction_date DESC 
       LIMIT 15`
    );

    // 4. Total transaction amount by currency
    const currencyTotals = await db.query(
      `SELECT currency, COUNT(*) AS count, ROUND(SUM(amount), 2) AS total_amount
       FROM transactions 
       GROUP BY currency 
       ORDER BY currency ASC`
    );

    // 5. Customer-wise transaction counts (Top 10)
    const topCustomers = await db.query(
      `SELECT t.customer_id, c.customer_name, COUNT(*) AS transaction_count, ROUND(SUM(t.amount), 2) AS total_spent
       FROM transactions t
       JOIN customers c ON t.customer_id = c.customer_id
       GROUP BY t.customer_id, c.customer_name
       ORDER BY transaction_count DESC
       LIMIT 10`
    );

    // 6. Duplicate transaction check (Integrity constraint check: should be 0)
    const duplicateCheck = await db.query(
      `SELECT transaction_id, COUNT(*) AS occurence_count 
       FROM transactions 
       GROUP BY transaction_id 
       HAVING COUNT(*) > 1`
    );

    // 7. Invalid reference / orphaned transactions check (Foreign key verification: should be 0)
    const orphanedCheck = await db.query(
      `SELECT t.transaction_id, t.customer_id 
       FROM transactions t 
       LEFT JOIN customers c ON t.customer_id = c.customer_id 
       WHERE c.customer_id IS NULL`
    );

    // 8. Rejected records breakdown
    const rejectedBreakdown = await db.query(
      `SELECT entity_type, rejection_reason, COUNT(*) as count 
       FROM rejected_records 
       GROUP BY entity_type, rejection_reason 
       ORDER BY count DESC`
    );

    // 9. Pipeline Runs summary
    const recentRuns = await db.query(
      `SELECT run_id, start_time, execution_status, input_records_count, inserted_records_count, duplicate_records_count, rejected_records_count, processing_duration_ms
       FROM pipeline_runs 
       ORDER BY start_time DESC 
       LIMIT 10`
    );

    const isIntegrityValid = duplicateCheck.length === 0 && orphanedCheck.length === 0;

    return {
      integrityStatus: isIntegrityValid ? 'PASS' : 'FAIL',
      curatedCounts: {
        totalCustomers,
        totalTransactions
      },
      integrityChecks: {
        duplicateTransactionsFound: duplicateCheck.length,
        orphanedTransactionsFound: orphanedCheck.length,
        details: {
          duplicateViolations: duplicateCheck,
          orphanedViolations: orphanedCheck
        }
      },
      financialMetrics: {
        currencyBreakdown: currencyTotals,
        dateBreakdown
      },
      customerMetrics: {
        topCustomers
      },
      quarantineMetrics: {
        totalQuarantined: rejectedBreakdown.reduce((acc, row) => acc + Number(row.count), 0),
        breakdown: rejectedBreakdown
      },
      recentRuns
    };
  }
}

export default new ReconciliationService();
