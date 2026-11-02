# PayLedger: 30 High-Yield Viva Questions & Answers
**Course**: Database Management Systems (3-Credit Final Project)  
**Topics**: Normalization, Invariants, Concurrency, Locking, Indexing, Partitioning, Security, Stored Procedures.

---

### Q1: Why did you choose double-entry bookkeeping over a simple `balance` column in a `users` table?
**Answer**: A single balance column is vulnerable to update anomalies, race conditions, and lack of auditability. If an update fails halfway or an unauthorized process alters the balance, there is no mathematical proof of where funds originated or went. Double-entry bookkeeping guarantees that every financial event consists of equal and offsetting debit and credit entries ($\sum \text{Debits} = \sum \text{Credits}$). The balance is an immutable derivative of historical facts.

### Q2: How does your database enforce that ledger entries are append-only?
**Answer**: Through the `trg_ledger_entries_immutable` trigger invoking `fn_block_update_delete()`. Any `UPDATE` or `DELETE` statement executed against `ledger_entries` or `ledger_transactions` immediately raises an exception with custom SQLSTATE `PL003`. Adjustments and refunds are recorded as new reversing entries.

### Q3: Why did you use a deferred constraint trigger for the double-entry balance check?
**Answer**: Inserting a transaction header and its corresponding debit and credit entries takes multiple SQL statements inside a single transaction block. A standard immediate trigger would fail on the very first entry because the offsetting entry has not been inserted yet. A `DEFERRABLE INITIALLY DEFERRED` constraint trigger postpones evaluation until the `COMMIT` boundary, ensuring the entire transaction balances before committing.

### Q4: In what normal form is the PayLedger database schema?
**Answer**: The schema satisfies Third Normal Form (3NF) and Boyce-Codd Normal Form (BCNF) across its entities. All non-prime attributes are fully functionally dependent on candidate keys with no transitive dependencies. We intentionally maintain two controlled denormalizations (`account_balances` and `loans.outstanding_principal`) protected by transactional triggers and row-level locks to eliminate $O(N)$ table scans.

### Q5: Why is `account_balances` denormalized instead of calculating `SUM()` on every request?
**Answer**: In a ledger with 20,000+ entries, running `SUM(amount)` over historical rows on every transfer check turns an $O(1)$ operation into an $O(N)$ sequential scan. Under high concurrency, this saturates CPU, causes buffer pool thrashing, and increases lock hold times. `account_balances` provides $O(1)$ point lookups, synchronized inside the exact same ACID transaction as the ledger entry.

### Q6: How do you prevent wallet balances from going below zero?
**Answer**: At the schema level, `account_balances` enforces a `CHECK (type IN ('system_fee', 'system_suspense', 'loan_pool') OR balance >= 0.00)`. In `sp_transfer`, we acquire an exclusive row lock (`FOR UPDATE`) on the balance row and check `v_from_balance < p_amount`, raising exception `PL001` if funds are insufficient.

### Q7: What isolation level is used for `sp_transfer` and why?
**Answer**: We use `READ COMMITTED` combined with pessimistic row-level locking (`SELECT ... FOR UPDATE`). We intentionally avoid `SERIALIZABLE` because high-velocity transfers touching popular accounts (merchants, system fee) trigger frequent false-positive serialization failures (`40001`), requiring expensive retries. `READ COMMITTED` with ordered locking avoids aborts while ensuring exact balance visibility.

