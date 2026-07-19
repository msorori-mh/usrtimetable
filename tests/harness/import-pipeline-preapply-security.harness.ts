import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { deliveryGroupIsolationKey, sectionIsolationKey } from "../../src/lib/excel-import/keys.ts";

const root = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");
const assert = (condition: unknown, message: string) => {
  if (!condition) throw new Error(`FAIL: ${message}`);
};

const atomic = read("supabase/migrations/20260718210000_source_only_atomic_import_job_commit.sql");
const manifest = read("supabase/migrations/20260718180000_import_manifest_contract.sql");
const createBaseline = read(
  "supabase/migrations/20260605002216_5a3621d3-8358-427d-be91-9bb7f4103861.sql",
);
const commit = read("src/lib/excel-import/commit.ts");
const safety = read("src/lib/excel-import/safety.ts");
const fixture = read("tests/fixtures/import-atomic-commit/proof.sql");

const excelImportDir = resolve(root, "src/lib/excel-import");
const excelImportSources = readdirSync(excelImportDir)
  .filter((name) => name.endsWith(".ts"))
  .map((name) => ({ name, src: read(`src/lib/excel-import/${name}`) }));

const hasTableRevoke = (sql: string, table: string, role: string) => {
  const pattern = new RegExp(
    `REVOKE\\s+INSERT\\s*,\\s*UPDATE\\s*,\\s*DELETE\\s+ON\\s+public\\.${table}\\s+FROM\\s+[^;]*\\b${role}\\b`,
    "i",
  );
  return pattern.test(sql);
};

// 1) anon table DML revoked (atomic migration + defense-in-depth)
assert(hasTableRevoke(atomic, "import_jobs", "anon"), "1 anon DML revoked on import_jobs");
assert(hasTableRevoke(atomic, "import_errors", "anon"), "1 anon DML revoked on import_errors");
assert(
  !/GRANT\s+(ALL|INSERT|UPDATE|DELETE)[^;]*\bON\s+public\.import_jobs\b[^;]*\bTO\s+anon\b/i.test(
    createBaseline,
  ),
  "1 anon never granted import_jobs DML in baseline",
);

// 2) authenticated table DML revoked
assert(
  hasTableRevoke(atomic, "import_jobs", "authenticated"),
  "2 authenticated DML revoked on import_jobs (atomic)",
);
assert(
  hasTableRevoke(atomic, "import_errors", "authenticated"),
  "2 authenticated DML revoked on import_errors (atomic)",
);
assert(
  hasTableRevoke(manifest, "import_jobs", "authenticated"),
  "2 authenticated DML revoked on import_jobs (manifest)",
);

// 3) PUBLIC table DML absent / revoked
assert(hasTableRevoke(atomic, "import_jobs", "PUBLIC"), "3 PUBLIC DML revoked on import_jobs");
assert(hasTableRevoke(atomic, "import_errors", "PUBLIC"), "3 PUBLIC DML revoked on import_errors");
assert(
  !/GRANT\s+(ALL|INSERT|UPDATE|DELETE)[^;]*\bON\s+public\.import_(jobs|errors)\b[^;]*\bTO\s+PUBLIC\b/i.test(
    createBaseline + manifest + atomic,
  ),
  "3 no GRANT table DML TO PUBLIC in import migrations",
);

// 4) public RPCs authenticated-only (never anon / PUBLIC execute)
const publicRpcs = [
  "create_import_preview_manifest",
  "claim_import_job_manifest",
  "finalize_import_job",
  "fail_import_job",
  "commit_import_job_atomic",
];
for (const rpc of publicRpcs) {
  const src = rpc === "commit_import_job_atomic" ? atomic : manifest;
  assert(
    new RegExp(`REVOKE\\s+ALL\\s+ON\\s+FUNCTION\\s+public\\.${rpc}\\b[^;]*\\banon\\b`, "i").test(
      src,
    ),
    `4 ${rpc} EXECUTE revoked from anon`,
  );
  assert(
    new RegExp(
      `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${rpc}\\b[^;]*\\bTO\\s+authenticated\\b`,
      "i",
    ).test(src),
    `4 ${rpc} EXECUTE granted to authenticated`,
  );
  assert(
    !new RegExp(
      `GRANT\\s+EXECUTE\\s+ON\\s+FUNCTION\\s+public\\.${rpc}\\b[^;]*\\bTO\\s+anon\\b`,
      "i",
    ).test(src),
    `4 ${rpc} not granted to anon`,
  );
}

