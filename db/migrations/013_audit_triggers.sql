-- ============================================================================
-- Migration 013: Audit Log Table and Triggers
-- PayLedger Fintech Database
-- ============================================================================

SET search_path = payledger, public;

-- ============================================================================
-- Audit Log Table — stores before/after snapshots as JSONB
-- ============================================================================
CREATE TABLE IF NOT EXISTS payledger.audit_log (
    id          BIGINT          GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    entity      VARCHAR(100)    NOT NULL,       -- table name being audited
    entity_id   TEXT            NOT NULL,        -- PK of the audited row (text for UUID compat)
    action      VARCHAR(10)     NOT NULL         -- INSERT, UPDATE, DELETE
                    CHECK (action IN ('INSERT', 'UPDATE', 'DELETE')),
    old_data    JSONB,                           -- NULL for INSERTs
    new_data    JSONB,                           -- NULL for DELETEs
    changed_by  TEXT,                            -- from session variable
    at          TIMESTAMPTZ     NOT NULL DEFAULT now()
);

COMMENT ON TABLE payledger.audit_log IS
    'Generic audit trail for tracked tables. Captures full row snapshots.';

-- Index for querying audit history of a specific entity/row
CREATE INDEX IF NOT EXISTS idx_audit_entity
    ON payledger.audit_log (entity, entity_id, at DESC);

-- Index for querying by actor
CREATE INDEX IF NOT EXISTS idx_audit_actor
    ON payledger.audit_log (changed_by, at DESC)
    WHERE changed_by IS NOT NULL;

-- ============================================================================
-- Generic audit trigger function
-- Reads payledger.current_user_id from session for the actor.
-- ============================================================================
CREATE OR REPLACE FUNCTION payledger.trg_audit_log()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER  -- needs INSERT on audit_log regardless of caller's grants
AS $$
DECLARE
    v_entity_id TEXT;
    v_actor     TEXT;
BEGIN
    -- Get the actor from session variable (may be NULL if not set)
    v_actor := current_setting('payledger.current_user_id', true);

    -- Determine the entity ID from the primary key
    -- We use the 'id' column if it exists; fall back to user_id for profile tables.
    IF TG_OP = 'DELETE' THEN
        v_entity_id := COALESCE(
            row_to_json(OLD)->>'id',
            row_to_json(OLD)->>'user_id',
            row_to_json(OLD)->>'account_id',
            'unknown'
        );

        INSERT INTO payledger.audit_log (entity, entity_id, action, old_data, changed_by)
        VALUES (TG_TABLE_NAME, v_entity_id, 'DELETE', to_jsonb(OLD), v_actor);

        RETURN OLD;

    ELSIF TG_OP = 'UPDATE' THEN
        v_entity_id := COALESCE(
            row_to_json(NEW)->>'id',
            row_to_json(NEW)->>'user_id',
            row_to_json(NEW)->>'account_id',
            'unknown'
        );

        -- Only log if data actually changed
        IF to_jsonb(OLD) IS DISTINCT FROM to_jsonb(NEW) THEN
            INSERT INTO payledger.audit_log (entity, entity_id, action, old_data, new_data, changed_by)
            VALUES (TG_TABLE_NAME, v_entity_id, 'UPDATE', to_jsonb(OLD), to_jsonb(NEW), v_actor);
        END IF;

        RETURN NEW;

    ELSIF TG_OP = 'INSERT' THEN
        v_entity_id := COALESCE(
            row_to_json(NEW)->>'id',
            row_to_json(NEW)->>'user_id',
            row_to_json(NEW)->>'account_id',
            'unknown'
        );

        INSERT INTO payledger.audit_log (entity, entity_id, action, new_data, changed_by)
        VALUES (TG_TABLE_NAME, v_entity_id, 'INSERT', to_jsonb(NEW), v_actor);

        RETURN NEW;
    END IF;

    RETURN NULL;
END;
$$;

COMMENT ON FUNCTION payledger.trg_audit_log IS
    'Generic audit trigger. Attach to any table to capture INSERT/UPDATE/DELETE history.';

-- ============================================================================
-- Attach audit triggers to key tables
-- ============================================================================

