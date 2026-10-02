import { describe, expect, it, vi } from "vitest";
import {
  executeOperationalAdoptionStage,
  fetchOperationalAdoptionPreview,
  operationalAdoptionReadiness,
  operationalAdoptionReference,
  OPERATIONAL_ADOPTION_PROFILE,
  readOperationalAdoptionPreview,
  type OperationalAdoptionPreview,
  type OperationalAdoptionReceipt,
  type OperationalAdoptionRpc,
} from "../src/lib/itcs-cutover/operational-adoption";

// Fixtures use synthetic identities; no production registration is bundled.
const VERSION = "00000000-0000-4000-8000-000000000001";
const PUBLISHED = "00000000-0000-4000-8000-000000000002";
const COLLEGE = "00000000-0000-4000-8000-000000000003";
const TERM = "00000000-0000-4000-8000-000000000004";
const before = "2026-10-02T16:24:49.676661+00:00";
const appliedAt = "2026-10-02T18:00:00.000Z";
const md5 = "0123456789abcdef0123456789abcdef";
const after = "abcdef0123456789abcdef0123456789";
const qualityId = "00000000-0000-4000-8000-000000000010";
const identity = {
  profile: OPERATIONAL_ADOPTION_PROFILE,
  version_id: VERSION,
  published_version_id: PUBLISHED,
  college_id: COLLEGE,
  term_id: TERM,
  manifest_sha: md5,
};
const counts = {
  sessions: 273,
  hours: 624,
  assignment_changes: 39,
  placement_changes: 29,
  joint_session_changes: 55,
  withdrawals: 31,
  promoted_reuses: 4,
  inactive_links: 5,
  preserved_inactive_scopes: 6,
} as const;

function baseline(): OperationalAdoptionPreview {
  return {
    ...identity,
    ok: true,
    published_snapshot: md5,
    current_snapshot: md5,
    version_status: "review",
    version_updated_at: before,
    eligibility_revision: 832,
    expected_version_status: "review",
    expected_version_updated_at: before,
    expected_eligibility_revision: 832,
    counts: { ...counts },
    baseline_matches: true,
    sealed: false,
    applied_receipt: null,
    published_receipt: null,
    fresh_quality: null,
    publish_ready: false,
    waiting: {
      net_student_hours: -57,
      worsened_students: 149,
      worsened_student_hours: 243,
      added_student_days: 0,
    },
    limitations: [],
  };
}

function appliedReceipt(): OperationalAdoptionReceipt {
  return {
    ...identity,
    ok: true,
    stage: "applied",
    counts: { ...counts },
    after_snapshot: after,
    rolled_back: false,
    sealed: true,
    revision: 833,
    version_updated_at: appliedAt,
    created_at: appliedAt,
    quality_run_required: true,
  };
}

function applied(): OperationalAdoptionPreview {
  return {
    ...baseline(),
    version_status: "draft",
    version_updated_at: appliedAt,
    eligibility_revision: 833,
    current_snapshot: after,
    baseline_matches: false,
    sealed: true,
    applied_receipt: appliedReceipt(),
  };
}

function publishable(): OperationalAdoptionPreview {
  return {
    ...applied(),
    fresh_quality: {
      id: qualityId,
      eligibility_revision: 833,
      hard_conflicts_count: 0,
      created_at: "2026-10-02T18:01:00.000Z",
    },
    publish_ready: true,
  };
}

function published(): OperationalAdoptionPreview {
  const receipt: OperationalAdoptionReceipt = {
    ...appliedReceipt(),
    stage: "published",
    revision: 836,
    version_updated_at: "2026-10-02T18:02:00.000Z",
    created_at: "2026-10-02T18:02:00.000Z",
    quality_run_id: qualityId,
  };
  return {
    ...publishable(),
    version_status: "published",
    version_updated_at: receipt.version_updated_at!,
    eligibility_revision: receipt.revision!,
    sealed: false,
    published_receipt: receipt,
    publish_ready: false,
  };
}

function mockRpc(preview: unknown, receipt: unknown = null) {
  return vi.fn<OperationalAdoptionRpc>(async (name) => ({
    data: name === "itcs_operational_adoption_preview" ? preview : receipt,
    error: null,
  }));
}

