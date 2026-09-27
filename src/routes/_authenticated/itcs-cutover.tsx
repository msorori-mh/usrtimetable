import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { useCurrentUser } from "@/hooks/use-current-user";
import { supabase } from "@/integrations/supabase/client";
import {
  ITCS_DRAFT_ID,
  ITCS_PUBLISHED_ID,
  diffAgainstLive,
  targetPathRules,
  validateManifest,
  type CutoverManifest,
  type LiveSession,
} from "@/lib/itcs-cutover/manifest";

export const Route = createFileRoute("/_authenticated/itcs-cutover")({
  head: () => ({
    meta: [
      { title: "انتقال جدول كلية الحاسوب — مراجعة البيان" },
      { name: "description", content: "رفع بيان استعادة جدول ITCS ومعاينة الفروق والتحقق قبل النشر." },
      { property: "og:title", content: "انتقال جدول كلية الحاسوب" },
      { property: "og:description", content: "معاينة ومطابقة بيان استعادة جدول ITCS قبل النشر." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ItcsCutoverPage,
});

// Functions from the proposed migration 20260927c; absent until it is applied.
type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc = supabase.rpc.bind(supabase) as unknown as Rpc;

function ItcsCutoverPage() {
  const { data: me, isLoading } = useCurrentUser();
  const [manifest, setManifest] = useState<CutoverManifest | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [diff, setDiff] = useState<ReturnType<typeof diffAgainstLive> | null>(null);
  const [rules, setRules] = useState<ReturnType<typeof targetPathRules> | null>(null);
  const [server, setServer] = useState<Record<string, unknown> | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  if (isLoading) return <p className="p-6">جارٍ التحميل…</p>;
  if (!me?.isSuperAdmin) return <p className="p-6 text-destructive">هذه الصفحة متاحة لمدير النظام فقط.</p>;

  const add = (s: string) => setLog((l) => [...l, `${new Date().toISOString()} ${s}`]);

  async function onFile(file: File) {
    setManifest(null); setDiff(null); setRules(null); setServer(null);
    let raw: unknown;
    try { raw = JSON.parse(await file.text()); } catch { setErrors(["INVALID_JSON"]); return; }
    const v = validateManifest(raw);
    setErrors(v.errors);
    if (!v.manifest) { add(`رُفض البيان: ${v.errors.length} خطأ`); return; }
    const { data, error } = await supabase
      .from("schedule_sessions")
      .select("id, day_of_week, start_time, end_time, room_id, instructor_id, teaching_assignment_id, delivery_group_id, cohort_id")
      .eq("schedule_version_id", ITCS_DRAFT_ID);
    if (error) { setErrors([error.message]); return; }
    const live = (data ?? []) as (LiveSession & { delivery_group_id: string | null; cohort_id: string | null })[];
    const groups = new Map(live.map((s) => [s.id, s.delivery_group_id ?? s.cohort_id]));
    setManifest(v.manifest);
    setDiff(diffAgainstLive(v.manifest, live));
    setRules(targetPathRules(v.manifest, (id) => groups.get(id) ?? null));
    add(`قُرئ البيان: ${v.manifest.sessions.length} جلسة`);
  }

  async function serverPreview() {
    if (!manifest) return;
    setBusy(true);
    const { data, error } = await rpc("itcs_cutover_preview", { p_version: ITCS_DRAFT_ID, p_manifest: manifest });
    setBusy(false);
    if (error) { add(`HOLD — المعاينة من الخادم: ${error.message}`); return; }
    setServer(data as Record<string, unknown>); add("نجحت معاينة الخادم");
  }

  async function execute() {
    if (!manifest || !server) return;
    setBusy(true);
    const snap = await rpc("itcs_cutover_published_snapshot", { p_published: ITCS_PUBLISHED_ID });
    if (snap.error) { setBusy(false); add(`HOLD: ${snap.error.message}`); return; }
    const { data, error } = await rpc("itcs_cutover_execute", {
      p_version: ITCS_DRAFT_ID,
      p_published: ITCS_PUBLISHED_ID,
      p_manifest: manifest,
      p_manifest_sha: server["manifest_sha"],
      p_expected_before: server["before_snapshot"],
      p_expected_published_snapshot: snap.data,
    });
    setBusy(false);
    add(error ? `HOLD — أُلغيت العملية كاملة: ${error.message}` : `PASS: ${JSON.stringify(data)}`);
  }

  const clientOk =
    !!diff?.ok && !!rules && !rules.theory.length && !rules.lab.length && !rules.roomClashes &&
    !rules.overFourDays.length && !rules.singleDays;
  const pending = Number(server?.["pending_cross_college"] ?? 1);
  const serverOk = !!server && server["missing"] === 0 && server["drift"] === 0 && pending === 0;

  return (
    <div dir="rtl" className="space-y-4 p-6">
      <h1 className="text-2xl font-bold">انتقال جدول كلية الحاسوب وتقنية المعلومات</h1>
      <Card className="space-y-2 p-4">
        <p className="text-sm text-muted-foreground">ارفع ملف itcs_schedule_recovery_2026-09-27.json</p>
        <input type="file" accept="application/json" aria-label="ملف البيان"
          onChange={(e) => e.target.files?.[0] && void onFile(e.target.files[0])} />
        {errors.length > 0 && (
          <ul className="text-sm text-destructive">{errors.slice(0, 20).map((e) => <li key={e}>{e}</li>)}</ul>
        )}
      </Card>
      {diff && rules && (
        <Card className="grid gap-2 p-4 text-sm md:grid-cols-3">
          <Stat label="مفقودة" v={diff.missing.length} />
          <Stat label="انحراف عن المسودة" v={diff.drift.length} />
          <Stat label="زائدة في المسودة" v={diff.extra.length} />
          <Stat label="نظري خارج 08–14" v={rules.theory.length} />
          <Stat label="عملي خارج 08–16" v={rules.lab.length} />
          <Stat label="تعارض قاعات" v={rules.roomClashes} />
          <Stat label="مجموعات فوق 4 أيام" v={rules.overFourDays.length} />
          <Stat label="أيام بمحاضرة واحدة" v={rules.singleDays} />
          <Stat label="طلبات بين كليات غير معتمدة" v={server ? pending : "—"} />
        </Card>
      )}
      <div className="flex gap-2">
        <Button disabled={!clientOk || busy} onClick={() => void serverPreview()}>معاينة من الخادم</Button>
        <Button variant="destructive" disabled={!clientOk || !serverOk || busy} onClick={() => void execute()}>
          تنفيذ الانتقال والنشر
        </Button>
      </div>
      <Card className="p-4">
        <h2 className="mb-2 font-semibold">سجل العمليات</h2>
        <pre className="whitespace-pre-wrap text-xs">{log.join("\n") || "—"}</pre>
      </Card>
    </div>
  );
}

function Stat({ label, v }: { label: string; v: number | string }) {
  return (
    <div className="flex items-center justify-between rounded border p-2">
      <span>{label}</span>
      <Badge variant={v === 0 ? "secondary" : "destructive"}>{v}</Badge>
    </div>
  );
}
