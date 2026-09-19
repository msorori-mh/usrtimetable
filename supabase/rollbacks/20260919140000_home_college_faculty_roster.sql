BEGIN;
CREATE OR REPLACE FUNCTION faculty_private.guard_instructor_home()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'pg_temp'
AS $function$
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
END $function$;

DROP FUNCTION public.update_home_college_instructor(uuid,timestamptz,uuid,text,text,text,text,text,text,text,text,integer,integer,boolean,uuid,uuid,uuid,text,uuid,uuid);
DROP FUNCTION public.get_college_faculty_roster(uuid,text);
DROP FUNCTION public.search_faculty_identity_candidates(uuid,text);
COMMIT;

