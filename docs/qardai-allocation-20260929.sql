BEGIN;
CREATE TEMP TABLE qardai_alloc(room_id uuid PRIMARY KEY, college_id uuid, days integer[]) ON COMMIT DROP;
INSERT INTO qardai_alloc VALUES
('0b097849-0658-4d29-a3a7-ee0aaa0e91f2','d78cf264-3a76-43a1-8601-4d6def12b400',ARRAY[0]),
('35355e05-f45a-4f35-875e-3dec562574cd','1ee291b2-bec9-43d3-b42b-5a4f46946399',ARRAY[6,2]),
('4e19eef6-6a23-55d5-bfde-1a4af775fbd0','f30ff526-3918-4395-b8a0-dff1873534bf',ARRAY[1,3,4]);
DO $$ BEGIN
 IF (SELECT count(*) FROM public.rooms r JOIN qardai_alloc a ON r.id=a.room_id AND r.college_id=a.college_id WHERE r.is_active AND r.available_start_time='08:00'::time AND r.available_end_time='14:00'::time) <> 3 THEN RAISE EXCEPTION 'Qardai baseline mismatch'; END IF;
END $$;
UPDATE public.rooms r SET available_days=a.days FROM qardai_alloc a WHERE r.id=a.room_id;
DELETE FROM public.room_availability r USING qardai_alloc a WHERE r.room_id=a.room_id AND NOT (r.day_of_week=ANY(a.days));
INSERT INTO public.room_availability(college_id,room_id,day_of_week,start_time,end_time,notes)
SELECT a.college_id,a.room_id,d,'08:00'::time,'14:00'::time,'توزيع القردعي المعتمد صراحة من المستخدم 29 سبتمبر 2026: الآداب الأحد؛ التربية السبت والثلاثاء؛ الإدارية الاثنين والأربعاء والخميس.'
FROM qardai_alloc a CROSS JOIN LATERAL unnest(a.days) d
WHERE NOT EXISTS (SELECT 1 FROM public.room_availability r WHERE r.room_id=a.room_id AND r.day_of_week=d);
UPDATE public.room_availability r SET notes='توزيع القردعي المعتمد صراحة من المستخدم 29 سبتمبر 2026: الآداب الأحد؛ التربية السبت والثلاثاء؛ الإدارية الاثنين والأربعاء والخميس.'
FROM qardai_alloc a WHERE r.room_id=a.room_id;
DO $$ BEGIN
 IF (SELECT count(*) FROM public.room_availability r JOIN qardai_alloc a ON r.room_id=a.room_id) <> 6 THEN RAISE EXCEPTION 'Expected six disjoint daily windows'; END IF;
 IF (SELECT md5(string_agg(to_jsonb(s)::text,'' order by id)) FROM public.schedule_sessions s) <> 'a3d7ff505f66a13790bc60c359ad419f' THEN RAISE EXCEPTION 'Session baseline changed; abort'; END IF;
END $$;
COMMIT;
SELECT r.id,r.name,r.available_days,count(a.id)*6 AS available_hours FROM public.rooms r JOIN public.room_availability a ON a.room_id=r.id WHERE r.id IN ('0b097849-0658-4d29-a3a7-ee0aaa0e91f2','35355e05-f45a-4f35-875e-3dec562574cd','4e19eef6-6a23-55d5-bfde-1a4af775fbd0') GROUP BY r.id;
