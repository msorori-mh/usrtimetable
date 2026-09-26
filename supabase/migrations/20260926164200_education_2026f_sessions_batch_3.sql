-- Exact source rows; sourced slots and substitutions are recorded on each source cell.
BEGIN;
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R13-L3',NULL,'دمالعواضي',2::smallint,'12:00'::time,'d3f3d7bb-10a6-4682-b1b3-d7447314c7e3'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R14-L1',NULL,'أبغداد',2::smallint,'12:00'::time,'4fcdb7e8-e358-48e6-afa1-0d0e3ff0ad8d'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R14-L3',NULL,'تيسير',6::smallint,'12:00'::time,'2809d5f3-10ca-457f-be04-ea887e716bb8'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R14-L4','a2ac7d65-39f0-5c79-9992-a8383dbe47b8'::uuid,NULL,2::smallint,'12:00'::time,'8cfa4c00-ff65-46b3-bdaa-7fb1a57bdc4f'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R15-L2',NULL,'دعبدالباسط',3::smallint,'08:00'::time,'35355e05-f45a-4f35-875e-3dec562574cd'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R16-L2','d174e491-1604-5cd4-9dd5-43b4953c3cbe'::uuid,NULL,3::smallint,'10:00'::time,'e1b07fa2-e88e-47a7-a7b7-fb6d0d40544d'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R17-L2',NULL,'أفؤاد',3::smallint,'12:00'::time,'2809d5f3-10ca-457f-be04-ea887e716bb8'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R18-L2',NULL,'أفؤاد',4::smallint,'10:00'::time,'2809d5f3-10ca-457f-be04-ea887e716bb8'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R18-L4','d174e491-1604-5cd4-9dd5-43b4953c3cbe'::uuid,NULL,4::smallint,'08:00'::time,'e1b07fa2-e88e-47a7-a7b7-fb6d0d40544d'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R19-L2',NULL,'تيسير',4::smallint,'12:00'::time,'2809d5f3-10ca-457f-be04-ea887e716bb8'::uuid);
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
