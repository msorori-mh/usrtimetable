import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(import.meta.dir, "../src/components/faculty-identity-link.tsx"),
  "utf8",
);

test("faculty identity link uses confirmation without a written evidence field", () => {
  expect(source.includes("دليل التحقق")).toBe(false);
  expect(source.includes("p_evidence")).toBe(false);
  expect(source.includes("onClick={submitLink}")).toBe(true);
  expect(
    source.includes("disabled={link.isPending || candidates.isLoading || !target || !confirmed}"),
  ).toBe(true);
});

test("faculty identity link preserves selection and same-person confirmation before the audited RPC", () => {
  expect(source.includes("if (!target)")).toBe(true);
  expect(source.includes("if (!confirmed)")).toBe(true);
  expect(
    source.includes("!filteredCandidates.some((row) => row.university_number === target)"),
  ).toBe(true);
  expect(source.includes("link_verified_faculty_identity")).toBe(true);
});
