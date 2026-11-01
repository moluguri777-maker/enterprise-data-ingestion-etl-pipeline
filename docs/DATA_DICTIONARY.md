# Data Dictionary & Entity Catalog

## 1. Overview & Data Model Architecture

The Enterprise Data Ingestion Pipeline ingests business events across two core functional entities:
1. **Customers (Master / Dimension Entity)**
2. **Transactions (Fact / Event Entity)**

Alongside these curated business entities, three operational audit and ledger entities enforce strict traceability, reconciliation, and idempotency:
3. **Pipeline Runs (`pipeline_runs`)**
4. **Processed Files (`processed_files`)**
5. **Rejected Records (`rejected_records`)**

---

## 2. Business Entities

### 2.1 Customers Entity (`customers`)
- **Grain**: One record per distinct customer.
- **Classification**: Master Dimension.
- **Target Storage**: MySQL Curated Zone (`customers` table).

| Column Name | SQL Type | Nullable | Primary / Foreign Key | Description & Business Rules |
| :--- | :--- | :--- | :--- | :--- |
| `customer_id` | `VARCHAR(64)` | NOT NULL | **PRIMARY KEY** | Deterministic customer identifier (e.g., `CUST-00100`). Whitespace-trimmed. |
| `customer_name` | `VARCHAR(255)` | NOT NULL | None | Full legal customer name. Must not be empty. |
| `email` | `VARCHAR(255)` | NOT NULL | INDEX | Validated contact email. Validated against RFC 5322 regex; converted to lowercase. |
| `created_at` | `DATETIME(3)` | NOT NULL | INDEX | ISO-8601 UTC timestamp of customer registration. Year between 2000 and 2099. |
| `updated_at` | `DATETIME(3)` | NULL | None | UTC timestamp of last metadata modification (if record re-ingested with changed name/email). |
| `source_file` | `VARCHAR(255)` | NOT NULL | None | Provenance tracking: incoming file name where this customer was first ingested. |
| `ingestion_run_id` | `VARCHAR(64)` | NOT NULL | INDEX | Unique execution run identifier of the pipeline run that published this record. |
| `ingestion_timestamp` | `DATETIME(3)` | NOT NULL | None | UTC timestamp when this record was published to the Curated Zone. |

---

### 2.2 Transactions Entity (`transactions`)
- **Grain**: One record per discrete financial transaction event.
- **Classification**: Fact / Event Table.
- **Target Storage**: MySQL Curated Zone (`transactions` table) and Curated Data Lake partitioned by date.

| Column Name | SQL Type | Nullable | Primary / Foreign Key | Description & Business Rules |
| :--- | :--- | :--- | :--- | :--- |
| `transaction_id` | `VARCHAR(64)` | NOT NULL | **PRIMARY KEY** | Deterministic transaction identifier (e.g., `TXN-0001001`). Whitespace-trimmed. |
| `customer_id` | `VARCHAR(64)` | NOT NULL | **FOREIGN KEY** | References `customers(customer_id)`. Referential integrity enforced. |
| `transaction_type` | `VARCHAR(20)` | NOT NULL | INDEX | Normalized uppercase transaction classification. Allowed: `SALE`, `REFUND`, `PAYMENT`. |
| `amount` | `DECIMAL(14, 2)` | NOT NULL | None | Monetary value rounded to 2 decimal places. Must be strictly non-negative (`amount >= 0.00`). |
| `currency` | `VARCHAR(10)` | NOT NULL | INDEX | ISO-4217 currency code. Normalized uppercase. Supported: `INR`, `USD`. |
| `transaction_timestamp` | `DATETIME(3)` | NOT NULL | INDEX | Exact timestamp when the transaction occurred, normalized to UTC ISO-8601. |
| `transaction_date` | `DATE` | NOT NULL | INDEX | Derived date (`YYYY-MM-DD`) from `transaction_timestamp` in UTC. Used for lake partitioning. |
| `source_file` | `VARCHAR(255)` | NOT NULL | None | Name of the incoming file containing this transaction. |
| `ingestion_timestamp` | `DATETIME(3)` | NOT NULL | None | UTC timestamp when record was ingested into the Curated Zone. |
| `ingestion_run_id` | `VARCHAR(64)` | NOT NULL | INDEX | Pipeline execution ID responsible for ingesting this record. |

---

## 3. Operational & Audit Entities

### 3.1 Pipeline Runs (`pipeline_runs`)
Tracks the end-to-end lifecycle and reconciliation balance of every pipeline execution.

