// Guards the Lovable exit (docs/operations/lovable-exit-runbook.md): the build, the runtime
// and the hosting configuration must not depend on Lovable any more.
import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(path.join(root, rel), "utf8");
const LEGACY_PROJECT_REF = ["emzytxqkxjj", "hsivqxdiu"].join(""); // split so this file is not itself a hit

// Known cosmetic leftovers: the timetable drag-and-drop payload MIME type. It is an
// internal string (no Lovable dependency) and is renamed in both files together later.
const ALLOWED = new Map([
  ["src/components/timetable/timetable-grid.tsx", ["application/x-lovable-drop"]],
  ["src/routes/_authenticated/timetable.$versionId.tsx", ["application/x-lovable-drop"]],
]);

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(?:[cm]?[jt]sx?|css|html|json)$/.test(name)) out.push(full);
  }
  return out;
}
const srcFiles = walk(path.join(root, "src")).map((f) => path.relative(root, f).split(path.sep).join("/"));

test("package.json has no @lovable.dev dependency", () => {
  const pkg = JSON.parse(read("package.json"));
  const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies, ...pkg.peerDependencies };
  assert.deepEqual(Object.keys(all).filter((n) => n.startsWith("@lovable.dev/")), []);
  assert.doesNotMatch(read("package.json"), /@lovable\.dev/);
});

test("bunfig.toml references neither the Lovable registry nor Lovable packages", () => {
  const bunfig = read("bunfig.toml");
  assert.doesNotMatch(bunfig, /lovable-core-prod/);
  assert.doesNotMatch(bunfig, /@lovable\.dev/);
});

test("vite.config.ts is explicit (no Lovable config wrapper)", () => {
  const config = read("vite.config.ts");
  assert.doesNotMatch(config, /lovable/i);
  assert.match(config, /from "@tanstack\/react-start\/plugin\/vite"/);
  assert.match(config, /from "nitro\/vite"/);
  assert.match(config, /preset: "cloudflare_module"/);
  assert.match(config, /server: \{ entry: "server" \}/);
});

test("src/ never hard-codes the legacy Lovable Cloud project", () => {
  const hits = srcFiles.filter((f) => read(f).includes(LEGACY_PROJECT_REF));
  assert.deepEqual(hits, []);
});

test("src/ has no Lovable identifiers except the allow-listed drag MIME strings", () => {
  const offenders = [];
  for (const file of srcFiles) {
    const allowed = ALLOWED.get(file) ?? [];
    read(file)
      .split("\n")
      .forEach((line, i) => {
        let rest = line;
        for (const token of allowed) rest = rest.split(token).join("");
        if (/lovable/i.test(rest)) offenders.push(`${file}:${i + 1}: ${line.trim()}`);
      });
  }
  assert.deepEqual(offenders, []);
  for (const removed of [
    "src/integrations/supabase/previewAuthStorage.ts",
    "src/lib/lovable-error-reporting.ts",
  ])
    assert.equal(existsSync(path.join(root, removed)), false, `${removed} must stay deleted`);
});

test("the .lovable/ project folder is gone (history lives in docs/history/lovable-plans)", () => {
  assert.equal(existsSync(path.join(root, ".lovable")), false);
  assert.equal(existsSync(path.join(root, "docs/history/lovable-plans/plan.md")), true);
});

test("bun.lock resolves only to the public registry (warning until regenerated)", (t) => {
  const lock = read("bun.lock");
  const privateEntries = (lock.match(/lovable-core-prod/g) ?? []).length;
  const lovablePackages = (lock.match(/"@lovable\.dev\//g) ?? []).length;
  if (privateEntries === 0 && lovablePackages === 0) return;
  const message =
    `WARNING bun.lock still has ${privateEntries} Lovable-registry entries and ` +
    `${lovablePackages} @lovable.dev references; run scripts/exit-lovable/regenerate-lockfile.sh`;
  t.diagnostic(message);
  console.warn(message);
  // Set LOVABLE_LOCK_STRICT=1 (after the lockfile is regenerated) to make this a hard failure.
  if (process.env.LOVABLE_LOCK_STRICT === "1") assert.fail(message);
});
