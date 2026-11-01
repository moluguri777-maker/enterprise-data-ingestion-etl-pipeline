import winston from 'winston';
import path from 'path';
import config, { ensureDirectories } from '../../config/config.js';

ensureDirectories();

const { combine, timestamp, printf, json, colorize, errors } = winston.format;

const consoleFormat = printf(({ level, message, timestamp, runId, ...meta }) => {
  const runTag = runId ? ` [run:${runId.slice(0, 8)}]` : '';
  const metaStr = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
  return `[${timestamp}] ${level}${runTag}: ${message}${metaStr}`;
});

const logger = winston.createLogger({
  level: config.logging.level,
  defaultMeta: { service: 'data-engineering-pipeline' },
  format: combine(
    errors({ stack: true }),
    timestamp({ format: 'YYYY-MM-DDTHH:mm:ss.SSSZ' }),
    json()
  ),
  transports: [
    new winston.transports.File({
      filename: path.join(config.logging.dir, 'error.log'),
      level: 'error',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5
    }),
    new winston.transports.File({
      filename: path.join(config.logging.dir, 'pipeline.log'),
      maxsize: 20 * 1024 * 1024,
      maxFiles: 5
    }),
    new winston.transports.Console({
      format: combine(
        colorize(),
        timestamp({ format: 'HH:mm:ss.SSS' }),
        consoleFormat
      )
    })
  ]
});

export default logger;
