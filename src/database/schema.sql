
-- =====================================================================
-- Enterprise Data Ingestion & ETL Pipeline: Production MySQL 8.0 Schema
-- Curated Data Zone, Audit Tracking & Lineage Control
-- =====================================================================

-- 1. Pipeline Execution Observability
CREATE TABLE IF NOT EXISTS pipeline_runs (
  run_id VARCHAR(64) NOT NULL,
  start_time DATETIME(3) NOT NULL,
  end_time DATETIME(3) NULL,
  execution_status VARCHAR(30) NOT NULL DEFAULT 'RUNNING',
  input_files_count INT NOT NULL DEFAULT 0,
  input_records_count INT NOT NULL DEFAULT 0,
  valid_records_count INT NOT NULL DEFAULT 0,
  rejected_records_count INT NOT NULL DEFAULT 0,
  duplicate_records_count INT NOT NULL DEFAULT 0,
  inserted_records_count INT NOT NULL DEFAULT 0,
  updated_records_count INT NOT NULL DEFAULT 0,
  processing_duration_ms INT NOT NULL DEFAULT 0,
  failure_reason TEXT NULL,
  metadata_json TEXT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (run_id),
  INDEX idx_pipeline_runs_status (execution_status),
  INDEX idx_pipeline_runs_start_time (start_time)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2. File-Level Ingestion Ledger (Idempotent Hash Tracking)
CREATE TABLE IF NOT EXISTS processed_files (
  file_hash VARCHAR(64) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  record_count INT NOT NULL DEFAULT 0,
  first_processed_run_id VARCHAR(64) NOT NULL,
  last_processed_run_id VARCHAR(64) NOT NULL,
  status VARCHAR(30) NOT NULL DEFAULT 'PROCESSED',
  processed_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (file_hash),
  INDEX idx_processed_files_name (file_name),
  INDEX idx_processed_files_date (processed_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3. Curated Master Entity: Customers
CREATE TABLE IF NOT EXISTS customers (
  customer_id VARCHAR(64) NOT NULL,
  customer_name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  created_at DATETIME(3) NOT NULL,
  updated_at DATETIME(3) NULL,
  source_file VARCHAR(255) NOT NULL,
  ingestion_run_id VARCHAR(64) NOT NULL,
  ingestion_timestamp DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (customer_id),
  INDEX idx_customers_email (email),
  INDEX idx_customers_created_at (created_at),
  INDEX idx_customers_run_id (ingestion_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4. Curated Fact Entity: Transactions
CREATE TABLE IF NOT EXISTS transactions (
  transaction_id VARCHAR(64) NOT NULL,
  customer_id VARCHAR(64) NOT NULL,
  transaction_type VARCHAR(20) NOT NULL,
  amount DECIMAL(14, 2) NOT NULL,
  currency VARCHAR(10) NOT NULL,
  transaction_timestamp DATETIME(3) NOT NULL,
  transaction_date DATE NOT NULL,
  source_file VARCHAR(255) NOT NULL,
  ingestion_timestamp DATETIME(3) NOT NULL,
  ingestion_run_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (transaction_id),
  CONSTRAINT fk_transactions_customer
    FOREIGN KEY (customer_id) REFERENCES customers(customer_id)
    ON DELETE RESTRICT
    ON UPDATE CASCADE,
  INDEX idx_transactions_customer_id (customer_id),
  INDEX idx_transactions_date (transaction_date),
  INDEX idx_transactions_type (transaction_type),
  INDEX idx_transactions_currency (currency),
  INDEX idx_transactions_timestamp (transaction_timestamp),
  INDEX idx_transactions_run_id (ingestion_run_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5. Audit & Quarantine Zone: Rejected Records
CREATE TABLE IF NOT EXISTS rejected_records (
  id BIGINT AUTO_INCREMENT NOT NULL,
  run_id VARCHAR(64) NOT NULL,
  source_file VARCHAR(255) NOT NULL,
  entity_type VARCHAR(50) NOT NULL,
  record_id VARCHAR(100) NULL,
  rejection_reason VARCHAR(500) NOT NULL,
  raw_record TEXT NOT NULL,
  rejection_fingerprint CHAR(64) NOT NULL,
  rejection_timestamp DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  PRIMARY KEY (id),
  UNIQUE KEY uq_rejected_fingerprint (rejection_fingerprint),
  INDEX idx_rejected_run_id (run_id),
  INDEX idx_rejected_entity_type (entity_type),
  INDEX idx_rejected_timestamp (rejection_timestamp)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