// 5) internal helpers client-inexecutable
assert(
  /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\._import_dispatch\b[^;]*\bFROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated/i.test(
    atomic,
  ),
  "5 _import_dispatch revoked from PUBLIC/anon/authenticated",
);
assert(
  /REVOKE\s+ALL\s+ON\s+FUNCTION\s+public\.import_manager_actor\b[^;]*\bFROM\s+PUBLIC\s*,\s*anon\s*,\s*authenticated/i.test(
    manifest,
  ),
  "5 import_manager_actor revoked from clients",
);
assert(
  (atomic.match(/REVOKE ALL ON FUNCTION public\._import_/g) ?? []).length >= 10,
  "5 multiple _import_ helpers revoked",
);

// 6) no client direct operational DML on import/control/domain tables
for (const { name, src } of excelImportSources) {
  assert(
    !/\.from\([^)]+\)[\s\S]{0,120}\.(insert|update|upsert|delete)\(/.test(src),
    `6 no chained table DML in excel-import/${name}`,
  );
  assert(
    !/\.(insert|update|upsert|delete)\(/.test(src),
    `6 no DML call sites in excel-import/${name}`,
  );
}
assert(commit.includes('rpc("commit_import_job_atomic"'), "6 commit uses atomic RPC only");
assert(!commit.includes("claimImportJob"), "6 no client claim fallback");
assert(!commit.includes("finalizeImportJob"), "6 no client finalize fallback");
assert(safety.includes("requireImportManager"), "6 preview still auth-gated");

// 7) failed atomic commit leaves job in preview
assert(
  fixture.includes("forced failure left non-preview job status"),
  "7 fixture asserts failed commit remains preview",
);
assert(
  atomic.includes("EXCEPTION") || atomic.includes("ROLLBACK"),
  "7 atomic exception aborts txn",
);

// 8) rollback leaves zero domain/audit mutations
assert(
  fixture.includes("forced failure left partial operational write"),
  "8 zero domain mutations",
);
assert(fixture.includes("forced failure wrote success audit"), "8 zero success audit on rollback");

// 9) replay remains idempotent
assert(
  atomic.includes("'replay', true") || /replay["']?\s*,\s*true/.test(atomic),
  "9 replay flag in atomic RPC",
);
assert(fixture.includes("replay re-wrote domain rows"), "9 fixture blocks replay domain rewrite");
assert(fixture.includes("replay created extra success audit"), "9 fixture blocks replay audit dup");

// 10) regular/parallel and college isolation preserved
assert(
  sectionIsolationKey({
    term_code: "T1",
    course_code: "C1",
    section_number: 1,
    study_system: "parallel",
  }) !==
    sectionIsolationKey({
      term_code: "T1",
      course_code: "C1",
      section_number: 1,
      study_system: "regular",
    }),
  "10 regular/parallel section isolation",
);
assert(
  deliveryGroupIsolationKey({
    cohort_code: "A",
    course_code: "C",
    component_type: "theory",
    delivery_group_code: "G1",
    employee_number: "E1",
  }) !==
    deliveryGroupIsolationKey({
      cohort_code: "B",
      course_code: "C",
      component_type: "theory",
      delivery_group_code: "G1",
      employee_number: "E1",
    }),
  "10 cohort isolation in V2 keys",
);
assert(atomic.includes("v_college := v_job.college_id"), "10 college from job only");
assert(atomic.includes("created_by IS DISTINCT FROM v_actor"), "10 actor binding");
assert(fixture.includes("cross-college was accepted"), "10 fixture denies cross-college");

// RLS: enabled; no anon write policies; no USING/WITH CHECK true for writes
assert(createBaseline.includes("ENABLE ROW LEVEL SECURITY"), "RLS enabled on import tables");
assert(
  !/CREATE POLICY\s+\w+\s+ON\s+public\.import_(jobs|errors)[\s\S]{0,200}\bTO\s+anon\b/i.test(
    createBaseline,
  ),
  "no anon policies on import tables",
);
assert(
  !/CREATE POLICY\s+ij_(insert|update|delete)\b[\s\S]{0,200}(USING|WITH CHECK)\s*\(\s*true\s*\)/i.test(
    createBaseline,
  ),
  "no wide-open write policies on import_jobs",
);
assert(
  atomic.includes("SOURCE-ONLY") && atomic.includes("NOT APPLIED"),
  "migration remains source-only / NOT APPLIED marker",
);

console.log("import-pipeline-preapply-security.harness.ts: PASS");
