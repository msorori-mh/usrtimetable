-- Exact source rows; sourced slots and substitutions are recorded on each source cell.
BEGIN;
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R14-L2','41026e72-403b-5af3-bd1c-316b3c73ef1d'::uuid,NULL,6::smallint,'10:00'::time,'35355e05-f45a-4f35-875e-3dec562574cd'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R14-L3',NULL,'جلالالبعداني',6::smallint,'12:00'::time,'35355e05-f45a-4f35-875e-3dec562574cd'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R15-L2',NULL,'دداعر',0::smallint,'12:00'::time,'8bff90de-21aa-4708-9a85-5c0592ac914c'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R16-L2',NULL,'دحسينالتركي',3::smallint,'08:00'::time,'d3f3d7bb-10a6-4682-b1b3-d7447314c7e3'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R17-L3','41026e72-403b-5af3-bd1c-316b3c73ef1d'::uuid,NULL,3::smallint,'10:00'::time,'d3f3d7bb-10a6-4682-b1b3-d7447314c7e3'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R18-L3',NULL,'دعارفبحيبح',3::smallint,'12:00'::time,'e1b07fa2-e88e-47a7-a7b7-fb6d0d40544d'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R19-L2',NULL,'جلالالبعداني',4::smallint,'08:00'::time,'d3f3d7bb-10a6-4682-b1b3-d7447314c7e3'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R19-L3',NULL,'دمباركالقطمي',4::smallint,'10:00'::time,'e1b07fa2-e88e-47a7-a7b7-fb6d0d40544d'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R20-L2',NULL,'دمباركالقطمي',4::smallint,'12:00'::time,'d3f3d7bb-10a6-4682-b1b3-d7447314c7e3'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R20-L3','6b402783-a116-52d5-870f-45ba01509480'::uuid,NULL,4::smallint,'10:00'::time,'d3f3d7bb-10a6-4682-b1b3-d7447314c7e3'::uuid);
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
