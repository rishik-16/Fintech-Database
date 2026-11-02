-- ============================================================================
-- Migration 014: Seed System Accounts and Default Fraud Rules
-- PayLedger Fintech Database
-- ============================================================================

SET search_path = payledger, public;

-- ============================================================================
-- System Accounts
-- These are internal ledger accounts with no owning user (user_id IS NULL).
-- They serve as counterparties for fees, suspense, and loan disbursements.
-- ============================================================================

-- System Fee Account — collects platform fees, penalties, interest income
INSERT INTO payledger.accounts (id, user_id, account_type, currency, status)
VALUES ('00000000-0000-0000-0000-000000000001'::uuid, NULL, 'system_fee', 'INR', 'active')
ON CONFLICT (id) DO NOTHING;

-- System Suspense Account — holds unreconciled or disputed amounts
INSERT INTO payledger.accounts (id, user_id, account_type, currency, status)
VALUES ('00000000-0000-0000-0000-000000000002'::uuid, NULL, 'system_suspense', 'INR', 'active')
ON CONFLICT (id) DO NOTHING;

-- Loan Pool Account — source of loan disbursements, destination for repayments
INSERT INTO payledger.accounts (id, user_id, account_type, currency, status)
VALUES ('00000000-0000-0000-0000-000000000003'::uuid, NULL, 'loan_pool', 'INR', 'active')
ON CONFLICT (id) DO NOTHING;

-- Initialise opening balances for system accounts (float/capital pool)
INSERT INTO payledger.account_balances (account_id, balance)
VALUES
    ('00000000-0000-0000-0000-000000000001'::uuid, 100000000.00),
    ('00000000-0000-0000-0000-000000000002'::uuid, 100000000.00),
    ('00000000-0000-0000-0000-000000000003'::uuid, 500000000.00)
ON CONFLICT (account_id) DO NOTHING;

-- ============================================================================
-- Default Fraud Rules
-- These are the five core rules evaluated by sp_evaluate_fraud_rules.
-- Thresholds are configurable via threshold_json (JSONB).
-- ============================================================================

-- VELOCITY: Too many transactions in a short window
INSERT INTO payledger.fraud_rules (code, description, severity, threshold_json)
VALUES (
    'VELOCITY',
    'Detects accounts making unusually many transactions in a short period.',
    'high',
    '{
        "window_minutes": 10,
        "max_count": 5
    }'::jsonb
) ON CONFLICT (code) DO NOTHING;

-- LARGE_AMOUNT: Single transaction exceeds absolute threshold or rolling average multiple
INSERT INTO payledger.fraud_rules (code, description, severity, threshold_json)
VALUES (
    'LARGE_AMOUNT',
    'Flags transactions exceeding an absolute threshold or significantly above the 30-day average.',
    'high',
    '{
        "absolute_threshold": 500000,
        "avg_multiplier": 10
    }'::jsonb
) ON CONFLICT (code) DO NOTHING;

-- ROUND_TRIP: A→B followed by B→A (potential money laundering pattern)
INSERT INTO payledger.fraud_rules (code, description, severity, threshold_json)
VALUES (
    'ROUND_TRIP',
    'Detects round-trip transfers (A→B then B→A) within a time window.',
    'critical',
    '{
        "window_minutes": 60
    }'::jsonb
) ON CONFLICT (code) DO NOTHING;

-- NEW_ACCOUNT_HIGH_VALUE: Young accounts making large transactions
INSERT INTO payledger.fraud_rules (code, description, severity, threshold_json)
VALUES (
    'NEW_ACCOUNT_HIGH_VALUE',
    'Flags high-value transactions from recently created accounts.',
    'medium',
    '{
        "account_age_days": 7,
        "amount_threshold": 100000
    }'::jsonb
) ON CONFLICT (code) DO NOTHING;

-- STRUCTURING: Multiple transactions just below reporting threshold
INSERT INTO payledger.fraud_rules (code, description, severity, threshold_json)
VALUES (
    'STRUCTURING',
    'Detects potential structuring: multiple transactions just below the reporting threshold.',
    'critical',
    '{
        "report_threshold": 1000000,
        "window_hours": 24,
        "min_count": 3
    }'::jsonb
) ON CONFLICT (code) DO NOTHING;

-- ============================================================================
-- Verify seed data
-- ============================================================================
DO $$
DECLARE
    v_acct_count INT;
    v_rule_count INT;
BEGIN
    SELECT COUNT(*) INTO v_acct_count
    FROM payledger.accounts
    WHERE user_id IS NULL;

    SELECT COUNT(*) INTO v_rule_count
    FROM payledger.fraud_rules;

    RAISE NOTICE 'Seed complete: % system accounts, % fraud rules.', v_acct_count, v_rule_count;
END;
$$;
