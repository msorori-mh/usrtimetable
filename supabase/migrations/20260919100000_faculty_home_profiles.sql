-- Current home is independent of the immutable issuing college and operational row owner.
-- No operational instructors, assignments, groups or sessions are moved or deleted.
CREATE SCHEMA IF NOT EXISTS faculty_private;
REVOKE ALL ON SCHEMA faculty_private FROM PUBLIC,anon,authenticated;
CREATE TABLE public.faculty_home_decisions (
 identity_id uuid PRIMARY KEY REFERENCES public.faculty_identities(id),
 home_college_id uuid NOT NULL REFERENCES public.colleges(id),
 source_instructor_id uuid NOT NULL REFERENCES public.instructors(id),
 quota_confirmed boolean NOT NULL DEFAULT false,
 evidence text NOT NULL CHECK(length(btrim(evidence))>=10),
 decided_by uuid NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.faculty_home_decisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.faculty_home_decisions FROM PUBLIC,anon,authenticated;

CREATE VIEW faculty_private.home_profiles AS
WITH members AS (
 SELECT l.identity_id,i.*,t.code AS type_code
 FROM public.faculty_identity_links l JOIN public.instructors i ON i.id=l.instructor_id
 LEFT JOIN public.instructor_types t ON t.id=i.instructor_type_id
), homes AS (
 SELECT identity_id,
   CASE WHEN count(DISTINCT affiliation_college_id)=1
     AND bool_and(affiliation_college_id IS NOT NULL)
     AND NOT bool_or(coalesce(type_code,'')='from_other_college' AND affiliation_college_id=college_id)
   THEN min(affiliation_college_id::text)::uuid END AS home_id
 FROM members GROUP BY identity_id
), resolved AS (
 SELECT h.identity_id,coalesce(d.home_college_id,h.home_id) AS home_college_id,
 d.source_instructor_id AS approved_source,d.quota_confirmed,d.updated_at AS decision_at
 FROM homes h LEFT JOIN public.faculty_home_decisions d USING(identity_id)
)
SELECT r.identity_id,f.university_id,f.university_number,r.home_college_id,
 c.name AS home_college_name,s.id AS source_instructor_id,
 coalesce(s.full_name_ar,s.full_name) AS full_name,s.academic_rank,s.employment_type,s.is_active,
 s.type_code,s.specialization,s.max_weekly_hours AS recorded_quota,
 s.administrative_release_hours AS recorded_release,
 CASE WHEN r.home_college_id IS NOT NULL AND (
   (r.approved_source IS NOT NULL AND r.quota_confirmed) OR
   (r.approved_source IS NULL AND s.college_id=r.home_college_id AND NOT EXISTS(
      SELECT 1 FROM members m WHERE m.identity_id=r.identity_id AND m.college_id=r.home_college_id
       AND (m.max_weekly_hours IS DISTINCT FROM s.max_weekly_hours
         OR m.administrative_release_hours IS DISTINCT FROM s.administrative_release_hours))))
   AND s.max_weekly_hours IS NOT NULL
 THEN greatest(0,s.max_weekly_hours-coalesce(s.administrative_release_hours,0)) END AS quota,
 CASE WHEN r.home_college_id IS NULL THEN 'pending' WHEN r.approved_source IS NOT NULL THEN 'verified' ELSE 'declared' END AS affiliation_status,
 r.decision_at
FROM resolved r JOIN public.faculty_identities f ON f.id=r.identity_id
LEFT JOIN public.colleges c ON c.id=r.home_college_id
LEFT JOIN LATERAL (
 SELECT m.* FROM members m WHERE m.identity_id=r.identity_id
 ORDER BY (m.id=r.approved_source) DESC NULLS LAST,
   (m.college_id=r.home_college_id) DESC NULLS LAST,m.is_active DESC,m.created_at,m.id LIMIT 1
) s ON true;
REVOKE ALL ON faculty_private.home_profiles FROM PUBLIC,anon,authenticated;

CREATE FUNCTION public.get_faculty_home_profiles(p_college_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_uid uuid:=auth.uid(); v_result jsonb;
BEGIN
 IF v_uid IS NULL OR (p_college_id IS NULL AND NOT (is_super_admin(v_uid) OR has_role(v_uid,'university_leadership')))
 OR (p_college_id IS NOT NULL AND NOT can_view_college(v_uid,p_college_id)) THEN
 RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object(
   'identity_id',h.identity_id,'university_number',h.university_number,'name',h.full_name,
   'home_college_id',h.home_college_id,'home_college',h.home_college_name,
   'source_instructor_id',CASE WHEN is_super_admin(v_uid) OR can_manage_college(v_uid,h.home_college_id) THEN h.source_instructor_id END,
   'status',h.affiliation_status,'quota',h.quota,'decision_at',h.decision_at,
   'academic_rank',h.academic_rank,'category',h.type_code,'is_active',h.is_active,
   'specialization',h.specialization,'employment_type',h.employment_type,
   'home_department',(SELECT d.name FROM instructors i JOIN departments d ON d.id=i.affiliation_department_id
     WHERE i.id=h.source_instructor_id AND d.college_id=h.home_college_id),
   'members',(SELECT coalesce(jsonb_agg(jsonb_build_object('id',i.id,'name',coalesce(i.full_name_ar,i.full_name),
      'college_id',i.college_id,'college',c.name,'recorded_quota',i.max_weekly_hours,
      'recorded_release',i.administrative_release_hours) ORDER BY i.id),'[]')
      FROM faculty_identity_links l JOIN instructors i ON i.id=l.instructor_id JOIN colleges c ON c.id=i.college_id
      WHERE l.identity_id=h.identity_id AND (is_super_admin(v_uid) OR i.college_id=p_college_id))
 ) ORDER BY h.full_name),'[]') INTO v_result
 FROM faculty_private.home_profiles h
 WHERE p_college_id IS NULL OR h.home_college_id=p_college_id OR EXISTS(
   SELECT 1 FROM faculty_identity_links l JOIN instructors i ON i.id=l.instructor_id
   WHERE l.identity_id=h.identity_id AND i.college_id=p_college_id) OR EXISTS(
   SELECT 1 FROM faculty_identity_links l JOIN teaching_assignments a ON a.instructor_id=l.instructor_id
   WHERE l.identity_id=h.identity_id AND a.college_id=p_college_id AND a.is_active);
 RETURN v_result;
