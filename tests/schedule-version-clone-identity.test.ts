import { describe, it, mock } from "bun:test";
import assert from "node:assert/strict";
let lastArgs: Record<string, unknown> = {};
let error: { message: string } | null = null;
mock.module("../src/integrations/supabase/client.ts", () => ({
  supabase: {
    rpc: async (name: string, args: Record<string, unknown>) => {
      assert.equal(name, "clone_schedule_version_current");
      lastArgs = args;
      return {
        data: {
          version_id: "new",
          source_sessions: 3,
          sessions_copied: 1,
          sessions_skipped: 2,
          skipped_sessions: [],
        },
        error,
      };
    },
    from: () => {
      throw new Error("clone must not make non-atomic table writes");
    },
  },
}));
const { cloneVersion, cloneVersionWithSummary } =
  await import("../src/lib/schedule-versions/lifecycle");
const params = {
  collegeId: "college",
  sourceVersionId: "source",
  targetTermId: "term",
  newName: "new",
};
describe("atomic clone adapter", () => {
  it("returns counts for interactive review and forwards identity parameters", async () => {
    const r = await cloneVersionWithSummary(params);
    assert.equal(r.sessions_skipped, 2);
    assert.equal(lastArgs.p_source_version_id, "source");
    assert.equal(lastArgs.p_college_id, "college");
    assert.equal(lastArgs.p_target_term_id, "term");
    assert.equal(lastArgs.p_require_complete, false);
  });
  it("backup callers retain the string contract and require a complete copy", async () => {
    assert.equal(await cloneVersion(params), "new");
    assert.equal(lastArgs.p_require_complete, true);
  });
  it("database rejection produces an Arabic actionable error", async () => {
    error = { message: "CLONE_TERM_REMAP_REQUIRED" };
    await assert.rejects(cloneVersion(params), /الفصل الآخر يحتاج مطابقة/);
    error = null;
  });
});
