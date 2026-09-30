import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { useCurrentUser } from "@/hooks/use-current-user";
import { listUnresolvedRows, suggestForRow } from "@/lib/unresolved-row-suggestions.functions";

export const Route = createFileRoute("/_authenticated/unresolved-suggestions")({
  head: () => ({
    meta: [
      { title: "اقتراح بدائل للصفوف غير المحلولة — نظام الجداول" },
      { name: "description", content: "اقتراحات قاعات وأوقات بالذكاء الاصطناعي مع فحص تعارضات آلي." },
      { property: "og:title", content: "اقتراح بدائل للصفوف غير المحلولة" },
      { property: "og:description", content: "اقتراحات قاعات وأوقات مع فحص تعارضات القاعات والمحاضرين والمجموعات." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: Page,
});

function Page() {
  const { data: me, isLoading } = useCurrentUser();
  if (isLoading) return <p className="p-6">جارٍ التحميل…</p>;
  if (!me?.isSuperAdmin) return <p className="p-6">هذه الصفحة لمسؤولي النظام فقط.</p>;
  return <Workspace />;
}

function Workspace() {
  const list = useServerFn(listUnresolvedRows);
  const suggest = useServerFn(suggestForRow);
  const rows = useQuery({ queryKey: ["unresolved-rows"], queryFn: () => list() });
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const run = useMutation({ mutationFn: (rowId: string) => suggest({ data: { rowId } }) });

  const filtered = useMemo(
    () =>
      (rows.data ?? []).filter((r) =>
        [r.raw_course, r.raw_teacher, r.college_name, r.raw_room].join(" ").includes(q),
      ),
    [rows.data, q],
  );

  return (
    <div dir="rtl" className="mx-auto max-w-6xl space-y-4 p-6">
      <h1 className="text-2xl font-bold">اقتراح بدائل للصفوف غير المحلولة</h1>
      <p className="text-sm text-muted-foreground">
        اختر صفًا من الجداول المصدرية لم يتحول إلى جلسة. يحسب النظام القاعات والأوقات الخالية من
        التعارض، ويرتّبها النموذج، ثم يُعاد فحص كل اقتراح آليًا. لا يُحفظ أي تغيير من هذه الصفحة.
      </p>
      <div className="grid gap-4 md:grid-cols-[1fr_1.3fr]">
        <Card className="space-y-2 p-3">
          <Input placeholder="بحث بالمقرر أو المحاضر أو الكلية" value={q} onChange={(e) => setQ(e.target.value)} />
          {rows.isPending ? (
            <p role="status">جارٍ تحميل الصفوف…</p>
          ) : rows.error ? (
            <p role="alert">{(rows.error as Error).message}</p>
          ) : (
            <>
              <p className="text-xs text-muted-foreground">{filtered.length} صفًا غير محلول</p>
              <ul className="max-h-[70vh] divide-y overflow-auto">
                {filtered.map((r) => (
                  <li key={r.id}>
                    <button
                      className={`w-full p-2 text-right text-sm hover:bg-muted ${selected === r.id ? "bg-muted" : ""}`}
                      onClick={() => {
                        setSelected(r.id);
                        run.mutate(r.id);
                      }}
                    >
                      <b>{r.raw_course || "بدون اسم مقرر"}</b> · {r.raw_teacher || "—"}
                      <div className="text-xs text-muted-foreground">
                        {r.college_name} · {r.raw_day || "—"} {r.raw_time || ""} · {r.raw_room || "بلا قاعة"}
                      </div>
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </Card>
        <Card className="space-y-3 p-4">
          {!selected ? (
            <p>اختر صفًا لعرض الاقتراحات.</p>
          ) : run.isPending ? (
            <p role="status">جارٍ حساب البدائل وفحصها…</p>
          ) : run.error ? (
            <div role="alert" className="space-y-2">
              <p>{(run.error as Error).message}</p>
              <Button variant="outline" onClick={() => run.mutate(selected)}>إعادة المحاولة</Button>
            </div>
          ) : run.data ? (
            <Result data={run.data} />
          ) : null}
        </Card>
      </div>
    </div>
  );
}

function Result({ data }: { data: Awaited<ReturnType<typeof suggestForRow>> }) {
  return (
    <div className="space-y-3">
      <div className="text-sm">
        <b>{data.row.course}</b> · {data.row.teacher || "—"} · {data.row.students || "عدد غير معروف"} طالبًا ·{" "}
        {data.row.practical ? "عملي" : "نظري"} · {data.row.duration_minutes} دقيقة
        <div className="text-xs text-muted-foreground">
          الأصل: {data.row.original.day || "—"} {data.row.original.time || ""} · {data.row.original.room || "—"}
        </div>
      </div>
      <p className="text-xs text-muted-foreground">
        قاعات مؤهلة {data.stats.eligible_rooms} · بدائل خالية من التعارض {data.stats.conflict_free_candidates} ·
        جلسات فُحصت {data.stats.sessions_checked}
        {!data.stats.teachers_known && " · تنبيه: لا محاضر مرتبط، لم يُفحص تعارض المحاضر"}
        {!data.stats.group_known && " · تنبيه: لا مجموعة مرتبطة، لم يُفحص تعارض المجموعة"}
      </p>
      {data.ai_error && <p className="text-sm text-destructive">{data.ai_error} — عُرض ترتيب آلي بدلًا منه.</p>}
      {data.suggestions.length === 0 ? (
        <p>لا يوجد بديل خالٍ من التعارض ضمن قاعات الكلية وأوقات الدوام.</p>
      ) : (
        <ul className="space-y-2">
          {data.suggestions.map((s) => (
            <li key={`${s.room_id}${s.day_of_week}${s.start_time}`} className="rounded border p-3 text-sm">
              <div className="flex items-center justify-between gap-2">
                <b>
                  {s.day_label} {s.start_time}–{s.end_time} · {s.room_label} (سعة {s.room_capacity})
                </b>
                <Badge variant={s.valid ? "default" : "destructive"}>{s.valid ? "بلا تعارض" : "تعارض"}</Badge>
              </div>
              <p className="text-muted-foreground">{s.reason}</p>
              {!s.valid && (
                <p className="text-destructive">
                  {[...s.checks.room, ...s.checks.instructor, ...s.checks.group].join("، ")}
                </p>
              )}
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">
        {data.ai_used ? "رُتبت بواسطة الذكاء الاصطناعي." : ""} التطبيق الفعلي يتم من محرر الجدول عبر مسار الحفظ المعتمد.
      </p>
    </div>
  );
}
