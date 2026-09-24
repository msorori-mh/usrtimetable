-- Restore data decisions using faculty_home_reconciled audit before-members first.
-- This schema rollback deliberately refuses while explicit pending decisions remain.
DO $rollback$ BEGIN IF EXISTS(SELECT 1 FROM public.faculty_home_decisions WHERE home_college_id IS NULL) THEN RAISE EXCEPTION 'RESTORE_PENDING_DECISIONS_BEFORE_ROLLBACK'; END IF; END $rollback$;
ALTER TABLE public.faculty_home_decisions DROP CONSTRAINT faculty_pending_quota_unconfirmed;
ALTER TABLE public.faculty_home_decisions ALTER COLUMN home_college_id SET NOT NULL;
CREATE OR REPLACE VIEW faculty_private.home_profiles AS
 WITH members AS (
         SELECT l.identity_id,
            i.id,
            i.college_id,
            i.department_id,
            i.full_name,
            i.academic_rank,
            i.email,
            i.phone,
            i.employment_type,
            i.max_weekly_hours,
            i.is_active,
            i.created_at,
            i.updated_at,
            i.instructor_type_id,
            i.external_source,
            i.academic_degree,
            i.admin_tasks,
            i.max_hours_per_day,
            i.employee_number,
            i.full_name_ar,
            i.full_name_en,
            i.specialization,
            i.administrative_release_hours,
            i.notes,
            i.affiliation_college_id,
            i.affiliation_department_id,
            i.administrative_position,
            i.administrative_department_id,
            i.administrative_support_department_id,
            i.target_attendance_days_per_week,
            i.max_attendance_days_per_week,
            t.code AS type_code
           FROM faculty_identity_links l
             JOIN instructors i ON i.id = l.instructor_id
             LEFT JOIN instructor_types t ON t.id = i.instructor_type_id
        ), homes AS (
         SELECT members.identity_id,
                CASE
                    WHEN count(DISTINCT members.affiliation_college_id) = 1 AND bool_and(members.affiliation_college_id IS NOT NULL) AND NOT bool_or(COALESCE(members.type_code, ''::text) = 'from_other_college'::text AND members.affiliation_college_id = members.college_id) THEN min(members.affiliation_college_id::text)::uuid
                    ELSE NULL::uuid
                END AS home_id
           FROM members
          GROUP BY members.identity_id
        ), resolved AS (
         SELECT h.identity_id,
            COALESCE(d.home_college_id, h.home_id) AS home_college_id,
            d.source_instructor_id AS approved_source,
            d.quota_confirmed,
            d.updated_at AS decision_at
           FROM homes h
             LEFT JOIN faculty_home_decisions d USING (identity_id)
        )
 SELECT r.identity_id,
    f.university_id,
    f.university_number,
    r.home_college_id,
    c.name AS home_college_name,
    s.id AS source_instructor_id,
    COALESCE(s.full_name_ar, s.full_name) AS full_name,
    s.academic_rank,
    s.employment_type,
    s.is_active,
    s.type_code,
    s.specialization,
    s.max_weekly_hours AS recorded_quota,
    s.administrative_release_hours AS recorded_release,
        CASE
            WHEN r.home_college_id IS NOT NULL AND (r.approved_source IS NOT NULL AND r.quota_confirmed OR r.approved_source IS NULL AND s.college_id = r.home_college_id AND NOT (EXISTS ( SELECT 1
               FROM members m
              WHERE m.identity_id = r.identity_id AND m.college_id = r.home_college_id AND (m.max_weekly_hours IS DISTINCT FROM s.max_weekly_hours OR m.administrative_release_hours IS DISTINCT FROM s.administrative_release_hours)))) AND s.max_weekly_hours IS NOT NULL THEN effective_instructor_weekly_quota(s.max_weekly_hours, s.administrative_release_hours)
            ELSE NULL::integer
        END AS quota,
        CASE
            WHEN r.home_college_id IS NULL THEN 'pending'::text
            WHEN r.approved_source IS NOT NULL THEN 'verified'::text
            ELSE 'declared'::text
        END AS affiliation_status,
    r.decision_at
   FROM resolved r
     JOIN faculty_identities f ON f.id = r.identity_id
     LEFT JOIN colleges c ON c.id = r.home_college_id
     LEFT JOIN LATERAL ( SELECT m.identity_id,
            m.id,
            m.college_id,
            m.department_id,
            m.full_name,
            m.academic_rank,
            m.email,
            m.phone,
            m.employment_type,
            m.max_weekly_hours,
            m.is_active,
            m.created_at,
            m.updated_at,
            m.instructor_type_id,
            m.external_source,
            m.academic_degree,
            m.admin_tasks,
            m.max_hours_per_day,
            m.employee_number,
            m.full_name_ar,
            m.full_name_en,
            m.specialization,
            m.administrative_release_hours,
            m.notes,
            m.affiliation_college_id,
            m.affiliation_department_id,
            m.administrative_position,
            m.administrative_department_id,
            m.administrative_support_department_id,
            m.target_attendance_days_per_week,
            m.max_attendance_days_per_week,
            m.type_code
           FROM members m
          WHERE m.identity_id = r.identity_id
          ORDER BY (m.id = r.approved_source) DESC NULLS LAST, (m.college_id = r.home_college_id) DESC NULLS LAST, m.is_active DESC, m.created_at, m.id
         LIMIT 1) s ON true;
