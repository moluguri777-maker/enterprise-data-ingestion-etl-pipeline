import reconciliationService from './reconciliation/reconciliationService.js';
import db from './database/db.js';

async function main() {
  try {
    console.log('\n======================================================');
    console.log(' DATABASE RECONCILIATION & DATA INTEGRITY REPORT');
    console.log('======================================================\n');

    const report = await reconciliationService.runAuditReconciliation();

    console.log(`[INTEGRITY AUDIT STATUS]: ${report.integrityStatus === 'PASS' ? '✅ PASS (Zero duplicates, Zero orphaned keys)' : '❌ FAIL'}\n`);

    console.log('--- CURATED TOTALS ---');
    console.table([
      { Entity: 'Customers', TotalRecords: report.curatedCounts.totalCustomers },
      { Entity: 'Transactions', TotalRecords: report.curatedCounts.totalTransactions },
      { Entity: 'Quarantined Rejections', TotalRecords: report.quarantineMetrics.totalQuarantined }
    ]);

    console.log('\n--- DATA INTEGRITY ASSERTIONS ---');
    console.table([
      { Check: 'Duplicate Transaction IDs in Curated DB', Violations: report.integrityChecks.duplicateTransactionsFound, Status: report.integrityChecks.duplicateTransactionsFound === 0 ? 'CLEAN' : 'VIOLATION' },
      { Check: 'Orphaned Foreign Keys (Missing Customers)', Violations: report.integrityChecks.orphanedTransactionsFound, Status: report.integrityChecks.orphanedTransactionsFound === 0 ? 'CLEAN' : 'VIOLATION' }
    ]);

    console.log('\n--- FINANCIAL TOTALS BY CURRENCY ---');
    console.table(report.financialMetrics.currencyBreakdown);

    console.log('\n--- TOP CUSTOMERS BY VOLUME ---');
    console.table(report.customerMetrics.topCustomers);

    console.log('\n--- RECENT PIPELINE RUNS ---');
    console.table(report.recentRuns);

    await db.close();
    process.exit(0);
  } catch (err) {
    console.error('Reconciliation failed:', err);
    process.exit(1);
  }
}

main();
