-- ============================================================================
-- Migration 001: Schema, Domain Types, and Extensions
-- PayLedger Fintech Database
-- ============================================================================

-- Create schema
CREATE SCHEMA IF NOT EXISTS payledger;

SET search_path = payledger, public;

-- Required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ============================================================================
-- Domain Types
-- ============================================================================

-- Non-negative monetary amount (allows zero for opening balances, fee waivers)
DO $$ BEGIN
    CREATE DOMAIN payledger.money_amount AS NUMERIC(18,2)
        CHECK (VALUE >= 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Strictly positive monetary amount (for transfer amounts, fees)
DO $$ BEGIN
    CREATE DOMAIN payledger.positive_amount AS NUMERIC(18,2)
        CHECK (VALUE > 0);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ============================================================================
-- Enum Types
-- ============================================================================

DO $$ BEGIN CREATE TYPE payledger.user_role AS ENUM (
    'customer', 'merchant', 'loan_officer', 'risk_analyst', 'admin'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE payledger.account_type AS ENUM (
    'customer_wallet', 'merchant_wallet', 'system_fee', 'system_suspense', 'loan_pool'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE payledger.account_status AS ENUM (
    'active', 'frozen', 'closed'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE payledger.kyc_status AS ENUM (
    'pending', 'verified', 'rejected'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE payledger.txn_kind AS ENUM (
    'transfer', 'payment', 'refund', 'loan_disbursement',
    'loan_repayment', 'fee', 'interest', 'penalty'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE payledger.entry_direction AS ENUM (
    'debit', 'credit'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE payledger.loan_app_status AS ENUM (
    'submitted', 'under_review', 'approved', 'rejected', 'disbursed'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE payledger.loan_status AS ENUM (
    'active', 'closed', 'defaulted'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE payledger.emi_status AS ENUM (
    'pending', 'paid', 'overdue', 'partially_paid'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE payledger.alert_severity AS ENUM (
    'low', 'medium', 'high', 'critical'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE payledger.alert_status AS ENUM (
    'open', 'investigating', 'resolved', 'false_positive'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE payledger.match_status AS ENUM (
    'matched', 'unmatched', 'amount_mismatch'
); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
