-- Close the one-time import entrypoint after its source rows have landed.
DO $check$
DECLARE linked integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.schedule_versions
     WHERE id='7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid) THEN RETURN; END IF;
  SELECT count(*) INTO linked FROM public.existing_schedule_source_rows
  WHERE schedule_version_id='7430bad7-2de7-5c90-9368-b214a199d6c3'::uuid
    AND source_file IN ('كيمياء.docx',
      'جدول قسم الدراسات الإسلامية 2026-2026م ,نهائي.docx')
    AND delivery_group_id IS NOT NULL AND schedule_session_id IS NOT NULL;
  IF linked<>72 OR NOT EXISTS (
    SELECT 1 FROM public.existing_schedule_source_rows WHERE
      source_id='EDU-SOURCE-2026-S1-20260922-S0304' AND schedule_session_id IS NOT NULL)
  THEN RAISE EXCEPTION 'EDU26F_IMPORT_INCOMPLETE: %',linked; END IF;
END;
$check$;

REVOKE ALL ON FUNCTION public.education_2026f_import_named_row(
  text,uuid,text,smallint,time without time zone,uuid)
FROM PUBLIC, anon, authenticated;
