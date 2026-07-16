import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Card } from "@/components/ui/card";
import { ClipboardList } from "lucide-react";

export const Route = createFileRoute("/_authenticated/course-offerings")({
  head: () => ({ meta: [{ title: "مقررات الفصل (داخلي)" }] }),
  component: OfferingsPage,
});

interface Offering {
  id: string;
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

function OfferingsPage() {
  const { active } = useActiveCollege();

  const { data: terms } = useQuery({
    queryKey: ["terms-min", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data } = await supabase
        .from("academic_terms")
        .select("id, name")
        .eq("college_id", active!.id);
      return data ?? [];
    },
  });

  const { data: courses } = useQuery({
    queryKey: ["courses-min", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data } = await supabase
        .from("courses")
        .select("id, code, name")
        .eq("college_id", active!.id);
      return data ?? [];
    },
  });

  const { data: programs } = useQuery({
    queryKey: ["programs-min", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data } = await supabase
        .from("academic_programs")
        .select("id, name")
        .eq("college_id", active!.id);
      return data ?? [];
    },
  });

  const { data: levels } = useQuery({
    queryKey: ["levels-min-all", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data } = await supabase
        .from("academic_levels")
        .select("id, name")
        .eq("college_id", active!.id);
      return data ?? [];
    },
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

  if (!active) {
    return (
      <div className="p-6">
        <CollegeSwitcher />
        <p className="mt-4 text-muted-foreground">اختر كلّية للبدء.</p>
      </div>
    );
  }

  const termMap = new Map((terms ?? []).map((t) => [t.id, t.name]));
  const courseMap = new Map((courses ?? []).map((c) => [c.id, `${c.code} — ${c.name}`]));
  const progMap = new Map((programs ?? []).map((p) => [p.id, p.name]));
  const levelMap = new Map((levels ?? []).map((l) => [l.id, l.name]));

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <ClipboardList className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">مقررات الفصل (طبقة داخلية)</h1>
          <p className="text-sm text-muted-foreground">
            طبقة توافق مولَّدة آليًا من نموذج التسليم V2 — ليست مسارًا تشغيليًا لإنشاء/تعديل يدوي.
          </p>
        </div>
      </header>

      <Card className="mb-4 border-amber-500/40 bg-amber-500/5 p-4 text-sm">
        <p className="font-medium">Phase 9.2 — مسار تشغيلي مغلق</p>
        <p className="mt-1 text-muted-foreground">
          يُنشئ مولّد الدفعات سجلات course_offerings تلقائيًا للتوافق مع Schedule Builder. الإنشاء
          والتعديل اليدوي معطّلان في الواجهة التشغيلية. هذه الصفحة للتشخيص فقط.
        </p>
      </Card>

      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        <p className="text-xs text-muted-foreground">
          الإنشاء اليدوي معطّل — استخدم استيراد الدفعات ثم مولّد V2.
        </p>
      </div>

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
                    {o.notes?.startsWith("elective:") ? " · اختياري" : ""}
                  </p>
                </div>
                <span className="text-xs text-muted-foreground">للقراءة فقط</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
