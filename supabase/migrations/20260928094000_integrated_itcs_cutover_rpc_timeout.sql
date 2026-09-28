-- PostgREST hoists this function setting before executing the RPC. Setting a
-- timeout inside preflight is too late to replace the incoming eight-second
-- deadline. Bound this administrative atomic batch to the API's 60s ceiling.
-- The ordinary role timeouts, authorization and all validation stay intact.
-- https://docs.postgrest.org/en/v13/references/transactions.html#hoisted-function-settings
BEGIN;
ALTER FUNCTION public.itcs_cutover_execute(text,uuid,uuid,jsonb,text,text)
 SET statement_timeout TO '60s';
NOTIFY pgrst, 'reload schema';
COMMIT;
