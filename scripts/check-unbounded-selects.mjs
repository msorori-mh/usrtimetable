#!/usr/bin/env node
/**
 * H-10 static guard: finds Supabase reads on large tables that can be silently
 * truncated by PostgREST's 1000-row response cap.
 *
 * A `.from("<big table>") ... .select(` chain is accepted when it:
 *   - is paginated or bounded: `.range(`, `.limit(`, `.single(`, `.maybeSingle(`;
 *   - is a head-only count: `head: true`;
 *   - reads by primary key: `.eq("id", ...)` / `.in("id", ...)` (bounded by the id list —
 *     callers must chunk large lists with chunkIds);
 *   - is a write returning rows (`.insert(` / `.update(` / `.upsert(` / `.delete(`);
 *   - sits inside a paginating wrapper call (readAllRows, readAllOrThrow, readScoped,
 *     readCollegeRows) — those add `.range()` themselves;
 *   - has an allow-list marker `// read-all-ok: <reason>` on the same line or within
 *     the 3 lines above the `.from(`.
 *
 * Usage: node scripts/check-unbounded-selects.mjs [rootDir=src] [--json]
 * Exit code 1 when offenders are found.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

export const BIG_TABLES = [
  "schedule_sessions",
  "teaching_assignments",
  "course_offerings",
  "plan_courses",
  "plan_course_components",
  "instructor_availability",
  "delivery_groups",
  "operational_delivery_groups",
  "delivery_group_partition_members",
  "cohort_student_partitions",
  "delivery_group_source_structures",
  "profiles",
  "user_roles",
  "user_colleges",
  "existing_schedule_source_rows",
  "courses",
  "instructors",
  "sections",
  "section_subgroups",
  "academic_cohorts",
  "audit_logs",
];

const WRAPPERS = ["readAllRows", "readAllOrThrow", "readScoped", "readCollegeRows"];
const OK_PATTERNS = [
  /\.range\(/,
  /\.limit\(/,
  /\.single\(/,
  /\.maybeSingle\(/,
  /head:\s*true/,
  /\.eq\(\s*["']id["']/,
  /\.in\(\s*["']id["']/,
  /\.(insert|update|upsert|delete)\(/,
];

/** Returns the end index of the expression chain that starts at `start` (a `.from(`). */
function chainEnd(src, start) {
  let depth = 0;
  for (let i = start; i < src.length; i++) {
    const c = src[i];
    if (c === '"' || c === "'" || c === "`") {
      const q = c;
      for (i++; i < src.length && src[i] !== q; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return i;
      depth--;
    } else if (depth === 0 && (c === ";" || c === ",")) return i;
  }
  return src.length;
}

/** Spans [open, close] of every call to a paginating wrapper. */
function wrapperSpans(src) {
  const spans = [];
  const re = new RegExp(`\\b(?:${WRAPPERS.join("|")})\\s*(?:<[^>]*>)?\\s*\\(`, "g");
  for (let m; (m = re.exec(src)); ) {
    const open = m.index + m[0].length - 1;
    spans.push([open, chainEnd(src, open + 1)]);
  }
  return spans;
}

export function scanSource(src, tables = BIG_TABLES) {
  const offenders = [];
  const spans = wrapperSpans(src);
  const lines = src.split("\n");
  const re = new RegExp(`\\.from\\(\\s*["'](${tables.join("|")})["']\\s*\\)`, "g");
  for (let m; (m = re.exec(src)); ) {
    const end = chainEnd(src, m.index + m[0].length);
    const chain = src.slice(m.index, end);
    if (!/\.select\(/.test(chain)) continue;
    if (OK_PATTERNS.some((p) => p.test(chain))) continue;
    if (spans.some(([a, b]) => m.index > a && m.index < b)) continue;
    const line = src.slice(0, m.index).split("\n").length;
    const context = lines.slice(Math.max(0, line - 4), line).join("\n");
    if (/read-all-ok:/.test(context)) continue;
    offenders.push({ table: m[1], line });
  }
  return offenders;
}

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) {
      if (name === "node_modules" || name.startsWith(".")) continue;
      walk(p, out);
    } else if (/\.(ts|tsx|mts|js|mjs)$/.test(name) && !/\.d\.ts$/.test(name)) out.push(p);
  }
  return out;
}

const isMain = process.argv[1] && import.meta.url === new URL(`file://${process.argv[1]}`).href;
if (isMain) {
  const args = process.argv.slice(2);
  const json = args.includes("--json");
  const root = args.find((a) => !a.startsWith("--")) ?? "src";
  const results = [];
  for (const file of walk(root)) {
    for (const o of scanSource(readFileSync(file, "utf8")))
      results.push({ file: relative(process.cwd(), file), ...o });
  }
  if (json) console.log(JSON.stringify(results, null, 2));
  else {
    for (const r of results) console.log(`${r.file}:${r.line}  .from("${r.table}") without pagination`);
    console.log(`\n${results.length} unbounded select(s) on large tables.`);
  }
  process.exit(results.length ? 1 : 0);
}
