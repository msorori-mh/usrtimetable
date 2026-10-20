import { facultyWorkflow } from "@/lib/instructors/faculty-workflow";
import { useQuery } from "@tanstack/react-query";
import { useState } from "react";
import { useAccessibleColleges, useActiveCollege } from "@/hooks/use-colleges";
import { useCurrentUser } from "@/hooks/use-current-user";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { matchesInstructorSearch } from "@/lib/instructors/directory-filters";
import {
  canSearchUniversityRoster,
  collegesInUniversity,
  distinctUniversityRosterHits,
  type UniversityRosterHit,
} from "@/lib/instructors/university-roster-search";
import { formatNumber } from "@/lib/format";
import type { InstructorJump } from "@/hooks/use-instructor-directory";

/** Super-admin search across the colleges of the current university (split from instructors.tsx, L-14). */
export function UniversityInstructorSearch({
  onOpenResult,
}: {
  onOpenResult: (target: InstructorJump) => void;
}) {
  const { active } = useActiveCollege();
  const { data: me } = useCurrentUser();
  const { data: accessibleColleges } = useAccessibleColleges();
  const [search, setSearch] = useState("");
  const colleges = collegesInUniversity(accessibleColleges ?? [], active?.university_id);
  const canSearch = canSearchUniversityRoster(me?.isSuperAdmin === true, search);

  const universityRoster = useQuery({
    queryKey: [
      "instructors",
      "university-roster",
      me?.id,
      active?.university_id,
      colleges.map((c) => c.id),
    ],
    enabled: !!active && colleges.length > 0 && canSearch,
    staleTime: 60_000,
    queryFn: async (): Promise<UniversityRosterHit[]> => {
      if (!me?.isSuperAdmin || !active) throw new Error("FORBIDDEN");
      const batches = await Promise.all(
        colleges.flatMap((college) =>
          (["home", "pending"] as const).map(async (scope) => {
            const { data, error } = await facultyWorkflow.rpc("get_college_faculty_roster", {
              p_college_id: college.id,
              p_scope: scope,
            });
            if (error) throw error;
            return (data ?? []).map((row) => ({
              row,
              collegeId: college.id,
              collegeName: college.name,
              scope,
            }));
          }),
        ),
      );
      return distinctUniversityRosterHits(batches.flat());
    },
  });

  if (me?.isSuperAdmin !== true) return null;
  const matches = canSearch
    ? (universityRoster.data ?? []).filter(({ row }) =>
        matchesInstructorSearch(row, search, row.home_department),
      )
    : [];

  return (
    <Card className="mb-4 space-y-3 p-4" data-testid="super-admin-university-search">
      <div>
        <Label htmlFor="university-instructor-search">البحث عن محاضر في الجامعة</Label>
        <p className="text-xs text-muted-foreground">
          يبحث في الكليات التابعة للجامعة الحالية دون الحاجة لاختيار كلية المحاضر أولاً.
        </p>
      </div>
      <Input
        id="university-instructor-search"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
        placeholder="اسم المحاضر أو رقمه الجامعي أو الوظيفي…"
      />
      {!canSearch ? (
        <p className="text-sm text-muted-foreground">أدخل حرفين على الأقل لبدء البحث.</p>
      ) : colleges.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          لا توجد كليات متاحة للبحث في الجامعة الحالية.
        </p>
      ) : universityRoster.isError ? (
        <div role="alert" className="flex items-center gap-2 text-sm">
          <span>تعذر البحث في كليات الجامعة.</span>
          <Button size="sm" variant="outline" onClick={() => void universityRoster.refetch()}>
            إعادة المحاولة
          </Button>
        </div>
      ) : universityRoster.isPending ? (
        <p className="text-sm text-muted-foreground" role="status">
          جارٍ البحث في الكليات…
        </p>
      ) : (
        <div aria-live="polite" className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {matches.length === 0
              ? "لا توجد نتائج مطابقة في الجامعة الحالية."
              : `عُثر على ${formatNumber(matches.length)} محاضر${matches.length > 30 ? "، تُعرض أول 30 نتيجة" : ""}.`}
          </p>
          {matches.length > 0 && (
            <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
              {matches.slice(0, 30).map(({ row, collegeId, collegeName, scope }) => (
                <li
                  key={row.identity_id || row.id}
                  className="flex flex-wrap items-center justify-between gap-2 p-3"
                >
                  <div>
                    <p className="font-medium">{row.full_name}</p>
                    <p className="text-xs text-muted-foreground">
                      {collegeName} ·{" "}
                      {scope === "pending"
                        ? "تبعية تحتاج مراجعة"
                        : (row.home_department ?? "بدون قسم")}
                      {row.university_number ? ` · ${row.university_number}` : ""}
                    </p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      onOpenResult({
                        collegeId,
                        scope,
                        search: row.university_number || row.full_name,
                      })
                    }
                  >
                    فتح في الكلية
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}