### Q8: How does PayLedger mathematically prevent deadlocks between concurrent transfers?
**Answer**: Deadlocks occur when concurrent transactions acquire locks in circular order (Coffman's Circular Wait condition). `sp_transfer` orders lock acquisition deterministically using `LEAST(p_from_account, p_to_account)` followed by `GREATEST(p_from_account, p_to_account)`. Because resources are always locked in global ascending order, the resource graph is acyclic (a DAG), making deadlocks impossible.

### Q9: How do you handle idempotency for network retries?
**Answer**: `ledger_transactions` has a `UNIQUE(idempotency_key)` constraint. When `sp_transfer` is called, it first checks if a transaction with that idempotency key exists. If so, it returns the existing transaction ID without modifying account balances. If two concurrent threads submit the same key, the unique constraint aborts the duplicate.

### Q10: How does table partitioning work on `ledger_entries`?
**Answer**: We use PostgreSQL 16 declarative range partitioning on `RANGE (created_at)` by month (`ledger_entries_YYYY_MM`). The query optimizer performs partition pruning, scanning only the monthly partition relevant to the queried date range, reducing disk I/O and buffer hits by over $85\%$.

### Q11: How do you handle partition maintenance for future months?
**Answer**: We implemented `sp_create_next_month_partition()`, which calculates the boundary dates for the upcoming month and dynamically executes `CREATE TABLE IF NOT EXISTS ... PARTITION OF ... FOR VALUES FROM (...) TO (...)`. This is scheduled via pg_cron or an automated job on the 25th of every month.

### Q12: What is the primary difference between a B-tree index and a partial index?
**Answer**: A standard B-tree index indexes all rows in a table. A partial index includes a `WHERE` predicate, indexing only rows meeting that condition. For example, `idx_fraud_alerts_open` indexes only rows `WHERE status = 'open'`. Since 95% of alerts are historical/closed, the partial index is over 90% smaller in RAM and vastly faster to traverse.

### Q13: What does `EXPLAIN (ANALYZE, BUFFERS)` reveal that regular `EXPLAIN` does not?
**Answer**: Regular `EXPLAIN` shows the query planner's estimated cost and plan. `EXPLAIN (ANALYZE, BUFFERS)` actually executes the query, reporting the true wall-clock time, actual row counts at each node, and the exact number of 8KB memory buffers read from shared memory (`shared hit`) or fetched from disk (`shared read`).

### Q14: Explain the column ordering in `idx_ledger_entries_account_created (account_id, created_at DESC)`.
**Answer**: The leading column `account_id` provides equality filtering (seeking to the customer's entries). The trailing column `created_at DESC` sorts the entries in reverse chronological order within the B-tree leaf pages. This satisfies `WHERE account_id = $1 ORDER BY created_at DESC LIMIT 50` in a single index traversal without an external sort node.

### Q15: What is Row-Level Security (RLS) in PostgreSQL?
**Answer**: RLS is an engine-level security feature where PostgreSQL rewrites queries to enforce tenant boundaries based on defined security policies. Even if a user executes `SELECT * FROM accounts;`, the engine filters the returned rows so they only see rows where `user_id = current_setting('payledger.current_user_id')`.

### Q16: How is the tenant session identity passed to PostgreSQL for RLS?
**Answer**: The API connection pool executes `SET LOCAL payledger.current_user_id = '<user_uuid>'` at the start of each transaction. `SET LOCAL` scopes the setting strictly to the current transaction, ensuring it automatically resets when the connection returns to the pool.

### Q17: What PostgreSQL roles exist in the database and what are their privileges?
**Answer**:
- `app_customer`: Can SELECT own accounts and ledger; EXECUTE transfer/loan procedures.
- `app_merchant`: Can SELECT merchant accounts; EXECUTE refunds.
- `app_officer`: Can SELECT loan applications; EXECUTE approve/disburse.
- `app_risk`: Can SELECT/UPDATE fraud alerts; EXECUTE reconciliation.
- `app_admin`: Full administrative access and audit log inspection.
- `app_api`: Least-privileged login role used by the web application pool.

### Q18: What is the purpose of the `audit_log` table and how is it populated?
**Answer**: `audit_log` captures an immutable chronological history of all state changes on sensitive tables (`users`, `loans`, `loan_applications`, `fraud_rules`). It is populated by the `trg_audit_log` trigger using `to_jsonb(OLD)` and `to_jsonb(NEW)` to store complete before-and-after snapshots alongside the `actor_user_id`.

### Q19: How is the reducing-balance EMI calculated in `sp_generate_emi_schedule`?
**Answer**: Using the actuarial annuity formula:
$$EMI = P \times \frac{r(1+r)^n}{(1+r)^n - 1}$$
For each month, interest is calculated on the remaining balance ($I = \text{Balance} \times r$), and principal is $P_{\text{comp}} = EMI - I$. To eliminate fractional rounding discrepancies, the procedure adjusts the final installment's principal component so the exact sum equals the loan principal.

### Q20: What happens when a borrower prepays an installment?
**Answer**: `sp_pay_emi` detects if the payment amount exceeds the scheduled installment. The excess amount is applied directly to reduce `loans.outstanding_principal`, and the procedure regenerates the remaining future installments in `emi_schedule` with lower monthly totals.

### Q21: What is the purpose of `sp_accrue_interest_and_penalties`?
**Answer**: It is the automated daily batch job that finds all installments in `emi_schedule` where `due_date < CURRENT_DATE` and `status = 'pending'`. It marks them `overdue`, calculates penalty interest based on `loan_products.penalty_rate`, and records penalty rows. It is idempotent for any given date.

### Q22: What fraud detection rules are implemented in `sp_evaluate_fraud_rules`?
**Answer**:
1. **Velocity**: More than $N$ transfers within $M$ minutes.
2. **High Amount**: Transaction amount exceeding absolute threshold or $X$ times the account's 30-day average.
3. **Round-Tripping**: Account A sends money to B, and B returns funds to A within $K$ minutes.
4. **Structuring (Smurfing)**: Multiple transfers just below the mandatory regulatory threshold ($₹49,000$).

### Q23: When is `sp_evaluate_fraud_rules` executed?
**Answer**: It is invoked by an `AFTER INSERT` trigger (`trg_evaluate_fraud_on_entry`) on `ledger_entries` for every debit entry. Because it inserts into `fraud_alerts`, any suspicious pattern generates an alert immediately upon transaction creation.

### Q24: How does bank reconciliation work in `sp_reconcile`?
**Answer**: External bank statement lines are imported into `bank_statement_lines`. `sp_reconcile` matches external bank references against internal `ledger_transactions.idempotency_key` or descriptions. Lines with exact reference and amount matches are marked `matched`. Lines with matching references but different amounts are flagged as `amount_mismatch`. Unmatched lines remain `unmatched`. A `reconciliation_runs` record aggregates the batch statistics.

### Q25: Why use PostgreSQL UUIDs over auto-incrementing integer IDs?
**Answer**: Auto-incrementing integers leak business volume metrics (competitors can deduce daily transaction volume) and are vulnerable to ID enumeration attacks. UUID v4 provides 128-bit collision-resistant globally unique identifiers suitable for distributed environments.

### Q26: What is a Materialized View and why did you use `mv_daily_stats`?
**Answer**: A standard view executes its query dynamically on every read. A Materialized View computes the query and physically stores the result on disk, offering $O(1)$ reads for expensive analytical aggregations (e.g., daily volume, loan defaults). It is refreshed periodically or on demand using `REFRESH MATERIALIZED VIEW`.

### Q27: How does PayLedger handle refunds without violating append-only rules?
**Answer**: When `sp_refund` is called, it verifies that the requested refund does not exceed the original transaction amount minus prior partial refunds. It then inserts a new `refund` transaction with inverted debit and credit entries. The original transaction is never modified.

### Q28: How does the system handle concurrent transfers between the same two accounts in opposite directions?
**Answer**: If User A sends money to User B while User B sends money to User A, both transactions require locking Account A and Account B. Because our canonical ordering rule mandates acquiring the lock on $\min(A, B)$ first, both threads attempt to lock the same first account. One thread wins and proceeds; the second thread waits. No deadlock occurs.

### Q29: What is the purpose of the "DB Lab" in the web application?
**Answer**: The DB Lab is an interactive administrative interface designed specifically for viva examination. It allows examiners to simulate concurrent transfers, inspect real-time lock acquisitions, view EXPLAIN ANALYZE comparison plans, trigger partition creation, and verify RLS filtering live in the browser.

### Q30: What is the single most important lesson from building this project?
**Answer**: Enforcing financial invariants, access security, and concurrency constraints at the database tier provides absolute correctness. Applications and microservices can crash, scale, or contain bugs, but the database remains the immutable single source of truth that guarantees zero lost money and mathematical consistency.
