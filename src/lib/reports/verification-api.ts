import { supabase } from "@/integrations/supabase/client";
import type { VerificationReportKind } from "./verification-link";

export interface ReportVerification {
  available: boolean;
  college_name?: string;
  term_name?: string;
  version_name?: string;
  report_kind?: VerificationReportKind;
  status?: "published";
  issued_at?: string;
  version_updated_at?: string;
  unchanged?: boolean;
  is_latest?: boolean;
}

type VerificationRpc = {
  rpc(
    name: "issue_report_verification",
    args: { p_version_id: string; p_report_kind: VerificationReportKind },
  ): PromiseLike<{ data: string | null; error: unknown }>;
  rpc(
    name: "resolve_report_verification",
    args: { p_receipt_id: string },
  ): PromiseLike<{ data: ReportVerification | null; error: unknown }>;
};
// Narrow RPC contract avoids editing the generated database types.
const api = supabase as unknown as VerificationRpc;
const pending = new Map<string, Promise<string | null>>();
export function issueReportVerification(versionId: string, kind: VerificationReportKind) {
  const key = `${versionId}:${kind}`;
  const existing = pending.get(key);
  if (existing) return existing;
  const request = (async () => {
    const { data, error } = await api.rpc("issue_report_verification", {
      p_version_id: versionId,
      p_report_kind: kind,
    });
    if (error) throw new Error("تعذر إنشاء مرجع التحقق");
    return data;
  })().finally(() => pending.delete(key));
  pending.set(key, request);
  return request;
}
export async function resolveReportVerification(receiptId: string) {
  const { data, error } = await api.rpc("resolve_report_verification", { p_receipt_id: receiptId });
  if (error) throw new Error("تعذر الاتصال بخدمة التحقق. حاول مجددًا.");
  return data;
}
