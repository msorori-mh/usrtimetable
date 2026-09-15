-- Temporary-only regression proof: leaves no permanent data or schema changes.
BEGIN;
CREATE TEMP TABLE instructors(id uuid,college_id uuid,max_weekly_hours numeric,administrative_release_hours numeric,academic_rank text);
CREATE TEMP TABLE faculty_workload_policies(college_id uuid,active boolean,required_load_hours numeric,rank_code text,rank_aliases text[]);
CREATE TEMP TABLE course_offerings(id uuid,term_id uuid);
CREATE TEMP TABLE delivery_groups(id uuid,component_id uuid,excluded_from_standard_workload boolean);
CREATE TEMP TABLE plan_course_components(id uuid,component_type text,counts_toward_regular_load boolean,weekly_contact_hours numeric);
CREATE TEMP TABLE teaching_assignments(id uuid DEFAULT gen_random_uuid(),instructor_id uuid,college_id uuid,course_offering_id uuid,delivery_group_id uuid,plan_course_component_id uuid,assigned_component_hours numeric,weekly_hours numeric,is_active boolean);
INSERT INTO instructors VALUES(md5('teacher')::uuid,md5('college')::uuid,18,6,'assistant_professor');
INSERT INTO course_offerings VALUES(md5('offer')::uuid,md5('term')::uuid),(md5('offer2')::uuid,md5('otherterm')::uuid);
CREATE OR REPLACE FUNCTION pg_temp.enforce_instructor_extra_hours_limit()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_temp AS $fn$
DECLARE
 v_base numeric; v_release numeric; v_rank text; v_term uuid; v_total numeric; v_limit numeric;
BEGIN
 IF NOT COALESCE(NEW.is_active,false) THEN RETURN NEW; END IF;
 -- Serialize writers for one instructor before reading the aggregate.
 SELECT max_weekly_hours,administrative_release_hours,academic_rank
 INTO v_base,v_release,v_rank FROM pg_temp.instructors
 WHERE id=NEW.instructor_id AND college_id=NEW.college_id FOR UPDATE;
 IF v_base IS NULL THEN
  SELECT required_load_hours INTO v_base FROM pg_temp.faculty_workload_policies
  WHERE college_id=NEW.college_id AND active
   AND (lower(rank_code)=lower(COALESCE(v_rank,'')) OR EXISTS(
    SELECT 1 FROM unnest(rank_aliases) a WHERE lower(a)=lower(COALESCE(v_rank,''))))
  ORDER BY rank_code LIMIT 1;
 END IF;
 IF v_base IS NULL THEN
  RAISE EXCEPTION 'INSTRUCTOR_QUOTA_REQUIRED: يجب تحديد النصاب الأساسي للمحاضر قبل الإسناد' USING ERRCODE='23514';
 END IF;
 v_limit:=GREATEST(0,v_base-COALESCE(v_release,0))+12;
 SELECT term_id INTO v_term FROM pg_temp.course_offerings WHERE id=NEW.course_offering_id;
 SELECT COALESCE(SUM(CASE
   WHEN p.component_type='summer_training' OR COALESCE(d.excluded_from_standard_workload,false)
     OR p.counts_toward_regular_load=false THEN 0
   WHEN t.delivery_group_id IS NULL THEN COALESCE(t.assigned_component_hours,t.weekly_hours,0)
   WHEN (SELECT count(*) FROM pg_temp.teaching_assignments peer
         WHERE peer.delivery_group_id=t.delivery_group_id AND peer.is_active)>1
     THEN COALESCE(t.assigned_component_hours,0)
   ELSE COALESCE(t.assigned_component_hours,p.weekly_contact_hours,0)
 END),0) INTO v_total
 FROM pg_temp.teaching_assignments t
 JOIN pg_temp.course_offerings o ON o.id=t.course_offering_id
 LEFT JOIN pg_temp.delivery_groups d ON d.id=t.delivery_group_id
 LEFT JOIN pg_temp.plan_course_components p ON p.id=COALESCE(t.plan_course_component_id,d.component_id)
 WHERE t.instructor_id=NEW.instructor_id AND t.college_id=NEW.college_id
 AND t.is_active AND o.term_id=v_term;
 IF v_total>v_limit THEN
  RAISE EXCEPTION 'INSTRUCTOR_EXTRA_HOURS_LIMIT_EXCEEDED: الساعات الزائدة لا يجوز أن تتجاوز 12 ساعة أسبوعيًا'
    USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$fn$;
DROP TRIGGER IF EXISTS enforce_instructor_extra_hours_limit ON pg_temp.teaching_assignments;
CREATE TRIGGER enforce_instructor_extra_hours_limit
AFTER INSERT OR UPDATE OF instructor_id,course_offering_id,delivery_group_id,plan_course_component_id,assigned_component_hours,weekly_hours,is_active
ON pg_temp.teaching_assignments FOR EACH ROW EXECUTE FUNCTION pg_temp.enforce_instructor_extra_hours_limit();

INSERT INTO teaching_assignments(instructor_id,college_id,course_offering_id,weekly_hours,is_active) VALUES
(md5('teacher')::uuid,md5('college')::uuid,md5('offer')::uuid,24,true);
DO $$ BEGIN
 BEGIN
 INSERT INTO teaching_assignments(instructor_id,college_id,course_offering_id,weekly_hours,is_active) VALUES(md5('teacher')::uuid,md5('college')::uuid,md5('offer')::uuid,0.01,true);
 RAISE EXCEPTION 'TEST_FAILED: accepted excess over 12';
 EXCEPTION WHEN check_violation THEN
 IF SQLERRM NOT LIKE 'INSTRUCTOR_EXTRA_HOURS_LIMIT_EXCEEDED:%' THEN RAISE; END IF;
 END;
END $$;
INSERT INTO teaching_assignments(instructor_id,college_id,course_offering_id,weekly_hours,is_active) VALUES
(md5('teacher')::uuid,md5('college')::uuid,md5('offer')::uuid,50,false),
(md5('teacher')::uuid,md5('college')::uuid,md5('offer2')::uuid,24,true);
UPDATE teaching_assignments SET is_active=false WHERE course_offering_id=md5('offer')::uuid;
INSERT INTO plan_course_components VALUES(md5('component')::uuid,'theory',true,2);
INSERT INTO delivery_groups VALUES(md5('group')::uuid,md5('component')::uuid,false);
INSERT INTO teaching_assignments(instructor_id,college_id,course_offering_id,delivery_group_id,assigned_component_hours,is_active) VALUES
(md5('teacher')::uuid,md5('college')::uuid,md5('offer')::uuid,md5('group')::uuid,2,true);
DO $$ BEGIN
 BEGIN
 UPDATE teaching_assignments SET assigned_component_hours=25 WHERE delivery_group_id=md5('group')::uuid;
 RAISE EXCEPTION 'TEST_FAILED: update accepted excess over 12';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
UPDATE instructors SET max_weekly_hours=0,administrative_release_hours=0;
UPDATE teaching_assignments SET assigned_component_hours=12 WHERE delivery_group_id=md5('group')::uuid;
DO $$ BEGIN
 BEGIN
 UPDATE teaching_assignments SET assigned_component_hours=12.01 WHERE delivery_group_id=md5('group')::uuid;
 RAISE EXCEPTION 'TEST_FAILED: zero quota accepted excess';
 EXCEPTION WHEN check_violation THEN NULL;
 END;
END $$;
ROLLBACK;
SELECT 'passed: boundary, release, inactive, term separation, V2 update, zero quota' result;