| Column Name | SQL Type | Nullable | Description |
| :--- | :--- | :--- | :--- |
| `run_id` | `VARCHAR(64)` | NOT NULL (PK) | Globally unique execution identifier (e.g., `RUN-1793433010207-2F9441`). |
| `start_time` | `DATETIME(3)` | NOT NULL | Execution start timestamp (UTC). |
| `end_time` | `DATETIME(3)` | NULL | Execution termination timestamp (UTC). |
| `execution_status` | `VARCHAR(30)` | NOT NULL | `RUNNING`, `COMPLETED`, `PARTIAL_SUCCESS`, `ALL_REJECTED`, `FAILED`. |
| `input_files_count` | `INT` | NOT NULL | Number of files discovered and processed in the incoming zone. |
| `input_records_count` | `INT` | NOT NULL | Total record count extracted across all input files. |
| `valid_records_count` | `INT` | NOT NULL | Number of records passing schema and business validation. |
| `rejected_records_count` | `INT` | NOT NULL | Number of records failing validation and quarantined to Rejected Zone. |
| `duplicate_records_count` | `INT` | NOT NULL | Number of duplicate records detected (in-batch or cross-batch) safely skipped. |
| `inserted_records_count` | `INT` | NOT NULL | Number of new records inserted into curated database tables. |
| `updated_records_count` | `INT` | NOT NULL | Number of existing master dimension records updated with modified metadata. |
| `processing_duration_ms` | `INT` | NOT NULL | Wall-clock execution time in milliseconds. |
| `failure_reason` | `TEXT` | NULL | Stack trace or exception message in case of catastrophic failure. |
| `metadata_json` | `TEXT` | NULL | Structured JSON object capturing run environment, file metrics, and timing breakdown. |

---

### 3.2 Processed Files Ledger (`processed_files`)
Enforces file-level idempotency by recording cryptographic SHA-256 signatures of all processed files.

| Column Name | SQL Type | Nullable | Description |
| :--- | :--- | :--- | :--- |
| `file_hash` | `VARCHAR(64)` | NOT NULL (PK) | SHA-256 hexadecimal hash computed over the raw file binary content. |
| `file_name` | `VARCHAR(255)` | NOT NULL | Filename in incoming directory. |
| `file_size_bytes` | `BIGINT` | NOT NULL | Byte size of the input file. |
| `record_count` | `INT` | NOT NULL | Total rows/records contained within the file. |
| `first_processed_run_id` | `VARCHAR(64)` | NOT NULL | The run ID during which the file was first ingested. |
| `last_processed_run_id` | `VARCHAR(64)` | NOT NULL | The run ID during which the file was most recently seen/replayed. |
| `status` | `VARCHAR(30)` | NOT NULL | Status: `PROCESSED`, `DUPLICATE_REPLAY`. |
| `processed_at` | `DATETIME(3)` | NOT NULL | UTC timestamp of last processing. |

---

### 3.3 Rejected Records Quarantine (`rejected_records`)
Captures all invalid records without silent data loss.

| Column Name | SQL Type | Nullable | Description |
| :--- | :--- | :--- | :--- |
| `id` | `BIGINT` | NOT NULL (PK AUTO) | Synthetic primary key. |
| `run_id` | `VARCHAR(64)` | NOT NULL | Execution run ID in which the violation occurred. |
| `source_file` | `VARCHAR(255)` | NOT NULL | Name of the source file. |
| `entity_type` | `VARCHAR(50)` | NOT NULL | Detected entity: `CUSTOMER`, `TRANSACTION`, `TRANSACTION_CONFLICT`, `MALFORMED`, `UNKNOWN`. |
| `record_id` | `VARCHAR(100)` | NULL | Primary key extracted from raw record if parseable. |
| `rejection_reason` | `VARCHAR(500)` | NOT NULL | Detailed reason(s) for failure (e.g. `Negative amount violation: -45`). |
| `raw_record` | `TEXT` | NOT NULL | Full original uncorrupted record serialized to string/JSON. |
| `rejection_timestamp` | `DATETIME(3)` | NOT NULL | UTC timestamp of quarantine. |

---

## 4. Reconciliation Balance Equation

Every pipeline run validates the mathematical integrity of the ingested batch:

$$\text{Input Records} = \text{Inserted Records} + \text{Duplicate Records} + \text{Rejected Records} + \text{Updated Records}$$

If discrepancy $\ne 0$, the run fails reconciliation audit and triggers an operational alert.
