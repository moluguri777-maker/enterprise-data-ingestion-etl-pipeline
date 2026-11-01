# Enterprise Data Engineering Pipeline Architecture

## 1. Executive Summary

This project implements a production-grade, idempotent, multi-zone Data Engineering Ingestion & ETL pipeline built with Node.js, Express, and MySQL 8.0.

The pipeline ingests heterogeneous business event streams (CSV, JSON, and NDJSON) arriving in simulated object storage, validates schemas and relational constraints, enforces data hygiene, prevents duplicate publishing, and loads pristine datasets into the Curated Zone with full lineage and mathematical reconciliation.

---

## 2. Mermaid Architecture Diagram

```mermaid
flowchart TD
    subgraph ObjectStorage ["Simulated Object Storage (data/incoming)"]
        CSVFiles["CSV Event Files"]
        JSONFiles["JSON & NDJSON Files"]
    end

    subgraph Stage1 ["Stage A: Ingestion & Raw Preservation"]
        HashCalc["SHA-256 File Hash Calculator"]
        RawArchiver["Raw Lake Archiver (/data/raw/{run_id})"]
        StreamParser["Chunked Stream Parser (csv-parse / JSON)"]
    end

    subgraph Stage2 ["Stage B: Schema & Relational Validation"]
        SchemaValidator["Schema & Type Validator"]
        FKValidator["Referential FK Integrity (Customers Set)"]
        QuarantineBranch{"Is Record Valid?"}
        RejectedZone["REJECTED ZONE (/data/rejected/{run_id})<br/>& rejected_records DB Table"]
    end

    subgraph Stage3 ["Stage C: Transformation & Lake Partitioning"]
        Normalizer["UTC Timestamp & Decimal Normalizer"]
        Sorter["Chronological Sorter (Late Events)"]
        LakePartitioner["Date-Based Lake Partitioner (/data/curated/date=YYYY-MM-DD)"]
    end

    subgraph Stage4 ["Stage D: Idempotent Publishing & Curated Storage"]
        Deduplicator["In-Batch & Cross-Batch Deduplicator"]
        ConflictDetector{"Identical or Conflicting PK?"}
        ConflictQuarantine["Quarantine Conflicting Record"]
        DBTransactions["Transactional Batch Publisher"]
        CuratedDB[("CURATED ZONE: MySQL 8.0<br/>- customers<br/>- transactions<br/>- processed_files<br/>- pipeline_runs")]
    end

    subgraph Stage5 ["Stage E: Observability & Reconciliation"]
        ReconciliationEngine["Mathematical Reconciliation Engine"]
        ReportGenerator["JSON / CSV Report Exporter (/reports)"]
        Logger["Winston Structured JSON Logger (/logs)"]
        Dashboard["Web Operations Console (Port 3000)"]
    end

    %% Flows
    CSVFiles --> HashCalc
    JSONFiles --> HashCalc
    HashCalc --> RawArchiver
    HashCalc --> StreamParser

    StreamParser --> SchemaValidator
    SchemaValidator --> FKValidator
    FKValidator --> QuarantineBranch

    QuarantineBranch -- "FAIL" --> RejectedZone
    QuarantineBranch -- "PASS" --> Normalizer

    Normalizer --> Sorter
    Sorter --> LakePartitioner
    Sorter --> Deduplicator

    Deduplicator --> ConflictDetector
    ConflictDetector -- "Conflicting PK" --> ConflictQuarantine --> RejectedZone
    ConflictDetector -- "Identical Duplicate" --> DBTransactions
    ConflictDetector -- "New Valid Record" --> DBTransactions

    DBTransactions --> CuratedDB
    CuratedDB --> ReconciliationEngine
    ReconciliationEngine --> ReportGenerator
    ReconciliationEngine --> Logger
    ReconciliationEngine --> Dashboard
```

---

## 3. Data Lake Zone Architecture

The pipeline partitions data across four distinct storage zones simulating cloud object storage (e.g. AWS S3, Google Cloud Storage):

### 1. Ingestion / Landing Zone (`/data/incoming`)
- Transient bucket where external producers drop source files (batches of customers, payments, sales, and refunds).
- Supports mixed CSV, JSON array, and NDJSON files.

### 2. Raw Zone (`/data/raw/{run_id}/`)
- Immutable historical archive.
- Original files are copied verbatim into run-partitioned directories before parsing.
- Guarantees byte-for-byte reproducibility and disaster recovery.

### 3. Validated Zone (`/data/validated/{run_id}/`)
- Intermediate staging zone containing structured records that passed structural validation.
- Serialized in clean JSON batches prior to database insertion.

### 4. Rejected Quarantine Zone (`/data/rejected/{run_id}/`)
- Dead-letter queue for anomalous records.
- Stores full original record, source file, timestamp, and human-readable validation error messages.
- Prevents silent data corruption while ensuring 100% data accountability.

### 5. Curated Zone (`/data/curated/` & Target Relational DB)
- **Filesystem Lake**: Partitioned by date (`/data/curated/transactions/date=YYYY-MM-DD/part-{run_id}.json`).
- **Relational Curated Database**: High-performance normalized tables (`customers`, `transactions`, `processed_files`, `pipeline_runs`, `rejected_records`).

---

## 4. Key Architectural Patterns

### 4.1 Two-Tier Idempotency Model
1. **Tier 1 (File-Level Detection)**:
   - Every file's SHA-256 cryptographic digest is calculated and logged in `processed_files`.
   - Repeated delivery of an identical file is flagged as a re-delivery.
2. **Tier 2 (Record-Level Deduplication & Conflict Isolation)**:
   - Naive pipelines skip an entire file if marked duplicate. Our pipeline parses every row to support **mixed batches** (files containing a mixture of existing and new events).
   - If `transaction_id` matches an existing record and all attributes match, it is treated as an **identical duplicate** (safely skipped, incrementing `duplicate_records_count`).
   - If `transaction_id` matches but attributes conflict (e.g. different amount or customer), the event is flagged as a **Primary Key Conflict** and routed to quarantine.

### 4.2 Referential Integrity via Pre-Cached Keys
- To prevent slow row-by-row SELECT queries for foreign key validation, the pipeline pre-loads existing customer keys into an in-memory `Set` ($O(1)$ lookup).
- When new customer records arrive in the same batch, their IDs are immediately registered into the set, allowing subsequent transactions in that same run to satisfy foreign keys seamlessly.

### 4.3 Out-of-Order & Late Event Handling
- Financial transactions often arrive days or months late due to network partitioning or batch delays.
- The pipeline sorts incoming transaction streams chronologically by UTC timestamp before committing and partitions the filesystem lake by `transaction_date` rather than processing date.

### 4.4 Automated Mathematical Reconciliation
Every execution validates the reconciliation balance:
$$\text{Input Records} = \text{Inserted} + \text{Duplicates} + \text{Rejected} + \text{Updated}$$
Any discrepancy produces an audit alert and flags the run status.
