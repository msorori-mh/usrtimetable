-- Exact source rows; sourced slots and substitutions are recorded on each source cell.
BEGIN;
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R03-L2',NULL,'دفارس',6::smallint,'08:00'::time,'a43a73a7-45e9-4404-9be2-56a87040638d'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R04-L2',NULL,'دمحمدالعواضي',6::smallint,'10:00'::time,'a43a73a7-45e9-4404-9be2-56a87040638d'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R05-L1',NULL,'دعدنان',6::smallint,'12:00'::time,'acfc4978-3cc2-47e5-82f8-f9332bd46ae1'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R05-L2',NULL,'امريمالمدني',6::smallint,'12:00'::time,'e1b07fa2-e88e-47a7-a7b7-fb6d0d40544d'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R06-L1','b6c9b4d5-76a7-5b3a-827e-cc381fd601c6'::uuid,NULL,0::smallint,'10:00'::time,'e1b07fa2-e88e-47a7-a7b7-fb6d0d40544d'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R06-L3','c9e33592-f985-52ea-8bc4-13e0532ccd8c'::uuid,NULL,0::smallint,'08:00'::time,'a43a73a7-45e9-4404-9be2-56a87040638d'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R07-L1',NULL,'ديحيى',0::smallint,'08:00'::time,'e1b07fa2-e88e-47a7-a7b7-fb6d0d40544d'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R07-L3',NULL,'أفؤاد',6::smallint,'10:00'::time,'2809d5f3-10ca-457f-be04-ea887e716bb8'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R08-L3',NULL,'دعبدالقادر',0::smallint,'12:00'::time,'35355e05-f45a-4f35-875e-3dec562574cd'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R09-L1','c9e33592-f985-52ea-8bc4-13e0532ccd8c'::uuid,NULL,1::smallint,'08:00'::time,'e1b07fa2-e88e-47a7-a7b7-fb6d0d40544d'::uuid);
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
