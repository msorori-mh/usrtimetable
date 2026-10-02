import { z } from "zod";
import type { Database } from "@/integrations/supabase/types";

export const OPERATIONAL_ADOPTION_PROFILE = "itcs_current_operational_20261002";

const fingerprint = z.string().regex(/^[a-f0-9]{32}$/);
const timestamp = z.string().refine((value) => Number.isFinite(Date.parse(value)));
const revision = z.number().int().nonnegative();
const identity = {
  profile: z.literal(OPERATIONAL_ADOPTION_PROFILE),
  // The authenticated private-registry preview supplies owned identities;
  // every receipt and refreshed reference must still match them exactly.
  version_id: z.string().uuid(),
  published_version_id: z.string().uuid(),
  college_id: z.string().uuid(),
  term_id: z.string().uuid(),
  manifest_sha: fingerprint,
};

const countsSchema = z.object({
  sessions: z.literal(273),
  hours: z.literal(624),
  assignment_changes: z.literal(39),
  placement_changes: z.literal(29),
  joint_session_changes: z.literal(55),
  withdrawals: z.literal(31),
  promoted_reuses: z.literal(4),
  inactive_links: z.literal(5),
  preserved_inactive_scopes: z.literal(6),
});

const receiptSchema = z.object({
  ...identity,
  ok: z.literal(true),
  stage: z.enum(["checked", "applied", "published"]),
  counts: countsSchema,
  after_snapshot: fingerprint,
  rolled_back: z.boolean(),
  sealed: z.boolean().optional(),
  revision: revision.optional(),
  version_updated_at: timestamp.optional(),
  created_at: timestamp,
  quality_run_required: z.boolean().optional(),
  quality_run_id: z.string().uuid().optional(),
});

const previewSchema = z.object({
  ...identity,
  ok: z.literal(true),
  published_snapshot: fingerprint,
  current_snapshot: fingerprint,
  version_status: z.enum(["draft", "review", "approved", "published", "archived"]),
  version_updated_at: timestamp,
  eligibility_revision: revision,
  expected_version_status: z.literal("review"),
  expected_version_updated_at: timestamp,
  expected_eligibility_revision: revision,
  counts: countsSchema,
  baseline_matches: z.boolean(),
  sealed: z.boolean(),
  applied_receipt: receiptSchema.nullable(),
  published_receipt: receiptSchema.nullable(),
  fresh_quality: z
    .object({
      id: z.string().uuid(),
      eligibility_revision: revision,
      hard_conflicts_count: z.number().int().nonnegative(),
      created_at: timestamp,
    })
    .nullable(),
  publish_ready: z.boolean(),
  waiting: z.object({
    net_student_hours: z.literal(-57),
    worsened_students: z.literal(149),
    worsened_student_hours: z.literal(243),
    added_student_days: z.literal(0),
  }),
  limitations: z.array(z.string()),
});

export type OperationalAdoptionPreview = z.infer<typeof previewSchema>;
export type OperationalAdoptionReceipt = z.infer<typeof receiptSchema>;
export type OperationalAdoptionStage =
  "operational_check" | "operational_apply" | "operational_publish";
type OperationalAdoptionRpcName = "itcs_operational_adoption_preview" | "itcs_cutover_execute";
export type OperationalAdoptionRpc = <Name extends OperationalAdoptionRpcName>(
  name: Name,
  args: Database["public"]["Functions"][Name]["Args"],
) => Promise<{ data: unknown; error: { message: string } | null }>;

function receiptMatches(receipt: OperationalAdoptionReceipt, preview: OperationalAdoptionPreview) {
  return (
    receipt.profile === preview.profile &&
    receipt.version_id === preview.version_id &&
    receipt.published_version_id === preview.published_version_id &&
    receipt.college_id === preview.college_id &&
    receipt.term_id === preview.term_id &&
    receipt.manifest_sha === preview.manifest_sha
  );
}

export function readOperationalAdoptionPreview(data: unknown): OperationalAdoptionPreview {
  const parsed = previewSchema.safeParse(data);
  if (!parsed.success) throw new Error("OPERATIONAL_PREVIEW_INVALID");
  const preview = parsed.data;
  for (const [receipt, stage] of [
    [preview.applied_receipt, "applied"],
    [preview.published_receipt, "published"],
  ] as const) {
    if (
      receipt &&
      (!receiptMatches(receipt, preview) ||
        receipt.stage !== stage ||
        receipt.rolled_back ||
        receipt.revision === undefined ||
        (stage === "applied" &&
          (receipt.sealed !== true ||
            !receipt.version_updated_at ||
            receipt.quality_run_required !== true)) ||
        (stage === "published" &&
          (!receipt.quality_run_id ||
            receipt.sealed !== true ||
            preview.version_status !== "published" ||
            receipt.after_snapshot !== preview.current_snapshot ||
            receipt.revision !== preview.eligibility_revision ||
            receipt.version_updated_at !== preview.version_updated_at)))
    )
      throw new Error("OPERATIONAL_RECEIPT_MISMATCH");
  }
  return preview;
}

