DO $t$
DECLARE
  v_admin uuid := '716f0f62-26ad-4db5-b2cf-7a2e6c4daefa';
  v_email text := 'provisioning-selftest@example.invalid';
  v_id uuid; v_nonce text; v_exp timestamptz; v_role text; v_ok boolean;
BEGIN
  DELETE FROM provisioning_private.account_provisioning_grants WHERE email_normalized = v_email;

  -- 1. happy path: issue then consume once
  SELECT grant_id, nonce, expires_at INTO v_id, v_nonce, v_exp
    FROM public.issue_account_provisioning_grant(upper(v_email), 'college_admin', v_admin);
  IF v_id IS NULL OR v_exp > now() + interval '61 seconds' THEN
    RAISE EXCEPTION 'SELFTEST_ISSUE_FAILED';
  END IF;

  -- 2. wrong nonce is rejected
  IF provisioning_private.consume_grant(v_email, gen_random_uuid(), 'deadbeef') IS NOT NULL THEN
    RAISE EXCEPTION 'SELFTEST_WRONG_NONCE_ACCEPTED';
  END IF;

  -- 3. correct nonce consumes and returns the bound role
  v_role := provisioning_private.consume_grant(v_email, gen_random_uuid(), v_nonce);
  IF v_role <> 'college_admin' THEN RAISE EXCEPTION 'SELFTEST_CONSUME_FAILED'; END IF;

  -- 4. replay is rejected
  IF provisioning_private.consume_grant(v_email, gen_random_uuid(), v_nonce) IS NOT NULL THEN
    RAISE EXCEPTION 'SELFTEST_REPLAY_ACCEPTED';
  END IF;

  -- 5. expired grant is rejected and never consumed
  SELECT grant_id INTO v_id
    FROM public.issue_account_provisioning_grant(v_email, 'read_only', v_admin);
  UPDATE provisioning_private.account_provisioning_grants
     SET created_at = now() - interval '120 seconds', expires_at = now() - interval '60 seconds'
   WHERE id = v_id;
  IF provisioning_private.consume_grant(v_email, gen_random_uuid(), NULL) IS NOT NULL THEN
    RAISE EXCEPTION 'SELFTEST_EXPIRED_ACCEPTED';
  END IF;

  -- 6. no duplicate outstanding grant for the same address (parallel double-issue)
  SELECT grant_id INTO v_id
    FROM public.issue_account_provisioning_grant(v_email, 'read_only', v_admin);
  BEGIN
    PERFORM public.issue_account_provisioning_grant(v_email, 'read_only', v_admin);
    RAISE EXCEPTION 'SELFTEST_DOUBLE_ISSUE_ACCEPTED';
  EXCEPTION WHEN unique_violation THEN NULL;
  END;

  -- 7. explicit revoke (createUser failure cleanup)
  v_ok := public.revoke_account_provisioning_grant(v_id);
  IF NOT v_ok THEN RAISE EXCEPTION 'SELFTEST_REVOKE_FAILED'; END IF;

  -- 8. non super-admin caller is rejected
  BEGIN
    PERFORM public.issue_account_provisioning_grant(v_email, 'read_only', gen_random_uuid());
    RAISE EXCEPTION 'SELFTEST_NON_ADMIN_ACCEPTED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  -- 9. role outside the allowed list is rejected
  BEGIN
    PERFORM public.issue_account_provisioning_grant(v_email, 'college_dean', v_admin);
    RAISE EXCEPTION 'SELFTEST_BAD_ROLE_ACCEPTED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;

  DELETE FROM provisioning_private.account_provisioning_grants WHERE email_normalized = v_email;
  RAISE NOTICE 'PROVISIONING_GRANT_SELFTEST_PASS';
END
$t$;