#!/usr/bin/env node
// M-16 guard: the app is always dir="rtl"; use logical classes (ms-/me-/ps-/pe-/start-/end-/
// text-start/text-end/border-s/border-e) instead of physical left/right ones.
// Usage: node scripts/check-rtl-classes.mjs [dir]   (exit 1 when offenders are found)
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.argv[2] ?? "src";
// Physical sides that are the point of the component (a sheet that slides from a named side).
const ALLOW = [/src\/components\/ui\/sheet\.tsx$/];
const PATTERN =
  /(?<![\w-])-?(?:[a-z-]+:)*(?:ml|mr|pl|pr|left|right|rounded-l|rounded-r|border-l|border-r)-(?:\d|\[(?!50%\])|px|auto|full|1\/2)|(?<![\w-])(?:[a-z-]+:)*text-(?:left|right)(?![\w-])|(?<![\w-])(?:[a-z-]+:)*border-[lr](?![\w-])/;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (p.endsWith(".tsx")) out.push(p);
  }
  return out;
}

const offenders = [];
for (const file of walk(root)) {
  if (ALLOW.some((re) => re.test(file.split(path.sep).join("/")))) continue;
  readFileSync(file, "utf8")
    .split("\n")
    .forEach((line, i) => {
      if (PATTERN.test(line) && !line.includes("rtl-ok")) offenders.push(`${file}:${i + 1}: ${line.trim().slice(0, 140)}`);
    });
}
if (offenders.length) {
  console.error(`Physical direction classes found (use logical ms-/me-/ps-/pe-/start-/end-):\n${offenders.join("\n")}`);
  process.exit(1);
}
console.log("rtl class check: OK");
