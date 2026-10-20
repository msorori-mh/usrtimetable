import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { buildAccountGreeting, OMIT_LEADERSHIP_TITLE_FLAG } from "../src/lib/viewer-roles";

test("L-7 greeting exception is driven by the omit_leadership_title flag, not an e-mail", () => {
  const leader = {
    fullName: "أ.د. قائد",
    collegeName: null,
    isCollegeDeanOnly: false,
    isUniversityLeadershipOnly: true,
  };
  expect(buildAccountGreeting(leader)).toBe("مرحبًا، أ.د. قائد — رئيس الجامعة");
  expect(buildAccountGreeting({ ...leader, omitLeadershipTitle: true })).toBe("مرحبًا، أ.د. قائد");
  expect(OMIT_LEADERSHIP_TITLE_FLAG).toBe("omit_leadership_title");
  const source = readFileSync("src/lib/viewer-roles.ts", "utf8");
  expect(source).not.toMatch(/@usr\.edu\.ye/);
  const migration = readFileSync(
    "supabase/migrations/20261025090000_user_feature_flags.sql",
    "utf8",
  );
  expect(migration).toContain("'omit_leadership_title'");
});
