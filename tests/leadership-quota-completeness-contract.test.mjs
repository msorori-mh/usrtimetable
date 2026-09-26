import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260926124000_leadership_quota_completeness.sql",
    import.meta.url,
  ),
  "utf8",
);

test("explicitly unresolved homes never fall back to an inferred college", () => {
  assert.match(
    migration,
    /CASE\s+WHEN d\.identity_id IS NOT NULL THEN d\.home_college_id\s+ELSE h\.home_id\s+END AS home_college_id/,
  );
  assert.doesNotMatch(
    migration,
    /coalesce\(d\.home_college_id,\s*h\.home_id\) AS home_college_id/i,
  );
});

test("confirmed faculty source overrides only the automatic applicability gate", () => {
  assert.match(
    migration,
    /\(r\.approved_source IS NOT NULL AND r\.quota_confirmed\)\s+OR\s+\(\s*faculty_private\.quota_applicability\(s\.type_code, s\.employment_type\) IS TRUE/,
  );
  assert.match(
    migration,
    /faculty_private\.quota_applicability\(s\.type_code, s\.employment_type\) IS TRUE[\s\S]*r\.approved_source IS NULL[\s\S]*NOT EXISTS/,
  );
  assert.match(migration, /s\.max_weekly_hours IS NOT NULL/);
});

test("leadership completeness excludes only explicitly non-applicable staff", () => {
  assert.match(
    migration,
    /faculty_private\.quota_applicability\([\s\S]*h\.type_code,[\s\S]*h\.employment_type[\s\S]*\) IS FALSE/,
  );
  assert.match(
    migration,
    /\(college\.value->>'incomplete_faculty'\)::integer\s*-\s*coalesce\(excluded\.non_applicable_count, 0\)/,
  );
  assert.match(migration, /WHEN college\.value->>'incomplete_faculty' IS NULL THEN college\.value/);
});

test("the implementation remains fail-closed and keeps the base RPC private", () => {
  assert.match(
    migration,
    /ALTER FUNCTION public\.leadership_overview\(text,text\)\s+RENAME TO leadership_overview_base/,
  );
  assert.match(
    migration,
    /REVOKE ALL ON FUNCTION public\.leadership_overview_base\(text,text\)\s+FROM PUBLIC, anon, authenticated/,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.leadership_overview\(text,text\)\s+TO authenticated, service_role/,
  );
});