export async function fetchOperationalAdoptionPreview(
  rpc: OperationalAdoptionRpc,
): Promise<OperationalAdoptionPreview> {
  const { data, error } = await rpc("itcs_operational_adoption_preview", {
    p_profile: OPERATIONAL_ADOPTION_PROFILE,
  });
  if (error) throw new Error(error.message);
  return readOperationalAdoptionPreview(data);
}

/** The reference is taken only from the authenticated, registered server preview. */
export function operationalAdoptionReference(preview: OperationalAdoptionPreview): string {
  return JSON.stringify([
    preview.profile,
    preview.version_id,
    preview.published_version_id,
    preview.college_id,
    preview.term_id,
    preview.manifest_sha,
    preview.published_snapshot,
    preview.current_snapshot,
    preview.version_status,
    preview.version_updated_at,
    preview.eligibility_revision,
  ]);
}

export function operationalAdoptionReadiness(preview: OperationalAdoptionPreview | null) {
  const canCheck =
    !!preview &&
    !preview.applied_receipt &&
    !preview.published_receipt &&
    preview.baseline_matches &&
    preview.version_status === "review" &&
    preview.version_status === preview.expected_version_status &&
    preview.version_updated_at === preview.expected_version_updated_at &&
    preview.eligibility_revision === preview.expected_eligibility_revision;
  const applied = preview?.applied_receipt;
  const sealed =
    !!preview &&
    !!applied &&
    receiptMatches(applied, preview) &&
    applied.stage === "applied" &&
    applied.rolled_back === false &&
    applied.sealed === true &&
    applied.revision === preview.eligibility_revision &&
    applied.version_updated_at === preview.version_updated_at &&
    applied.after_snapshot === preview.current_snapshot &&
    preview.sealed === true &&
    preview.version_status === "draft" &&
    !preview.published_receipt;
  const quality = preview?.fresh_quality;
  const freshQuality =
    sealed &&
    !!quality &&
    quality.eligibility_revision === preview.eligibility_revision &&
    quality.hard_conflicts_count === 0 &&
    !!applied?.created_at &&
    Date.parse(quality.created_at) >= Date.parse(applied.created_at);
  return {
    canCheck,
    canApply: canCheck,
    canQualityCheck: sealed,
    canPublish: freshQuality && preview?.publish_ready === true,
  };
}

export async function executeOperationalAdoptionStage(
  rpc: OperationalAdoptionRpc,
  stage: OperationalAdoptionStage,
  reviewed: OperationalAdoptionPreview,
  checkedReference: string | null,
): Promise<OperationalAdoptionReceipt> {
  // Refresh before sending the exact reviewed CAS reference. Never silently
  // apply a different reference while an impact confirmation is open.
  const fresh = await fetchOperationalAdoptionPreview(rpc);
  if (operationalAdoptionReference(fresh) !== operationalAdoptionReference(reviewed))
    throw new Error("OPERATIONAL_REFERENCE_CHANGED");
  const ready = operationalAdoptionReadiness(fresh);
  if (
    (stage === "operational_check" && !ready.canCheck) ||
    (stage === "operational_apply" &&
      (!ready.canApply || checkedReference !== operationalAdoptionReference(fresh))) ||
    (stage === "operational_publish" && !ready.canPublish)
  )
    throw new Error("OPERATIONAL_STAGE_NOT_READY");

  const { data, error } = await rpc("itcs_cutover_execute", {
    p_stage: stage,
    p_version: fresh.version_id,
    p_published: fresh.published_version_id,
    p_manifest: { profile: fresh.profile },
    p_manifest_sha: fresh.manifest_sha,
    p_expected_published_snapshot: fresh.published_snapshot,
  });
  if (error) throw new Error(error.message);
  const parsed = receiptSchema.safeParse(data);
  if (!parsed.success || !receiptMatches(parsed.data, fresh))
    throw new Error("OPERATIONAL_RECEIPT_MISMATCH");
  const receipt = parsed.data;
  const expectedStage = {
    operational_check: "checked",
    operational_apply: "applied",
    operational_publish: "published",
  }[stage];
  if (
    receipt.stage !== expectedStage ||
    receipt.rolled_back !== (stage === "operational_check") ||
    (stage === "operational_apply" &&
      (receipt.sealed !== true ||
        receipt.revision === undefined ||
        !receipt.version_updated_at ||
        !receipt.created_at ||
        receipt.quality_run_required !== true)) ||
    (stage === "operational_publish" &&
      (!receipt.quality_run_id ||
        receipt.quality_run_id !== fresh.fresh_quality?.id ||
        receipt.after_snapshot !== fresh.current_snapshot ||
        receipt.revision === undefined))
  )
    throw new Error("OPERATIONAL_RECEIPT_MISMATCH");
  return receipt;
}
