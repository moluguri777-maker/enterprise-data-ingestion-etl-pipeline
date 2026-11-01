import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { parse as csvParse } from 'csv-parse';
import config from '../../config/config.js';
import logger from '../monitoring/logger.js';

export class IngestionService {
  constructor(options = {}) {
    this.incomingDir = options.incomingDir || config.storage.incoming;
    this.rawDir = options.rawDir || config.storage.raw;
  }

  /**
   * Computes SHA-256 hash of a file for deterministic duplicate file detection.
   */
  async computeFileHash(filePath) {
    return new Promise((resolve, reject) => {
      const hash = crypto.createHash('sha256');
      const stream = fs.createReadStream(filePath);
      stream.on('error', (err) => reject(err));
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('end', () => resolve(hash.digest('hex')));
    });
  }

  /**
   * Discovers all supported candidate files (.csv, .json) in the incoming directory.
   */
  async discoverIncomingFiles() {
    if (!fs.existsSync(this.incomingDir)) {
      return [];
    }

    const entries = fs.readdirSync(this.incomingDir);
    const files = [];

    for (const entry of entries) {
      const fullPath = path.join(this.incomingDir, entry);
      const stat = fs.statSync(fullPath);

      if (stat.isFile()) {
        const ext = path.extname(entry).toLowerCase();
        if (config.pipeline.supportedFileExtensions.includes(ext)) {
          files.push({
            fileName: entry,
            filePath: fullPath,
            sizeBytes: stat.size,
            ext
          });
        }
      }
    }

    // Sort deterministically (e.g. customers before transactions or lexicographical)
    return files.sort((a, b) => {
      // Prioritize customer files before transaction files to satisfy foreign key dependencies
      const aIsCust = a.fileName.toLowerCase().includes('customer');
      const bIsCust = b.fileName.toLowerCase().includes('customer');
      if (aIsCust && !bIsCust) return -1;
      if (!aIsCust && bIsCust) return 1;
      return a.fileName.localeCompare(b.fileName);
    });
  }

  /**
   * Preserves original raw input files in the RAW zone partitioned by run_id.
   * Object Storage simulation: /data/raw/{run_id}/{fileName}
   */
  async archiveToRawZone(fileInfo, runId) {
    const runRawDir = path.join(this.rawDir, runId);
    if (!fs.existsSync(runRawDir)) {
      fs.mkdirSync(runRawDir, { recursive: true });
    }

    const destinationPath = path.join(runRawDir, fileInfo.fileName);
    fs.copyFileSync(fileInfo.filePath, destinationPath);

    logger.debug('Archived raw input to RAW zone', {
      runId,
      source: fileInfo.filePath,
      archivedTo: destinationPath
    });

    return destinationPath;
  }

  /**
   * Streams and parses records from CSV or JSON file in chunks.
   * Yields or returns records tagged with source_file and ingestion_timestamp.
   */
  async parseFileRecords(filePath, fileInfo, runId) {
    const ext = fileInfo.ext;
    const ingestionTimestamp = new Date().toISOString();
    const records = [];

    if (ext === '.csv') {
      const parser = fs.createReadStream(filePath).pipe(
        csvParse({
          columns: true,
          skip_empty_lines: true,
          trim: true,
          relax_column_count: true // allows catching malformed / column mismatch rows in validation stage
        })
      );

      for await (const row of parser) {
        records.push({
          ...row,
          _meta: {
            source_file: fileInfo.fileName,
            ingestion_timestamp: ingestionTimestamp,
            run_id: runId
          }
        });
      }
    } else if (ext === '.json') {
      const content = fs.readFileSync(filePath, 'utf8').trim();
      if (!content) {
        return [];
      }

      let parsedData;
      // Handle either JSON array or NDJSON (Newline Delimited JSON)
      if (content.startsWith('[')) {
        try {
          parsedData = JSON.parse(content);
        } catch (jsonErr) {
          // If JSON parse fails, throw to let pipeline handle malformed file
          throw new Error(`Malformed JSON file syntax: ${jsonErr.message}`);
        }
      } else {
        // Line-delimited JSON
        const lines = content.split('\n').filter((l) => l.trim().length > 0);
        parsedData = lines.map((line, idx) => {
          try {
            return JSON.parse(line);
          } catch (lineErr) {
            return {
              __malformed_raw: line,
              __line_number: idx + 1,
              __error: lineErr.message
            };
          }
        });
      }

      for (const item of parsedData) {
        records.push({
          ...item,
          _meta: {
            source_file: fileInfo.fileName,
            ingestion_timestamp: ingestionTimestamp,
            run_id: runId
          }
        });
      }
    }

    return records;
  }
}

export default new IngestionService();
