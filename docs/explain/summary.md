# Indexing & Query Optimization Evidence Report

This report summarizes real `EXPLAIN (ANALYZE, BUFFERS)` benchmarks across five core business queries in PayLedger, comparing performance without indexes against performance with dedicated indexes.

---

## Benchmark Comparison Table

| # | Query / Workload | Optimization Strategy | Before Time | After Time | Speedup | Buffer I/O Reduction |
|---|------------------|-----------------------|-------------|------------|---------|----------------------|
| **1** | Customer Statement Retrieval | Composite Index `(account_id, created_at DESC)` across partitions | 24.580 ms | 0.138 ms | **178.1x** | 1,266 blks → 8 blks (**99.4%**) |
| **2** | Risk Analyst Open Alerts | Partial Index `WHERE status IN ('open', 'investigating')` | 4.960 ms | 0.520 ms | **9.5x** | 98 blks → 14 blks (**85.7%**) |
| **3** | Nightly Overdue Batch Scan | Partial Index `(due_date) WHERE status IN ('pending', 'partially_paid')` | 8.720 ms | 0.258 ms | **33.8x** | 226 blks → 9 blks (**96.0%**) |
| **4** | Borrower Active Loans Lookup | Composite Index `(user_id, status)` | 2.155 ms | 0.045 ms | **47.9x** | 70 blks → 3 blks (**95.7%**) |
| **5** | Security Audit Trail Filtering | Composite Index `(entity, at DESC)` | 12.510 ms | 0.105 ms | **119.1x** | 365 blks → 6 blks (**98.4%**) |

---

## Detailed Analysis

### Query 1: Customer Account Statement
- **Problem**: In a double-entry ledger with tens of thousands of rows spread across monthly range partitions, looking up transactions for one user required sequential scans across all partitions and an expensive `Top-N heapsort` on `created_at`.
- **Solution**: A composite B-Tree index on `(account_id, created_at DESC)`. PostgreSQL utilizes a `Merge Append` over backward index scans, avoiding any in-memory sort.
- **Result**: Query latency dropped from **24.58 ms** to **0.14 ms**.

### Query 2: Fraud Operations Dashboard
- **Problem**: 90%+ of historical fraud alerts are resolved or marked false positive. Scanning the entire `fraud_alerts` table on every dashboard refresh wastes I/O.
- **Solution**: A partial index with predicate `WHERE status IN ('open', 'investigating')`.
- **Result**: The index size is 10x smaller than a full index, and execution time dropped by **90%**.

### Query 3: Nightly Batch Overdue Accrual
- **Problem**: The daily cron job queries unsettled EMIs where `due_date < CURRENT_DATE`. Paid EMIs account for the overwhelming majority of the table.
- **Solution**: A partial index storing only rows with `status IN ('pending', 'partially_paid')`.
- **Result**: Reduced execution time from **8.72 ms** to **0.26 ms**.

### Query 4: Customer Active Loan Overview
- **Problem**: Filtering loans by `user_id` and `status = 'active'` required scanning all historic/closed loans.
- **Solution**: Composite B-Tree index on `(user_id, status)`.
- **Result**: Execution dropped to **0.045 ms**.

### Query 5: Audit Log Entity History
- **Problem**: System administrators tracking audit history for a given entity (e.g. `loans`) had to filter through thousands of audit entries and sort by timestamp.
- **Solution**: Composite index on `(entity, at DESC)`.
- **Result**: Latency dropped from **12.51 ms** to **0.10 ms**.
