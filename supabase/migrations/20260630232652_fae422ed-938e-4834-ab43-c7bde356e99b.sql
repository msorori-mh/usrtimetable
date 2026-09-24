
ALTER TABLE public.rooms DROP CONSTRAINT IF EXISTS rooms_room_type_check;
ALTER TABLE public.teaching_assignments DROP CONSTRAINT IF EXISTS teaching_assignments_required_room_type_check;
ALTER TABLE public.teaching_assignments DROP CONSTRAINT IF EXISTS teaching_assignments_session_type_check;

UPDATE public.room_types SET code = 'network_lab' WHERE code = 'networking_lab';

UPDATE public.rooms SET room_type = 'lecture_hall' WHERE room_type IN ('lecture_room','lecture');
UPDATE public.rooms SET room_type = 'computer_lab' WHERE room_type IN ('lab','practical_lab');
UPDATE public.rooms SET room_type = 'network_lab' WHERE room_type = 'networking_lab';

UPDATE public.teaching_assignments SET required_room_type = 'lecture_hall' WHERE required_room_type IN ('lecture_room','lecture');
UPDATE public.teaching_assignments SET required_room_type = 'computer_lab' WHERE required_room_type IN ('lab','practical_lab');
UPDATE public.teaching_assignments SET required_room_type = 'network_lab' WHERE required_room_type = 'networking_lab';

UPDATE public.plan_courses SET required_room_type_for_lecture = 'lecture_hall' WHERE required_room_type_for_lecture IN ('lecture_room','lecture');
UPDATE public.plan_courses SET required_room_type_for_lecture = 'computer_lab' WHERE required_room_type_for_lecture IN ('lab','practical_lab');
UPDATE public.plan_courses SET required_room_type_for_lecture = 'network_lab' WHERE required_room_type_for_lecture = 'networking_lab';
UPDATE public.plan_courses SET required_room_type_for_lab = 'lecture_hall' WHERE required_room_type_for_lab IN ('lecture_room','lecture');
UPDATE public.plan_courses SET required_room_type_for_lab = 'computer_lab' WHERE required_room_type_for_lab IN ('lab','practical_lab');
UPDATE public.plan_courses SET required_room_type_for_lab = 'network_lab' WHERE required_room_type_for_lab = 'networking_lab';

UPDATE public.teaching_assignments SET session_type = 'lab' WHERE session_type IN ('practical','practical_session');
UPDATE public.teaching_assignments SET session_type = 'lecture' WHERE session_type IN ('theory','theoretical');

UPDATE public.schedule_sessions SET session_type = 'lab' WHERE session_type IN ('practical','practical_session');
UPDATE public.schedule_sessions SET session_type = 'lecture' WHERE session_type IN ('theory','theoretical');

ALTER TABLE public.rooms ADD CONSTRAINT rooms_room_type_check
  CHECK (room_type = ANY (ARRAY['lecture_hall','computer_lab','network_lab','cybersecurity_lab','electronics_lab','workshop','seminar_room']));

ALTER TABLE public.teaching_assignments ADD CONSTRAINT teaching_assignments_required_room_type_check
  CHECK (required_room_type IS NULL OR required_room_type = ANY (ARRAY['lecture_hall','computer_lab','network_lab','cybersecurity_lab','electronics_lab','workshop','seminar_room']));

ALTER TABLE public.teaching_assignments ADD CONSTRAINT teaching_assignments_session_type_check
  CHECK (session_type = ANY (ARRAY['lecture','lab','tutorial','seminar','workshop']));

INSERT INTO public.audit_logs (action, entity, entity_id, details)
VALUES ('reference_data_normalized', 'system', gen_random_uuid(),
  jsonb_build_object(
    'phase', '1.5D',
    'room_type_map', jsonb_build_object('lecture_room','lecture_hall','lecture','lecture_hall','lab','computer_lab','practical_lab','computer_lab','networking_lab','network_lab'),
    'session_type_map', jsonb_build_object('practical','lab','practical_session','lab','theory','lecture','theoretical','lecture')
  )
);
