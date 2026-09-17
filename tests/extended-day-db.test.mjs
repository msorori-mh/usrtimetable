import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

test(
  "PostgreSQL enforces partition extension, multirow writes, publication and RLS",
  { skip: process.env.EXTENDED_DAY_TEST_DISPOSABLE !== "1" },
  () => {
    const url = process.env.EXTENDED_DAY_TEST_DATABASE_URL;
    assert.ok(url);
    const policy = readFileSync(
      new URL("../supabase/sql/partition_extended_day.sql", import.meta.url),
      "utf8",
    );
    const sql = `
  CREATE ROLE extended_day_test_reader;
  DO $$ BEGIN
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='service_role') THEN CREATE ROLE service_role; END IF;
  END $$;
  CREATE TABLE public.scheduling_settings(college_id uuid PRIMARY KEY,day_start_time time,day_end_time time);
  CREATE TABLE public.schedule_versions(id uuid PRIMARY KEY,college_id uuid,status text);
  CREATE TABLE public.schedule_sessions(id uuid PRIMARY KEY,college_id uuid,schedule_version_id uuid,cohort_id uuid,delivery_group_id uuid,day_of_week int,end_time time,replaced_by_split boolean DEFAULT false);
  CREATE TABLE public.delivery_groups(id uuid PRIMARY KEY,college_id uuid,cohort_id uuid,expected_students int,active boolean DEFAULT true,is_obsolete boolean DEFAULT false);
  CREATE TABLE public.cohort_student_partitions(id uuid PRIMARY KEY,college_id uuid,cohort_id uuid,headcount int,active boolean DEFAULT true);
  CREATE TABLE public.delivery_group_partition_members(college_id uuid,cohort_id uuid,delivery_group_id uuid,partition_id uuid);
  INSERT INTO scheduling_settings VALUES('00000000-0000-0000-0000-000000000001','08:00','16:00');
  INSERT INTO schedule_versions VALUES('00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000001','draft');
  INSERT INTO delivery_groups(id,college_id,cohort_id,expected_students) SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003',CASE WHEN i=12 THEN 40 ELSE 20 END FROM generate_series(10,12) i;
  INSERT INTO cohort_student_partitions(id,college_id,cohort_id,headcount) SELECT ('00000000-0000-0000-0000-'||lpad(i::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003',20 FROM generate_series(20,21) i;
  INSERT INTO delivery_group_partition_members SELECT '00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003',g.id,p.id FROM delivery_groups g CROSS JOIN cohort_student_partitions p WHERE g.id::text LIKE '%012' OR (g.id::text LIKE '%010' AND p.id::text LIKE '%020') OR (g.id::text LIKE '%011' AND p.id::text LIKE '%021');
  ${policy}
  DO $$ BEGIN
    IF (SELECT max_extended_days_per_partition FROM scheduling_settings) <> 2 THEN
      RAISE EXCEPTION 'extended-day default is not two days';
    END IF;
  END $$;
  UPDATE scheduling_settings SET extended_day_policy_enabled=true;
  INSERT INTO schedule_sessions(id,college_id,schedule_version_id,cohort_id,delivery_group_id,day_of_week,end_time) SELECT ('00000000-0000-0000-0000-'||lpad((i+100)::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003',('00000000-0000-0000-0000-'||lpad((i+10)::text,12,'0'))::uuid,i,'16:00' FROM generate_series(0,1) i;
  DO $$ BEGIN
    IF (SELECT count(*) FROM schedule_extended_day_counts('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002') WHERE days=1) <> 2 THEN RAISE EXCEPTION 'independent partition count failed'; END IF;
  END $$;
  INSERT INTO schedule_sessions VALUES('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000012',2,'16:00',false);
  DO $$ BEGIN
    BEGIN
      INSERT INTO schedule_sessions VALUES('00000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000012',3,'16:00',false);
      RAISE EXCEPTION 'shared third day accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
    UPDATE schedule_sessions SET day_of_week=3 WHERE id='00000000-0000-0000-0000-000000000100';
    BEGIN
      INSERT INTO schedule_sessions(id,college_id,schedule_version_id,cohort_id,delivery_group_id,day_of_week,end_time) SELECT ('00000000-0000-0000-0000-'||lpad((i+110)::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000010',i,'16:00' FROM generate_series(4,5) i;
      RAISE EXCEPTION 'multirow violation accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
    IF (SELECT count(*) FROM schedule_sessions)<>3 THEN RAISE EXCEPTION 'failed write not rolled back'; END IF;
  END $$;
  UPDATE scheduling_settings SET extended_day_policy_enabled=false;
  INSERT INTO schedule_sessions VALUES('00000000-0000-0000-0000-000000000120','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000010',4,'16:00',false);
  UPDATE scheduling_settings SET extended_day_policy_enabled=true;
  DO $$ BEGIN
    BEGIN
      UPDATE schedule_versions SET status='published';
      RAISE EXCEPTION 'invalid publication accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
    UPDATE schedule_sessions SET end_time='14:00' WHERE id='00000000-0000-0000-0000-000000000120';
    UPDATE schedule_versions SET status='published';
    IF has_function_privilege('anon','public.schedule_extended_day_counts(uuid,uuid,uuid,jsonb)','EXECUTE') THEN RAISE EXCEPTION 'anonymous execution granted'; END IF;
  END $$;
  DELETE FROM schedule_sessions;
  DO $$ BEGIN
    BEGIN
      INSERT INTO schedule_sessions(id,college_id,schedule_version_id,cohort_id,delivery_group_id,day_of_week,end_time) SELECT ('00000000-0000-0000-0000-'||lpad((i+200)::text,12,'0'))::uuid,'00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000010',i,'16:00' FROM generate_series(0,2) i;
      RAISE EXCEPTION 'three new days in one statement accepted';
    EXCEPTION WHEN check_violation THEN NULL; END;
    IF EXISTS(SELECT 1 FROM schedule_sessions) THEN RAISE EXCEPTION 'multirow insert was not atomic'; END IF;
  END $$;
  INSERT INTO schedule_sessions VALUES('00000000-0000-0000-0000-000000000220','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000010',0,'16:00',false);
  GRANT USAGE ON SCHEMA public TO extended_day_test_reader;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO extended_day_test_reader;
  GRANT EXECUTE ON FUNCTION schedule_extended_day_counts(uuid,uuid,uuid,jsonb) TO extended_day_test_reader;
  ALTER TABLE schedule_sessions ENABLE ROW LEVEL SECURITY;
  ALTER TABLE delivery_groups ENABLE ROW LEVEL SECURITY;
  ALTER TABLE scheduling_settings ENABLE ROW LEVEL SECURITY;
  SET ROLE extended_day_test_reader;
  DO $$ BEGIN
    IF EXISTS(SELECT 1 FROM schedule_extended_day_counts('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002')) THEN RAISE EXCEPTION 'RLS bypass'; END IF;
  END $$;
  RESET ROLE;
  `;
    const result = spawnSync("psql", [url, "-X", "-v", "ON_ERROR_STOP=1"], {
      input: sql,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  },
);
