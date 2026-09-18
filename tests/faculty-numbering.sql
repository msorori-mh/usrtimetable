-- Disposable PostgreSQL fixture only. No production data or identities.
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT nullif(current_setting('test.actor',true),'')::uuid $$;
CREATE TABLE universities(id uuid PRIMARY KEY,code text);
CREATE TABLE colleges(id uuid PRIMARY KEY,university_id uuid,code text);
CREATE TABLE instructors(id uuid PRIMARY KEY,college_id uuid,affiliation_college_id uuid,employee_number text,full_name text,created_at timestamptz DEFAULT now());
CREATE TABLE audit_logs(actor_id uuid,action text,entity text,entity_id uuid,details jsonb);
CREATE FUNCTION is_super_admin(p uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT p='00000000-0000-0000-0000-000000000001'::uuid $$;
CREATE FUNCTION can_view_college(p uuid,c uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT is_super_admin(p) OR (p='00000000-0000-0000-0000-000000000002'::uuid AND c='00000000-0000-0000-0000-000000000011'::uuid) $$;
INSERT INTO universities VALUES ('447f6cef-4584-4299-83e0-be2254232375',null);
INSERT INTO colleges VALUES ('00000000-0000-0000-0000-000000000011','447f6cef-4584-4299-83e0-be2254232375','ITCS'),('00000000-0000-0000-0000-000000000012','447f6cef-4584-4299-83e0-be2254232375','hum');
INSERT INTO instructors VALUES ('00000000-0000-0000-0000-000000000021','00000000-0000-0000-0000-000000000011','00000000-0000-0000-0000-000000000012','OLD-1','Same name',now()),('00000000-0000-0000-0000-000000000022','00000000-0000-0000-0000-000000000012','00000000-0000-0000-0000-000000000012',null,'Same name',now());
CREATE TABLE before_instructors AS SELECT * FROM instructors;
