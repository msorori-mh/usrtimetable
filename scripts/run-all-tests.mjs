#!/usr/bin/env node
/**
 * Run every JS/TS test file under tests/ with the framework it is written for (H-13).
 *
 * Classification is by the test framework each file imports:
 *   - "bun:test"  → `bun test <files>`
 *   - "vitest"    → `bunx vitest run --config tests/vitest-bun-compat.config.mjs <files>`
 *   - "node:test" → `node --import tsx [--experimental-test-module-mocks] --test <files>`
 *     (tsx because many .mjs tests import .ts sources; mock.module users get the mocks flag)
 *   - none        → plain scripts that assert at top level: `node [--import tsx] <file>`
 * Support files (fixtures, compat shims, harness helpers) are not tests and are skipped.
 *
 * Database tests (they open PGlite via a *_DB_MODULE / PGLITE_TEST_MODULE env var, or a
 * disposable local PostgreSQL via *_TEST_DATABASE_URL) are NOT run here: they belong to
 * the `db-tests` CI job. They are listed with `--list` so nothing silently disappears.
 *
 * Usage:
 *   node scripts/run-all-tests.mjs                 run all non-DB groups
 *   node scripts/run-all-tests.mjs --list          print the classification only
 *   node scripts/run-all-tests.mjs --group=bun     run one group (bun|vitest|node|script|pglite)
 *   node scripts/run-all-tests.mjs --json          print the classification as JSON
 *
 * Exit code is non-zero if any group fails (or if a file cannot be classified).
 */
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const testsDir = path.join(root, "tests");

/** Not tests: imported helpers, fixtures, framework shims. */
export const SUPPORT_FILES = new Set([
  "tests/vitest-bun-compat.config.mjs",
  "tests/vitest-bun-test-compat.ts",
  "tests/shared-lecture-cases.mjs",
]);

