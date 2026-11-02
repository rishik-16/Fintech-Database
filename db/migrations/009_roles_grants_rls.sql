-- ============================================================================
-- Migration 009: Roles, Grants, and Row-Level Security
-- PayLedger Fintech Database
-- ============================================================================

SET search_path = payledger, public;

-- ============================================================================
-- Create Roles (idempotent with DO blocks)
-- ============================================================================

-- Login role for the API layer (least privilege, acts via SET ROLE, NOINHERIT)
DO $$ BEGIN
    CREATE ROLE app_api LOGIN PASSWORD 'app_api_secret' NOINHERIT;
EXCEPTION WHEN duplicate_object THEN
    ALTER ROLE app_api NOINHERIT;
END $$;

-- Group roles (no login) — mapped to business roles
DO $$ BEGIN CREATE ROLE app_customer NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE app_merchant NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE app_officer  NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE app_risk     NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE ROLE app_admin    NOLOGIN; EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============================================================================
-- Schema Usage Grants
-- ============================================================================
GRANT USAGE ON SCHEMA payledger TO app_api, app_customer, app_merchant,
                                   app_officer, app_risk, app_admin;

-- ============================================================================
-- app_customer: Read own data, execute specific wallet & loan functions
-- ============================================================================
GRANT SELECT ON
    payledger.accounts,
    payledger.ledger_transactions,
    payledger.ledger_entries,
    payledger.account_balances,
    payledger.loan_products,
    payledger.loan_applications,
    payledger.loans,
    payledger.emi_schedule,
    payledger.loan_repayments,
    payledger.users
TO app_customer;

GRANT INSERT ON payledger.loan_applications TO app_customer;

-- Scoped function execution grants (least privilege)
GRANT EXECUTE ON FUNCTION payledger.sp_transfer(UUID, UUID, NUMERIC, VARCHAR, TEXT, UUID, TIMESTAMPTZ) TO app_customer;
GRANT EXECUTE ON FUNCTION payledger.sp_pay_merchant(UUID, UUID, NUMERIC, VARCHAR, UUID, TIMESTAMPTZ) TO app_customer;
GRANT EXECUTE ON FUNCTION payledger.sp_refund(UUID, NUMERIC, VARCHAR, UUID, TIMESTAMPTZ) TO app_customer;
GRANT EXECUTE ON FUNCTION payledger.sp_apply_for_loan(UUID, UUID, NUMERIC, INT) TO app_customer;
GRANT EXECUTE ON FUNCTION payledger.sp_pay_emi(UUID, UUID, NUMERIC, VARCHAR, UUID) TO app_customer;
GRANT EXECUTE ON FUNCTION payledger.sp_prepay_loan(UUID, NUMERIC, VARCHAR, UUID) TO app_customer;

-- ============================================================================
-- app_merchant: Same as customer plus merchant-specific tables
-- ============================================================================
GRANT SELECT ON
    payledger.accounts,
    payledger.ledger_transactions,
    payledger.ledger_entries,
    payledger.account_balances,
    payledger.merchant_profiles,
    payledger.settlements,
    payledger.loan_products,
    payledger.loan_applications,
    payledger.loans,
    payledger.emi_schedule,
    payledger.loan_repayments,
    payledger.users
TO app_merchant;

GRANT INSERT ON payledger.loan_applications TO app_merchant;

GRANT EXECUTE ON FUNCTION payledger.sp_transfer(UUID, UUID, NUMERIC, VARCHAR, TEXT, UUID, TIMESTAMPTZ) TO app_merchant;
GRANT EXECUTE ON FUNCTION payledger.sp_pay_merchant(UUID, UUID, NUMERIC, VARCHAR, UUID, TIMESTAMPTZ) TO app_merchant;
GRANT EXECUTE ON FUNCTION payledger.sp_refund(UUID, NUMERIC, VARCHAR, UUID, TIMESTAMPTZ) TO app_merchant;
GRANT EXECUTE ON FUNCTION payledger.sp_apply_for_loan(UUID, UUID, NUMERIC, INT) TO app_merchant;
GRANT EXECUTE ON FUNCTION payledger.sp_pay_emi(UUID, UUID, NUMERIC, VARCHAR, UUID) TO app_merchant;
GRANT EXECUTE ON FUNCTION payledger.sp_prepay_loan(UUID, NUMERIC, VARCHAR, UUID) TO app_merchant;

