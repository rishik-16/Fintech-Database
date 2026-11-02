-- ============================================================================
-- Migration 006: Lending Stored Procedures
-- PayLedger Fintech Database
-- ============================================================================

SET search_path = payledger, public;

-- ============================================================================
-- sp_apply_for_loan: Submit a new loan application
-- ============================================================================
CREATE OR REPLACE FUNCTION payledger.sp_apply_for_loan(
    p_user_id       UUID,
    p_product_id    UUID,
    p_amount        NUMERIC,
    p_tenure_months INT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = payledger, pg_temp
AS $$
DECLARE
    v_product       RECORD;
    v_app_id        UUID;
    v_kyc_status    payledger.kyc_status;
BEGIN
    -- 1. Validate product exists and is active
    SELECT * INTO v_product
    FROM payledger.loan_products
    WHERE id = p_product_id AND active = true;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Loan product % not found or inactive', p_product_id;
    END IF;

    -- 2. Validate amount within product bounds
    IF p_amount < v_product.min_amount OR p_amount > v_product.max_amount THEN
        RAISE EXCEPTION 'Amount % outside product range [%, %]',
            p_amount, v_product.min_amount, v_product.max_amount;
    END IF;

    -- 3. Validate tenure within product bounds
    IF p_tenure_months < v_product.min_tenure_months
       OR p_tenure_months > v_product.max_tenure_months THEN
        RAISE EXCEPTION 'Tenure % months outside product range [%, %]',
            p_tenure_months, v_product.min_tenure_months, v_product.max_tenure_months;
    END IF;

    -- 4. Validate KYC status
    SELECT status INTO v_kyc_status
    FROM payledger.kyc_profiles
    WHERE user_id = p_user_id;

    IF FOUND AND v_kyc_status <> 'verified' THEN
        RAISE EXCEPTION 'KYC not verified for user %. Current status: %',
            p_user_id, v_kyc_status;
    END IF;

    IF NOT FOUND THEN
        RAISE NOTICE 'No KYC profile for user %. Allowing for demo purposes.', p_user_id;
    END IF;

    -- 5. Validate user exists
    IF NOT EXISTS (SELECT 1 FROM payledger.users WHERE id = p_user_id) THEN
        RAISE EXCEPTION 'User % not found', p_user_id;
    END IF;

    -- 6. Insert application
    v_app_id := gen_random_uuid();

    INSERT INTO payledger.loan_applications (id, user_id, product_id, amount, tenure_months)
    VALUES (v_app_id, p_user_id, p_product_id, p_amount, p_tenure_months);

    RETURN v_app_id;
END;
$$;

COMMENT ON FUNCTION payledger.sp_apply_for_loan IS
    'Customer submits a loan application. Validates product constraints and KYC.';

-- ============================================================================
-- sp_decide_loan: Officer approves or rejects a loan application
-- ============================================================================
CREATE OR REPLACE FUNCTION payledger.sp_decide_loan(
    p_application_id UUID,
    p_officer_id     UUID,
    p_decision       VARCHAR,
    p_reason         TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = payledger, pg_temp
AS $$
DECLARE
    v_app_status    payledger.loan_app_status;
    v_officer_role  payledger.user_role;
BEGIN
    -- 1. Validate officer role
    SELECT role INTO v_officer_role
    FROM payledger.users
    WHERE id = p_officer_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Officer user % not found', p_officer_id;
    END IF;

    IF v_officer_role NOT IN ('loan_officer', 'admin') THEN
        RAISE EXCEPTION 'User % with role % cannot decide loans',
            p_officer_id, v_officer_role;
    END IF;

    -- 2. Validate application exists and is in decidable state
    SELECT status INTO v_app_status
    FROM payledger.loan_applications
    WHERE id = p_application_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Loan application % not found', p_application_id;
    END IF;

    IF v_app_status NOT IN ('submitted', 'under_review') THEN
        RAISE EXCEPTION 'Application % is in status % and cannot be decided',
            p_application_id, v_app_status;
    END IF;

    -- 3. Validate decision value
    IF p_decision NOT IN ('approved', 'rejected') THEN
        RAISE EXCEPTION 'Decision must be "approved" or "rejected", got "%"', p_decision;
    END IF;

    -- 4. Update application
    UPDATE payledger.loan_applications
    SET status     = p_decision::payledger.loan_app_status,
        decided_by = p_officer_id,
        decided_at = now(),
        reason     = p_reason
    WHERE id = p_application_id;

    -- 5. If approved, create loan record if not exists
    IF p_decision = 'approved' THEN
        INSERT INTO payledger.loans (
            id, application_id, user_id, principal, annual_rate,
            tenure_months, status, outstanding_principal
        )
        SELECT
            gen_random_uuid(), la.id, la.user_id, la.amount, lp.annual_rate,
            la.tenure_months, 'active'::payledger.loan_status, la.amount
        FROM payledger.loan_applications la
        JOIN payledger.loan_products lp ON lp.id = la.product_id
        WHERE la.id = p_application_id
        ON CONFLICT (application_id) DO NOTHING;
    END IF;
END;
$$;

COMMENT ON FUNCTION payledger.sp_decide_loan IS
    'Loan officer approves or rejects a loan application.';

-- ============================================================================
-- sp_generate_emi_schedule: Reducing-balance EMI amortisation
-- ============================================================================
CREATE OR REPLACE FUNCTION payledger.sp_generate_emi_schedule(
    p_loan_id UUID
)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = payledger, pg_temp
AS $$
DECLARE
    v_loan              RECORD;
    v_monthly_rate      NUMERIC;           -- r = annual_rate / 12 / 100
    v_emi               NUMERIC(18,2);
    v_outstanding       NUMERIC(18,2);
    v_interest          NUMERIC(18,2);
    v_principal_part    NUMERIC(18,2);
    v_total_principal   NUMERIC(18,2) := 0;
    v_due_date          DATE;
    i                   INT;
    v_power_factor      NUMERIC;           -- (1+r)^n
BEGIN
    -- 1. Get loan details (accepts loan_id or application_id)
    SELECT * INTO v_loan
    FROM payledger.loans
    WHERE id = p_loan_id OR application_id = p_loan_id;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Loan % not found', p_loan_id;
    END IF;

    -- 2. Delete any existing schedule (in case of re-generation)
    DELETE FROM payledger.emi_schedule WHERE loan_id = v_loan.id;

    -- 3. Calculate monthly rate
    v_monthly_rate := v_loan.annual_rate / 12.0 / 100.0;
    v_outstanding  := v_loan.principal;

    -- 4. Calculate EMI using reducing-balance formula:
    --    EMI = P * r * (1+r)^n / ((1+r)^n - 1)
    IF v_monthly_rate = 0 THEN
        v_emi := ROUND(v_loan.principal / v_loan.tenure_months, 2);
    ELSE
        v_power_factor := POWER(1 + v_monthly_rate, v_loan.tenure_months);
        v_emi := ROUND(
            v_loan.principal * v_monthly_rate * v_power_factor / (v_power_factor - 1),
            2
        );
    END IF;

    -- 5. Generate schedule
    --    Due dates start 1 month after disbursement
    v_due_date := (COALESCE(v_loan.disbursed_at, now())::date + INTERVAL '1 month')::date;

    FOR i IN 1..v_loan.tenure_months LOOP
        -- Interest for this period on outstanding principal
        IF v_monthly_rate = 0 THEN
            v_interest := 0.00;
        ELSE
            v_interest := ROUND(v_outstanding * v_monthly_rate, 2);
        END IF;

        -- Final installment adjustment: principal part is exactly remaining outstanding principal
        IF i = v_loan.tenure_months THEN
            v_principal_part := v_outstanding;
        ELSE
            v_principal_part := v_emi - v_interest;
            IF v_principal_part < 0 THEN
                v_principal_part := 0.00;
            END IF;
            IF v_principal_part > v_outstanding THEN
                v_principal_part := v_outstanding;
            END IF;
        END IF;

        -- Insert using the resolved loan ID (v_loan.id) to prevent FK failure when called with app_id
        INSERT INTO payledger.emi_schedule (
            loan_id, installment_no, due_date,
            principal_component, interest_component, total_due
        ) VALUES (
            v_loan.id, i, v_due_date,
            v_principal_part, v_interest, v_principal_part + v_interest
        );

        v_outstanding := v_outstanding - v_principal_part;
        v_total_principal := v_total_principal + v_principal_part;

        -- Advance due date by 1 month
        v_due_date := (v_due_date + INTERVAL '1 month')::date;
    END LOOP;
END;
$$;

COMMENT ON FUNCTION payledger.sp_generate_emi_schedule IS
    'Generates reducing-balance EMI amortisation schedule for a loan.';

-- ============================================================================
-- sp_disburse_loan: Transfer principal to borrower, activate loan
-- ============================================================================
CREATE OR REPLACE FUNCTION payledger.sp_disburse_loan(
    p_loan_id           UUID,
    p_idempotency_key   VARCHAR
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = payledger, pg_temp
AS $$
DECLARE
    v_loan              RECORD;
    v_app_status        payledger.loan_app_status;
    v_loan_pool_id      UUID;
    v_borrower_wallet   UUID;
    v_txn_id            UUID;
    v_existing_id       UUID;
    v_existing_kind     payledger.txn_kind;
    v_pool_balance      NUMERIC(18,2);
    v_debit_amt         NUMERIC(18,2);
    v_credit_amt        NUMERIC(18,2);
BEGIN
    IF p_idempotency_key IS NULL OR BTRIM(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'Idempotency key must not be blank';
    END IF;

    -- 1. Get loan and validate (accepts loan_id or application_id)
    SELECT l.*, la.status AS app_status
    INTO v_loan
    FROM payledger.loans l
    JOIN payledger.loan_applications la ON la.id = l.application_id
    WHERE l.id = p_loan_id OR l.application_id = p_loan_id
    FOR UPDATE OF l;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Loan % not found', p_loan_id;
    END IF;

    -- 2. Idempotency check: verify identical parameters
    SELECT id, kind INTO v_existing_id, v_existing_kind
    FROM payledger.ledger_transactions
    WHERE idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_existing_kind <> 'loan_disbursement' THEN
            RAISE EXCEPTION 'Idempotency key % already used with different parameters', p_idempotency_key;
        END IF;

        SELECT
            COALESCE(SUM(amount) FILTER (WHERE direction = 'debit'), 0),
            COALESCE(SUM(amount) FILTER (WHERE direction = 'credit'), 0)
        INTO v_debit_amt, v_credit_amt
        FROM payledger.ledger_entries
        WHERE transaction_id = v_existing_id;

        IF v_debit_amt = v_loan.principal AND v_credit_amt = v_loan.principal THEN
            RETURN v_existing_id;
        ELSE
            RAISE EXCEPTION 'Idempotency key % already used with different parameters', p_idempotency_key;
        END IF;
    END IF;

    IF v_loan.app_status <> 'approved' THEN
        RAISE EXCEPTION 'Loan application must be approved before disbursement. Current status: %',
            v_loan.app_status;
    END IF;

    IF v_loan.disbursed_at IS NOT NULL THEN
        RAISE EXCEPTION 'Loan % has already been disbursed', v_loan.id;
    END IF;

    -- 3. Find loan pool (source of funds) and borrower wallet (destination)
    SELECT id INTO v_loan_pool_id
    FROM payledger.accounts
    WHERE account_type = 'loan_pool'
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Loan pool account not found. Run seed migration first.';
    END IF;

    SELECT id INTO v_borrower_wallet
    FROM payledger.accounts
    WHERE user_id = v_loan.user_id
      AND account_type = 'customer_wallet'
      AND status = 'active';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active customer wallet not found for user %', v_loan.user_id;
    END IF;

    -- Liquidity check
    SELECT balance INTO v_pool_balance
    FROM payledger.account_balances
    WHERE account_id = v_loan_pool_id;

    IF v_pool_balance < v_loan.principal THEN
        RAISE EXCEPTION 'Insufficient funds in loan pool for disbursement: available %, required %',
            v_pool_balance, v_loan.principal;
    END IF;

    -- 4. Lock involved accounts in UUID order
    PERFORM id FROM payledger.accounts
    WHERE id IN (v_loan_pool_id, v_borrower_wallet)
    ORDER BY id
    FOR UPDATE;

    -- 5. Create ledger entries: loan_pool -> borrower
    v_txn_id := gen_random_uuid();

    INSERT INTO payledger.ledger_transactions (id, kind, idempotency_key, description, created_by)
    VALUES (v_txn_id, 'loan_disbursement', p_idempotency_key,
            format('Loan %s disbursement of %s', v_loan.id, v_loan.principal),
            v_loan.user_id);

    INSERT INTO payledger.ledger_entries (transaction_id, account_id, direction, amount)
    VALUES
        (v_txn_id, v_loan_pool_id,   'debit',  v_loan.principal),
        (v_txn_id, v_borrower_wallet, 'credit', v_loan.principal);

    -- 6. Update loan record
    UPDATE payledger.loans
    SET disbursed_at = now()
    WHERE id = v_loan.id;

    -- 7. Update application status to 'disbursed'
    UPDATE payledger.loan_applications
    SET status = 'disbursed'
    WHERE id = v_loan.application_id;

    -- 8. Generate EMI schedule
    PERFORM payledger.sp_generate_emi_schedule(v_loan.id);

    RETURN v_txn_id;
END;
$$;

COMMENT ON FUNCTION payledger.sp_disburse_loan IS
    'Disburses an approved loan: transfers funds and generates EMI schedule.';

-- ============================================================================
-- sp_pay_emi: Borrower pays an EMI installment
-- ============================================================================
CREATE OR REPLACE FUNCTION payledger.sp_pay_emi(
    p_loan_id           UUID,
    p_emi_id            UUID,
    p_amount            NUMERIC,
    p_idempotency_key   VARCHAR,
    p_user_id           UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = payledger, pg_temp
AS $$
DECLARE
    v_txn_id             UUID;
    v_existing_id        UUID;
    v_existing_kind      payledger.txn_kind;
    v_loan               RECORD;
    v_emi                RECORD;
    v_borrower_wallet    UUID;
    v_loan_pool_id       UUID;
    v_fee_account_id     UUID;
    v_remaining_emi      NUMERIC(18,2);
    v_new_paid           NUMERIC(18,2);
    v_new_status         payledger.emi_status;
    v_all_paid           BOOLEAN;
    v_prior_interest_paid NUMERIC(18,2);
    v_rem_interest       NUMERIC(18,2);
    v_interest_portion   NUMERIC(18,2);
    v_principal_portion  NUMERIC(18,2);
    v_wallet_bal         NUMERIC(18,2);
    v_repay_count        INT;
BEGIN
    -- 1. Validate inputs
    IF p_idempotency_key IS NULL OR BTRIM(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'Idempotency key must not be blank';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'EMI payment amount must be positive, got %', p_amount;
    END IF;

    IF p_amount <> ROUND(p_amount, 2) THEN
        RAISE EXCEPTION 'EMI payment amount % exceeds permitted precision of 2 decimal places', p_amount;
    END IF;

    -- 2. Idempotency validation
    SELECT id, kind INTO v_existing_id, v_existing_kind
    FROM payledger.ledger_transactions
    WHERE idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_existing_kind <> 'loan_repayment' THEN
            RAISE EXCEPTION 'Idempotency key % already used with different parameters', p_idempotency_key;
        END IF;

        SELECT COUNT(*) INTO v_repay_count
        FROM payledger.loan_repayments
        WHERE ledger_transaction_id = v_existing_id
          AND loan_id = p_loan_id
          AND emi_id = p_emi_id
          AND amount = p_amount;

        IF v_repay_count = 1 THEN
            RETURN v_existing_id;
        ELSE
            RAISE EXCEPTION 'Idempotency key % already used with different parameters', p_idempotency_key;
        END IF;
    END IF;

    -- 3. Validate loan belongs to user
    SELECT * INTO v_loan
    FROM payledger.loans
    WHERE id = p_loan_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Loan % not found', p_loan_id;
    END IF;

    IF v_loan.user_id <> p_user_id THEN
        RAISE EXCEPTION 'Loan % does not belong to user %', p_loan_id, p_user_id;
    END IF;

    IF v_loan.status <> 'active' THEN
        RAISE EXCEPTION 'Loan % is not active (status: %)', p_loan_id, v_loan.status;
    END IF;

    -- 4. Validate EMI belongs to loan and is payable
    SELECT * INTO v_emi
    FROM payledger.emi_schedule
    WHERE id = p_emi_id AND loan_id = p_loan_id
    FOR UPDATE;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'EMI % not found for loan %', p_emi_id, p_loan_id;
    END IF;

    IF v_emi.status NOT IN ('pending', 'overdue', 'partially_paid') THEN
        RAISE EXCEPTION 'EMI % is already % and cannot be paid', p_emi_id, v_emi.status;
    END IF;

    -- Cap repayment at the remaining EMI amount
    v_remaining_emi := v_emi.total_due - v_emi.paid_amount;
    IF p_amount > v_remaining_emi THEN
        RAISE EXCEPTION 'EMI payment amount % exceeds remaining due % for EMI %',
            p_amount, v_remaining_emi, p_emi_id;
    END IF;

    -- 5. Find accounts
    SELECT id INTO v_borrower_wallet
    FROM payledger.accounts
    WHERE user_id = p_user_id
      AND account_type = 'customer_wallet'
      AND status = 'active';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active wallet not found for user %', p_user_id;
    END IF;

    SELECT id INTO v_loan_pool_id
    FROM payledger.accounts
    WHERE account_type = 'loan_pool'
    LIMIT 1;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Loan pool account not found';
    END IF;

    SELECT id INTO v_fee_account_id
    FROM payledger.accounts
    WHERE account_type = 'system_fee'
    LIMIT 1;

    -- Check wallet balance
    SELECT balance INTO v_wallet_bal
    FROM payledger.account_balances
    WHERE account_id = v_borrower_wallet;

    IF v_wallet_bal < p_amount THEN
        RAISE EXCEPTION 'Insufficient funds: wallet has % but EMI payment requires %',
            v_wallet_bal, p_amount;
    END IF;

    -- Calculate interest and principal portions before creating ledger entries
    v_prior_interest_paid := LEAST(v_emi.paid_amount, v_emi.interest_component);
    v_rem_interest        := v_emi.interest_component - v_prior_interest_paid;
    v_interest_portion    := LEAST(p_amount, v_rem_interest);
    v_principal_portion   := p_amount - v_interest_portion;

    -- Lock accounts in deterministic UUID order to eliminate deadlocks
    PERFORM id FROM payledger.accounts
    WHERE id IN (v_borrower_wallet, v_loan_pool_id, COALESCE(v_fee_account_id, v_loan_pool_id))
    ORDER BY id
    FOR UPDATE;

    -- 6. Create ledger entries:
    -- Debit: Borrower personal wallet (p_amount)
    -- Credit 1: System loan_pool (v_principal_portion) -> Returns capital to bank lending reserves
    -- Credit 2: System system_fee (v_interest_portion) -> Bank earned interest profit
    v_txn_id := gen_random_uuid();

    INSERT INTO payledger.ledger_transactions (id, kind, idempotency_key, description, created_by)
    VALUES (v_txn_id, 'loan_repayment', p_idempotency_key,
            format('EMI #%s payment for loan %s (principal %s, interest %s)',
                   v_emi.installment_no, p_loan_id, v_principal_portion, v_interest_portion),
            p_user_id);

    INSERT INTO payledger.ledger_entries (transaction_id, account_id, direction, amount)
    VALUES (v_txn_id, v_borrower_wallet, 'debit', p_amount);

    IF v_principal_portion > 0 THEN
        INSERT INTO payledger.ledger_entries (transaction_id, account_id, direction, amount)
        VALUES (v_txn_id, v_loan_pool_id, 'credit', v_principal_portion);
    END IF;

    IF v_interest_portion > 0 AND v_fee_account_id IS NOT NULL THEN
        INSERT INTO payledger.ledger_entries (transaction_id, account_id, direction, amount)
        VALUES (v_txn_id, v_fee_account_id, 'credit', v_interest_portion);
    ELSIF v_interest_portion > 0 AND v_fee_account_id IS NULL THEN
        -- Fallback if fee account not configured
        INSERT INTO payledger.ledger_entries (transaction_id, account_id, direction, amount)
        VALUES (v_txn_id, v_loan_pool_id, 'credit', v_interest_portion);
    END IF;

    -- 7. Update EMI schedule
    v_new_paid := v_emi.paid_amount + p_amount;

    IF v_new_paid >= v_emi.total_due THEN
        v_new_status := 'paid';
    ELSE
        v_new_status := 'partially_paid';
    END IF;

    UPDATE payledger.emi_schedule
    SET paid_amount = v_new_paid,
        status      = v_new_status,
        paid_at     = CASE WHEN v_new_status = 'paid' THEN now() ELSE paid_at END
    WHERE id = p_emi_id;

    -- 8. Update outstanding principal on the loan
    UPDATE payledger.loans
    SET outstanding_principal = GREATEST(outstanding_principal - v_principal_portion, 0)
    WHERE id = p_loan_id;

    -- 9. Create repayment record
    INSERT INTO payledger.loan_repayments (loan_id, emi_id, ledger_transaction_id, amount)
    VALUES (p_loan_id, p_emi_id, v_txn_id, p_amount);

    -- 10. Check if all EMIs are paid -> close the loan
    SELECT NOT EXISTS (
        SELECT 1 FROM payledger.emi_schedule
        WHERE loan_id = p_loan_id AND status <> 'paid'
    ) INTO v_all_paid;

    IF v_all_paid THEN
        UPDATE payledger.loans
        SET status = 'closed',
            outstanding_principal = 0
        WHERE id = p_loan_id;
    END IF;

    RETURN v_txn_id;
END;
$$;

COMMENT ON FUNCTION payledger.sp_pay_emi IS
    'Records an EMI payment with interest-first allocation, updates schedule, outstanding balance, and closes loan if fully paid.';

-- ============================================================================
-- sp_prepay_loan: Borrower makes early principal prepayment or full loan payoff
-- ============================================================================
CREATE OR REPLACE FUNCTION payledger.sp_prepay_loan(
    p_loan_id           UUID,
    p_amount            NUMERIC,
    p_idempotency_key   VARCHAR,
    p_user_id           UUID
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = payledger, pg_temp
AS $$
DECLARE
    v_txn_id            UUID;
    v_existing_id       UUID;
    v_existing_kind     payledger.txn_kind;
    v_loan              RECORD;
    v_product           RECORD;
    v_borrower_wallet   UUID;
    v_loan_pool_id      UUID;
    v_wallet_bal        NUMERIC(18,2);
    v_new_outstanding   NUMERIC(18,2);
BEGIN
    IF p_idempotency_key IS NULL OR BTRIM(p_idempotency_key) = '' THEN
        RAISE EXCEPTION 'Idempotency key must not be blank';
    END IF;

    IF p_amount IS NULL OR p_amount <= 0 THEN
        RAISE EXCEPTION 'Prepayment amount must be positive, got %', p_amount;
    END IF;

    IF p_amount <> ROUND(p_amount, 2) THEN
        RAISE EXCEPTION 'Prepayment amount % exceeds permitted precision of 2 decimal places', p_amount;
    END IF;

    -- Idempotency check
    SELECT id, kind INTO v_existing_id, v_existing_kind
    FROM payledger.ledger_transactions
    WHERE idempotency_key = p_idempotency_key;

    IF FOUND THEN
        IF v_existing_kind <> 'loan_repayment' THEN
            RAISE EXCEPTION 'Idempotency key % already used with different parameters', p_idempotency_key;
        END IF;
        RETURN v_existing_id;
    END IF;

    -- Lock and validate loan
    SELECT l.*, la.product_id
    INTO v_loan
    FROM payledger.loans l
    JOIN payledger.loan_applications la ON la.id = l.application_id
    WHERE l.id = p_loan_id
    FOR UPDATE OF l;

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Loan % not found', p_loan_id;
    END IF;

    IF v_loan.user_id <> p_user_id THEN
        RAISE EXCEPTION 'Loan % does not belong to user %', p_loan_id, p_user_id;
    END IF;

    IF v_loan.status <> 'active' THEN
        RAISE EXCEPTION 'Loan % is not active (status: %)', p_loan_id, v_loan.status;
    END IF;

    -- Validate prepayment allowed on product
    SELECT * INTO v_product
    FROM payledger.loan_products
    WHERE id = v_loan.product_id;

    IF NOT v_product.prepayment_allowed THEN
        RAISE EXCEPTION 'Prepayment is not allowed for loan product %', v_product.name;
    END IF;

    IF p_amount > v_loan.outstanding_principal THEN
        RAISE EXCEPTION 'Prepayment amount % exceeds outstanding principal %',
            p_amount, v_loan.outstanding_principal;
    END IF;

    -- Find borrower wallet and loan pool
    SELECT id INTO v_borrower_wallet
    FROM payledger.accounts
    WHERE user_id = p_user_id
      AND account_type = 'customer_wallet'
      AND status = 'active';

    IF NOT FOUND THEN
        RAISE EXCEPTION 'Active customer wallet not found for user %', p_user_id;
    END IF;

    SELECT id INTO v_loan_pool_id
    FROM payledger.accounts
    WHERE account_type = 'loan_pool'
    LIMIT 1;

    -- Check wallet balance
    SELECT balance INTO v_wallet_bal
    FROM payledger.account_balances
    WHERE account_id = v_borrower_wallet;

    IF v_wallet_bal < p_amount THEN
        RAISE EXCEPTION 'Insufficient funds: wallet has % but prepayment requires %',
            v_wallet_bal, p_amount;
    END IF;

    -- Lock accounts
    PERFORM id FROM payledger.accounts
    WHERE id IN (v_borrower_wallet, v_loan_pool_id)
    ORDER BY id
    FOR UPDATE;

    -- Create ledger entries
    v_txn_id := gen_random_uuid();

    INSERT INTO payledger.ledger_transactions (id, kind, idempotency_key, description, created_by)
    VALUES (v_txn_id, 'loan_repayment', p_idempotency_key,
            format('Prepayment of %s for loan %s', p_amount, p_loan_id),
            p_user_id);

    INSERT INTO payledger.ledger_entries (transaction_id, account_id, direction, amount)
    VALUES
        (v_txn_id, v_borrower_wallet, 'debit',  p_amount),
        (v_txn_id, v_loan_pool_id,    'credit', p_amount);

    v_new_outstanding := v_loan.outstanding_principal - p_amount;

    UPDATE payledger.loans
    SET outstanding_principal = v_new_outstanding,
        status = CASE WHEN v_new_outstanding = 0 THEN 'closed'::payledger.loan_status ELSE status END
    WHERE id = p_loan_id;

    -- If full payoff, mark remaining pending EMIs as paid
    IF v_new_outstanding = 0 THEN
        UPDATE payledger.emi_schedule
        SET status = 'paid',
            paid_at = now()
        WHERE loan_id = p_loan_id AND status <> 'paid';
    END IF;

    RETURN v_txn_id;
END;
$$;

COMMENT ON FUNCTION payledger.sp_prepay_loan IS
    'Applies early principal prepayment or full loan payoff, updating outstanding balance and loan status.';

-- ============================================================================
-- sp_accrue_interest_and_penalties: Batch job for overdue EMIs
-- ============================================================================
CREATE OR REPLACE FUNCTION payledger.sp_accrue_interest_and_penalties(
    p_as_of DATE DEFAULT CURRENT_DATE
)
RETURNS TABLE(penalties_assessed INT, emis_marked_overdue INT)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = payledger, pg_temp
AS $$
DECLARE
    v_penalties_count   INT := 0;
    v_overdue_count     INT := 0;
    v_emi               RECORD;
    v_penalty_amount    NUMERIC(18,2);
    v_unpaid            NUMERIC(18,2);
    v_days_overdue      INT;
    v_txn_id            UUID;
    v_borrower_wallet   UUID;
    v_fee_account_id    UUID;
    v_idem_key          VARCHAR;
    v_currency          CHAR(3);
BEGIN
    -- 1. Mark overdue EMIs
    UPDATE payledger.emi_schedule
    SET status = 'overdue'
    WHERE due_date < p_as_of
      AND status IN ('pending', 'partially_paid');

    GET DIAGNOSTICS v_overdue_count = ROW_COUNT;

    -- 2. Assess penalties on overdue EMIs
    FOR v_emi IN
        SELECT es.*, l.user_id, lp.penalty_rate
        FROM payledger.emi_schedule es
        JOIN payledger.loans l ON l.id = es.loan_id
        JOIN payledger.loan_applications la ON la.id = l.application_id
        JOIN payledger.loan_products lp ON lp.id = la.product_id
        WHERE es.status = 'overdue'
          AND es.due_date < p_as_of
          AND l.status = 'active'
        FOR UPDATE OF es
    LOOP
        -- Check if already penalised for this date
        IF EXISTS (
            SELECT 1 FROM payledger.penalties
            WHERE loan_id = v_emi.loan_id
              AND emi_id = v_emi.id
              AND assessed_on = p_as_of
        ) THEN
            CONTINUE;
        END IF;

        -- Calculate penalty: unpaid * penalty_rate / 365 * days_overdue
        v_unpaid := v_emi.total_due - v_emi.paid_amount;
        v_days_overdue := p_as_of - v_emi.due_date;

        IF v_days_overdue <= 0 OR v_unpaid <= 0 THEN
            CONTINUE;
        END IF;

        v_penalty_amount := ROUND(v_unpaid * v_emi.penalty_rate / 365.0 * v_days_overdue, 2);

        IF v_penalty_amount <= 0 THEN
            CONTINUE;
        END IF;

        -- Find borrower wallet and determine currency
        SELECT id, currency INTO v_borrower_wallet, v_currency
        FROM payledger.accounts
        WHERE user_id = v_emi.user_id
          AND account_type = 'customer_wallet'
          AND status = 'active';

        IF NOT FOUND THEN
            CONTINUE; -- skip if no active wallet
        END IF;

        -- Look up currency-specific system fee account
        SELECT id INTO v_fee_account_id
        FROM payledger.accounts
        WHERE account_type = 'system_fee' AND currency = v_currency
        LIMIT 1;

        IF v_fee_account_id IS NULL THEN
            RAISE NOTICE 'System fee account for currency % not found; skipping penalty for EMI %', v_currency, v_emi.id;
            CONTINUE;
        END IF;

        -- Create ledger entry for penalty
        v_idem_key := format('penalty-%s-%s-%s', v_emi.loan_id, v_emi.id, p_as_of);
        v_txn_id := gen_random_uuid();

        BEGIN
            INSERT INTO payledger.ledger_transactions (id, kind, idempotency_key, description)
            VALUES (v_txn_id, 'penalty', v_idem_key,
                    format('Penalty for EMI #%s loan %s: %s days overdue',
                           v_emi.installment_no, v_emi.loan_id, v_days_overdue));

            INSERT INTO payledger.ledger_entries (transaction_id, account_id, direction, amount)
            VALUES
                (v_txn_id, v_borrower_wallet, 'debit',  v_penalty_amount),
                (v_txn_id, v_fee_account_id,  'credit', v_penalty_amount);

            -- Record the penalty
            INSERT INTO payledger.penalties (loan_id, emi_id, amount, assessed_on, ledger_transaction_id)
            VALUES (v_emi.loan_id, v_emi.id, v_penalty_amount, p_as_of, v_txn_id)
            ON CONFLICT (loan_id, emi_id, assessed_on) DO NOTHING;

            v_penalties_count := v_penalties_count + 1;
        EXCEPTION
            WHEN unique_violation THEN
                NULL;
        END;
    END LOOP;

    penalties_assessed  := v_penalties_count;
    emis_marked_overdue := v_overdue_count;
    RETURN NEXT;
END;
$$;

COMMENT ON FUNCTION payledger.sp_accrue_interest_and_penalties IS
    'Batch job: marks overdue EMIs and assesses daily penalties via ledger entries.';

-- ============================================================================
-- Execute Grants for Lending Stored Procedures
-- ============================================================================
GRANT EXECUTE ON FUNCTION payledger.sp_apply_for_loan(UUID, UUID, NUMERIC, INT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION payledger.sp_pay_emi(UUID, UUID, NUMERIC, VARCHAR, UUID) TO PUBLIC;
GRANT EXECUTE ON FUNCTION payledger.sp_prepay_loan(UUID, NUMERIC, VARCHAR, UUID) TO PUBLIC;
GRANT EXECUTE ON FUNCTION payledger.sp_decide_loan(UUID, UUID, VARCHAR, TEXT) TO PUBLIC;
GRANT EXECUTE ON FUNCTION payledger.sp_disburse_loan(UUID, VARCHAR) TO PUBLIC;
GRANT EXECUTE ON FUNCTION payledger.sp_generate_emi_schedule(UUID) TO PUBLIC;
GRANT EXECUTE ON FUNCTION payledger.sp_accrue_interest_and_penalties(DATE) TO PUBLIC;
