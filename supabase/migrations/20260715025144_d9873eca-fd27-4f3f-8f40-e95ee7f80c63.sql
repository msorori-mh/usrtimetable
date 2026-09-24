CREATE OR REPLACE FUNCTION public._ss_pack(p_conflicts jsonb,p_vid uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path=public AS $$
DECLARE c jsonb; item jsonb; enr jsonb:='[]'::jsonb; blk jsonb:='[]'::jsonb;
  appr jsonb:='[]'::jsonb; warn jsonb:='[]'::jsonb; ok boolean; eid uuid; ereas text;
  prim uuid; sec uuid;
BEGIN
  FOR c IN SELECT elem FROM jsonb_array_elements(COALESCE(p_conflicts,'[]'::jsonb)) t(elem)
  LOOP
    prim:=NULLIF(c->>'schedule_session_id','')::uuid;
    sec:=CASE WHEN c->>'related_session_id' IS NULL OR c->>'related_session_id'='null' THEN NULL
      ELSE (c->>'related_session_id')::uuid END;
    SELECT * INTO ok,eid,ereas FROM public._ss_ex_match(p_vid,c->>'code',prim,sec);
    item:=c||jsonb_build_object('approved_exception',ok,'exception_id',eid,'exception_reason',ereas);
    enr:=enr||jsonb_build_array(item);
    IF COALESCE(c->>'severity','hard')='soft' THEN warn:=warn||jsonb_build_array(item);
    ELSIF ok THEN appr:=appr||jsonb_build_array(item);
    ELSE blk:=blk||jsonb_build_array(item); END IF;
  END LOOP;
  RETURN jsonb_build_object('all_conflicts',enr,'blocking_conflicts',blk,
    'approved_exceptions',appr,'warnings',warn);
END;$$;
REVOKE ALL ON FUNCTION public._ss_pack(jsonb,uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._ss_pack(jsonb,uuid) TO service_role;