-- ============================================================================
-- app_officer: Loan management
-- ============================================================================
GRANT SELECT ON
    payledger.loan_applications,
    payledger.loans,
    payledger.emi_schedule,
    payledger.users,
    payledger.kyc_profiles,
    payledger.loan_products,
    payledger.loan_repayments,
    payledger.penalties,
    payledger.accounts,
    payledger.account_balances
TO app_officer;

GRANT UPDATE ON payledger.loan_applications TO app_officer;

GRANT EXECUTE ON FUNCTION payledger.sp_decide_loan(UUID, UUID, VARCHAR, TEXT) TO app_officer;
GRANT EXECUTE ON FUNCTION payledger.sp_disburse_loan(UUID, VARCHAR) TO app_officer;
GRANT EXECUTE ON FUNCTION payledger.sp_generate_emi_schedule(UUID) TO app_officer;

-- ============================================================================
-- app_risk: Fraud investigation and reconciliation
-- ============================================================================
GRANT SELECT, INSERT, UPDATE ON
    payledger.fraud_rules,
    payledger.fraud_alerts
TO app_risk;

GRANT SELECT, INSERT ON
    payledger.bank_statement_imports,
    payledger.bank_statement_lines,
    payledger.reconciliation_runs
TO app_risk;

GRANT UPDATE ON payledger.bank_statement_lines TO app_risk;

GRANT SELECT ON
    payledger.ledger_transactions,
    payledger.ledger_entries,
    payledger.accounts,
    payledger.account_balances,
    payledger.users
TO app_risk;

GRANT EXECUTE ON FUNCTION payledger.sp_reconcile(UUID, UUID) TO app_risk;
GRANT EXECUTE ON FUNCTION payledger.sp_evaluate_fraud_rules(UUID) TO app_risk;

-- ============================================================================
-- app_admin: Full access
-- ============================================================================
GRANT ALL ON ALL TABLES IN SCHEMA payledger TO app_admin;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA payledger TO app_admin;
GRANT ALL ON ALL SEQUENCES IN SCHEMA payledger TO app_admin;

-- ============================================================================
-- API role: acts via SET ROLE (least privilege, NOINHERIT)
-- ============================================================================
GRANT app_customer, app_merchant, app_officer, app_risk, app_admin TO app_api;

-- Direct bootstrap grants for app_api before SET ROLE
GRANT SELECT, INSERT ON payledger.users TO app_api;
GRANT SELECT, INSERT ON payledger.accounts TO app_api;
GRANT SELECT, INSERT ON payledger.account_balances TO app_api;
GRANT SELECT, INSERT ON payledger.merchant_profiles TO app_api;
GRANT SELECT, INSERT ON payledger.kyc_profiles TO app_api;
GRANT SELECT ON payledger.ledger_transactions, payledger.ledger_entries TO app_api;
GRANT EXECUTE ON FUNCTION payledger.sp_register_user(VARCHAR, VARCHAR, VARCHAR, VARCHAR, payledger.user_role, CHAR(3), VARCHAR, NUMERIC) TO app_api;

-- ============================================================================
-- Row-Level Security
-- ============================================================================
-- The API sets these GUC variables on each request:
--   SET payledger.current_user_id   = '<uuid>';
--   SET payledger.current_user_role = '<role>';
-- RLS policies use these to restrict visibility.

-- ---------- accounts ----------
ALTER TABLE payledger.accounts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS account_isolation ON payledger.accounts;
CREATE POLICY account_isolation ON payledger.accounts
    FOR SELECT
    USING (
        current_setting('payledger.current_user_role', true) IN (
            'admin', 'risk_analyst', 'loan_officer'
        )
        OR user_id::text = current_setting('payledger.current_user_id', true)
        OR user_id IS NULL
    );

DROP POLICY IF EXISTS account_insert ON payledger.accounts;
CREATE POLICY account_insert ON payledger.accounts
    FOR INSERT WITH CHECK (
        current_setting('payledger.current_user_role', true) IN ('admin', 'app_admin')
        OR user_id::text = current_setting('payledger.current_user_id', true)
        OR user_id IS NULL
    );

-- ---------- account_balances ----------
ALTER TABLE payledger.account_balances ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS balance_isolation ON payledger.account_balances;
CREATE POLICY balance_isolation ON payledger.account_balances
    FOR SELECT
    USING (
        current_setting('payledger.current_user_role', true) IN (
            'admin', 'risk_analyst', 'loan_officer'
        )
        OR account_id IN (
            SELECT id FROM payledger.accounts
            WHERE user_id::text = current_setting('payledger.current_user_id', true)
               OR user_id IS NULL
        )
    );

