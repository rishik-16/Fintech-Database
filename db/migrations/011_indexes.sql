-- ============================================================================
-- Migration 011: Indexes
-- PayLedger Fintech Database
-- ============================================================================

SET search_path = payledger, public;

-- ============================================================================
-- Ledger & Wallet Indexes
-- ============================================================================

-- Account statement queries: filter by account, order by date
CREATE INDEX IF NOT EXISTS idx_ledger_entries_account_date
    ON payledger.ledger_entries (account_id, created_at DESC);

-- Transaction lookup by kind and date (dashboard / reporting)
CREATE INDEX IF NOT EXISTS idx_ledger_txn_kind_date
    ON payledger.ledger_transactions (kind, created_at DESC);

-- Note: User email lookups are indexed via the unique functional index
-- idx_users_email_lower ON payledger.users (LOWER(email)) defined in Migration 002.
-- Redundant regular index on users(email) removed.

-- Account lookup by user (for sp_transfer, sp_pay_emi wallet lookups)
CREATE INDEX IF NOT EXISTS idx_accounts_user_type
    ON payledger.accounts (user_id, account_type) WHERE user_id IS NOT NULL;

-- ============================================================================
-- Fraud & Alert Indexes
-- ============================================================================

-- Open/investigating fraud alerts for the risk dashboard
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_open
    ON payledger.fraud_alerts (status, severity)
    WHERE status IN ('open', 'investigating');

-- Fraud alert by transaction (for dedup checks in sp_evaluate_fraud_rules)
CREATE INDEX IF NOT EXISTS idx_fraud_alerts_txn
    ON payledger.fraud_alerts (ledger_transaction_id);

-- ============================================================================
-- Lending Indexes
-- ============================================================================

-- Pending EMIs by due date (for overdue batch job)
CREATE INDEX IF NOT EXISTS idx_emi_pending_due
    ON payledger.emi_schedule (due_date)
    WHERE status IN ('pending', 'partially_paid');

-- Overdue EMIs for penalty assessment
CREATE INDEX IF NOT EXISTS idx_emi_overdue
    ON payledger.emi_schedule (loan_id, due_date)
    WHERE status = 'overdue';

-- Loans by user and status
CREATE INDEX IF NOT EXISTS idx_loans_user
    ON payledger.loans (user_id, status);

-- Loan applications by user
CREATE INDEX IF NOT EXISTS idx_loan_apps_user
    ON payledger.loan_applications (user_id, status);

-- Penalties by loan (for total penalty queries)
CREATE INDEX IF NOT EXISTS idx_penalties_loan
    ON payledger.penalties (loan_id, assessed_on);

-- ============================================================================
-- Reconciliation Indexes
-- ============================================================================

-- Bank statement lines by import and match status
CREATE INDEX IF NOT EXISTS idx_bsl_import_status
    ON payledger.bank_statement_lines (import_id, match_status);

-- Bank reference lookup (for reconciliation matching)
CREATE INDEX IF NOT EXISTS idx_bsl_bank_reference
    ON payledger.bank_statement_lines (bank_reference)
    WHERE bank_reference IS NOT NULL;

-- ============================================================================
-- Audit Log Index (table created in migration 013)
-- Created here as a placeholder; the actual CREATE INDEX runs in 013.
-- ============================================================================
-- idx_audit_entity will be created in migration 013 after the audit_log table.
