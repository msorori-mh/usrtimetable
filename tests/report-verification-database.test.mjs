import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
const { PGlite } = await import(process.env.VERIFY_DB_MODULE ?? "@electric-sql/pglite");
test("receipt permissions, public allowlist, withdrawal and stale-version detection", async () => {
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated;
 create schema auth;
 create function auth.uid() returns uuid language sql as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
 create table colleges(id uuid primary key,name text);
 create table academic_terms(id uuid primary key,college_id uuid,name text);
 create table schedule_versions(id uuid primary key,college_id uuid,academic_term_id uuid,name text,status text,eligibility_revision bigint default 1,updated_at timestamptz default now(),created_at timestamptz default now(),disposable_test boolean default false);
 create function can_view_college(u uuid,c uuid) returns boolean language sql as $$select u='11111111-1111-4111-8111-111111111111'::uuid and c='22222222-2222-4222-8222-222222222222'::uuid$$;
 insert into colleges values('22222222-2222-4222-8222-222222222222','College');
 insert into academic_terms values('33333333-3333-4333-8333-333333333333','22222222-2222-4222-8222-222222222222','Term');
 insert into schedule_versions(id,college_id,academic_term_id,name,status) values('44444444-4444-4444-8444-444444444444','22222222-2222-4222-8222-222222222222','33333333-3333-4333-8333-333333333333','Published','published');`);
    await db.exec(
      await readFile(
        new URL(
          "../supabase/migrations/20260918130000_public_report_verification.sql",
          import.meta.url,
        ),
        "utf8",
      ),
    );
    const rpc = async (name, arg) =>
      (await db.query(`select public.${name}(${arg}) as result`)).rows[0].result;
    const args = "'44444444-4444-4444-8444-444444444444','student'";
    await db.exec("set role anon");
    await assert.rejects(db.query("select * from report_verification_receipts"));
    await assert.rejects(rpc("issue_report_verification", args));
    assert.deepEqual(
      await rpc("resolve_report_verification", "'55555555-5555-4555-8555-555555555555'"),
      { available: false },
    );
    await db.exec(
      "reset role;set role authenticated;set request.jwt.claim.sub='99999999-9999-4999-8999-999999999999'",
    );
    await assert.rejects(rpc("issue_report_verification", args));
    await db.exec("set request.jwt.claim.sub='11111111-1111-4111-8111-111111111111'");
    await assert.rejects(
      rpc("issue_report_verification", "'44444444-4444-4444-8444-444444444444','private-title'"),
    );
    const id = await rpc("issue_report_verification", args);
    assert.equal(await rpc("issue_report_verification", args), id);
    await assert.rejects(db.query("select * from report_verification_receipts"));
    await db.exec("reset role;set role anon");
    const result = await rpc("resolve_report_verification", `'${id}'`);
    assert.equal(result.available, true);
    assert.equal(result.unchanged, true);
    assert.equal(result.is_latest, true);
    assert.deepEqual(
      Object.keys(result).sort(),
      [
        "available",
        "college_name",
        "term_name",
        "version_name",
        "report_kind",
        "status",
        "issued_at",
        "version_updated_at",
        "unchanged",
        "is_latest",
      ].sort(),
    );
    await db.exec("reset role;update schedule_versions set eligibility_revision=2");
    assert.equal((await rpc("resolve_report_verification", `'${id}'`)).unchanged, false);
    await db.exec("update schedule_versions set status='draft';set role authenticated");
    assert.equal(await rpc("issue_report_verification", args), null);
    await db.exec("reset role;set role anon");
    assert.deepEqual(await rpc("resolve_report_verification", `'${id}'`), { available: false });
  } finally {
    await db.close();
  }
});
