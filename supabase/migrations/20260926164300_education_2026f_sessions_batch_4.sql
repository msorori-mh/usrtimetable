-- Exact source rows; sourced slots and substitutions are recorded on each source cell.
BEGIN;
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R19-L4','4552a689-c0d8-510d-b8ff-63e6640753aa'::uuid,NULL,4::smallint,'12:00'::time,'e1b07fa2-e88e-47a7-a7b7-fb6d0d40544d'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-CHEM-R20-L2',NULL,'اسماء',1::smallint,'12:00'::time,'2809d5f3-10ca-457f-be04-ea887e716bb8'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R04-L1','e7dc2cf9-4e6a-592e-9e97-db2cd3fe37f7'::uuid,NULL,6::smallint,'08:00'::time,'d3f3d7bb-10a6-4682-b1b3-d7447314c7e3'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R04-L4','9d59c9f7-aebf-4535-8f8b-3d57cd1eddb5'::uuid,NULL,6::smallint,'08:00'::time,'8f73eb57-4fbb-47d1-a401-cc2e70d70c8e'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R05-L1',NULL,'جلالالبعداني',6::smallint,'10:00'::time,'d3f3d7bb-10a6-4682-b1b3-d7447314c7e3'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R05-L4','70ac5da1-6613-478f-80b2-68e0bc601284'::uuid,NULL,6::smallint,'10:00'::time,'e1b07fa2-e88e-47a7-a7b7-fb6d0d40544d'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R06-L1','3407f68e-a6d1-563c-b23d-b1fe5c594211'::uuid,NULL,6::smallint,'12:00'::time,'d3f3d7bb-10a6-4682-b1b3-d7447314c7e3'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R06-L4',NULL,'دياسرالوجيه',6::smallint,'12:00'::time,'8f73eb57-4fbb-47d1-a401-cc2e70d70c8e'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R07-L1','461f86f1-fab8-4ff9-bb40-5e7cb5d8159d'::uuid,NULL,0::smallint,'08:00'::time,'d3f3d7bb-10a6-4682-b1b3-d7447314c7e3'::uuid);
SELECT public.education_2026f_import_named_row('EDU-2026F-ISL-R07-L4','4552a689-c0d8-510d-b8ff-63e6640753aa'::uuid,NULL,0::smallint,'08:00'::time,'8f73eb57-4fbb-47d1-a401-cc2e70d70c8e'::uuid);
SET CONSTRAINTS ALL IMMEDIATE;
COMMIT;
