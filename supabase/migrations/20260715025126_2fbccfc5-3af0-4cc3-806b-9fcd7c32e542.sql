CREATE OR REPLACE FUNCTION public._ss_ex_match(
  p_vid uuid,p_code text,p_sid uuid,p_rid uuid, OUT ok boolean, OUT eid uuid, OUT ereas text
) LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
BEGIN
  ok:=false; eid:=NULL; ereas:=NULL;
  IF p_sid IS NULL THEN RETURN; END IF;
  IF p_rid IS NULL THEN
    SELECT id,reason INTO eid,ereas FROM public.schedule_version_conflict_exceptions
    WHERE schedule_version_id=p_vid AND conflict_code=p_code AND status='approved'
      AND session_id=p_sid AND related_session_id IS NULL LIMIT 1;
  ELSE
    SELECT id,reason INTO eid,ereas FROM public.schedule_version_conflict_exceptions
    WHERE schedule_version_id=p_vid AND conflict_code=p_code AND status='approved'
      AND related_session_id IS NOT NULL
      AND LEAST(session_id,related_session_id)=LEAST(p_sid,p_rid)
      AND GREATEST(session_id,related_session_id)=GREATEST(p_sid,p_rid) LIMIT 1;
  END IF;
  IF FOUND THEN ok:=true; ELSE eid:=NULL; ereas:=NULL; END IF;
END;$$;
REVOKE ALL ON FUNCTION public._ss_ex_match(uuid,text,uuid,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ss_ex_match(uuid,text,uuid,uuid) TO service_role;