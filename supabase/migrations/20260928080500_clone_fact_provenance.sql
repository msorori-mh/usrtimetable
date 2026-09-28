-- An inherited approval must retain its exact source row. The previous
-- single-version checks prevented every clone of the corrected timetable.
BEGIN;
SET LOCAL lock_timeout='5s';
CREATE TABLE schedule_version_delivery_private.clone_provenance (
 version_id uuid PRIMARY KEY REFERENCES public.schedule_versions(id) ON DELETE CASCADE,
 source_version_id uuid NOT NULL REFERENCES public.schedule_versions(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 CHECK (version_id <> source_version_id)
);
REVOKE ALL ON schedule_version_delivery_private.clone_provenance FROM PUBLIC,anon,authenticated;

CREATE FUNCTION schedule_version_delivery_private.is_delivery_clone(p_version uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path='pg_catalog','public','schedule_version_delivery_private' AS $$
 SELECT EXISTS (
  SELECT 1 FROM schedule_version_delivery_private.clone_provenance c
  JOIN public.schedule_versions v ON v.id=c.version_id
  JOIN public.schedule_versions src ON src.id=c.source_version_id
  WHERE c.version_id=p_version AND v.college_id=src.college_id
   AND v.academic_term_id=src.academic_term_id
 );
$$;
REVOKE ALL ON FUNCTION schedule_version_delivery_private.is_delivery_clone(uuid) FROM PUBLIC,anon,authenticated;

CREATE FUNCTION schedule_version_delivery_private.guard_inherited_approval()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path='pg_catalog','public','schedule_version_delivery_private' AS $$
DECLARE v_source uuid; v_match boolean; v_status text;
BEGIN
 IF NEW.version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b'::uuid THEN RETURN NEW; END IF;
 SELECT c.source_version_id,v.status INTO v_source,v_status
 FROM schedule_version_delivery_private.clone_provenance c
 JOIN public.schedule_versions v ON v.id=c.version_id
 WHERE c.version_id=NEW.version_id;
 IF v_source IS NULL OR v_status <> 'draft'
    OR NOT schedule_version_delivery_private.is_delivery_clone(NEW.version_id) THEN
  RAISE EXCEPTION 'INHERITED_APPROVAL_SOURCE_REQUIRED' USING ERRCODE='23514';
 END IF;
 EXECUTE format('SELECT EXISTS (SELECT 1 FROM schedule_version_delivery_private.%I s WHERE s.version_id=$1 AND to_jsonb(s)-''version_id''=$2)',TG_TABLE_NAME)
 INTO v_match USING v_source,to_jsonb(NEW)-'version_id';
 IF NOT v_match THEN
  RAISE EXCEPTION 'INHERITED_APPROVAL_MUST_MATCH_SOURCE' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION schedule_version_delivery_private.guard_inherited_approval() FROM PUBLIC,anon,authenticated;

ALTER TABLE schedule_version_delivery_private.component_room_type_facts
 DROP CONSTRAINT component_room_type_facts_version_id_check,
 ADD CONSTRAINT component_room_type_facts_version_id_check CHECK (
  version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b'::uuid
  OR schedule_version_delivery_private.is_delivery_clone(version_id));
ALTER TABLE schedule_version_delivery_private.instructor_hour_waivers
 DROP CONSTRAINT instructor_hour_waivers_version_id_check,
 ADD CONSTRAINT instructor_hour_waivers_version_id_check CHECK (
  version_id='d68d8d22-9a6d-4f21-935f-cebf18bb969b'::uuid
  OR schedule_version_delivery_private.is_delivery_clone(version_id)),
 DROP CONSTRAINT instructor_hour_waivers_pkey,
 ADD CONSTRAINT instructor_hour_waivers_pkey PRIMARY KEY (version_id,assignment_id);
CREATE TRIGGER inherited_room_type BEFORE INSERT OR UPDATE
 ON schedule_version_delivery_private.component_room_type_facts
 FOR EACH ROW EXECUTE FUNCTION schedule_version_delivery_private.guard_inherited_approval();
CREATE TRIGGER inherited_hour_waiver BEFORE INSERT OR UPDATE
 ON schedule_version_delivery_private.instructor_hour_waivers
 FOR EACH ROW EXECUTE FUNCTION schedule_version_delivery_private.guard_inherited_approval();
COMMIT;