END $$;

CREATE FUNCTION public.reconcile_faculty_home(p_identity_id uuid,p_home_college_id uuid,
 p_source_instructor_id uuid,p_quota_confirmed boolean,p_evidence text,p_expected_decision_at timestamptz DEFAULT NULL)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v_old public.faculty_home_decisions%ROWTYPE;v_members jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT is_super_admin(auth.uid()) THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
 PERFORM pg_advisory_xact_lock(180600,1);
 PERFORM 1 FROM faculty_identities WHERE id=p_identity_id FOR UPDATE;
 IF NOT FOUND THEN RAISE EXCEPTION 'FACULTY_IDENTITY_NOT_FOUND'; END IF;
 SELECT * INTO v_old FROM faculty_home_decisions WHERE identity_id=p_identity_id;
 IF v_old.updated_at IS DISTINCT FROM p_expected_decision_at THEN RAISE EXCEPTION 'STALE_FACULTY_DECISION'; END IF;
 IF length(btrim(coalesce(p_evidence,'')))<10 THEN RAISE EXCEPTION 'FACULTY_EVIDENCE_REQUIRED'; END IF;
 IF NOT EXISTS(SELECT 1 FROM faculty_identities f JOIN colleges c ON c.university_id=f.university_id
   WHERE f.id=p_identity_id AND c.id=p_home_college_id) OR NOT EXISTS(
   SELECT 1 FROM faculty_identity_links WHERE identity_id=p_identity_id AND instructor_id=p_source_instructor_id)
 THEN RAISE EXCEPTION 'FACULTY_HOME_OR_SOURCE_INVALID'; END IF;
 IF p_quota_confirmed AND NOT EXISTS(SELECT 1 FROM instructors WHERE id=p_source_instructor_id AND max_weekly_hours IS NOT NULL)
 THEN RAISE EXCEPTION 'FACULTY_QUOTA_REQUIRED'; END IF;
 SELECT jsonb_agg(jsonb_build_object('id',i.id,'affiliation_college_id',i.affiliation_college_id,
   'affiliation_department_id',i.affiliation_department_id)) INTO v_members
 FROM instructors i JOIN faculty_identity_links l ON l.instructor_id=i.id WHERE l.identity_id=p_identity_id;
 UPDATE instructors i SET affiliation_college_id=p_home_college_id,
 affiliation_department_id=CASE WHEN EXISTS(SELECT 1 FROM departments d WHERE d.id=i.affiliation_department_id AND d.college_id=p_home_college_id)
   THEN i.affiliation_department_id END
 WHERE EXISTS(SELECT 1 FROM faculty_identity_links l WHERE l.instructor_id=i.id AND l.identity_id=p_identity_id);
 INSERT INTO faculty_home_decisions(identity_id,home_college_id,source_instructor_id,quota_confirmed,evidence,decided_by)
 VALUES(p_identity_id,p_home_college_id,p_source_instructor_id,coalesce(p_quota_confirmed,false),btrim(p_evidence),auth.uid())
 ON CONFLICT(identity_id) DO UPDATE SET home_college_id=excluded.home_college_id,
 source_instructor_id=excluded.source_instructor_id,quota_confirmed=excluded.quota_confirmed,
 evidence=excluded.evidence,decided_by=excluded.decided_by,updated_at=clock_timestamp();
 INSERT INTO audit_logs(actor_id,action,entity,entity_id,college_id,details)
 VALUES(auth.uid(),'faculty_home_reconciled','faculty_identities',p_identity_id,p_home_college_id,
 jsonb_build_object('before',to_jsonb(v_old),'before_members',v_members,'source_instructor_id',p_source_instructor_id,
 'quota_confirmed',p_quota_confirmed,'evidence',btrim(p_evidence)));
