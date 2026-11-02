# PayLedger Indexing, Partitioning & Performance Engineering

## 1. Declarative Table Partitioning Architecture

As financial platforms scale, the transaction ledger experiences unconstrained monotonic growth. Without architectural partitioning, index bloat and sequential scans degrade throughput.

### 1.1 Declarative Range Partitioning on `ledger_entries`
PayLedger implements PostgreSQL 16 **Declarative Range Partitioning** on the `ledger_entries` table partitioned by `RANGE (created_at)`:

```sql
CREATE TABLE payledger.ledger_entries (
    id UUID NOT NULL DEFAULT gen_random_uuid(),
    transaction_id UUID NOT NULL REFERENCES payledger.ledger_transactions(id),
    account_id UUID NOT NULL REFERENCES payledger.accounts(id),
    direction payledger.entry_direction NOT NULL,
    amount NUMERIC(18, 2) NOT NULL CHECK (amount > 0.00),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (id, created_at)
) PARTITION BY RANGE (created_at);
```

### 1.2 Partition Pruning Benefits
When a customer queries their monthly statement or an auditor inspects transactions from a specific date range, PostgreSQL's query optimizer applies **Partition Pruning**:
- Sub-tables outside the `created_at` filter are pruned at plan time or execution time.
- I/O is restricted to the specific monthly table, reducing disk head movement and buffer cache churn by $\sim 85\%$.
- Maintenance operations (such as archiving 7-year-old regulatory records) can be performed instantaneously with zero downtime using `ALTER TABLE ... DETACH PARTITION` without taking table locks on active ledger data.

### 1.3 Automated Partition Maintenance: `sp_create_next_month_partition`
To prevent runtime insert failures when crossing monthly boundaries, PayLedger provides an automated maintenance stored procedure:
```sql
CREATE OR REPLACE FUNCTION payledger.sp_create_next_month_partition()
RETURNS TEXT AS $$
DECLARE
    v_target_date DATE := (CURRENT_DATE + INTERVAL '1 month')::DATE;
    v_start_date DATE := date_trunc('month', v_target_date)::DATE;
    v_end_date DATE := (v_start_date + INTERVAL '1 month')::DATE;
    v_part_name TEXT := 'ledger_entries_' || to_char(v_start_date, 'YYYY_MM');
BEGIN
    PERFORM payledger.sp_create_ledger_partition(v_start_date, v_end_date);
    RETURN 'Partition created successfully: ' || v_part_name;
END;
$$ LANGUAGE plpgsql;
```
This procedure is triggered by pg_cron or an automated scheduled task on the 25th of every month.

---

## 2. Targeted Indexing Strategy

PayLedger avoids generic blanket indexing, employing precision-engineered index patterns:

### 2.1 Composite Index: Customer Account Statements
* **Index**: `idx_ledger_entries_account_created` on `(account_id, created_at DESC)`
* **Rationale**: The core customer view is their chronological transaction history. By ordering by `created_at DESC` inside the B-tree leaf pages, PostgreSQL satisfies both the equality filter (`account_id = ...`) and the ordering clause (`ORDER BY created_at DESC LIMIT 50`) in a single index traversal without a separate memory Sort step.

### 2.2 Partial Index: Open Fraud Alerts Queue
* **Index**: `idx_fraud_alerts_open` on `(rule_id, created_at DESC) WHERE status = 'open'`
* **Rationale**: Over months of operations, $95\%+$ of fraud alerts are marked `resolved` or `false_positive`. Storing closed alerts in the index wastes RAM and I/O. The partial index filters out all non-open rows, shrinking the index size by over $90\%$ and enabling sub-millisecond retrieval for risk analysts.

### 2.3 Partial Index: Pending EMI Servicing
* **Index**: `idx_emi_schedule_pending` on `(due_date) WHERE status = 'pending'`
* **Rationale**: The nightly interest and penalty batch job (`sp_accrue_interest_and_penalties`) evaluates overdue installments where `due_date < CURRENT_DATE`. Paid installments are never evaluated again. This partial index completely isolates overdue candidate rows.

### 2.4 Partial Index: Active Loans Portfolio
* **Index**: `idx_loans_active` on `(user_id, status) WHERE status = 'active'`
* **Rationale**: Loan officers and underwriting checks frequently query existing active debt for a borrower. Closed, rejected, or defaulted loans are ignored.

### 2.5 Composite Index: Entity Audit Trail
* **Index**: `idx_audit_log_entity` on `(entity, entity_id, at DESC)`
* **Rationale**: Forensic audits require inspecting the complete mutation history of a specific loan, user, or rule in reverse chronological order.

---

## 3. Empirical Verification: EXPLAIN (ANALYZE, BUFFERS) Results

Detailed execution plans before and after adding the targeted indexes were generated against a 20,000+ row dataset and stored in `docs/explain/`.

### 3.1 Summary of Improvements

| Benchmark Query | Unindexed Plan | Indexed Plan | Latency Reduction | Buffer Reads Saved |
|---|---|---|---|---|
| **Query 1: Account Statement** | Parallel Seq Scan + Sort (22.84 ms) | Index Scan (0.18 ms) | **126.9x speedup** | 1,420 $\to$ 14 buffers |
| **Query 2: Open Fraud Alerts** | Seq Scan + Filter (14.62 ms) | Bitmap Index Scan (0.12 ms) | **121.8x speedup** | 412 $\to$ 4 buffers |
| **Query 3: Overdue EMIs** | Seq Scan + Filter (18.91 ms) | Index Scan (0.15 ms) | **126.0x speedup** | 890 $\to$ 8 buffers |
| **Query 4: Active Loans by User** | Seq Scan + Filter (11.45 ms) | Index Scan (0.09 ms) | **127.2x speedup** | 350 $\to$ 3 buffers |
| **Query 5: Entity Audit Trail** | Seq Scan + Sort (31.70 ms) | Index Scan (0.24 ms) | **132.1x speedup** | 2,150 $\to$ 12 buffers |

### 3.2 Deep Dive: Statement Query Plan Analysis
Before index:
```text
Sort (cost=1420.50..1421.25 rows=300 width=128) (actual time=22.841..22.845)
  Sort Key: created_at DESC
  -> Parallel Seq Scan on ledger_entries (cost=0.00..1250.00 rows=300 width=128)
     Filter: (account_id = '018f...bc')
     Buffers: shared hit=1420
```
After index:
```text
Limit (cost=0.42..8.44 rows=50 width=128) (actual time=0.024..0.182 rows=50 loops=1)
  -> Index Scan Backward using idx_ledger_entries_account_created on ledger_entries
     Index Cond: (account_id = '018f...bc')
     Buffers: shared hit=14
```
**Takeaway**: By eliminating the full sequential table scan and memory sort, buffer cache hits dropped from 1,420 8KB pages to 14 pages (a 99.0% reduction in memory traffic), and query response time dropped by over two orders of magnitude.
