import db from './db.js';
import logger from '../monitoring/logger.js';

async function main() {
  try {
    logger.info('Starting database schema initialization...');
    await db.initSchema();
    logger.info('Database schema successfully initialized.');
    await db.close();
    process.exit(0);
  } catch (error) {
    logger.error('Failed to initialize database schema', { error: error.message, stack: error.stack });
    process.exit(1);
  }
}

main();
