-- Exact source rows; sourced slots and substitutions are recorded on each source cell.
BEGIN;
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R21-L2','6b402783-a116-52d5-870f-45ba01509480'::uuid,NULL,0::smallint,'08:00'::time,'a525ec27-e969-4d53-8873-f7ebdadaa231'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R21-L3','380820e8-d0c0-4a33-acf7-b7dd4963cc2b'::uuid,NULL,6::smallint,'12:00'::time,'640f6651-0c74-474f-bdd2-f14eb646807c'::uuid);
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
