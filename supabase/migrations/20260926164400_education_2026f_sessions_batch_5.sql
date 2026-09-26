-- Exact source rows; sourced slots and substitutions are recorded on each source cell.
BEGIN;
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R08-L1','6b402783-a116-52d5-870f-45ba01509480'::uuid,NULL,0::smallint,'10:00'::time,'d3f3d7bb-10a6-4682-b1b3-d7447314c7e3'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R08-L4',NULL,'جلالالبعداني',0::smallint,'10:00'::time,'8f73eb57-4fbb-47d1-a401-cc2e70d70c8e'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R10-L1','70ac5da1-6613-478f-80b2-68e0bc601284'::uuid,NULL,1::smallint,'10:00'::time,'8f73eb57-4fbb-47d1-a401-cc2e70d70c8e'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R10-L4','f9b49acb-e5a2-44e1-996d-1968d4b66ff5'::uuid,NULL,1::smallint,'08:00'::time,'323a9f1e-e281-4104-92ec-38e856f828bd'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R11-L1','9f48f373-4670-4ce8-90b4-7093cdd28e6d'::uuid,NULL,0::smallint,'12:00'::time,'d3f3d7bb-10a6-4682-b1b3-d7447314c7e3'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R11-L4','3c76884d-497e-5de3-b150-7c468002bed5'::uuid,NULL,1::smallint,'10:00'::time,'ed9cf660-29a0-4597-a2a5-1eb5fd19ea49'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R12-L1','00e344d0-bb02-4da8-a6c7-ad548bbfd93e'::uuid,NULL,2::smallint,'08:00'::time,'8f368a52-31eb-407a-9bb7-426e9f1918e4'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R12-L4',NULL,'دعليعويضان',1::smallint,'12:00'::time,'8f73eb57-4fbb-47d1-a401-cc2e70d70c8e'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R13-L2',NULL,'دعليعويضان',2::smallint,'12:00'::time,'315676a4-575c-4d2c-97c1-2bb4ee5ddf89'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R13-L3',NULL,'ياسرالوجيه',6::smallint,'08:00'::time,'35355e05-f45a-4f35-875e-3dec562574cd'::uuid);
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