describe("registered operational adoption client", () => {
  it("loads only the authenticated registered preview with complete metadata", async () => {
    const rpc = mockRpc(baseline());
    expect(await fetchOperationalAdoptionPreview(rpc)).toEqual(baseline());
    expect(rpc).toHaveBeenCalledExactlyOnceWith("itcs_operational_adoption_preview", {
      p_profile: OPERATIONAL_ADOPTION_PROFILE,
    });
  });

  it("uses the protected server preview identities and rejects receipts for different valid UUIDs", async () => {
    const preview: OperationalAdoptionPreview = {
      ...baseline(),
      version_id: "00000000-0000-4000-8000-000000000021",
      published_version_id: "00000000-0000-4000-8000-000000000022",
      college_id: "00000000-0000-4000-8000-000000000023",
      term_id: "00000000-0000-4000-8000-000000000024",
    };
    expect(readOperationalAdoptionPreview(preview)).toEqual(preview);
    for (const field of ["version_id", "published_version_id", "college_id", "term_id"] as const) {
      const receipt: OperationalAdoptionReceipt = {
        ...appliedReceipt(),
        version_id: preview.version_id,
        published_version_id: preview.published_version_id,
        college_id: preview.college_id,
        term_id: preview.term_id,
        stage: "checked",
        rolled_back: true,
        [field]: identity[field],
      };
      await expect(
        executeOperationalAdoptionStage(
          mockRpc(preview, receipt),
          "operational_check",
          preview,
          null,
        ),
      ).rejects.toThrow("OPERATIONAL_RECEIPT_MISMATCH");
      expect(() =>
        readOperationalAdoptionPreview({
          ...preview,
          applied_receipt: { ...receipt, stage: "applied", rolled_back: false },
        }),
      ).toThrow("OPERATIONAL_RECEIPT_MISMATCH");
    }
  });

  it("rejects missing metadata, a mismatched profile, malformed identities, hash, or totals", () => {
    const valid = baseline();
    for (const invalid of [
      null,
      { ok: true, profile: OPERATIONAL_ADOPTION_PROFILE },
      { ...valid, current_snapshot: undefined },
      { ...valid, profile: "itcs_proposal16_review_20260930" },
      { ...valid, version_id: "not-a-uuid" },
      { ...valid, published_version_id: "not-a-uuid" },
      { ...valid, college_id: "not-a-uuid" },
      { ...valid, term_id: "not-a-uuid" },
      { ...valid, manifest_sha: "" },
      { ...valid, manifest_sha: "not-a-registered-md5" },
      { ...valid, counts: { ...counts, hours: 644 } },
      { ...valid, waiting: { ...valid.waiting, worsened_students: 0 } },
      { ...valid, waiting: { ...valid.waiting, worsened_students: 172 } },
      { ...valid, fresh_quality: { id: qualityId } },
    ])
      expect(() => readOperationalAdoptionPreview(invalid)).toThrow("OPERATIONAL_PREVIEW_INVALID");
  });

  it("requires the exact review baseline and all CAS fields before check or apply", () => {
    const valid = baseline();
    expect(operationalAdoptionReadiness(valid).canApply).toBe(true);
    for (const invalid of [
      { ...valid, baseline_matches: false },
      { ...valid, version_status: "draft" as const },
      { ...valid, version_updated_at: appliedAt },
      { ...valid, eligibility_revision: 833 },
    ]) {
      expect(operationalAdoptionReadiness(invalid).canCheck).toBe(false);
      expect(operationalAdoptionReadiness(invalid).canApply).toBe(false);
    }
  });

  it("checks through the sole writer and accepts only a rolled back checked receipt", async () => {
    const preview = baseline();
    const receipt = {
      ...appliedReceipt(),
      stage: "checked",
      rolled_back: true,
    };
    const rpc = mockRpc(preview, receipt);
    expect(await executeOperationalAdoptionStage(rpc, "operational_check", preview, null)).toEqual(
      receipt,
    );
    expect(rpc).toHaveBeenLastCalledWith("itcs_cutover_execute", {
      p_stage: "operational_check",
      p_version: VERSION,
      p_published: PUBLISHED,
      p_manifest: { profile: OPERATIONAL_ADOPTION_PROFILE },
      p_manifest_sha: md5,
      p_expected_published_snapshot: md5,
    });
    for (const invalid of [
      { ...receipt, rolled_back: false },
      { ...receipt, stage: "applied" },
      { ...receipt, ok: false },
    ])
      await expect(
        executeOperationalAdoptionStage(
          mockRpc(preview, invalid),
          "operational_check",
          preview,
          null,
        ),
      ).rejects.toThrow("OPERATIONAL_RECEIPT_MISMATCH");
  });

  it("does not execute apply until this exact current reference has passed check", async () => {
    const preview = baseline();
    const rpc = mockRpc(preview, appliedReceipt());
    await expect(
      executeOperationalAdoptionStage(rpc, "operational_apply", preview, null),
    ).rejects.toThrow("OPERATIONAL_STAGE_NOT_READY");
    expect(rpc).toHaveBeenCalledTimes(1);
    rpc.mockClear();
    expect(
      await executeOperationalAdoptionStage(
        rpc,
        "operational_apply",
        preview,
        operationalAdoptionReference(preview),
      ),
    ).toEqual(appliedReceipt());
    expect(rpc).toHaveBeenCalledTimes(2);
  });

  it("rejects changed CAS, manifest, or published snapshot before a writer call", async () => {
    const reviewed = baseline();
    for (const fresh of [
      { ...reviewed, published_snapshot: after },
      { ...reviewed, current_snapshot: after },
      { ...reviewed, manifest_sha: after },
      { ...reviewed, version_updated_at: appliedAt },
      { ...reviewed, eligibility_revision: 833 },
      { ...reviewed, version_id: PUBLISHED },
      { ...reviewed, published_version_id: VERSION },
      { ...reviewed, college_id: VERSION },
      { ...reviewed, term_id: VERSION },
    ]) {
      const rpc = mockRpc(fresh, appliedReceipt());
      await expect(
        executeOperationalAdoptionStage(
          rpc,
          "operational_apply",
          reviewed,
          operationalAdoptionReference(reviewed),
        ),
      ).rejects.toThrow("OPERATIONAL_REFERENCE_CHANGED");
      expect(rpc).toHaveBeenCalledTimes(1);
    }
  });

  it("rejects partial or mismatched applied receipts rather than displaying success", async () => {
    const preview = baseline();
    for (const receipt of [
      { ok: true },
      { ...appliedReceipt(), profile: "another_profile" },
      { ...appliedReceipt(), manifest_sha: after },
      { ...appliedReceipt(), version_id: PUBLISHED },
      { ...appliedReceipt(), counts: { ...counts, sessions: 282 } },
      { ...appliedReceipt(), sealed: false },
      { ...appliedReceipt(), revision: undefined },
      { ...appliedReceipt(), created_at: undefined },
      { ...appliedReceipt(), quality_run_required: false },
    ])
      await expect(
        executeOperationalAdoptionStage(
          mockRpc(preview, receipt),
          "operational_apply",
          preview,
          operationalAdoptionReference(preview),
        ),
      ).rejects.toThrow("OPERATIONAL_RECEIPT_MISMATCH");
  });

  it("rejects preview receipts linked to a different manifest or lacking an apply seal", () => {
    for (const receipt of [
      { ...appliedReceipt(), manifest_sha: after },
      { ...appliedReceipt(), stage: "checked" },
      { ...appliedReceipt(), sealed: undefined },
      { ...appliedReceipt(), quality_run_required: undefined },
    ])
      expect(() =>
        readOperationalAdoptionPreview({ ...applied(), applied_receipt: receipt }),
      ).toThrow("OPERATIONAL_RECEIPT_MISMATCH");
  });

  it("requires a matching current apply seal before quality and publication", () => {
    expect(operationalAdoptionReadiness(applied())).toEqual({
      canCheck: false,
      canApply: false,
      canQualityCheck: true,
      canPublish: false,
    });
    const ready = publishable();
    expect(operationalAdoptionReadiness(ready).canPublish).toBe(true);
    for (const invalid of [
      { ...ready, applied_receipt: null },
      { ...ready, sealed: false },
      { ...ready, current_snapshot: md5 },
      { ...ready, eligibility_revision: 834 },
      { ...ready, version_updated_at: "2026-10-02T18:00:01.000Z" },
      { ...ready, version_status: "published" as const },
    ]) {
      expect(operationalAdoptionReadiness(invalid).canQualityCheck).toBe(false);
      expect(operationalAdoptionReadiness(invalid).canPublish).toBe(false);
    }
  });

  it("rejects stale initial publication receipts unless the current published state still matches", () => {
    const valid = published();
    expect(readOperationalAdoptionPreview(valid)).toEqual(valid);
    for (const invalid of [
      { ...valid, version_status: "draft" },
      { ...valid, current_snapshot: md5 },
      { ...valid, eligibility_revision: 837 },
      { ...valid, version_updated_at: before },
      { ...valid, published_receipt: { ...valid.published_receipt!, sealed: false } },
      {
        ...valid,
        published_receipt: { ...valid.published_receipt!, version_updated_at: undefined },
      },
    ])
      expect(() => readOperationalAdoptionPreview(invalid)).toThrow("OPERATIONAL_RECEIPT_MISMATCH");
  });

  it("accepts a matching historical publication receipt when a later quality run exists", () => {
    const valid: OperationalAdoptionPreview = {
      ...published(),
      fresh_quality: {
        id: VERSION,
        eligibility_revision: 836,
        hard_conflicts_count: 0,
        created_at: "2026-10-02T18:03:00.000Z",
      },
    };
    expect(readOperationalAdoptionPreview(valid)).toEqual(valid);
    expect(operationalAdoptionReadiness(valid)).toEqual({
      canCheck: false,
      canApply: false,
      canQualityCheck: false,
      canPublish: false,
    });
  });

  it("rejects fake publish readiness, stale quality revisions, old quality runs, and hard conflicts", () => {
    const ready = publishable();
    for (const invalid of [
      { ...ready, publish_ready: false },
      { ...ready, fresh_quality: null },
      { ...ready, fresh_quality: { ...ready.fresh_quality!, eligibility_revision: 832 } },
      { ...ready, fresh_quality: { ...ready.fresh_quality!, created_at: before } },
      { ...ready, fresh_quality: { ...ready.fresh_quality!, hard_conflicts_count: 1 } },
    ])
      expect(operationalAdoptionReadiness(invalid).canPublish).toBe(false);
  });

  it("publishes only after refreshing authoritative readiness and matching the published receipt", async () => {
    const preview = publishable();
    const receipt = {
      ...appliedReceipt(),
      stage: "published",
      quality_run_id: qualityId,
    };
    const rpc = mockRpc(preview, receipt);
    expect(
      await executeOperationalAdoptionStage(rpc, "operational_publish", preview, null),
    ).toEqual(receipt);
    expect(rpc).toHaveBeenCalledTimes(2);
    const stale = mockRpc({ ...preview, publish_ready: false }, receipt);
    await expect(
      executeOperationalAdoptionStage(stale, "operational_publish", preview, null),
    ).rejects.toThrow("OPERATIONAL_STAGE_NOT_READY");
    expect(stale).toHaveBeenCalledTimes(1);
    for (const invalid of [
      { ...receipt, quality_run_id: undefined },
      { ...receipt, quality_run_id: VERSION },
      { ...receipt, after_snapshot: md5 },
    ])
      await expect(
        executeOperationalAdoptionStage(
          mockRpc(preview, invalid),
          "operational_publish",
          preview,
          null,
        ),
      ).rejects.toThrow("OPERATIONAL_RECEIPT_MISMATCH");
  });

  it("propagates authorization or server failures and never falls back to private helpers", async () => {
    const rpc = vi.fn<OperationalAdoptionRpc>(async () => ({
      data: null,
      error: { message: "SUPER_ADMIN_REQUIRED" },
    }));
    await expect(
      executeOperationalAdoptionStage(rpc, "operational_check", baseline(), null),
    ).rejects.toThrow("SUPER_ADMIN_REQUIRED");
    expect(rpc).toHaveBeenCalledExactlyOnceWith("itcs_operational_adoption_preview", {
      p_profile: OPERATIONAL_ADOPTION_PROFILE,
    });
  });
});
