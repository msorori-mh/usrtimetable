-- Source-of-teaching reporting is independent from financial quota eligibility.
-- An explicit visiting-college category and a different known home college
-- establish the source even when the employment contract has not been entered.
CREATE OR REPLACE FUNCTION faculty_private.reporting_category(p_home uuid, p_college uuid, p_type text, p_employment text)
RETURNS text LANGUAGE sql STABLE SET search_path TO 'public', 'pg_temp' AS $$
 SELECT CASE
  WHEN faculty_private.quota_applicability(p_type,p_employment) IS FALSE THEN 'contractual'
  WHEN p_type='from_other_college' AND p_home IS NOT NULL AND p_home<>p_college THEN 'other_college'
  WHEN faculty_private.quota_applicability(p_type,p_employment) IS NULL OR p_home IS NULL THEN 'unknown'
  WHEN p_home=p_college THEN 'internal' ELSE 'other_college' END
$$;
REVOKE ALL ON FUNCTION faculty_private.reporting_category(uuid,uuid,text,text) FROM PUBLIC,anon,authenticated;
