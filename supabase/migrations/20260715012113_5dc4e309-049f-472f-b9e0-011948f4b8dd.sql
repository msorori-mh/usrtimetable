CREATE TABLE IF NOT EXISTS public._phase6_b64_stage (seq int PRIMARY KEY, chunk text NOT NULL);
GRANT ALL ON public._phase6_b64_stage TO service_role;
ALTER TABLE public._phase6_b64_stage ENABLE ROW LEVEL SECURITY;
TRUNCATE public._phase6_b64_stage;