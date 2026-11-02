# PayLedger: Team Contribution & Module Split
**Course**: Database Management Systems (3-Credit Capstone Project)  
**Team Size**: 3 Members  
**Duration**: 15 Days  

---

## Member 1: Wallet, Core Ledger & Concurrency Architecture

### Responsibilities & Scope
Member 1 designed the core double-entry accounting engine, balance materialization, declarative partitioning, and mathematical deadlock prevention algorithms.

### Database Components Delivered
* **Tables**:
  * `payledger.users` & `payledger.kyc_profiles`: Core identity and KYC verification states.
  * `payledger.accounts`: Financial accounts across customer, merchant, and system pool types.
  * `payledger.account_balances`: Denormalized running balance with zero-floor CHECK constraint.
  * `payledger.ledger_transactions`: Top-level transaction records with unique idempotency keys.
  * `payledger.ledger_entries`: Append-only, range-partitioned financial movements.
* **Stored Procedures**:
  * `sp_transfer`: Atomic peer-to-peer money movement with canonical row locking (`LEAST`/`GREATEST`).
  * `sp_pay_merchant`: 3-way atomic ledger transaction with automated system fee collection.
  * `sp_refund`: Partial/full refund engine enforcing cumulative cap against original transaction.
  * `sp_create_ledger_partition` & `sp_create_next_month_partition`: Dynamic partition management.
* **Triggers & Invariants**:
  * `trg_ledger_transactions_immutable` & `trg_ledger_entries_immutable`: Append-only trigger blocking `UPDATE` and `DELETE`.
  * `trg_update_account_balance`: Synchronous balance materialization.
  * `trg_ledger_double_entry_check`: `DEFERRABLE INITIALLY DEFERRED` constraint trigger verifying zero-sum net entries.
* **Indexing & Performance**:
  * Declarative monthly range partitioning on `ledger_entries`.
  * Composite index `idx_ledger_entries_account_created` on `(account_id, created_at DESC)`.
* **Testing & Scripts**:
  * `scripts/concurrency_demo.py`: 100-thread cross-transfer stress test proving deadlock avoidance and money conservation.
  * `api/tests/test_invariants.py` & `api/tests/test_concurrency.py`.
* **Frontend Pages**:
  * Customer Wallet Dashboard, Send Money modal, Pay Merchant modal, Transaction Statement, DB Lab Concurrency Simulator.

---

## Member 2: Lending Engine & Actuarial Servicing

### Responsibilities & Scope
Member 2 architected the credit underwriting, loan product configuration, amortized reducing-balance EMI generation, and automated daily interest/penalty accrual batch jobs.

### Database Components Delivered
* **Tables**:
  * `payledger.loan_products`: Credit definitions, annual interest rates, tenures, and penalty caps.
  * `payledger.loan_applications`: Customer credit applications and underwriting decision records.
  * `payledger.loans`: Active loan contracts with materialized outstanding principal.
  * `payledger.emi_schedule`: Amortized installment schedules (principal, interest, status).
  * `payledger.loan_repayments`: Repayment logs mapped to ledger transactions.
  * `payledger.penalties`: Daily overdue penalty assessments.
* **Stored Procedures**:
  * `sp_apply_for_loan`: Customer application validation against product criteria.
  * `sp_decide_loan`: Underwriting approval/rejection with automatic loan contract initialization.
  * `sp_generate_emi_schedule`: Reducing-balance actuarial EMI formula with last-installment rounding compensation.
  * `sp_disburse_loan`: Atomic ledger disbursement from `loan_pool` to customer wallet.
  * `sp_pay_emi`: Installment repayment engine supporting prepayment and automatic remaining schedule recalculation.
  * `sp_accrue_interest_and_penalties`: Nightly automated batch job marking overdue EMIs and assessing penalties.
* **Views & Reporting**:
  * `v_loan_portfolio`: Non-Performing Asset (NPA) ratio, total active loans, outstanding principal, and overdue totals.
* **Indexing & Performance**:
  * Partial index `idx_emi_schedule_pending` on `(due_date) WHERE status = 'pending'`.
  * Partial index `idx_loans_active` on `(user_id, status) WHERE status = 'active'`.
* **Testing**:
  * `api/tests/test_lending.py`: Comprehensive test suite verifying amortization sums, disbursement, repayment, and penalty accrual.
* **Frontend Pages**:
  * Customer Loan Apply & Repayment views, Loan Officer Underwriting Queue, Portfolio Analytics view.

---

## Member 3: Risk, Fraud Engine, Reconciliation & Security

### Responsibilities & Scope
Member 3 implemented real-time transaction monitoring, external bank statement reconciliation, multi-role PostgreSQL permissions, Row-Level Security (RLS), and JSONB audit logging.

### Database Components Delivered
* **Tables**:
  * `payledger.fraud_rules`: Dynamic rule thresholds (velocity, amount, round-tripping, structuring).
  * `payledger.fraud_alerts`: Risk analyst alert investigation queue.
  * `payledger.bank_statement_imports` & `payledger.bank_statement_lines`: External bank statement ingestion tables.
  * `payledger.reconciliation_runs`: Automated reconciliation audit run summaries.
  * `payledger.audit_log`: JSONB historical change capture for sensitive state mutations.
* **Stored Procedures**:
  * `sp_evaluate_fraud_rules`: Real-time transaction evaluator checking velocity, high-amount multiplier, round-trips, and structuring.
  * `sp_reconcile`: External statement reconciliation engine classifying `matched`, `unmatched`, and `amount_mismatch`.
* **Triggers & Security**:
  * `trg_evaluate_fraud_on_entry`: Trigger evaluating fraud rules on every debit ledger entry.
  * `trg_audit_log`: Generic trigger capturing `to_jsonb(OLD)` and `to_jsonb(NEW)` snapshots.
  * PostgreSQL Roles (`app_customer`, `app_merchant`, `app_officer`, `app_risk`, `app_admin`, `app_api`).
  * Row-Level Security (RLS) policies on `accounts`, `ledger_entries`, `loans`, `loan_applications`.
* **Views & Performance**:
  * `v_fraud_dashboard` & `v_reconciliation_summary`.
  * `mv_daily_stats`: Analytical materialized view for system-wide volume and risk tracking.
  * Partial index `idx_fraud_alerts_open` on `(rule_id, created_at DESC) WHERE status = 'open'`.
  * Composite index `idx_audit_log_entity` on `(entity, entity_id, at DESC)`.
* **Testing & Scripts**:
  * `api/tests/test_fraud.py`, `api/tests/test_reconciliation.py`, `api/tests/test_rls.py`, `api/tests/test_api.py`.
  * `scripts/seed.py`: Enterprise seed data generator (20,000+ entries across 6 months).
* **Frontend Pages**:
  * Risk Analyst Fraud Alert Manager, Rule Configuration, Bank Reconciliation dashboard, Admin Audit Log Viewer, System Health dashboard.
