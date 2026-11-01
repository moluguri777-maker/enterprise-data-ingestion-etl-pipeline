import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import db from './src/database/db.js';
import { runPipeline } from './src/pipeline.js';
import generateSyntheticDataset from './src/generators/generateData.js';
import reconciliationService from './src/reconciliation/reconciliationService.js';
import config, { ensureDirectories } from './config/config.js';
import logger from './src/monitoring/logger.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function createServer() {
  ensureDirectories();
  await db.initSchema();

  const app = express();
  const PORT = parseInt(process.env.PORT || '3000', 10);

  app.use(express.json());

  // API Routes
  // 1. Reconciliation & Health
  app.get('/api/reconciliation', async (req, res) => {
    try {
      const report = await reconciliationService.runAuditReconciliation();
      res.json({ success: true, report });
    } catch (err) {
      logger.error('Failed to run reconciliation API', { error: err.message });
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 2. Recent Pipeline Runs
  app.get('/api/runs', async (req, res) => {
    try {
      const runs = await db.query(
        'SELECT * FROM pipeline_runs ORDER BY start_time DESC LIMIT 50'
      );
      res.json({ success: true, runs });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 3. Trigger Pipeline Execution
  app.post('/api/pipeline/run', async (req, res) => {
    try {
      const result = await runPipeline();
      res.json({ success: true, result });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 4. Trigger Synthetic Data Generation
  app.post('/api/pipeline/generate', async (req, res) => {
    try {
      const { size = 'small', count } = req.body;
      let txCount = 250;
      let custCount = 50;

      if (count) {
        txCount = parseInt(count, 10);
        custCount = Math.max(10, Math.floor(txCount / 20));
      } else if (size === 'medium') {
        txCount = 2500;
        custCount = 200;
      } else if (size === 'large') {
        txCount = 10000;
        custCount = 800;
      }

      const result = generateSyntheticDataset({
        customerCount: custCount,
        transactionCount: txCount,
        seed: Date.now()
      });

      res.json({
        success: true,
        message: `Generated ${txCount} transactions and ${custCount} customers in incoming storage`,
        summary: result.groundTruth.counts
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 5. Curated Transactions
  app.get('/api/transactions', async (req, res) => {
    try {
      const page = parseInt(req.query.page || '1', 10);
      const limit = parseInt(req.query.limit || '20', 10);
      const offset = (page - 1) * limit;

      const rows = await db.query(
        `SELECT * FROM transactions ORDER BY transaction_timestamp DESC LIMIT ? OFFSET ?`,
        [limit, offset]
      );
      const countRows = await db.query('SELECT COUNT(*) as total FROM transactions');
      const countRow = countRows && countRows.length > 0 ? countRows[0] : { total: 0 };

      res.json({
        success: true,
        data: rows,
        pagination: {
          page,
          limit,
          total: Number(countRow.total || 0)
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 6. Quarantined Rejected Records
  app.get('/api/rejected', async (req, res) => {
    try {
      const rows = await db.query(
        'SELECT * FROM rejected_records ORDER BY rejection_timestamp DESC LIMIT 50'
      );
      res.json({ success: true, data: rows });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // 7. Data Lake Storage Zones overview
  app.get('/api/zones', async (req, res) => {
    try {
      const getFileCount = (dirPath) => {
        if (!fs.existsSync(dirPath)) return 0;
        return fs.readdirSync(dirPath).length;
      };

      res.json({
        success: true,
        zones: {
          incoming: { path: config.storage.incoming, files: getFileCount(config.storage.incoming) },
          raw: { path: config.storage.raw, files: getFileCount(config.storage.raw) },
          validated: { path: config.storage.validated, files: getFileCount(config.storage.validated) },
          rejected: { path: config.storage.rejected, files: getFileCount(config.storage.rejected) },
          curated: { path: config.storage.curated, files: getFileCount(config.storage.curated) },
          reports: { path: config.storage.reports, files: getFileCount(config.storage.reports) }
        }
      });
    } catch (err) {
      res.status(500).json({ success: false, error: err.message });
    }
  });

  // Mount Vite middleware in development
  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    // Serve static dist
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (req, res) => {
        res.sendFile(path.resolve(distPath, 'index.html'));
      });
    }
  }

  app.listen(PORT, '0.0.0.0', () => {
    logger.info(`Enterprise Data Engineering Operations Console running on port ${PORT}`);
    console.log(`Server listening at http://localhost:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
