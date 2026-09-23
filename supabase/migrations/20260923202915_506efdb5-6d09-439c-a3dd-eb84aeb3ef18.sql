DO $$
DECLARE d text := pg_get_functiondef('public.get_delivery_group_assignment_candidates(uuid)'::regprocedure);
BEGIN
  IF position('availability_status' in d) = 0 THEN
    IF position('WHERE i.is_active = TRUE AND c.university_id' in d) = 0 THEN
      RAISE EXCEPTION 'candidates patch anchor not found';
    END IF;
    d := replace(d, 'WHERE i.is_active = TRUE AND c.university_id',
                    'WHERE i.is_active = TRUE AND i.availability_status = ''available'' AND c.university_id');
    EXECUTE d;
  END IF;
END $$;