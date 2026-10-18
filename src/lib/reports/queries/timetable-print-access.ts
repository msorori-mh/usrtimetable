import { supabase } from "@/integrations/supabase/client";
import type { SVStatus } from "@/lib/schedule-versions/lifecycle";
import { DRAFT_PRINT_ADMIN_ONLY_AR } from "../timetable-print-access";

export interface PrintableScheduleVersion {
  id: string;
  name: string;
  status: SVStatus;
  college_id: string;
  academic_term_id: string;
  notes: string | null;
  updated_at: string;
}

/** Server authorization is mandatory even for a manually supplied version URL. */
export async function fetchPrintableScheduleVersion(
  versionId: string,
): Promise<PrintableScheduleVersion> {
  const client = supabase as unknown as {
    rpc(
      name: "get_timetable_print_version",
      args: { p_version_id: string },
    ): Promise<{
      data: PrintableScheduleVersion[] | null;
      error: { message: string } | null;
    }>;
  };
  const { data, error } = await client.rpc("get_timetable_print_version", {
    p_version_id: versionId,
  });
  if (error) {
    if (error.message.includes("DRAFT_PRINT_SUPER_ADMIN_ONLY"))
      throw new Error(DRAFT_PRINT_ADMIN_ONLY_AR);
    throw new Error(error.message);
  }
  if (!data?.[0]) throw new Error("تعذر تحديد نسخة الجدول المسموح بطباعتها.");
  return data[0];
}
