import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(
  resolve(import.meta.dir, "../src/components/faculty-identity-link.tsx"),
  "utf8",
);

test("faculty identity link explains evidence requirement instead of silently disabling submit", () => {
  expect(source.includes("evidenceReady")).toBe(true);
  expect(source.includes("12 حرفًا على الأقل")).toBe(true);
  expect(source.includes("onClick={submitLink}")).toBe(true);
  expect(source.includes("disabled={link.isPending || candidates.isLoading}")).toBe(true);
  expect(source.includes("required")).toBe(true);
  expect(source.includes("minLength={12}")).toBe(true);
});

test("faculty identity link preserves the hard validation before the RPC", () => {
  expect(source.includes("evidence.trim().length < 12")).toBe(true);
  expect(source.includes("link_faculty_identity_with_evidence")).toBe(true);
});
