import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const { PGlite } = await import(process.env.CLONE_DB_MODULE ?? "@electric-sql/pglite");
const migration = await readFile(
  new URL(
    "../supabase/migrations/20260929103000_itcs_grand_hall_three_day_availability.sql",
    import.meta.url,
  ),
  "utf8",
);

const COLLEGE = "7168345f-cf9d-4789-b2ad-547abb687dc8";
const GRAND = "10000000-0000-4000-8000-000000000001";
const OTHER = "10000000-0000-4000-8000-000000000002";
const HALL_TYPE = "20000000-0000-4000-8000-000000000001";

async function fixture({ duplicateGrand = false } = {}) {
  const db = new PGlite();
  await db.exec(`
    CREATE TABLE public.room_types (
      id uuid PRIMARY KEY,
      code text
    );
    CREATE TABLE public.rooms (
      id uuid PRIMARY KEY,
      college_id uuid NOT NULL,
      room_type_id uuid,
      room_type text NOT NULL,
      name text,
      is_active boolean NOT NULL DEFAULT true,
      available_days smallint[],
      available_start_time time,
      available_end_time time,
      notes text,
      updated_at timestamptz NOT NULL DEFAULT now()
    );
    CREATE TABLE public.room_availability (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      college_id uuid NOT NULL,
      room_id uuid NOT NULL,
      day_of_week smallint NOT NULL,
      start_time time NOT NULL,
      end_time time NOT NULL,
      notes text
    );
    INSERT INTO public.room_types VALUES ('${HALL_TYPE}', 'lecture_hall');
    INSERT INTO public.rooms (
      id, college_id, room_type_id, room_type, name, available_days,
      available_start_time, available_end_time, notes
    ) VALUES
      ('${GRAND}', '${COLLEGE}', '${HALL_TYPE}', 'lecture_hall', 'القاعة الكبرى',
       NULL, '08:00', '14:00', 'متاحة 36 ساعة أسبوعيًا'),
      ('${OTHER}', '${COLLEGE}', '${HALL_TYPE}', 'lecture_hall', 'قاعة 1',
       NULL, '08:00', '14:00', 'لا تتغير');
    INSERT INTO public.room_availability (
      college_id, room_id, day_of_week, start_time, end_time, notes
    ) VALUES
      ('${COLLEGE}', '${GRAND}', 0, '08:00', '14:00', 'قديم'),
      ('${COLLEGE}', '${GRAND}', 1, '08:00', '14:00', 'قديم'),
      ('${COLLEGE}', '${GRAND}', 4, '08:00', '14:00', 'قديم'),
      ('${COLLEGE}', '${GRAND}', 4, '08:00', '14:00', 'مكرر'),
      ('${COLLEGE}', '${GRAND}', 6, '08:00', '16:00', 'قديم'),
      ('${COLLEGE}', '${OTHER}', 2, '08:00', '14:00', 'يجب أن يبقى');
  `);
  if (duplicateGrand)
    await db.exec(`
      INSERT INTO public.rooms (
        id, college_id, room_type_id, room_type, name, available_days,
        available_start_time, available_end_time, notes
      ) VALUES (
        '10000000-0000-4000-8000-000000000003', '${COLLEGE}', '${HALL_TYPE}',
        'lecture_hall', 'القاعة الكبرى', NULL, '08:00', '14:00', 'مكرر'
      );
    `);
  return db;
}

test("ITCS grand hall correction is exact, isolated and idempotent", async () => {
  const db = await fixture();
  try {
    await db.exec(migration);
    await db.exec(migration);

    const room = await db.query(`
      SELECT available_days, available_start_time::text AS starts,
             available_end_time::text AS ends, notes
      FROM public.rooms WHERE id='${GRAND}'
    `);
    assert.deepEqual(room.rows, [
      {
        available_days: [6, 0, 4],
        starts: "08:00:00",
        ends: "14:00:00",
        notes:
          "اعتماد المستخدم 29 سبتمبر 2026: القاعة متاحة فقط أيام السبت والأحد والخميس من 08:00 إلى 14:00، بإجمالي 18 ساعة أسبوعيًا. هذا القيد هو مرجع الجدولة والتقارير.",
      },
    ]);

    const availability = await db.query(`
      SELECT day_of_week, start_time::text AS starts, end_time::text AS ends
      FROM public.room_availability WHERE room_id='${GRAND}' ORDER BY day_of_week
    `);
    assert.deepEqual(availability.rows, [
      { day_of_week: 0, starts: "08:00:00", ends: "14:00:00" },
      { day_of_week: 4, starts: "08:00:00", ends: "14:00:00" },
      { day_of_week: 6, starts: "08:00:00", ends: "14:00:00" },
    ]);
    const hours = await db.query(`
      SELECT sum(extract(epoch FROM (end_time-start_time))/3600)::int AS hours
      FROM public.room_availability WHERE room_id='${GRAND}'
    `);
    assert.equal(hours.rows[0].hours, 18);
    const untouched = await db.query(
      `SELECT count(*)::int AS rows FROM public.room_availability WHERE room_id='${OTHER}'`,
    );
    assert.equal(untouched.rows[0].rows, 1);
  } finally {
    await db.close();
  }
});

test("ITCS grand hall correction fails closed on an ambiguous room identity", async () => {
  const db = await fixture({ duplicateGrand: true });
  try {
    await assert.rejects(() => db.exec(migration), /ITCS_GRAND_HALL_IDENTITY_MISMATCH/);
  } finally {
    await db.close();
  }
});