-- ---------- ledger_entries ----------
ALTER TABLE payledger.ledger_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS entry_isolation ON payledger.ledger_entries;
CREATE POLICY entry_isolation ON payledger.ledger_entries
    FOR SELECT
    USING (
        current_setting('payledger.current_user_role', true) IN (
            'admin', 'risk_analyst', 'loan_officer'
        )
        OR account_id IN (
            SELECT id FROM payledger.accounts
            WHERE user_id::text = current_setting('payledger.current_user_id', true)
               OR user_id IS NULL
        )
    );

-- ---------- loan_applications ----------
ALTER TABLE payledger.loan_applications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS loan_app_isolation ON payledger.loan_applications;
CREATE POLICY loan_app_isolation ON payledger.loan_applications
    FOR SELECT
    USING (
        current_setting('payledger.current_user_role', true) IN (
            'admin', 'loan_officer'
        )
        OR user_id::text = current_setting('payledger.current_user_id', true)
    );

DROP POLICY IF EXISTS loan_app_insert ON payledger.loan_applications;
CREATE POLICY loan_app_insert ON payledger.loan_applications
    FOR INSERT WITH CHECK (
        current_setting('payledger.current_user_role', true) IN ('admin', 'loan_officer')
        OR user_id::text = current_setting('payledger.current_user_id', true)
    );

-- ---------- loans ----------
ALTER TABLE payledger.loans ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS loan_isolation ON payledger.loans;
CREATE POLICY loan_isolation ON payledger.loans
    FOR SELECT
    USING (
        current_setting('payledger.current_user_role', true) IN (
            'admin', 'loan_officer'
        )
        OR user_id::text = current_setting('payledger.current_user_id', true)
    );

-- ---------- emi_schedule ----------
ALTER TABLE payledger.emi_schedule ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS emi_isolation ON payledger.emi_schedule;
CREATE POLICY emi_isolation ON payledger.emi_schedule
    FOR SELECT
    USING (
        current_setting('payledger.current_user_role', true) IN (
            'admin', 'loan_officer'
        )
        OR loan_id IN (
            SELECT id FROM payledger.loans
            WHERE user_id::text = current_setting('payledger.current_user_id', true)
        )
    );

-- ---------- kyc_profiles ----------
ALTER TABLE payledger.kyc_profiles ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS kyc_isolation ON payledger.kyc_profiles;
CREATE POLICY kyc_isolation ON payledger.kyc_profiles
    FOR SELECT
    USING (
        current_setting('payledger.current_user_role', true) IN ('admin', 'loan_officer', 'risk_analyst')
        OR user_id::text = current_setting('payledger.current_user_id', true)
    );

DROP POLICY IF EXISTS kyc_insert_update ON payledger.kyc_profiles;
CREATE POLICY kyc_insert_update ON payledger.kyc_profiles
    FOR ALL
    USING (
        current_setting('payledger.current_user_role', true) IN ('admin', 'loan_officer')
        OR user_id::text = current_setting('payledger.current_user_id', true)
    )
    WITH CHECK (
        current_setting('payledger.current_user_role', true) IN ('admin', 'loan_officer')
        OR user_id::text = current_setting('payledger.current_user_id', true)
    );

-- ============================================================================
-- Force RLS for API role
-- ============================================================================
ALTER TABLE payledger.accounts            FORCE ROW LEVEL SECURITY;
ALTER TABLE payledger.account_balances    FORCE ROW LEVEL SECURITY;
ALTER TABLE payledger.ledger_entries      FORCE ROW LEVEL SECURITY;
ALTER TABLE payledger.loan_applications   FORCE ROW LEVEL SECURITY;
ALTER TABLE payledger.loans               FORCE ROW LEVEL SECURITY;
ALTER TABLE payledger.emi_schedule        FORCE ROW LEVEL SECURITY;
ALTER TABLE payledger.kyc_profiles        FORCE ROW LEVEL SECURITY;

COMMENT ON POLICY account_isolation  ON payledger.accounts          IS 'Isolates account visibility by user. System accounts visible to all.';
COMMENT ON POLICY loan_app_isolation ON payledger.loan_applications IS 'Customers see own apps; officers and admins see all.';
