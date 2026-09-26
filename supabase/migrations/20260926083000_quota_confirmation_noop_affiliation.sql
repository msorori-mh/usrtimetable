-- Quota confirmation must not re-run schedule conflict guards when the home
-- affiliation is already correct. Real home-college corrections retain the
-- existing fail-closed update, department cleanup, audit and stale-write guard.

CREATE OR REPLACE FUNCTION public.reconcile_faculty_home(
  p_identity_id uuid,
  p_home_college_id uuid,
  p_source_instructor_id uuid,
  p_quota_confirmed boolean,
  p_evidence text,
  p_expected_decision_at timestamp with time zone DEFAULT NULL::timestamp with time zone
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE
  v_old public.faculty_home_decisions%ROWTYPE;
  v_members jsonb;
BEGIN
  IF auth.uid() IS NULL OR NOT is_super_admin(auth.uid()) THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501';
  END IF;

  PERFORM pg_advisory_xact_lock(180600,1);
  PERFORM 1 FROM faculty_identities WHERE id=p_identity_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'FACULTY_IDENTITY_NOT_FOUND'; END IF;

  SELECT * INTO v_old
  FROM faculty_home_decisions
  WHERE identity_id=p_identity_id;

  IF v_old.updated_at IS DISTINCT FROM p_expected_decision_at THEN
    RAISE EXCEPTION 'STALE_FACULTY_DECISION';
  END IF;
  IF length(btrim(coalesce(p_evidence,'')))<10 THEN
    RAISE EXCEPTION 'FACULTY_EVIDENCE_REQUIRED';
  END IF;
  IF (
    p_home_college_id IS NOT NULL
    AND NOT EXISTS(
      SELECT 1
      FROM faculty_identities f
      JOIN colleges c ON c.university_id=f.university_id
      WHERE f.id=p_identity_id AND c.id=p_home_college_id
    )
  ) OR NOT EXISTS(
    SELECT 1
    FROM faculty_identity_links
    WHERE identity_id=p_identity_id AND instructor_id=p_source_instructor_id
  ) THEN
    RAISE EXCEPTION 'FACULTY_HOME_OR_SOURCE_INVALID';
  END IF;
  IF p_quota_confirmed AND p_home_college_id IS NULL THEN
    RAISE EXCEPTION 'FACULTY_HOME_REQUIRED_FOR_QUOTA';
  END IF;
  IF p_quota_confirmed AND NOT EXISTS(
    SELECT 1
    FROM instructors
    WHERE id=p_source_instructor_id AND max_weekly_hours IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'FACULTY_QUOTA_REQUIRED';
  END IF;

  SELECT jsonb_agg(jsonb_build_object(
    'id',i.id,
    'affiliation_college_id',i.affiliation_college_id,
    'affiliation_department_id',i.affiliation_department_id
  ))
  INTO v_members
  FROM instructors i
  JOIN faculty_identity_links l ON l.instructor_id=i.id
  WHERE l.identity_id=p_identity_id;

  IF p_home_college_id IS NOT NULL THEN
    UPDATE instructors i
    SET affiliation_college_id=p_home_college_id,
        affiliation_department_id=CASE
          WHEN EXISTS(
            SELECT 1
            FROM departments d
            WHERE d.id=i.affiliation_department_id
              AND d.college_id=p_home_college_id
          ) THEN i.affiliation_department_id
        END
    WHERE EXISTS(
      SELECT 1
      FROM faculty_identity_links l
      WHERE l.instructor_id=i.id
        AND l.identity_id=p_identity_id
    )
      AND (
        i.affiliation_college_id IS DISTINCT FROM p_home_college_id
        OR (
          i.affiliation_department_id IS NOT NULL
          AND NOT EXISTS(
            SELECT 1
            FROM departments d
            WHERE d.id=i.affiliation_department_id
              AND d.college_id=p_home_college_id
          )
        )
      );
  END IF;

  INSERT INTO faculty_home_decisions(
    identity_id,home_college_id,source_instructor_id,
    quota_confirmed,evidence,decided_by
  )
  VALUES(
    p_identity_id,p_home_college_id,p_source_instructor_id,
    coalesce(p_quota_confirmed,false),btrim(p_evidence),auth.uid()
  )
  ON CONFLICT(identity_id) DO UPDATE
  SET home_college_id=excluded.home_college_id,
      source_instructor_id=excluded.source_instructor_id,
      quota_confirmed=excluded.quota_confirmed,
      evidence=excluded.evidence,
      decided_by=excluded.decided_by,
      updated_at=clock_timestamp();

  INSERT INTO audit_logs(actor_id,action,entity,entity_id,college_id,details)
  VALUES(
    auth.uid(),'faculty_home_reconciled','faculty_identities',
    p_identity_id,p_home_college_id,
    jsonb_build_object(
      'before',to_jsonb(v_old),
      'before_members',v_members,
      'source_instructor_id',p_source_instructor_id,
      'quota_confirmed',p_quota_confirmed,
      'evidence',btrim(p_evidence)
    )
  );
END
$function$;

REVOKE ALL ON FUNCTION public.reconcile_faculty_home(
  uuid,uuid,uuid,boolean,text,timestamp with time zone
) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reconcile_faculty_home(
  uuid,uuid,uuid,boolean,text,timestamp with time zone
) TO authenticated;
