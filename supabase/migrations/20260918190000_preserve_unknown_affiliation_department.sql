-- Preserve unknown home department when the teaching department belongs to another college.
CREATE OR REPLACE FUNCTION public.enforce_instructor_hr_affiliation()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE v_dep_college uuid; v_admin_dep_college uuid; v_type_code text;
BEGIN
 NEW.affiliation_college_id:=COALESCE(NEW.affiliation_college_id,NEW.college_id);
 IF NEW.affiliation_department_id IS NULL AND NEW.department_id IS NOT NULL THEN
  SELECT college_id INTO v_dep_college FROM public.departments WHERE id=NEW.department_id;
  IF v_dep_college=NEW.affiliation_college_id THEN
   NEW.affiliation_department_id:=NEW.department_id;
  END IF;
 END IF;
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
END $function$;