END $$;

-- New records belong to the home college. Existing foreign records retain their IDs.
CREATE FUNCTION faculty_private.guard_instructor_home() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER
SET search_path=public,pg_temp AS $$
DECLARE v_home uuid; v_identity uuid;
BEGIN
 IF TG_OP='INSERT' THEN
   PERFORM pg_advisory_xact_lock(180600,1);
   IF NEW.affiliation_college_id IS NOT NULL AND NEW.affiliation_college_id<>NEW.college_id THEN
     RAISE EXCEPTION 'أضف المحاضر في كليته الأصلية ثم اطلب تكليفه من صفحة الإسناد';
   END IF;
   IF nullif(btrim(NEW.employee_number),'') IS NOT NULL AND EXISTS(
     SELECT 1 FROM instructors i JOIN colleges c ON c.id=i.college_id JOIN colleges nc ON nc.id=NEW.college_id
     WHERE c.university_id=nc.university_id AND btrim(i.employee_number)=btrim(NEW.employee_number)) THEN
     RAISE EXCEPTION 'الرقم الوظيفي موجود؛ استخدم المحاضر المسجل أو راجع ربط الهوية';
   END IF;
 ELSE
   IF NEW.college_id IS DISTINCT FROM OLD.college_id THEN RAISE EXCEPTION 'استخدم تسوية التبعية مع الحفاظ على سجل الإسنادات'; END IF;
   IF auth.uid() IS NOT NULL AND NOT is_super_admin(auth.uid())
     AND NEW.affiliation_college_id IS DISTINCT FROM OLD.affiliation_college_id THEN
     RAISE EXCEPTION 'تغيير الكلية الأصلية يتم بواسطة الأدمن من تسوية التبعية' USING ERRCODE='42501';
   END IF;
   SELECT h.home_college_id,h.identity_id INTO v_home,v_identity FROM faculty_private.home_profiles h
     JOIN faculty_identity_links l ON l.identity_id=h.identity_id WHERE l.instructor_id=OLD.id;
   IF auth.uid() IS NOT NULL AND NOT is_super_admin(auth.uid()) AND v_identity IS NOT NULL
     AND (v_home IS NULL OR v_home<>OLD.college_id) THEN
     RAISE EXCEPTION 'تعديل بيانات المحاضر من الكلية الأصلية أو بواسطة الأدمن فقط' USING ERRCODE='42501';
   END IF;
   -- Reconfirm a borrowed quota after its source changes; never keep a stale approval.
   IF NEW.max_weekly_hours IS DISTINCT FROM OLD.max_weekly_hours
      OR NEW.administrative_release_hours IS DISTINCT FROM OLD.administrative_release_hours THEN
     UPDATE faculty_home_decisions SET quota_confirmed=false,updated_at=clock_timestamp()
     WHERE source_instructor_id=OLD.id AND quota_confirmed;
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER zz_faculty_home_guard BEFORE INSERT OR UPDATE ON public.instructors
 FOR EACH ROW EXECUTE FUNCTION faculty_private.guard_instructor_home();
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA faculty_private FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.get_faculty_home_profiles(uuid) FROM PUBLIC,anon;
REVOKE ALL ON FUNCTION public.reconcile_faculty_home(uuid,uuid,uuid,boolean,text,timestamptz) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.get_faculty_home_profiles(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_faculty_home(uuid,uuid,uuid,boolean,text,timestamptz) TO authenticated;

CREATE FUNCTION public.find_faculty_for_registration(p_college_id uuid,p_name text,p_employee_number text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public,pg_temp AS $$
DECLARE v jsonb;
BEGIN
 IF auth.uid() IS NULL OR NOT can_manage_college(auth.uid(),p_college_id) THEN RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE='42501'; END IF;
 IF length(btrim(coalesce(p_name,'')))<3 AND nullif(btrim(p_employee_number),'') IS NULL THEN RETURN '[]'::jsonb; END IF;
 SELECT coalesce(jsonb_agg(x),'[]') INTO v FROM (
 SELECT h.university_number,h.full_name AS name,h.home_college_name AS home_college
 FROM faculty_private.home_profiles h JOIN colleges c ON c.university_id=h.university_id
 WHERE c.id=p_college_id AND (
  (length(btrim(coalesce(p_name,'')))>=3 AND strpos(regexp_replace(lower(h.full_name),'\s+',' ','g'),regexp_replace(lower(btrim(p_name)),'\s+',' ','g'))>0)
  OR (nullif(btrim(p_employee_number),'') IS NOT NULL AND EXISTS(SELECT 1 FROM faculty_identity_links l JOIN instructors i ON i.id=l.instructor_id
      WHERE l.identity_id=h.identity_id AND btrim(i.employee_number)=btrim(p_employee_number))))
 ORDER BY h.full_name LIMIT 20) x;
 RETURN v;
END $$;
REVOKE ALL ON FUNCTION public.find_faculty_for_registration(uuid,text,text) FROM PUBLIC,anon;
GRANT EXECUTE ON FUNCTION public.find_faculty_for_registration(uuid,text,text) TO authenticated;

CREATE OR REPLACE FUNCTION public.update_faculty_employment_number()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
DECLARE v_kind text; v_identity uuid; v_old text; v_new text; v_serial bigint;
BEGIN
  IF NEW.instructor_type_id IS NOT DISTINCT FROM OLD.instructor_type_id THEN RETURN NEW; END IF;
  SELECT CASE lower(code) WHEN 'permanent' THEN 'P' WHEN 'annual_contract' THEN 'C'
    WHEN 'con' THEN 'H' END INTO v_kind FROM public.instructor_types WHERE id=NEW.instructor_type_id;
  -- Unresolved/legacy categories never imply permanent employment.
  IF v_kind IS NULL THEN RETURN NEW; END IF;
  PERFORM pg_advisory_xact_lock(180600,1);
  SELECT l.identity_id,f.university_number INTO v_identity,v_old
    FROM public.faculty_identity_links l JOIN public.faculty_identities f ON f.id=l.identity_id
    WHERE l.instructor_id=NEW.id FOR UPDATE OF f;
  IF v_identity IS NULL THEN RETURN NEW; END IF;
  -- A secondary college must not change the university-wide employment classification.
  IF NOT EXISTS(SELECT 1 FROM faculty_private.home_profiles h WHERE h.identity_id=v_identity
    AND h.home_college_id IS NOT NULL AND h.source_instructor_id=NEW.id) THEN
    RAISE EXCEPTION 'غيّر الفئة الوظيفية من سجل الكلية الأصلية';
  END IF;
  IF split_part(v_old,'-',2)=v_kind THEN RETURN NEW; END IF;
  v_serial:=nextval('public.faculty_number_seq');
  v_new:=split_part(v_old,'-',1)||'-'||v_kind||'-'||lpad(v_serial::text,greatest(6,length(v_serial::text)),'0');
  INSERT INTO public.faculty_number_history(university_number,identity_id,replaced_by)
    VALUES(v_old,v_identity,auth.uid());
  UPDATE public.faculty_identities SET university_number=v_new WHERE id=v_identity;
  INSERT INTO public.audit_logs(actor_id,action,entity,entity_id,college_id,details)
    VALUES(auth.uid(),'faculty_employment_number_changed','instructors',NEW.id,NEW.college_id,
      jsonb_build_object('identity_id',v_identity,'previous_number',v_old,'university_number',v_new));
  RETURN NEW;
END $function$;
