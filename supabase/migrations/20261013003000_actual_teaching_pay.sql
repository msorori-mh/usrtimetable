-- Actual, certified payable hours only. Never derive money from scheduled hours.
-- All writes go through the super-admin RPC. Approved entries and rate versions
-- are immutable; no payment is executed by this module.
CREATE SCHEMA teaching_pay_private;
REVOKE ALL ON SCHEMA teaching_pay_private FROM PUBLIC, anon, authenticated;

CREATE TABLE teaching_pay_private.rates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  university_id uuid NOT NULL REFERENCES public.universities(id),
  rank text NOT NULL CHECK (rank IN ('معيد','مدرس','محاضر','أستاذ مساعد','أستاذ مشارك','أستاذ','أستاذ دكتور')),
  kind text NOT NULL CHECK (kind IN ('overload','contractual')),
  system text NOT NULL CHECK (system IN ('regular','parallel')),
  effective_from date NOT NULL,
  hourly_rate numeric(12,2) NOT NULL CHECK (hourly_rate > 0 AND hourly_rate <= 100000000),
  currency text NOT NULL CHECK (currency ~ '^[A-Z]{3}$'),
  decision_ref text NOT NULL CHECK (length(btrim(decision_ref)) BETWEEN 1 AND 300),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (university_id,rank,kind,system,effective_from)
);
CREATE TABLE teaching_pay_private.executions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  college_id uuid NOT NULL REFERENCES public.colleges(id),
  term_id uuid NOT NULL REFERENCES public.academic_terms(id),
  identity_id uuid NOT NULL,
  instructor_name text NOT NULL,
  university_number text,
  rank text NOT NULL,
  department_id uuid NOT NULL REFERENCES public.departments(id),
  department_name text NOT NULL,
  program_id uuid NOT NULL REFERENCES public.academic_programs(id),
  program_name text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('overload','contractual')),
  system text NOT NULL CHECK (system IN ('regular','parallel')),
  work_date date NOT NULL,
  starts_at time NOT NULL,
  ends_at time NOT NULL,
  actual_hours numeric(5,2) NOT NULL CHECK (actual_hours > 0 AND actual_hours <= 24),
  payable_hours numeric(5,2) NOT NULL CHECK (payable_hours > 0 AND payable_hours <= actual_hours),
  approval_ref text NOT NULL CHECK (length(btrim(approval_ref)) BETWEEN 1 AND 300),
  note text NOT NULL DEFAULT '' CHECK (length(note) <= 1000),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','void')),
  rate_id uuid REFERENCES teaching_pay_private.rates(id),
  hourly_rate numeric(12,2),
  currency text,
  amount numeric(14,2),
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  approved_by uuid,
  approved_at timestamptz,
  CHECK (ends_at > starts_at),
  CHECK (actual_hours <= extract(epoch FROM (ends_at - starts_at))/3600 + 0.005),
  CHECK ((status = 'approved' AND rate_id IS NOT NULL AND hourly_rate > 0
    AND currency IS NOT NULL AND amount = round(payable_hours * hourly_rate, 2)
    AND approved_by IS NOT NULL AND approved_at IS NOT NULL)
    OR (status IN ('draft','void') AND rate_id IS NULL AND hourly_rate IS NULL
      AND currency IS NULL AND amount IS NULL AND approved_by IS NULL AND approved_at IS NULL))
);
CREATE INDEX ON teaching_pay_private.executions(college_id,term_id,work_date);
CREATE INDEX ON teaching_pay_private.executions(identity_id,work_date) WHERE status <> 'void';
ALTER TABLE teaching_pay_private.rates ENABLE ROW LEVEL SECURITY;
ALTER TABLE teaching_pay_private.executions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA teaching_pay_private FROM PUBLIC, anon, authenticated;

