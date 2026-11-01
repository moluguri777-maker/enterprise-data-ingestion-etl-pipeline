import fs from 'fs';
import path from 'path';
import config from '../../config/config.js';
import logger from './logger.js';

export class MetricsService {
  constructor(runId) {
    this.runId = runId;
    this.startTime = new Date();
    this.endTime = null;
    this.executionStatus = 'INITIALIZING';
    this.inputFilesCount = 0;
    this.inputRecordsCount = 0;
    this.validRecordsCount = 0;
    this.rejectedRecordsCount = 0;
    this.duplicateRecordsCount = 0;
    this.insertedRecordsCount = 0;
    this.updatedRecordsCount = 0;
    this.failureReason = null;
    this.fileMetrics = [];
    this.rejectionBreakdown = {};
  }

  recordFile(fileMetric) {
    this.fileMetrics.push(fileMetric);
    this.inputFilesCount++;
  }

  recordRejection(reason) {
    this.rejectedRecordsCount++;
    const key = reason.split(':')[0] || reason;
    this.rejectionBreakdown[key] = (this.rejectionBreakdown[key] || 0) + 1;
  }

  finish(status = 'COMPLETED', failureReason = null) {
    this.endTime = new Date();
    this.executionStatus = status;
    this.failureReason = failureReason;
  }

  getDurationMs() {
    const end = this.endTime ? this.endTime.getTime() : Date.now();
    return end - this.startTime.getTime();
  }

  getSummary() {
    const durationMs = this.getDurationMs();
    const throughput = durationMs > 0 ? Math.round((this.inputRecordsCount / (durationMs / 1000))) : 0;
    const accountedCount = this.insertedRecordsCount + this.duplicateRecordsCount + this.rejectedRecordsCount + this.updatedRecordsCount;
    const isReconciled = accountedCount === this.inputRecordsCount;

    return {
      runId: this.runId,
      startTime: this.startTime.toISOString(),
      endTime: this.endTime ? this.endTime.toISOString() : null,
      executionStatus: this.executionStatus,
      durationMs,
      throughputRecordsPerSec: throughput,
      reconciliation: {
        inputRecords: this.inputRecordsCount,
        insertedRecords: this.insertedRecordsCount,
        duplicateRecords: this.duplicateRecordsCount,
        rejectedRecords: this.rejectedRecordsCount,
        updatedRecords: this.updatedRecordsCount,
        accountedRecords: accountedCount,
        isReconciled,
        discrepancy: this.inputRecordsCount - accountedCount
      },
      counts: {
        inputFilesCount: this.inputFilesCount,
        inputRecordsCount: this.inputRecordsCount,
        validRecordsCount: this.validRecordsCount,
        rejectedRecordsCount: this.rejectedRecordsCount,
        duplicateRecordsCount: this.duplicateRecordsCount,
        insertedRecordsCount: this.insertedRecordsCount,
        updatedRecordsCount: this.updatedRecordsCount
      },
      failureReason: this.failureReason,
      rejectionBreakdown: this.rejectionBreakdown,
      fileBreakdown: this.fileMetrics
    };
  }

  /**
   * Generates readable JSON and CSV execution reports saved to reports directory.
   */
  async exportReport(reportsDir = config.storage.reports) {
    if (!fs.existsSync(reportsDir)) {
      fs.mkdirSync(reportsDir, { recursive: true });
    }

    const summary = this.getSummary();
    const jsonPath = path.join(reportsDir, `run_${this.runId}.json`);
    const csvPath = path.join(reportsDir, `run_${this.runId}.csv`);

    // 1. JSON Report
    fs.writeFileSync(jsonPath, JSON.stringify(summary, null, 2), 'utf8');

    // 2. CSV Summary Report
    const csvHeader = 'Metric,Value\n';
    const csvRows = [
      `Run ID,${summary.runId}`,
      `Execution Status,${summary.executionStatus}`,
      `Start Time,${summary.startTime}`,
      `End Time,${summary.endTime}`,
      `Duration (ms),${summary.durationMs}`,
      `Throughput (rec/s),${summary.throughputRecordsPerSec}`,
      `Input Files,${summary.counts.inputFilesCount}`,
      `Total Input Records,${summary.counts.inputRecordsCount}`,
      `Valid Records,${summary.counts.validRecordsCount}`,
      `Inserted Records,${summary.counts.insertedRecordsCount}`,
      `Duplicate Records,${summary.counts.duplicateRecordsCount}`,
      `Rejected Records,${summary.counts.rejectedRecordsCount}`,
      `Updated Records,${summary.counts.updatedRecordsCount}`,
      `Reconciled,${summary.reconciliation.isReconciled ? 'YES' : 'NO'}`
    ].join('\n');

    fs.writeFileSync(csvPath, csvHeader + csvRows, 'utf8');

    logger.info(`Generated execution reports for run ${this.runId}`, {
      jsonReport: jsonPath,
      csvReport: csvPath
    });

    return { jsonPath, csvPath, summary };
  }
}

export default MetricsService;
