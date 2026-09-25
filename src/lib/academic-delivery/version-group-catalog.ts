import { supabase } from "@/integrations/supabase/client";

export interface VersionGroupCatalogRow {
  id: string;
  cohort_id: string;
  plan_course_id: string;
  component_id: string;
  group_code: string;
  group_number: number;
  expected_students: number;
  capacity_limit: number | null;
  active: boolean;
  is_obsolete: boolean;
}

type CatalogRpc = {
  rpc(
    name: string,
    args: { p_version: string; p_cohorts: string[] },
  ): Promise<{ data: VersionGroupCatalogRow[] | null; error: { message: string } | null }>;
};

/** The database excludes groups that belong only to another schedule version. */
export async function fetchVersionGroupCatalog(
  versionId: string,
  cohortIds: readonly string[],
): Promise<VersionGroupCatalogRow[]> {
  const ids = [...new Set(cohortIds.filter(Boolean))];
  const rows = new Map<string, VersionGroupCatalogRow>();
  for (let i = 0; i < ids.length; i += 100) {
    const { data, error } = await (supabase as unknown as CatalogRpc).rpc(
      "schedule_version_delivery_group_catalog",
      { p_version: versionId, p_cohorts: ids.slice(i, i + 100) },
    );
    if (error) throw error;
    for (const row of data ?? []) rows.set(row.id, row);
  }
  return [...rows.values()];
}