CREATE FUNCTION public.teaching_payroll(p_college_id uuid, p_action text, p_payload jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public','pg_temp'
AS $function$
DECLARE
  v_university uuid; v_term uuid; v_identity uuid; v_program uuid;
  h record; p record; t record; e teaching_pay_private.executions%ROWTYPE;
  r teaching_pay_private.rates%ROWTYPE; v_id uuid; v_date date;
  v_start time; v_end time; v_actual numeric; v_payable numeric;
  v_kind text; v_system text; v_expected text; v_result jsonb;
BEGIN
  IF auth.uid() IS NULL OR public.has_role(auth.uid(),'super_admin') IS NOT TRUE THEN
    RAISE EXCEPTION 'هذه العملية متاحة للأدمن العام فقط' USING ERRCODE='42501';
  END IF;
  SELECT university_id INTO v_university FROM public.colleges WHERE id=p_college_id;
  IF v_university IS NULL THEN RAISE EXCEPTION 'الكلية غير صالحة'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload) <> 'object' THEN RAISE EXCEPTION 'بيانات غير صالحة'; END IF;
  IF p_action = 'read' THEN
    v_term := nullif(p_payload->>'term_id','')::uuid;
    IF v_term IS NOT NULL AND NOT EXISTS (SELECT 1 FROM public.academic_terms WHERE id=v_term AND college_id=p_college_id) THEN
      RAISE EXCEPTION 'الفصل لا يتبع الكلية';
    END IF;
    IF (SELECT count(*) FROM teaching_pay_private.executions WHERE college_id=p_college_id AND term_id=v_term) > 10000 THEN
      RAISE EXCEPTION 'تجاوز السجل حد العرض؛ يلزم تقسيم التقرير قبل المتابعة';
    END IF;
    SELECT jsonb_build_object(
      'terms',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.start_date DESC NULLS LAST) FROM
        (SELECT id,name,start_date,end_date,is_active FROM public.academic_terms WHERE college_id=p_college_id) x),'[]'::jsonb),
      'programs',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.name) FROM
        (SELECT ap.id,ap.name,ap.department_id,d.name department_name
         FROM public.academic_programs ap JOIN public.departments d ON d.id=ap.department_id
         WHERE ap.college_id=p_college_id AND NOT ap.is_archived) x),'[]'::jsonb),
      'instructors',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.name) FROM
        (SELECT hp.identity_id id,hp.full_name name,hp.academic_rank rank,hp.university_number,
          CASE faculty_private.quota_applicability(hp.type_code,hp.employment_type)
            WHEN true THEN 'overload' WHEN false THEN 'contractual' END kind
         FROM faculty_private.home_profiles hp
         WHERE hp.university_id=v_university AND EXISTS (
           SELECT 1 FROM public.faculty_identity_links l JOIN public.v_instructor_delivery_workload w ON w.instructor_id=l.instructor_id
           WHERE l.identity_id=hp.identity_id AND w.college_id=p_college_id AND w.term_id=v_term AND w.standard_assigned_hours > 0)) x),'[]'::jsonb),
      'rates',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.effective_from DESC,x.rank) FROM
        (SELECT id,rank,kind,system,effective_from,hourly_rate,currency,decision_ref FROM teaching_pay_private.rates WHERE university_id=v_university) x),'[]'::jsonb),
      'entries',coalesce((SELECT jsonb_agg(to_jsonb(x) ORDER BY x.work_date DESC,x.instructor_name) FROM
        (SELECT * FROM teaching_pay_private.executions WHERE college_id=p_college_id AND term_id=v_term) x),'[]'::jsonb)
    ) INTO v_result;
    RETURN v_result;
  ELSIF p_action = 'save_rate' THEN
    -- Append only. A new effective date never rewrites an approved amount.
    INSERT INTO teaching_pay_private.rates(university_id,rank,kind,system,effective_from,hourly_rate,currency,decision_ref,created_by)
    VALUES(v_university,p_payload->>'rank',p_payload->>'kind',p_payload->>'system',
      (p_payload->>'effective_from')::date,(p_payload->>'hourly_rate')::numeric,
      upper(btrim(p_payload->>'currency')),btrim(p_payload->>'decision_ref'),auth.uid()) RETURNING id INTO v_id;
  ELSIF p_action = 'save_execution' THEN
    v_term := (p_payload->>'term_id')::uuid;
    v_identity := (p_payload->>'identity_id')::uuid;
    v_program := (p_payload->>'program_id')::uuid;
    v_kind := p_payload->>'kind'; v_system := p_payload->>'system';
    v_date := (p_payload->>'work_date')::date;
    v_start := (p_payload->>'starts_at')::time; v_end := (p_payload->>'ends_at')::time;
    v_actual := (p_payload->>'actual_hours')::numeric;
    v_payable := (p_payload->>'payable_hours')::numeric;
    IF v_date IS NULL OR v_date > (now() AT TIME ZONE 'Asia/Riyadh')::date THEN
      RAISE EXCEPTION 'أدخل تاريخ تنفيذ فعلي؛ لا تقبل التواريخ المستقبلية';
    END IF;
    SELECT * INTO t FROM public.academic_terms WHERE id=v_term AND college_id=p_college_id;
    IF NOT FOUND OR (t.start_date IS NOT NULL AND v_date<t.start_date) OR (t.end_date IS NOT NULL AND v_date>t.end_date) THEN
      RAISE EXCEPTION 'تاريخ التنفيذ خارج الفصل المختار';
    END IF;
    SELECT ap.*,d.name department_name INTO p FROM public.academic_programs ap
      JOIN public.departments d ON d.id=ap.department_id AND d.college_id=ap.college_id
      WHERE ap.id=v_program AND ap.college_id=p_college_id AND NOT ap.is_archived;
    IF NOT FOUND THEN RAISE EXCEPTION 'البرنامج لا يتبع الكلية'; END IF;
    SELECT * INTO h FROM faculty_private.home_profiles WHERE identity_id=v_identity AND university_id=v_university;
    IF NOT FOUND OR nullif(btrim(h.academic_rank),'') IS NULL THEN RAISE EXCEPTION 'بيانات المحاضر أو رتبته غير مكتملة'; END IF;
    v_expected := CASE faculty_private.quota_applicability(h.type_code,h.employment_type) WHEN true THEN 'overload' WHEN false THEN 'contractual' END;
    IF v_expected IS NULL OR v_kind IS DISTINCT FROM v_expected THEN
      RAISE EXCEPTION 'نوع الاستحقاق لا يطابق تصنيف المحاضر المعتمد';
    END IF;
    IF p_payload->>'certified' IS DISTINCT FROM 'true' THEN RAISE EXCEPTION 'يلزم الإقرار باعتماد التنفيذ والساعات المستحقة بعد استيفاء النصاب'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.faculty_identity_links l
      JOIN public.v_instructor_delivery_workload w ON w.instructor_id=l.instructor_id
      JOIN public.academic_cohorts ac ON ac.id=w.cohort_id
      WHERE l.identity_id=v_identity AND w.college_id=p_college_id AND w.term_id=v_term
        AND ac.program_id=v_program AND ac.study_system=v_system AND w.standard_assigned_hours>0) THEN
      RAISE EXCEPTION 'لا يوجد إسناد محتسب للمحاضر في البرنامج والنظام والفصل المختار';
    END IF;
    -- Serialize every creation for one canonical lecturer, across colleges and systems.
    PERFORM pg_advisory_xact_lock(hashtextextended('teaching-pay:'||v_identity::text,0));
    IF EXISTS (SELECT 1 FROM teaching_pay_private.executions WHERE identity_id=v_identity AND status<>'void'
      AND work_date=v_date AND starts_at<v_end AND ends_at>v_start) THEN
      RAISE EXCEPTION 'سبق تسجيل تنفيذ متداخل لهذا المحاضر؛ المحاضرة المدمجة تسجل مرة واحدة فقط';
    END IF;
    INSERT INTO teaching_pay_private.executions(college_id,term_id,identity_id,instructor_name,university_number,rank,
      department_id,department_name,program_id,program_name,kind,system,work_date,starts_at,ends_at,
      actual_hours,payable_hours,approval_ref,note,created_by)
    VALUES(p_college_id,v_term,v_identity,h.full_name,h.university_number,h.academic_rank,p.department_id,p.department_name,
      p.id,p.name,v_kind,v_system,v_date,v_start,v_end,v_actual,v_payable,btrim(p_payload->>'approval_ref'),
      coalesce(p_payload->>'note',''),auth.uid()) RETURNING id INTO v_id;
  ELSIF p_action IN ('approve','void') THEN
    v_id := (p_payload->>'id')::uuid;
    SELECT * INTO e FROM teaching_pay_private.executions WHERE id=v_id AND college_id=p_college_id FOR UPDATE;
    IF NOT FOUND OR e.status <> 'draft' THEN RAISE EXCEPTION 'السجل غير متاح أو سبق اعتماده أو إلغاؤه؛ حدّث الصفحة'; END IF;
    IF p_action='void' THEN
      IF length(btrim(coalesce(p_payload->>'reason',''))) NOT BETWEEN 1 AND 1000 THEN RAISE EXCEPTION 'سبب الإلغاء مطلوب'; END IF;
      UPDATE teaching_pay_private.executions SET status='void' WHERE id=v_id;
    ELSE
      SELECT * INTO h FROM faculty_private.home_profiles WHERE identity_id=e.identity_id AND university_id=v_university;
      v_expected := CASE faculty_private.quota_applicability(h.type_code,h.employment_type) WHEN true THEN 'overload' WHEN false THEN 'contractual' END;
      IF NOT FOUND OR h.academic_rank IS DISTINCT FROM e.rank OR v_expected IS DISTINCT FROM e.kind THEN
        RAISE EXCEPTION 'تغيرت رتبة المحاضر أو تصنيفه؛ ألغ المسودة وأعد إدخالها بالبيانات المعتمدة';
      END IF;
      SELECT * INTO r FROM teaching_pay_private.rates WHERE university_id=v_university AND rank=e.rank AND kind=e.kind
        AND system=e.system AND effective_from<=e.work_date ORDER BY effective_from DESC LIMIT 1;
      IF NOT FOUND THEN RAISE EXCEPTION 'لا يوجد سعر نافذ لهذه الرتبة والنوع والنظام في تاريخ التنفيذ'; END IF;
      -- Optimistic price check makes the reviewed amount binding even with concurrent rate creation.
      IF r.id IS DISTINCT FROM (p_payload->>'rate_id')::uuid THEN RAISE EXCEPTION 'تغير السعر أو لم تتم مراجعته؛ حدّث البيانات وراجع المبلغ'; END IF;
      UPDATE teaching_pay_private.executions SET status='approved',rate_id=r.id,hourly_rate=r.hourly_rate,
        currency=r.currency,amount=round(payable_hours*r.hourly_rate,2),approved_by=auth.uid(),approved_at=now() WHERE id=v_id;
    END IF;
  ELSE
    RAISE EXCEPTION 'عملية غير معروفة';
  END IF;
  INSERT INTO public.audit_logs(actor_id,college_id,action,entity,entity_id,details)
    VALUES(auth.uid(),p_college_id,'teaching_pay_'||p_action,'teaching_payroll',v_id,
      jsonb_build_object('reason',p_payload->>'reason','reference',coalesce(p_payload->>'approval_ref',p_payload->>'decision_ref')));
  RETURN jsonb_build_object('id',v_id,'ok',true);
END
$function$;
REVOKE ALL ON FUNCTION public.teaching_payroll(uuid,text,jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.teaching_payroll(uuid,text,jsonb) TO authenticated;
