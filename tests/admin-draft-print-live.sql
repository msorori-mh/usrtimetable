-- Live, read-only role and direct-URL authorization checks. No accounts or grants are changed.
BEGIN TRANSACTION READ ONLY;
DO $test$
DECLARE account record; allowed boolean;
  draft uuid:='0f11c15c-f7ce-4dd3-8974-e856f039d3e7';
  published uuid:='af6b6b8e-7860-4da0-916b-3b891e0655f6';
  college uuid:='7168345f-cf9d-4789-b2ad-547abb687dc8';
  authorized_rows integer;
BEGIN
  PERFORM set_config('request.jwt.claim.sub','',true);
  BEGIN
    PERFORM public.get_timetable_print_version(draft);
    RAISE EXCEPTION 'ANONYMOUS_DRAFT_PRINT_ALLOWED';
  EXCEPTION WHEN insufficient_privilege THEN NULL;
  END;
  FOR account IN SELECT DISTINCT user_id FROM public.user_roles LOOP
    PERFORM set_config('request.jwt.claim.sub',account.user_id::text,true);
    allowed:=public.can_view_college(account.user_id,college)
      AND public.is_super_admin(account.user_id);
    BEGIN
      SELECT count(*) INTO authorized_rows FROM public.get_timetable_print_version(draft);
      IF NOT allowed OR authorized_rows<>1 THEN RAISE EXCEPTION 'NON_ADMIN_DRAFT_PRINT_ALLOWED'; END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      IF allowed THEN RAISE EXCEPTION 'ADMIN_DRAFT_PRINT_DENIED'; END IF;
    END;
    -- Existing published print access must retain its original college scope.
    allowed:=public.can_view_college(account.user_id,college);
    BEGIN
      SELECT count(*) INTO authorized_rows FROM public.get_timetable_print_version(published);
      IF NOT allowed OR authorized_rows<>1 THEN RAISE EXCEPTION 'PUBLISHED_PRINT_SCOPE_WIDENED'; END IF;
    EXCEPTION WHEN insufficient_privilege THEN
      IF allowed THEN RAISE EXCEPTION 'AUTHORIZED_PUBLISHED_PRINT_DENIED'; END IF;
    END;
  END LOOP;
END $test$;
ROLLBACK;
