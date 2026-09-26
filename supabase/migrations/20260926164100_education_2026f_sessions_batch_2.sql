-- Exact source rows; sourced slots and substitutions are recorded on each source cell.
BEGIN;
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R09-L3',NULL,'اسماء',1::smallint,'08:00'::time,'2809d5f3-10ca-457f-be04-ea887e716bb8'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R10-L1',NULL,'اسماء',1::smallint,'10:00'::time,'2809d5f3-10ca-457f-be04-ea887e716bb8'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R10-L3','e67b2167-5faf-5ea4-a2ca-c2604ad23bc4'::uuid,NULL,6::smallint,'08:00'::time,'e1b07fa2-e88e-47a7-a7b7-fb6d0d40544d'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R10-L4',NULL,'دفارس',1::smallint,'10:00'::time,'e1b07fa2-e88e-47a7-a7b7-fb6d0d40544d'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R11-L4',NULL,'دمحمد',1::smallint,'12:00'::time,'e1b07fa2-e88e-47a7-a7b7-fb6d0d40544d'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R12-L1',NULL,'أسبأ',2::smallint,'08:00'::time,'d3f3d7bb-10a6-4682-b1b3-d7447314c7e3'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R12-L3',NULL,'دعبدالباسط',2::smallint,'08:00'::time,'a525ec27-e969-4d53-8873-f7ebdadaa231'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R12-L4',NULL,'تيسير',2::smallint,'08:00'::time,'2809d5f3-10ca-457f-be04-ea887e716bb8'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R13-L1',NULL,'EDU-2026F-CHEM-R13-L1',2::smallint,'10:00'::time,'640f6651-0c74-474f-bdd2-f14eb646807c'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R13-L2','c6bc68ab-8890-43f2-8a9b-ed321c31e78e'::uuid,NULL,2::smallint,'08:00'::time,'8bff90de-21aa-4708-9a85-5c0592ac914c'::uuid);
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