const DB_ENV =
  /process\.env(?:\.|\[["'])([A-Z_]*(?:_DB_MODULE|_TEST_MODULE|_TEST_DATABASE_URL|_QA_MODULES))\b/;

export function classify(rel, source) {
  if (SUPPORT_FILES.has(rel)) return { group: "support" };
  const dbEnv = source.match(DB_ENV)?.[1];
  if (dbEnv) return { group: "db", env: dbEnv };
  const uses = (id) =>
    new RegExp(`(?:from\\s+|import\\(|require\\()\\s*["']${id}["']`).test(source);
  if (uses("bun:test")) return { group: "bun" };
  if (uses("vitest")) return { group: "vitest" };
  const ts = /\.tsx?$/.test(rel);
  if (uses("node:test")) {
    return { group: "node", ts, mocks: /\bmock\.module\(/.test(source) };
  }
  return { group: "script", ts };
}

export function inventory() {
  const entries = readdirSync(testsDir)
    .filter((name) => /\.(?:[cm]?js|tsx?)$/.test(name))
    .sort()
    .map((name) => {
      const rel = `tests/${name}`;
      const source = readFileSync(path.join(root, rel), "utf8");
      return { file: rel, source, ...classify(rel, source) };
    });
  // A file that imports a DB test's fixture (e.g. `from "./faculty-workflow-db.test.mjs"`)
  // needs the same database runtime: propagate until stable.
  for (let changed = true; changed;) {
    changed = false;
    const db = new Map(entries.filter((e) => e.group === "db").map((e) => [e.file, e]));
    for (const e of entries) {
      if (e.group === "db" || e.group === "support") continue;
      for (const m of e.source.matchAll(/from\s+["']\.\/([^"']+)["']/g)) {
        const dep = db.get(`tests/${m[1]}`);
        if (dep) {
          Object.assign(e, { group: "db", env: dep.env, via: dep.file });
          changed = true;
          break;
        }
      }
    }
  }
  return entries.map(({ source, ...rest }) => rest);
}

function run(label, command, args, env = {}) {
  process.stdout.write(`\n=== ${label}: ${command} ${args.join(" ")}\n`);
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, ...env },
  });
  if (result.error) process.stdout.write(`!!! ${label}: ${result.error.message}\n`);
  return result.status === 0;
}

function main(argv) {
  const files = inventory();
  const only = argv.find((a) => a.startsWith("--group="))?.slice(8);
  if (argv.includes("--json")) {
    process.stdout.write(`${JSON.stringify(files, null, 2)}\n`);
    return 0;
  }
  if (argv.includes("--list")) {
    for (const f of files) {
      const extra = f.env
        ? ` (${f.env}${f.via ? ` via ${f.via}` : ""})`
        : f.mocks
          ? " (module mocks)"
          : "";
      process.stdout.write(`${f.group.padEnd(8)} ${f.file}${extra}\n`);
    }
    const counts = Object.groupBy(files, (f) => f.group);
    process.stdout.write(
      `\n${Object.entries(counts)
        .map(([g, l]) => `${g}=${l.length}`)
        .join(" ")}\n`,
    );
    return 0;
  }

  // "pglite" is opt-in (needs the PGlite package); the default run covers everything else.
  const want = (group) => (!only && group !== "pglite") || only === group;
  const pick = (group) => files.filter((f) => f.group === group);
  const failures = [];
  const bun = process.env.BUN_BIN || "bun";

  if (want("bun") && pick("bun").length) {
    if (!run("bun:test", bun, ["test", ...pick("bun").map((f) => f.file)])) failures.push("bun");
  }
  if (want("vitest") && pick("vitest").length) {
    const ok = run("vitest", process.env.BUNX_BIN || "bunx", [
      "vitest",
      "run",
      "--config",
      "tests/vitest-bun-compat.config.mjs",
      ...pick("vitest").map((f) => f.file),
    ]);
    if (!ok) failures.push("vitest");
  }
  if (want("node")) {
    // One process per flag combination; node --test isolates each file in a subprocess.
    const combos = new Map();
    for (const f of pick("node")) {
      // Always load tsx: many .mjs tests import .ts sources or the "@/…" alias.
      const key = `tsx${f.mocks ? "+mocks" : ""}`;
      combos.set(key, [...(combos.get(key) ?? []), f]);
    }
    for (const [key, list] of combos) {
      const args = [
        ...(key.startsWith("tsx") ? ["--import", "tsx"] : []),
        ...(key.endsWith("+mocks") ? ["--experimental-test-module-mocks"] : []),
        "--test",
        ...list.map((f) => f.file),
      ];
      if (!run(`node:test (${key})`, process.execPath, args)) failures.push(`node:${key}`);
    }
  }
  if (want("script")) {
    for (const f of pick("script")) {
      const args = [...(f.ts ? ["--import", "tsx"] : []), f.file];
      if (!run(`script ${f.file}`, process.execPath, args)) failures.push(f.file);
    }
  }

  // PGlite database tests: in-process PostgreSQL, no server needed, but the PGlite package
  // is not a project dependency, so CI installs it and passes its location:
  //   PGLITE_MODULE=<dir>/node_modules/@electric-sql/pglite/dist/index.js (default for every
  //   *_DB_MODULE / *_TEST_MODULE variable that is not already set) and
  //   PASSWORD_QA_MODULES=<dir>/node_modules (pglite + jsdom) for the *_QA_MODULES tests.
  const pglite = pick("db").filter((f) => !f.env.endsWith("_TEST_DATABASE_URL"));
  if (only === "pglite") {
    const byEnv = Map.groupBy(pglite, (f) => f.env);
    for (const [envName, list] of byEnv) {
      const value =
        process.env[envName] || (envName.endsWith("_QA_MODULES") ? "" : process.env.PGLITE_MODULE);
      if (!value) {
        process.stdout.write(`!!! ${envName} (or PGLITE_MODULE) is not set\n`);
        failures.push(`pglite:${envName}`);
        continue;
      }
      const ok = run(
        `pglite (${envName})`,
        process.execPath,
        ["--import", "tsx", "--test", ...list.map((f) => f.file)],
        { [envName]: value },
      );
      if (!ok) failures.push(`pglite:${envName}`);
    }
  }
  const server = pick("db").filter((f) => f.env.endsWith("_TEST_DATABASE_URL"));
  process.stdout.write(
    `\n${pglite.length} PGlite database test files run with --group=pglite; ` +
      `${server.length} disposable-PostgreSQL test files run in runtime-gates (atomic-compaction-db).\n`,
  );
  if (failures.length) {
    process.stdout.write(`\nFAILED groups: ${failures.join(", ")}\n`);
    return 1;
  }
  process.stdout.write("\nall test groups passed\n");
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