CREATE OR REPLACE FUNCTION public.guard_intake_unknown_catalog_values()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public', 'pg_temp'
AS $function$
BEGIN
 IF (TG_TABLE_NAME='courses' AND to_jsonb(NEW)->>'credit_hours' IS NULL)
 OR (TG_TABLE_NAME='instructors' AND to_jsonb(NEW)->>'max_weekly_hours' IS NULL) THEN
 IF NOT EXISTS(SELECT 1 FROM public.academic_terms t WHERE t.college_id=NEW.college_id AND t.academic_year='2026-2027' AND t.term_type='first' AND public.existing_schedule_intake_enabled(NEW.college_id,t.id))
 OR NEW.college_id='7168345f-cf9d-4789-b2ad-547abb687dc8'::uuid THEN
 RAISE EXCEPTION 'UNKNOWN_CATALOG_VALUES_REQUIRE_EXISTING_SCHEDULE_INTAKE';
 END IF;
 END IF;
 RETURN NEW;
END $function$;
CREATE OR REPLACE FUNCTION public.reconcile_faculty_home(p_identity_id uuid, p_home_college_id uuid, p_source_instructor_id uuid, p_quota_confirmed boolean, p_evidence text, p_expected_decision_at timestamp with time zone DEFAULT NULL::timestamp with time zone)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_old public.faculty_home_decisions%ROWTYPE;v_members jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(180600,1);
 PERFORM 1 FROM faculty_identities WHERE id=p_identity_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FACULTY_IDENTITY_NOT_FOUND'; END IF;
 SELECT * INTO v_old FROM faculty_home_decisions WHERE identity_id=p_identity_id;
 IF v_old.updated_at IS DISTINCT FROM p_expected_decision_at THEN RAISE EXCEPTION 'STALE_FACULTY_DECISION'; END IF;
 IF length(btrim(coalesce(p_evidence,'')))<10 THEN RAISE EXCEPTION 'FACULTY_EVIDENCE_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM faculty_identities f JOIN colleges c ON c.university_id=f.university_id
   WHERE f.id=p_identity_id AND c.id=p_home_college_id) OR NOT EXISTS(
   SELECT 1 FROM faculty_identity_links WHERE identity_id=p_identity_id AND instructor_id=p_source_instructor_id)
 THEN RAISE EXCEPTION 'FACULTY_HOME_OR_SOURCE_INVALID'; END IF;
 IF p_quota_confirmed AND NOT EXISTS(SELECT 1 FROM instructors WHERE id=p_source_instructor_id AND max_weekly_hours IS NOT NULL)
 THEN RAISE EXCEPTION 'FACULTY_QUOTA_REQUIRED'; END IF;
 SELECT jsonb_agg(jsonb_build_object('id',i.id,'affiliation_college_id',i.affiliation_college_id,
   'affiliation_department_id',i.affiliation_department_id)) INTO v_members
 FROM instructors i JOIN faculty_identity_links l ON l.instructor_id=i.id WHERE l.identity_id=p_identity_id;
 UPDATE instructors i SET affiliation_college_id=p_home_college_id,
 affiliation_department_id=CASE WHEN EXISTS(SELECT 1 FROM departments d WHERE d.id=i.affiliation_department_id AND d.college_id=p_home_college_id)
   THEN i.affiliation_department_id END
 WHERE EXISTS(SELECT 1 FROM faculty_identity_links l WHERE l.instructor_id=i.id AND l.identity_id=p_identity_id);
 INSERT INTO faculty_home_decisions(identity_id,home_college_id,source_instructor_id,quota_confirmed,evidence,decided_by)
 VALUES(p_identity_id,p_home_college_id,p_source_instructor_id,coalesce(p_quota_confirmed,false),btrim(p_evidence),auth.uid())
 ON CONFLICT(identity_id) DO UPDATE SET home_college_id=excluded.home_college_id,
 source_instructor_id=excluded.source_instructor_id,quota_confirmed=excluded.quota_confirmed,
 evidence=excluded.evidence,decided_by=excluded.decided_by,updated_at=clock_timestamp();
 INSERT INTO audit_logs(actor_id,action,entity,entity_id,college_id,details)
 VALUES(auth.uid(),'faculty_home_reconciled','faculty_identities',p_identity_id,p_home_college_id,
 jsonb_build_object('before',to_jsonb(v_old),'before_members',v_members,'source_instructor_id',p_source_instructor_id,
 'quota_confirmed',p_quota_confirmed,'evidence',btrim(p_evidence)));
END $function$;