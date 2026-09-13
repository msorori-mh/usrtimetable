import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Card } from "@/components/ui/card";
import { ClipboardList } from "lucide-react";
import { entityDisplayName } from "@/lib/entity-display";

export const Route = createFileRoute("/_authenticated/course-offerings")({
  head: () => ({ meta: [{ title: "مقررات الفصل" }] }),
  component: OfferingsPage,
});

interface Offering {
  id: string;
  college_id: string;
  term_id: string;
  course_id: string;
  program_id: string | null;
  level_id: string | null;
  expected_students: number;
  sections_count: number;
  notes: string | null;
  is_active: boolean;
  status: string;
}

/** Read-only diagnostic view — manual Create/Edit/Delete/import disabled (Phase 9.2). */
function OfferingsPage() {
  const { active } = useActiveCollege();

  const { data: terms } = useQuery({
    queryKey: ["terms-min", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("academic_terms")
          .select("id, name")
          .eq("college_id", active!.id)
          .order("start_date", { ascending: false })
      ).data ?? [],
  });
  const { data: courses } = useQuery({
    queryKey: ["courses-min", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("courses")
          .select("id, code, name")
          .eq("college_id", active!.id)
          .order("code")
      ).data ?? [],
  });
  const { data: programs } = useQuery({
    queryKey: ["programs-min", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("academic_programs")
          .select("id, name")
          .eq("college_id", active!.id)
          .order("name")
      ).data ?? [],
  });
  const { data: levels } = useQuery({
    queryKey: ["levels-min-ro", active?.id],
    enabled: !!active,
    queryFn: async () =>
      (
        await supabase
          .from("academic_levels")
          .select("id, name, program_id")
          .eq("college_id", active!.id)
          .order("level_number")
      ).data ?? [],
  });

  const { data: rows, isLoading } = useQuery({
    queryKey: ["offerings", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("course_offerings")
        .select("*")
        .eq("college_id", active!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as Offering[];
    },
  });

  const termMap = new Map((terms ?? []).map((t) => [t.id, t.name]));
  const courseMap = new Map((courses ?? []).map((c) => [c.id, entityDisplayName(c)]));
  const progMap = new Map((programs ?? []).map((p) => [p.id, p.name]));
  const levelMap = new Map((levels ?? []).map((l) => [l.id, l.name]));

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <ClipboardList className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">مقررات الفصل</h1>
          <p className="text-sm text-muted-foreground">
            الطروحات الأكاديمية طبقة توافق داخلية يتم توليدها آليًا من بيانات الدفعات والخطط
            الدراسية.
          </p>
        </div>
      </header>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
      </div>

      <Card className="mb-4 border-dashed p-4 text-sm text-muted-foreground">
        هذه الصفحة للتشخيص فقط (قراءة). لا يتوفر إنشاء أو تعديل أو حذف يدوي للطروحات. استخدم استيراد
        نموذج التسليم الأكاديمي V2 وتوليد المنهج للدفعة.
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-center text-muted-foreground">جارٍ التحميل...</p>
        ) : !rows || rows.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground">لا توجد طروحات بعد.</p>
        ) : (
          <ul className="divide-y divide-border">
            {rows.map((o) => (
              <li key={o.id} className="flex items-center justify-between p-4">
                <div>
                  <p className="font-semibold">{courseMap.get(o.course_id) ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">
                    {termMap.get(o.term_id) ?? "—"}
                    {o.program_id && ` · ${progMap.get(o.program_id) ?? ""}`}
                    {o.level_id && ` · ${levelMap.get(o.level_id) ?? ""}`}
                    {` · ${o.sections_count} مجموعة · ${o.expected_students} طالب`}
                    {o.status ? ` · ${o.status}` : ""}
                  </p>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
