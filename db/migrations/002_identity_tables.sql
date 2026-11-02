-- ============================================================================
-- Migration 002: Identity Tables (users, kyc_profiles)
-- PayLedger Fintech Database
-- ============================================================================

SET search_path = payledger, public;

-- ============================================================================
-- Users table — the central identity for all actors in the system
-- ============================================================================
CREATE TABLE IF NOT EXISTS payledger.users (
    id          UUID            DEFAULT gen_random_uuid() PRIMARY KEY,
    full_name   VARCHAR(200)    NOT NULL,
    email       VARCHAR(254)    NOT NULL,
    phone       VARCHAR(20),
    password_hash TEXT          NOT NULL,
    role        payledger.user_role NOT NULL DEFAULT 'customer',
    status      VARCHAR(20)     NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'deactivated')),
    created_at  TIMESTAMPTZ     NOT NULL DEFAULT now()
);

-- Case-insensitive uniqueness on email to prevent duplicate accounts with differing case.
-- Enforced via a functional unique index on LOWER(email), avoiding a redundant case-sensitive unique constraint.
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_lower
    ON payledger.users (LOWER(email));

COMMENT ON TABLE payledger.users IS 'All platform actors: customers, merchants, officers, admins.';
COMMENT ON COLUMN payledger.users.password_hash IS 'Bcrypt or Argon2 hash — never store plaintext.';
COMMENT ON INDEX payledger.idx_users_email_lower IS 'Enforces case-insensitive email uniqueness and accelerates LOWER(email) lookups.';

-- ============================================================================
-- KYC Profiles — one-to-one with users, mandatory for lending
-- ============================================================================
CREATE TABLE IF NOT EXISTS payledger.kyc_profiles (
    user_id         UUID            PRIMARY KEY
                        REFERENCES payledger.users (id) ON DELETE CASCADE,
    id_type         VARCHAR(50)     NOT NULL,            -- e.g. 'aadhaar', 'passport', 'pan'
    id_number_hash  TEXT            NOT NULL,            -- keyed HMAC-SHA256 hash for privacy and rainbow table resistance
    status          payledger.kyc_status NOT NULL DEFAULT 'pending',
    verified_at     TIMESTAMPTZ,

    -- verified_at must be set iff status = 'verified'
    CONSTRAINT chk_kyc_verified_at CHECK (
        (status = 'verified' AND verified_at IS NOT NULL)
        OR
        (status <> 'verified' AND verified_at IS NULL)
    )
);

COMMENT ON TABLE payledger.kyc_profiles IS 'Know-Your-Customer verification records.';
COMMENT ON COLUMN payledger.kyc_profiles.id_number_hash IS 'Keyed HMAC-SHA256 hex digest of the original ID number. The secret HMAC key must be stored strictly outside PostgreSQL (e.g., in a dedicated KMS, HSM, or Vault) and never stored in database tables, functions, or logs.';