-- users
DROP TRIGGER IF EXISTS audit_users ON payledger.users;
CREATE TRIGGER audit_users
    AFTER INSERT OR UPDATE OR DELETE ON payledger.users
    FOR EACH ROW EXECUTE FUNCTION payledger.trg_audit_log();

-- loans
DROP TRIGGER IF EXISTS audit_loans ON payledger.loans;
CREATE TRIGGER audit_loans
    AFTER INSERT OR UPDATE OR DELETE ON payledger.loans
    FOR EACH ROW EXECUTE FUNCTION payledger.trg_audit_log();

-- loan_applications
DROP TRIGGER IF EXISTS audit_loan_applications ON payledger.loan_applications;
CREATE TRIGGER audit_loan_applications
    AFTER INSERT OR UPDATE OR DELETE ON payledger.loan_applications
    FOR EACH ROW EXECUTE FUNCTION payledger.trg_audit_log();

-- fraud_rules
DROP TRIGGER IF EXISTS audit_fraud_rules ON payledger.fraud_rules;
CREATE TRIGGER audit_fraud_rules
    AFTER INSERT OR UPDATE OR DELETE ON payledger.fraud_rules
    FOR EACH ROW EXECUTE FUNCTION payledger.trg_audit_log();

-- fraud_alerts
DROP TRIGGER IF EXISTS audit_fraud_alerts ON payledger.fraud_alerts;
CREATE TRIGGER audit_fraud_alerts
    AFTER INSERT OR UPDATE OR DELETE ON payledger.fraud_alerts
    FOR EACH ROW EXECUTE FUNCTION payledger.trg_audit_log();

-- accounts
DROP TRIGGER IF EXISTS audit_accounts ON payledger.accounts;
CREATE TRIGGER audit_accounts
    AFTER INSERT OR UPDATE OR DELETE ON payledger.accounts
    FOR EACH ROW EXECUTE FUNCTION payledger.trg_audit_log();

-- merchant_profiles
DROP TRIGGER IF EXISTS audit_merchant_profiles ON payledger.merchant_profiles;
CREATE TRIGGER audit_merchant_profiles
    AFTER INSERT OR UPDATE OR DELETE ON payledger.merchant_profiles
    FOR EACH ROW EXECUTE FUNCTION payledger.trg_audit_log();

-- kyc_profiles
DROP TRIGGER IF EXISTS audit_kyc_profiles ON payledger.kyc_profiles;
CREATE TRIGGER audit_kyc_profiles
    AFTER INSERT OR UPDATE OR DELETE ON payledger.kyc_profiles
    FOR EACH ROW EXECUTE FUNCTION payledger.trg_audit_log();

-- loan_products
DROP TRIGGER IF EXISTS audit_loan_products ON payledger.loan_products;
CREATE TRIGGER audit_loan_products
    AFTER INSERT OR UPDATE OR DELETE ON payledger.loan_products
    FOR EACH ROW EXECUTE FUNCTION payledger.trg_audit_log();

-- settlements
DROP TRIGGER IF EXISTS audit_settlements ON payledger.settlements;
CREATE TRIGGER audit_settlements
    AFTER INSERT OR UPDATE OR DELETE ON payledger.settlements
    FOR EACH ROW EXECUTE FUNCTION payledger.trg_audit_log();

-- reconciliation_runs
DROP TRIGGER IF EXISTS audit_reconciliation_runs ON payledger.reconciliation_runs;
CREATE TRIGGER audit_reconciliation_runs
    AFTER INSERT OR UPDATE OR DELETE ON payledger.reconciliation_runs
    FOR EACH ROW EXECUTE FUNCTION payledger.trg_audit_log();

-- bank_statement_lines
DROP TRIGGER IF EXISTS audit_bank_statement_lines ON payledger.bank_statement_lines;
CREATE TRIGGER audit_bank_statement_lines
    AFTER INSERT OR UPDATE OR DELETE ON payledger.bank_statement_lines
    FOR EACH ROW EXECUTE FUNCTION payledger.trg_audit_log();

-- Note: ledger_transactions and ledger_entries are NOT audited because they
-- are append-only (immutable). Their own immutability triggers prevent changes.
