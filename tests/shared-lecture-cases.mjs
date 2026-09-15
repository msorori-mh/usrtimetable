const id = (name) => `md5('${name}')::uuid`;
const group = (cohort, component = "theory") =>
  `(SELECT id FROM public.delivery_groups WHERE cohort_id=${id(cohort)} AND component_id=${id(component)} AND group_number=1)`;
export const anchor = group("regular");
export const member = group("parallel");
const merge = `SELECT public.merge_shared_lecture(${anchor},${member});`;
export const cases = [
  [
    "cohort guard handles both trigger row shapes and blocks source count drift",
    `
    UPDATE academic_cohorts SET code=code WHERE id=${id("regular")};
    ${merge}
    UPDATE academic_cohorts SET code=code WHERE id=${id("regular")};
    DO $$ BEGIN
      BEGIN UPDATE academic_cohorts SET expected_students=51 WHERE id=${id("regular")}; RAISE EXCEPTION 'cohort count drift accepted'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'SHARED_LECTURE_REVIEW_REQUIRED' THEN RAISE; END IF; END;
      BEGIN UPDATE scheduling_cohort_term_headcounts SET scheduling_headcount=51 WHERE cohort_id=${id("regular")}; RAISE EXCEPTION 'approved count drift accepted'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'SHARED_LECTURE_REVIEW_REQUIRED' THEN RAISE; END IF; END;
    END $$;`,
  ],

  [
    "server overlap checks both directions across source cohort ids",
    `${merge}
    INSERT INTO schedule_sessions(id,college_id,schedule_version_id,course_offering_id,instructor_id,cohort_id,delivery_group_id,day_of_week,start_time,end_time,study_system)
      VALUES(md5('peer')::uuid,${id("college")},${id("version")},(SELECT id FROM course_offerings WHERE study_system='parallel' LIMIT 1),${id("labteacher")},${id("parallel")},${group("parallel", "practical")},0,'08:00','10:00','parallel');
    DO $$ BEGIN
      IF jsonb_array_length(_sb_v2_delivery_group_overlap(${id("version")},${anchor},${id("regular")},0,'08:00','10:00',NULL))<>1 THEN RAISE EXCEPTION 'forward conflict missed'; END IF;
    END $$;
    DELETE FROM schedule_sessions WHERE id=md5('peer')::uuid;
    INSERT INTO schedule_sessions(id,college_id,schedule_version_id,course_offering_id,instructor_id,cohort_id,delivery_group_id,day_of_week,start_time,end_time,study_system)
      VALUES(md5('peer')::uuid,${id("college")},${id("version")},(SELECT id FROM course_offerings WHERE study_system='regular' LIMIT 1),${id("teacher")},${id("regular")},${anchor},0,'08:00','10:00','both');
    DO $$ BEGIN
      IF jsonb_array_length(_sb_v2_delivery_group_overlap(${id("version")},${group("parallel", "practical")},${id("parallel")},0,'08:00','10:00',NULL))<>1 THEN RAISE EXCEPTION 'reverse conflict missed'; END IF;
    END $$;`,
  ],
  [
    "one assignment counts workload once and the satellite rejects duplicate assignment",
    `${merge}
    SELECT create_teaching_assignment_v2(${anchor},${id("teacher")});
    DO $$ BEGIN
      IF (SELECT count(*) FROM teaching_assignments WHERE is_active)<>1 OR (SELECT sum(weekly_hours) FROM teaching_assignments WHERE is_active)<>2
        OR (SELECT expected_students FROM teaching_assignments WHERE is_active LIMIT 1)<>75 THEN RAISE EXCEPTION 'duplicate workload or wrong count'; END IF;
      BEGIN PERFORM create_teaching_assignment_v2(${member},${id("labteacher")}); RAISE EXCEPTION 'satellite assigned'; EXCEPTION WHEN check_violation THEN NULL; END;
    END $$;`,
  ],
  [
    "one scheduled lecture is tagged for both study systems and includes 75 students",
    `${merge}
    SELECT create_teaching_assignment_v2(${anchor},${id("teacher")});
    DO $$ DECLARE r jsonb; BEGIN
      r:=create_schedule_session_from_assignment_v2(${id("version")},(SELECT id FROM teaching_assignments WHERE delivery_group_id=${anchor} AND is_active),0,'08:00','10:00',${id("room")},(SELECT updated_at FROM schedule_versions WHERE id=${id("version")}));
      IF r->>'ok'<>'true' THEN RAISE EXCEPTION 'session create %',r; END IF;
      IF (SELECT count(*) FROM schedule_sessions)<>1 OR NOT EXISTS(SELECT 1 FROM schedule_sessions WHERE study_system='both' AND expected_students=75) THEN RAISE EXCEPTION 'shared session lost'; END IF;
    END $$;`,
  ],
  [
    "75 students, one operational lecture, original counts and labs preserved",
    `${merge}
    DO $$ BEGIN
      IF (SELECT count(*) FROM delivery_groups)<>5 OR (SELECT count(*) FROM operational_delivery_groups WHERE active AND NOT is_obsolete)<>4 THEN RAISE EXCEPTION 'group count'; END IF;
      IF (SELECT expected_students FROM operational_delivery_groups WHERE id=${anchor})<>75 THEN RAISE EXCEPTION 'shared capacity'; END IF;
      IF (SELECT expected_students FROM delivery_groups WHERE id=${anchor})<>50 OR (SELECT expected_students FROM delivery_groups WHERE id=${member})<>25 THEN RAISE EXCEPTION 'source changed'; END IF;
      IF (SELECT sum(expected_students) FROM delivery_groups WHERE component_id=${id("practical")})<>75 THEN RAISE EXCEPTION 'lab changed'; END IF;
    END $$;`,
  ],
  [
    "retry and regenerating either cohort retain membership without duplicate workload",
    `${merge}${merge}
    SELECT generate_cohort_delivery_groups(${id("regular")}); SELECT generate_cohort_delivery_groups(${id("parallel")});
    DO $$ BEGIN
      IF (SELECT count(*) FROM shared_lecture_links)<>1 OR (SELECT count(*) FROM delivery_groups)<>5 THEN RAISE EXCEPTION 'retry duplicates'; END IF;
      IF (SELECT sum(partition_headcount) FROM operational_group_members WHERE delivery_group_id=${anchor} AND partition_active)<>75 THEN RAISE EXCEPTION 'partition coverage'; END IF;
    END $$;`,
  ],
  [
    "shared lecture conflicts with labs of both cohorts; independent labs remain parallel",
    `${merge}
    DO $$ BEGIN
      IF NOT delivery_groups_share_students(${anchor},${group("parallel", "practical")}) THEN RAISE EXCEPTION 'parallel students ignored'; END IF;
      IF NOT delivery_groups_share_students(${anchor},${group("regular", "practical")}) THEN RAISE EXCEPTION 'regular students ignored'; END IF;
      IF delivery_groups_share_students(${group("regular", "practical")},${group("parallel", "practical")}) THEN RAISE EXCEPTION 'independent labs blocked'; END IF;
    END $$;`,
  ],
  [
    "parallel assignment filter sees anchor once at 75",
    `${merge}
    DO $$ DECLARE result jsonb; BEGIN
      result:=list_teaching_assignment_workspace(${id("college")},NULL,NULL,${id("term")},'parallel',${id("parallel")},'theory',NULL);
      IF jsonb_array_length(result->'rows')<>1 OR (result->'rows'->0->>'expected_students')::int<>75 THEN RAISE EXCEPTION 'parallel workspace %',result; END IF;
    END $$;`,
  ],
  [
    "viewers cannot merge or write links directly",
    `SET LOCAL ROLE authenticated; SELECT set_config('request.jwt.claim.sub',md5('viewer'),true);
    DO $$ BEGIN
      BEGIN PERFORM merge_shared_lecture(${anchor},${member}); RAISE EXCEPTION 'viewer accepted'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      BEGIN INSERT INTO shared_lecture_links VALUES(${member},${anchor},${id("college")},now()); RAISE EXCEPTION 'direct write'; EXCEPTION WHEN insufficient_privilege THEN NULL; END;
      IF has_function_privilege('anon','merge_shared_lecture(uuid,uuid)','EXECUTE') THEN RAISE EXCEPTION 'anon grant'; END IF;
    END $$;`,
  ],
  [
    "practical groups cannot be merged",
    `DO $$ BEGIN
    BEGIN PERFORM merge_shared_lecture(${group("regular", "practical")},${group("parallel", "practical")}); RAISE EXCEPTION 'accepted lab'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'SHARED_LECTURE_CONTEXT_MISMATCH' THEN RAISE; END IF; END;
  END $$;`,
  ],
  [
    "capacity overflow rejects atomically",
    `UPDATE delivery_groups SET capacity_limit=60 WHERE id=${anchor}; DO $$ BEGIN
    BEGIN PERFORM merge_shared_lecture(${anchor},${member}); RAISE EXCEPTION 'overflow accepted'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'SHARED_LECTURE_CAPACITY_EXCEEDED' THEN RAISE; END IF; END;
    IF EXISTS(SELECT 1 FROM shared_lecture_links) THEN RAISE EXCEPTION 'partial merge'; END IF;
  END $$;`,
  ],
  [
    "source count change requires review instead of silently breaking the merge",
    `${merge} DO $$ BEGIN
    BEGIN UPDATE delivery_groups SET expected_students=51 WHERE id=${anchor}; RAISE EXCEPTION 'count overwritten'; EXCEPTION WHEN check_violation THEN IF SQLERRM<>'SHARED_LECTURE_REVIEW_REQUIRED' THEN RAISE; END IF; END;
  END $$;`,
  ],
  [
    "unmerge restores operational source groups without changing their identities",
    `${merge} SELECT unmerge_shared_lecture(${member});
    DO $$ BEGIN IF (SELECT count(*) FROM operational_delivery_groups WHERE active AND NOT is_obsolete)<>5 OR EXISTS(SELECT 1 FROM shared_lecture_links) THEN RAISE EXCEPTION 'unmerge'; END IF; END $$;`,
  ],
];
