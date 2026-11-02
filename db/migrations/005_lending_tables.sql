-- ============================================================================
-- Migration 005: Lending Tables
-- PayLedger Fintech Database
-- ============================================================================

SET search_path = payledger, public;

-- ============================================================================
-- Loan Products — catalog of available loan products
-- ============================================================================
CREATE TABLE IF NOT EXISTS payledger.loan_products (
    id                  UUID            DEFAULT gen_random_uuid() PRIMARY KEY,
    name                VARCHAR(100)    NOT NULL,
    annual_rate         NUMERIC(6,4)    NOT NULL CHECK (annual_rate >= 0),
    min_amount          NUMERIC(18,2)   NOT NULL CHECK (min_amount > 0),
    max_amount          NUMERIC(18,2)   NOT NULL CHECK (max_amount > 0),
    min_tenure_months   INT             NOT NULL CHECK (min_tenure_months > 0),
    max_tenure_months   INT             NOT NULL,
    penalty_rate        NUMERIC(6,4)    NOT NULL DEFAULT 0.0200 CHECK (penalty_rate >= 0),
    prepayment_allowed  BOOLEAN         NOT NULL DEFAULT true,
    active              BOOLEAN         NOT NULL DEFAULT true,

    CONSTRAINT chk_lp_amount_range  CHECK (max_amount >= min_amount),
    CONSTRAINT chk_lp_tenure_range  CHECK (max_tenure_months >= min_tenure_months)
);

COMMENT ON TABLE payledger.loan_products IS 'Catalog of loan products with interest rates and constraints.';

-- ============================================================================
-- Loan Applications — customer requests for a loan
-- ============================================================================
CREATE TABLE IF NOT EXISTS payledger.loan_applications (
    id              UUID                        DEFAULT gen_random_uuid() PRIMARY KEY,
    user_id         UUID                        NOT NULL
                        REFERENCES payledger.users (id),
    product_id      UUID                        NOT NULL
                        REFERENCES payledger.loan_products (id),
    amount          NUMERIC(18,2)               NOT NULL CHECK (amount > 0),
    tenure_months   INT                         NOT NULL CHECK (tenure_months > 0),
    status          payledger.loan_app_status   NOT NULL DEFAULT 'submitted',
    decided_by      UUID                        REFERENCES payledger.users (id),
    decided_at      TIMESTAMPTZ,
    reason          TEXT,
    created_at      TIMESTAMPTZ                 NOT NULL DEFAULT now(),

    -- Compound unique key to enforce user consistency on referencing tables
    CONSTRAINT uq_loan_applications_user UNIQUE (id, user_id)
);

COMMENT ON TABLE payledger.loan_applications IS 'Customer-submitted loan requests awaiting officer decision.';

-- Trigger enforcing product amount and tenure limits at the database level
CREATE OR REPLACE FUNCTION payledger.trg_validate_loan_application_limits()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = payledger, pg_temp
AS $$
DECLARE
    v_min_amt    NUMERIC(18,2);
    v_max_amt    NUMERIC(18,2);
    v_min_tenure INT;
    v_max_tenure INT;
    v_active     BOOLEAN;
BEGIN
    SELECT min_amount, max_amount, min_tenure_months, max_tenure_months, active
    INTO v_min_amt, v_max_amt, v_min_tenure, v_max_tenure, v_active
    FROM payledger.loan_products
    WHERE id = NEW.product_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Loan product % not found', NEW.product_id;
    END IF;

    IF NOT v_active THEN
        RAISE EXCEPTION 'Loan product % is inactive', NEW.product_id;
    END IF;

    IF NEW.amount < v_min_amt OR NEW.amount > v_max_amt THEN
        RAISE EXCEPTION 'Application amount % is outside product limits [%, %]',
            NEW.amount, v_min_amt, v_max_amt;
    END IF;

    IF NEW.tenure_months < v_min_tenure OR NEW.tenure_months > v_max_tenure THEN
        RAISE EXCEPTION 'Application tenure % months is outside product limits [%, %]',
            NEW.tenure_months, v_min_tenure, v_max_tenure;
    END IF;

    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS loan_applications_validate_limits ON payledger.loan_applications;
CREATE TRIGGER loan_applications_validate_limits
    BEFORE INSERT OR UPDATE ON payledger.loan_applications
    FOR EACH ROW
    EXECUTE FUNCTION payledger.trg_validate_loan_application_limits();

