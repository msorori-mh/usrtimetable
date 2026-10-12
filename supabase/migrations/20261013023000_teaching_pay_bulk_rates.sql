-- Expand explicit All selections atomically. The existing RPC owns all validation,
-- permissions, append-only versions and per-rate audit; no broad update/upsert.
CREATE OR REPLACE FUNCTION public.save_teaching_pay_rates(p_college_id uuid,p_payload jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public','pg_temp' AS $$
DECLARE kinds text[]; systems text[]; k text; s text; result jsonb; ids jsonb:='[]'::jsonb;
BEGIN
 IF auth.uid() IS NULL OR (public.has_role(auth.uid(),'super_admin') IS NOT TRUE
  AND public.has_role(auth.uid(),'institutional_viewer') IS NOT TRUE)
  OR public.can_view_college(auth.uid(),p_college_id) IS NOT TRUE THEN
  RAISE EXCEPTION 'هذه العملية متاحة للشؤون الأكاديمية والأدمن العام فقط ضمن الكليات المصرح بها' USING ERRCODE='42501';
 END IF;
 IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object'
  OR coalesce(p_payload->>'kind','') NOT IN ('overload','contractual','all')
  OR coalesce(p_payload->>'system','') NOT IN ('regular','parallel','all') THEN
  RAISE EXCEPTION 'اختر نوع الأجر والنظام أو الكل' USING ERRCODE='22023';
 END IF;
 kinds:=CASE WHEN p_payload->>'kind'='all' THEN ARRAY['overload','contractual'] ELSE ARRAY[p_payload->>'kind'] END;
 systems:=CASE WHEN p_payload->>'system'='all' THEN ARRAY['regular','parallel'] ELSE ARRAY[p_payload->>'system'] END;
 FOREACH k IN ARRAY kinds LOOP
  FOREACH s IN ARRAY systems LOOP
   result:=public.teaching_payroll(p_college_id,'save_rate',p_payload||jsonb_build_object('kind',k,'system',s));
   ids:=ids||jsonb_build_array(result->>'id');
  END LOOP;
 END LOOP;
 RETURN jsonb_build_object('ok',true,'ids',ids,'count',jsonb_array_length(ids));
EXCEPTION WHEN unique_violation THEN
 RAISE EXCEPTION 'يوجد سعر مسجل لأحد الخيارات في تاريخ السريان نفسه؛ لم يُحفظ أي سعر من هذه الدفعة. اختر تاريخ سريان جديدًا أو خيارات أخرى.' USING ERRCODE='23505';
END $$;
REVOKE ALL ON FUNCTION public.save_teaching_pay_rates(uuid,jsonb) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.save_teaching_pay_rates(uuid,jsonb) TO authenticated;
