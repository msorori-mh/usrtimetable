-- Supporting departments are separate from academic departments and programs.
CREATE TABLE IF NOT EXISTS public.support_departments (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 college_id uuid NOT NULL REFERENCES public.colleges(id),
 name text NOT NULL CHECK (name=btrim(name) AND length(name) BETWEEN 1 AND 150),
 created_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(college_id,name)
);
ALTER TABLE public.support_departments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS support_departments_read ON public.support_departments;
CREATE POLICY support_departments_read ON public.support_departments FOR SELECT TO authenticated
 USING(public.can_view_college(auth.uid(),college_id));
DROP POLICY IF EXISTS support_departments_insert ON public.support_departments;
CREATE POLICY support_departments_insert ON public.support_departments FOR INSERT TO authenticated
 WITH CHECK(public.can_manage_college(auth.uid(),college_id));
DROP POLICY IF EXISTS support_departments_update ON public.support_departments;
CREATE POLICY support_departments_update ON public.support_departments FOR UPDATE TO authenticated
 USING(public.can_manage_college(auth.uid(),college_id))
 WITH CHECK(public.can_manage_college(auth.uid(),college_id));
REVOKE ALL ON public.support_departments FROM PUBLIC,anon,authenticated;
GRANT SELECT,INSERT ON public.support_departments TO authenticated;
GRANT UPDATE(name) ON public.support_departments TO authenticated;
ALTER TABLE public.instructors ADD COLUMN IF NOT EXISTS administrative_support_department_id uuid
 REFERENCES public.support_departments(id);
CREATE INDEX IF NOT EXISTS instructors_support_department_idx
 ON public.instructors(administrative_support_department_id)
 WHERE administrative_support_department_id IS NOT NULL;

-- Preserve the existing affiliation and hourly-contract rules.
CREATE OR REPLACE FUNCTION public.enforce_instructor_hr_affiliation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path=public AS $fn$
DECLARE v_dep_college uuid; v_admin_dep_college uuid; v_type_code text;
BEGIN
 NEW.affiliation_college_id:=COALESCE(NEW.affiliation_college_id,NEW.college_id);
 NEW.affiliation_department_id:=COALESCE(NEW.affiliation_department_id,NEW.department_id);
 IF NEW.affiliation_department_id IS NOT NULL THEN
  SELECT college_id INTO v_dep_college FROM public.departments WHERE id=NEW.affiliation_department_id;
  IF v_dep_college IS NULL OR v_dep_college<>NEW.affiliation_college_id THEN
   RAISE EXCEPTION 'affiliation_department_id must belong to affiliation_college_id';
  END IF;
 END IF;
 IF NEW.instructor_type_id IS NOT NULL THEN
  SELECT lower(code) INTO v_type_code FROM public.instructor_types WHERE id=NEW.instructor_type_id;
 END IF;
 IF COALESCE(v_type_code,'')='con' THEN
  NEW.administrative_release_hours:=0;
  NEW.administrative_position:=NULL;
 END IF;
 IF NEW.administrative_position='department_head' THEN
  IF (NEW.administrative_department_id IS NULL)=(NEW.administrative_support_department_id IS NULL) THEN
   RAISE EXCEPTION 'اختر قسماً أكاديمياً أو مسانداً واحداً لرئاسة القسم';
  END IF;
  IF NEW.administrative_support_department_id IS NOT NULL THEN
   SELECT college_id INTO v_admin_dep_college FROM public.support_departments
    WHERE id=NEW.administrative_support_department_id;
  ELSE
   SELECT college_id INTO v_admin_dep_college FROM public.departments
    WHERE id=NEW.administrative_department_id;
  END IF;
  IF v_admin_dep_college IS NULL OR v_admin_dep_college<>NEW.affiliation_college_id THEN
   RAISE EXCEPTION 'قسم الرئاسة يجب أن يتبع كلية التبعية المختارة';
  END IF;
 ELSE
  NEW.administrative_department_id:=NULL;
  NEW.administrative_support_department_id:=NULL;
 END IF;
 RETURN NEW;
END $fn$;
REVOKE ALL ON FUNCTION public.enforce_instructor_hr_affiliation() FROM PUBLIC,anon,authenticated;
NOTIFY pgrst,'reload schema';