-- ============================================================================
-- Loans — active/closed loans post-disbursement
-- ============================================================================
CREATE TABLE IF NOT EXISTS payledger.loans (
    id                      UUID                    DEFAULT gen_random_uuid() PRIMARY KEY,
    application_id          UUID                    NOT NULL UNIQUE,
    user_id                 UUID                    NOT NULL,
    principal               NUMERIC(18,2)           NOT NULL CHECK (principal > 0),
    annual_rate             NUMERIC(6,4)            NOT NULL CHECK (annual_rate >= 0),
    tenure_months           INT                     NOT NULL CHECK (tenure_months > 0),
    status                  payledger.loan_status   NOT NULL DEFAULT 'active',
    disbursed_at            TIMESTAMPTZ,
    outstanding_principal   NUMERIC(18,2)           NOT NULL CHECK (outstanding_principal >= 0),
    created_at              TIMESTAMPTZ             NOT NULL DEFAULT now(),

    -- Enforce table-level loan and application ownership consistency
    CONSTRAINT fk_loans_application_user FOREIGN KEY (application_id, user_id)
        REFERENCES payledger.loan_applications (id, user_id) ON DELETE RESTRICT
);

COMMENT ON TABLE payledger.loans IS 'Active, closed, or defaulted loans.';

-- ============================================================================
-- EMI Schedule — each installment for a loan
-- ============================================================================
CREATE TABLE IF NOT EXISTS payledger.emi_schedule (
    id                      UUID            DEFAULT gen_random_uuid() PRIMARY KEY,
    loan_id                 UUID            NOT NULL
                                REFERENCES payledger.loans (id),
    installment_no          INT             NOT NULL CHECK (installment_no > 0),
    due_date                DATE            NOT NULL,
    principal_component     NUMERIC(18,2)   NOT NULL CHECK (principal_component >= 0),
    interest_component      NUMERIC(18,2)   NOT NULL CHECK (interest_component >= 0),
    total_due               NUMERIC(18,2)   NOT NULL CHECK (total_due > 0),
    status                  payledger.emi_status NOT NULL DEFAULT 'pending',
    paid_amount             NUMERIC(18,2)   NOT NULL DEFAULT 0 CHECK (paid_amount >= 0),
    paid_at                 TIMESTAMPTZ,

    CONSTRAINT uq_emi_loan_installment UNIQUE (loan_id, installment_no),
    CONSTRAINT uq_emi_id_loan UNIQUE (id, loan_id),
    CONSTRAINT chk_emi_total_due_balance CHECK (total_due = principal_component + interest_component)
);

COMMENT ON TABLE payledger.emi_schedule IS 'Amortisation schedule with one row per EMI installment.';

-- ============================================================================
-- Loan Repayments — individual repayment records
-- ============================================================================
CREATE TABLE IF NOT EXISTS payledger.loan_repayments (
    id                      UUID            DEFAULT gen_random_uuid() PRIMARY KEY,
    loan_id                 UUID            NOT NULL
                                REFERENCES payledger.loans (id),
    emi_id                  UUID            NOT NULL,
    ledger_transaction_id   UUID            REFERENCES payledger.ledger_transactions (id),
    amount                  NUMERIC(18,2)   NOT NULL CHECK (amount > 0),
    paid_at                 TIMESTAMPTZ     NOT NULL DEFAULT now(),

    -- Enforces that repayment EMI belongs to the exact same loan
    CONSTRAINT fk_repayments_emi_loan FOREIGN KEY (emi_id, loan_id)
        REFERENCES payledger.emi_schedule (id, loan_id) ON DELETE RESTRICT
);

COMMENT ON TABLE payledger.loan_repayments IS 'Individual EMI payment records linked to ledger transactions.';

-- ============================================================================
-- Penalties — overdue charges assessed daily
-- ============================================================================
CREATE TABLE IF NOT EXISTS payledger.penalties (
    id                      UUID            DEFAULT gen_random_uuid() PRIMARY KEY,
    loan_id                 UUID            NOT NULL
                                REFERENCES payledger.loans (id),
    emi_id                  UUID            NOT NULL,
    amount                  NUMERIC(18,2)   NOT NULL CHECK (amount > 0),
    assessed_on             DATE            NOT NULL,
    ledger_transaction_id   UUID            REFERENCES payledger.ledger_transactions (id),

    -- Prevent duplicate penalties for the same EMI on the same date
    CONSTRAINT uq_penalty_per_day UNIQUE (loan_id, emi_id, assessed_on),

    -- Enforces that penalised EMI belongs to the exact same loan
    CONSTRAINT fk_penalties_emi_loan FOREIGN KEY (emi_id, loan_id)
        REFERENCES payledger.emi_schedule (id, loan_id) ON DELETE RESTRICT
);

COMMENT ON TABLE payledger.penalties IS 'Daily overdue penalty charges on missed EMI installments.';
