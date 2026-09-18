-- Public QR receipts disclose only approved report/version metadata, never report rows.
CREATE TABLE public.report_verification_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.schedule_versions(id) ON DELETE CASCADE,
  report_kind text NOT NULL CHECK (report_kind IN ('student','instructor','room','report')),
  source_revision bigint NOT NULL,
  source_updated_at timestamptz NOT NULL,
  issued_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(version_id, report_kind, source_revision, source_updated_at)
);
ALTER TABLE public.report_verification_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.report_verification_receipts FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.issue_report_verification(p_version_id uuid, p_report_kind text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE v public.schedule_versions%ROWTYPE; receipt_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'AUTH_REQUIRED' USING ERRCODE='42501'; END IF;
  IF p_report_kind IS NULL OR p_report_kind NOT IN ('student','instructor','room','report') THEN
    RAISE EXCEPTION 'INVALID_REPORT_KIND' USING ERRCODE='22023';
  END IF;
  SELECT * INTO v FROM public.schedule_versions WHERE id=p_version_id;
  IF NOT FOUND OR NOT public.can_view_college(auth.uid(),v.college_id) THEN
    RAISE EXCEPTION 'REPORT_NOT_AVAILABLE' USING ERRCODE='42501';
  END IF;
  IF v.status <> 'published' OR coalesce(v.disposable_test,false) THEN RETURN NULL; END IF;
  INSERT INTO public.report_verification_receipts(version_id,report_kind,source_revision,source_updated_at)
    VALUES(v.id,p_report_kind,coalesce(v.eligibility_revision,0),v.updated_at)
    ON CONFLICT DO NOTHING RETURNING id INTO receipt_id;
  IF receipt_id IS NULL THEN
    SELECT id INTO receipt_id FROM public.report_verification_receipts
      WHERE version_id=v.id AND report_kind=p_report_kind
        AND source_revision=coalesce(v.eligibility_revision,0) AND source_updated_at=v.updated_at;
  END IF;
  RETURN receipt_id;
END;
$$;
REVOKE ALL ON FUNCTION public.issue_report_verification(uuid,text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.issue_report_verification(uuid,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.resolve_report_verification(p_receipt_id uuid)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT coalesce((
    SELECT jsonb_build_object(
      'available',true,
      'college_name',c.name,
      'term_name',t.name,
      'version_name',v.name,
      'report_kind',r.report_kind,
      'status','published',
      'issued_at',r.issued_at,
      'version_updated_at',v.updated_at,
      'unchanged',r.source_revision=coalesce(v.eligibility_revision,0) AND r.source_updated_at=v.updated_at,
      'is_latest',NOT EXISTS (
        SELECT 1 FROM public.schedule_versions newer
        WHERE newer.college_id=v.college_id AND newer.academic_term_id=v.academic_term_id
          AND newer.status='published' AND NOT coalesce(newer.disposable_test,false)
          AND newer.created_at>v.created_at
      )
    )
    FROM public.report_verification_receipts r
    JOIN public.schedule_versions v ON v.id=r.version_id
    JOIN public.colleges c ON c.id=v.college_id
    JOIN public.academic_terms t ON t.id=v.academic_term_id AND t.college_id=v.college_id
    WHERE r.id=p_receipt_id AND v.status='published' AND NOT coalesce(v.disposable_test,false)
  ),jsonb_build_object('available',false));
$$;
REVOKE ALL ON FUNCTION public.resolve_report_verification(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_report_verification(uuid) TO anon, authenticated;
