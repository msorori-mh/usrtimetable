-- Rollback for H-1 definer EXECUTE lockdown. Restores the pre-fix (insecure) grants:
-- the functions that anon could execute before 20261020000200, default privileges,
-- and authenticated EXECUTE on the service-only helpers.
DO $$
DECLARE s text;
BEGIN
  FOREACH s IN ARRAY ARRAY[
    'public.ensure_ta_college()',
        'public.delivery_groups_share_students(uuid,uuid)',
        'public.ensure_csp_cohort_college()',
        'public.ensure_dgpm_consistency()',
        'public.academic_affairs_update_instructor(uuid,text,text,text,text,text,text,text,text,integer,integer,boolean,uuid,uuid,uuid,text,uuid,uuid)',
        'public.instructor_availability_enforced(uuid)',
        'public.rebuild_cohort_student_partitions(uuid)',
        'public.enforce_instructor_hr_affiliation()',
        'public.seed_college_instructor_types(uuid)',
        'public.seed_new_college_instructor_types()',
        'public.assign_university_instructor_no()',
        'public._import_apply_academic_structure(uuid,text,text,jsonb)',
        'public.propagate_theory_explicit_capacity()',
        'public.sync_large_theory_capacity_from_rooms()',
        'public.enforce_instructor_daily_session_cap()',
        'public.existing_schedule_intake_enabled(uuid,uuid)',
        'public.existing_schedule_intake_version(uuid)',
        'public.import_existing_schedule_intake(uuid,integer)',
        'public.enforce_instructor_extra_hours_limit()',
        'public.link_intake_shared_group(uuid,uuid,uuid)',
        'public.validate_version_assignment_allocation(uuid,uuid,numeric)',
        'public.version_effective_assignments(uuid)',
        'public.record_audit_log(text,text,uuid,uuid,jsonb)',
        'public.consume_security_limit(uuid,text)',
        'public.enforce_membership_change_rate_limit()',
        'public.version_scoped_publish_gate(uuid)',
        'public.schedule_version_session_snapshot(uuid)',
        'public.guard_session_version_scoped_assignment()',
        'public.guard_version_scoped_publish()',
        'public.create_version_scoped_replacement_assignment(uuid,uuid,uuid,numeric)',
        'public.submit_version_scoped_teaching_request(uuid,uuid,uuid,numeric,text)',
        'public.apply_version_scoped_replacements(uuid,jsonb,integer,text)',
        'public.preview_version_session_moves(uuid,jsonb)',
        'public.seal_version_publish_expectation(uuid,integer,text)',
        'public.apply_version_session_moves(uuid,jsonb,integer,text,text)',
        'public.itcs_cutover_execute(text,uuid,uuid,jsonb,text,text)',
        'public.itcs_cutover_path_rules(uuid)',
        'public.itcs_cutover_published_snapshot(uuid)',
        'public.itcs_cutover_session_units(uuid)',
        'public.itcs_cutover_preview(uuid,jsonb)'
  ] LOOP
    IF to_regprocedure(s) IS NOT NULL THEN EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO PUBLIC, anon, authenticated', s); END IF;
  END LOOP;
END $$;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO PUBLIC, anon;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;
