import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

test(
  "PostgreSQL enforces the 8/6/8 student daily policy for direct and shared partitions",
  { skip: process.env.STUDENT_DAILY_LOAD_TEST_DISPOSABLE !== "1" },
  () => {
    const target = process.env.STUDENT_DAILY_LOAD_TEST_DATABASE_URL;
    assert.ok(target);
    const url = new URL(target);
    assert.ok(["localhost", "127.0.0.1"].includes(url.hostname));
    assert.equal(url.pathname, "/student_daily_load_test");

    const guard = readFileSync(
      new URL("../supabase/sql/student_daily_load_guard.sql", import.meta.url),
      "utf8",
    );

    const sql = `
      CREATE TABLE public.scheduling_settings(
        college_id uuid PRIMARY KEY,
        max_daily_hours_per_section integer,
        max_daily_theory_hours_per_section integer,
        max_daily_practical_hours_per_section integer
      );
      CREATE TABLE public.schedule_versions(
        id uuid PRIMARY KEY,
        college_id uuid NOT NULL,
        status text NOT NULL
      );
      CREATE TABLE public.schedule_sessions(
        id uuid PRIMARY KEY,
        college_id uuid NOT NULL,
        schedule_version_id uuid NOT NULL,
        teaching_assignment_id uuid,
        plan_course_component_id uuid,
        cohort_id uuid,
        delivery_group_id uuid,
        day_of_week integer,
        start_time time,
        end_time time,
        replaced_by_split boolean DEFAULT false
      );
      CREATE TABLE public.teaching_assignments(
        id uuid PRIMARY KEY,
        college_id uuid NOT NULL,
        cohort_id uuid,
        delivery_group_id uuid,
        plan_course_component_id uuid
      );
      CREATE TABLE public.plan_course_components(
        id uuid PRIMARY KEY,
        college_id uuid NOT NULL,
        component_type text
      );
      CREATE TABLE public.operational_delivery_groups(
        id uuid PRIMARY KEY,
        college_id uuid NOT NULL,
        cohort_id uuid NOT NULL,
        component_id uuid,
        expected_students integer NOT NULL
      );
      CREATE TABLE public.operational_group_members(
        college_id uuid NOT NULL,
        cohort_id uuid NOT NULL,
        delivery_group_id uuid NOT NULL,
        partition_id uuid NOT NULL
      );
      CREATE TABLE public.cohort_student_partitions(
        id uuid PRIMARY KEY,
        college_id uuid NOT NULL,
        cohort_id uuid NOT NULL,
        headcount integer NOT NULL,
        active boolean NOT NULL DEFAULT true
      );

      INSERT INTO public.scheduling_settings VALUES(
        '00000000-0000-0000-0000-000000000001', 8, 6, 8
      );
      INSERT INTO public.schedule_versions VALUES(
        '00000000-0000-0000-0000-000000000002',
        '00000000-0000-0000-0000-000000000001',
        'draft'
      );
      INSERT INTO public.cohort_student_partitions(id,college_id,cohort_id,headcount) VALUES
        ('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003',40),
        ('00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003',30);
      INSERT INTO public.plan_course_components(id,college_id,component_type) VALUES
        ('00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000001','theory'),
        ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000001','practical'),
        ('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000001','seminar');
      INSERT INTO public.operational_delivery_groups(id,college_id,cohort_id,component_id,expected_students) VALUES
        ('00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000020',40),
        ('00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000021',40),
        ('00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000020',30),
        ('00000000-0000-0000-0000-000000000033','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000020',70),
        ('00000000-0000-0000-0000-000000000034','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000022',40);
      INSERT INTO public.operational_group_members VALUES
        ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000010'),
        ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000010'),
        ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000011'),
        ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000033','00000000-0000-0000-0000-000000000010'),
        ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000033','00000000-0000-0000-0000-000000000011'),
        ('00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000034','00000000-0000-0000-0000-000000000010');
      INSERT INTO public.teaching_assignments(id,college_id,cohort_id,delivery_group_id,plan_course_component_id) VALUES
        ('00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000030','00000000-0000-0000-0000-000000000020'),
        ('00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000031','00000000-0000-0000-0000-000000000021'),
        ('00000000-0000-0000-0000-000000000042','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000032','00000000-0000-0000-0000-000000000020'),
        ('00000000-0000-0000-0000-000000000043','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000033','00000000-0000-0000-0000-000000000020'),
        ('00000000-0000-0000-0000-000000000044','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000034','00000000-0000-0000-0000-000000000022');

      ${guard}

      -- 6h theory + 2h practical is valid (8h total).
      INSERT INTO public.schedule_sessions VALUES
        ('00000000-0000-0000-0000-000000000100','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000030',0,'08:00','11:00',false),
        ('00000000-0000-0000-0000-000000000101','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000030',0,'11:00','14:00',false);
      INSERT INTO public.schedule_sessions VALUES
        ('00000000-0000-0000-0000-000000000102','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000031',0,'14:00','16:00',false);

      DO $$ BEGIN
        BEGIN
          INSERT INTO public.schedule_sessions VALUES
            ('00000000-0000-0000-0000-000000000103','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000031',0,'16:00','17:00',false);
          RAISE EXCEPTION '9h total was accepted';
        EXCEPTION WHEN check_violation THEN
          IF SQLERRM <> 'STUDENT_DAILY_LOAD_LIMIT' THEN RAISE; END IF;
        END;
      END $$;

      -- 8h practical is valid.
      INSERT INTO public.schedule_sessions VALUES
        ('00000000-0000-0000-0000-000000000104','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000041','00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000031',1,'08:00','16:00',false);

      -- 8h theory and unknown 7h components are both rejected.
      DO $$ BEGIN
        BEGIN
          INSERT INTO public.schedule_sessions VALUES
            ('00000000-0000-0000-0000-000000000105','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000030',2,'08:00','16:00',false);
          RAISE EXCEPTION '8h theory was accepted';
        EXCEPTION WHEN check_violation THEN NULL; END;
        BEGIN
          INSERT INTO public.schedule_sessions VALUES
            ('00000000-0000-0000-0000-000000000106','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000044','00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000034',2,'08:00','15:00',false);
          RAISE EXCEPTION 'unknown 7h component was not treated as theory-like';
        EXCEPTION WHEN check_violation THEN NULL; END;
      END $$;

      -- A shared lecture consumes the theory allowance for every member Partition.
      INSERT INTO public.schedule_sessions VALUES
        ('00000000-0000-0000-0000-000000000107','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000043','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000033',3,'08:00','14:00',false);
      DO $$ BEGIN
        BEGIN
          INSERT INTO public.schedule_sessions VALUES
            ('00000000-0000-0000-0000-000000000108','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000042','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000032',3,'14:00','15:00',false);
          RAISE EXCEPTION 'shared partition theory overflow was accepted';
        EXCEPTION WHEN check_violation THEN NULL; END;
      END $$;

      -- Existing violations may be reduced but never enlarged.
      ALTER TABLE public.schedule_sessions DISABLE TRIGGER trg_ss_student_daily_load_insert;
      INSERT INTO public.schedule_sessions VALUES
        ('00000000-0000-0000-0000-000000000109','00000000-0000-0000-0000-000000000001','00000000-0000-0000-0000-000000000002','00000000-0000-0000-0000-000000000040','00000000-0000-0000-0000-000000000020','00000000-0000-0000-0000-000000000003','00000000-0000-0000-0000-000000000030',4,'08:00','15:00',false);
      ALTER TABLE public.schedule_sessions ENABLE TRIGGER trg_ss_student_daily_load_insert;
      UPDATE public.schedule_sessions
        SET end_time='14:30'
        WHERE id='00000000-0000-0000-0000-000000000109';
      DO $$ BEGIN
        BEGIN
          UPDATE public.schedule_sessions
            SET end_time='15:00'
            WHERE id='00000000-0000-0000-0000-000000000109';
          RAISE EXCEPTION 'pre-existing violation was enlarged';
        EXCEPTION WHEN check_violation THEN NULL; END;
      END $$;

      -- Publication is strict: grandfathering is only for incremental repair.
      DO $$ BEGIN
        BEGIN
          UPDATE public.schedule_versions SET status='published'
          WHERE id='00000000-0000-0000-0000-000000000002';
          RAISE EXCEPTION 'invalid schedule was published';
        EXCEPTION WHEN check_violation THEN NULL; END;
      END $$;
      UPDATE public.schedule_sessions
        SET end_time='14:00'
        WHERE id='00000000-0000-0000-0000-000000000109';
      UPDATE public.schedule_versions SET status='published'
      WHERE id='00000000-0000-0000-0000-000000000002';

      DO $$ BEGIN
        IF (SELECT count(*) FROM public.schedule_sessions) <> 7 THEN
          RAISE EXCEPTION 'rejected writes were not rolled back';
        END IF;
      END $$;
    `;

    const result = spawnSync("psql", [target, "-X", "-v", "ON_ERROR_STOP=1"], {
      input: sql,
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr);
  },
);
