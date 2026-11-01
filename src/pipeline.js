import crypto from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import db from './database/db.js';
import ingestionService from './ingestion/ingestionService.js';
import validationService from './validation/validationService.js';
import transformationService from './transformation/transformationService.js';
import publishingService from './publishing/publishingService.js';
import MetricsService from './monitoring/metricsService.js';
import logger from './monitoring/logger.js';
import config, { ensureDirectories } from '../config/config.js';

export async function runPipeline(options = {}) {
  ensureDirectories();

  const runId = options.runId || `RUN-${Date.now()}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
  const metrics = new MetricsService(runId);

  logger.info(`Starting Pipeline Execution [${runId}]`, { runId });

  try {
    // 1. Initialize schema if necessary
    await db.initSchema();
    await publishingService.createPipelineRun(runId, metrics.startTime.toISOString());

    // 2. Discover incoming files
    const incomingFiles = await ingestionService.discoverIncomingFiles();
    logger.info(`Discovered ${incomingFiles.length} file(s) in incoming zone`, { runId, fileCount: incomingFiles.length });

    if (incomingFiles.length === 0) {
      logger.info('Incoming directory is empty. Pipeline run complete (empty batch).', { runId });
      metrics.finish('COMPLETED');
      await publishingService.finalizePipelineRun(metrics.getSummary());
      await metrics.exportReport();
      return {
        runId,
        status: 'COMPLETED',
        summary: metrics.getSummary()
      };
    }

    // 3. Load known customer IDs from database to validate foreign keys
    const knownCustomerIds = await publishingService.loadExistingCustomerIds();
    logger.info(`Pre-loaded ${knownCustomerIds.size} existing customer IDs for referential validation`, { runId });

    const allRawRecords = [];
    const allRejectedRecords = [];
    const validCustomers = [];
    const validTransactions = [];

    // 4. Ingestion & Validation Phase
    for (const fileInfo of incomingFiles) {
      const fileHash = await ingestionService.computeFileHash(fileInfo.filePath);
      const previousFile = await publishingService.checkFileProcessed(fileHash);
      const isDuplicateFile = Boolean(previousFile);

      logger.info(`Processing file: ${fileInfo.fileName}`, {
        runId,
        fileName: fileInfo.fileName,
        sizeBytes: fileInfo.sizeBytes,
        fileHash,
        isDuplicateDelivery: isDuplicateFile
      });

      // Preserve raw copy in RAW zone
      await ingestionService.archiveToRawZone(fileInfo, runId);

      // Parse records (CSV or JSON)
      let parsedRecords = [];
      try {
        parsedRecords = await ingestionService.parseFileRecords(fileInfo.filePath, fileInfo, runId);
      } catch (parseError) {
        logger.error(`Critical parsing error for file ${fileInfo.fileName}: ${parseError.message}`, { runId });
        allRejectedRecords.push({
          run_id: runId,
          source_file: fileInfo.fileName,
          entity_type: 'FILE_CORRUPTION',
          record_id: null,
          rejection_reason: `File format parse error: ${parseError.message}`,
          raw_record: { fileName: fileInfo.fileName },
          rejection_timestamp: new Date().toISOString()
        });
        metrics.recordRejection('FILE_CORRUPTION');
        continue;
      }

      metrics.recordFile({
        fileName: fileInfo.fileName,
        sizeBytes: fileInfo.sizeBytes,
        fileHash,
        recordCount: parsedRecords.length,
        isDuplicateDelivery: isDuplicateFile
      });

      metrics.inputRecordsCount += parsedRecords.length;

      // Validate each record
      for (const rawRecord of parsedRecords) {
        allRawRecords.push(rawRecord);
        const entityType = validationService.detectEntityType(rawRecord);

        if (entityType === 'CUSTOMER') {
          const valRes = validationService.validateCustomer(rawRecord);
          if (valRes.isValid) {
            validCustomers.push(rawRecord);
            // Register ID into knownCustomerIds set so subsequent transactions can reference it
            knownCustomerIds.add(String(rawRecord.customer_id).trim());
          } else {
            allRejectedRecords.push({
              run_id: runId,
              source_file: fileInfo.fileName,
              entity_type: 'CUSTOMER',
              record_id: valRes.recordId,
              rejection_reason: valRes.reasons.join(' | '),
              raw_record: rawRecord,
              rejection_timestamp: new Date().toISOString()
            });
            metrics.recordRejection(valRes.reasons[0] || 'Customer validation failure');
          }
        } else if (entityType === 'TRANSACTION') {
          const valRes = validationService.validateTransaction(rawRecord, knownCustomerIds);
          if (valRes.isValid) {
            validTransactions.push(rawRecord);
          } else {
            allRejectedRecords.push({
              run_id: runId,
              source_file: fileInfo.fileName,
              entity_type: 'TRANSACTION',
              record_id: valRes.recordId,
              rejection_reason: valRes.reasons.join(' | '),
              raw_record: rawRecord,
              rejection_timestamp: new Date().toISOString()
            });
            metrics.recordRejection(valRes.reasons[0] || 'Transaction validation failure');
          }
        } else {
          // Unknown / Malformed
          const reason = rawRecord.__error || 'Unrecognized record structure or missing identifying entity keys';
          allRejectedRecords.push({
            run_id: runId,
            source_file: fileInfo.fileName,
            entity_type: 'UNKNOWN',
            record_id: null,
            rejection_reason: reason,
            raw_record: rawRecord,
            rejection_timestamp: new Date().toISOString()
          });
          metrics.recordRejection(reason);
        }
      }
    }

    metrics.validRecordsCount = validCustomers.length + validTransactions.length;

    // 5. Transformation Phase
    logger.info('Transforming valid records...', {
      runId,
      validCustomersCount: validCustomers.length,
      validTransactionsCount: validTransactions.length
    });

    const transformedCustomers = validCustomers.map((c) => transformationService.transformCustomer(c));
    const transformedTransactions = validTransactions.map((t) => transformationService.transformTransaction(t));

    // Sort transactions chronologically to handle out-of-order & late arriving data
    const sortedTransactions = transformationService.sortChronologically(transformedTransactions);

    // 6. Persist to VALIDATED & REJECTED Zones
    await validationService.persistValidatedRecords(transformedCustomers, runId, 'CUSTOMERS');
    await validationService.persistValidatedRecords(sortedTransactions, runId, 'TRANSACTIONS');
    await validationService.persistRejectedRecords(allRejectedRecords, runId);

    // 7. Publishing to MySQL & CURATED Zone
    logger.info('Publishing curated records to database...', { runId });

    // Publish Customers first to satisfy FK dependencies
    const customerPubResult = await publishingService.publishCustomers(transformedCustomers, runId);
    metrics.insertedRecordsCount += customerPubResult.inserted;
    metrics.duplicateRecordsCount += customerPubResult.duplicates;
    metrics.updatedRecordsCount += customerPubResult.updated;

    // Publish Transactions
    const txPubResult = await publishingService.publishTransactions(sortedTransactions, runId);
    metrics.insertedRecordsCount += txPubResult.inserted;
    metrics.duplicateRecordsCount += txPubResult.duplicates;

    // If any conflicting records were detected during transaction publishing, quarantine them
    if (txPubResult.conflicts && txPubResult.conflicts.length > 0) {
      for (const conflict of txPubResult.conflicts) {
        allRejectedRecords.push({
          run_id: runId,
          source_file: conflict.record.source_file,
          entity_type: 'TRANSACTION_CONFLICT',
          record_id: conflict.record.transaction_id,
          rejection_reason: conflict.reason,
          raw_record: conflict.record,
          rejection_timestamp: new Date().toISOString()
        });
        metrics.recordRejection(conflict.reason);
      }
    }

    // Persist all rejected records to REJECTED filesystem zone
    await validationService.persistRejectedRecords(allRejectedRecords, runId);

    // Publish rejected records to database table for reconciliation queries
    await publishingService.publishRejectedRecords(allRejectedRecords);

    // Write partitioned curated transactions to filesystem lake
    await transformationService.partitionToCuratedZone(sortedTransactions, runId);

    // Update processed_files ledger for each file
    for (const f of metrics.fileMetrics) {
      await publishingService.recordProcessedFile(
        { fileName: f.fileName, sizeBytes: f.sizeBytes },
        f.fileHash,
        runId,
        f.recordCount,
        'PROCESSED'
      );
    }

    // Determine final status

let finalStatus = 'COMPLETED';

const successfullyProcessedRecords =
  metrics.insertedRecordsCount +
  metrics.duplicateRecordsCount +
  metrics.updatedRecordsCount;

if (metrics.rejectedRecordsCount > 0) {
  if (successfullyProcessedRecords > 0) {
    finalStatus = 'PARTIAL_SUCCESS';
  } else {
    finalStatus = 'ALL_REJECTED';
  }
}

metrics.finish(finalStatus);

    // Finalize pipeline run record in DB
    await publishingService.finalizePipelineRun(metrics.getSummary());

    // Generate JSON and CSV audit reports
    const reportFiles = await metrics.exportReport();

    logger.info(`Pipeline Execution ${runId} finished with status: ${finalStatus}`, {
      runId,
      status: finalStatus,
      durationMs: metrics.getDurationMs(),
      summary: metrics.getSummary().counts,
      reconciliation: metrics.getSummary().reconciliation
    });

    return {
      runId,
      status: finalStatus,
      reports: reportFiles,
      summary: metrics.getSummary()
    };
  } catch (fatalError) {
    logger.error(`Catastrophic pipeline failure in run ${runId}: ${fatalError.message}`, {
      runId,
      error: fatalError.message,
      stack: fatalError.stack
    });

    metrics.finish('FAILED', fatalError.message);
    try {
      await publishingService.finalizePipelineRun(metrics.getSummary());
      await metrics.exportReport();
    } catch (saveErr) {
      logger.error('Failed to persist failure metrics', { error: saveErr.message });
    }

    throw fatalError;
  }
}

// CLI direct execution support
const isDirectCli = process.argv[1] && (
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url) ||
  process.argv[1].endsWith('pipeline.js') ||
  process.argv[1].endsWith('pipeline')
);

if (isDirectCli) {
  runPipeline()
    .then((result) => {
      console.log('\n=============================================');
      console.log(' PIPELINE EXECUTION SUMMARY');
      console.log('=============================================');
      console.log(JSON.stringify(result.summary, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error('\nPipeline execution failed:', err.message);
      process.exit(1);
    });
}

export default runPipeline;
