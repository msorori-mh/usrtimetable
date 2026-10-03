import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useCurrentUser } from "@/hooks/use-current-user";
import { supabase } from "@/integrations/supabase/client";
import { scoreScheduleVersion } from "@/lib/conflict-engine/scorer";
import { invalidateTeachingAssignmentReadModels } from "@/lib/teaching-assignments/query-invalidation";
import {
  executeOperationalAdoptionStage,
  fetchOperationalAdoptionPreview,
  operationalAdoptionReadiness,
  operationalAdoptionReference,
  type OperationalAdoptionPreview,
  type OperationalAdoptionReceipt,
  type OperationalAdoptionRpc,
  type OperationalAdoptionStage,
} from "@/lib/itcs-cutover/operational-adoption";
import {
  RELAYOUT_PROFILE,
  MANIFEST_FILE,
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
      {
        name: "description",
        content: "رفع بيان استعادة جدول ITCS ومعاينة الفروق والتحقق قبل النشر.",
      },
      { property: "og:title", content: "انتقال جدول كلية الحاسوب" },
      { property: "og:description", content: "معاينة ومطابقة بيان استعادة جدول ITCS قبل النشر." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ItcsCutoverPage,
});

// Authenticated entrypoints for the reviewed, version-scoped September cutover.
type Rpc = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ data: unknown; error: { message: string } | null }>;
const rpc = supabase.rpc.bind(supabase) as unknown as Rpc;
const operationalRpc: OperationalAdoptionRpc = async (name, args) => {
  const { data, error } = await supabase.rpc(name, args);
  return { data, error };
};
const operationalLimitationLabels: Record<string, string> = {
  "Read-only planning verification is not authenticated execution proof.":
    "نتائج التخطيط وحدها لا تعني اعتماد الجدول؛ يلزم نجاح الفحص والتطبيق من هذه الصفحة.",
  "Some student partitions still wait longer; no global optimum is claimed.":
    "ما زال انتظار بعض الشعب أطول؛ الخطة لا تحقق أفضل نتيجة لجميع الطلاب.",
  "Execution requires a real authenticated Super Admin and fresh official validation.":
    "يشترط الاعتماد حساب مدير النظام وفحصًا رسميًا حديثًا.",
};
type Stage = "requests" | "approve" | "apply" | "rooms" | "publish";
type Repl = {
  replaces: string;
  cross_college: boolean;
  state: string;
  scoped_request: string | null;
};

function ItcsCutoverPage() {
  const queryClient = useQueryClient();
  const { data: me, isLoading } = useCurrentUser();
  const [manifest, setManifest] = useState<CutoverManifest | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [diff, setDiff] = useState<ReturnType<typeof diffAgainstLive> | null>(null);
  const [rules, setRules] = useState<ReturnType<typeof targetPathRules> | null>(null);
  const [server, setServer] = useState<Record<string, unknown> | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [manifestText, setManifestText] = useState("");

  if (isLoading) return <p className="p-6">جارٍ التحميل…</p>;
  if (!me?.isSuperAdmin)
    return <p className="p-6 text-destructive">هذه الصفحة متاحة لمدير النظام فقط.</p>;

  const add = (s: string) => setLog((l) => [...l, `${new Date().toISOString()} ${s}`]);

  async function onText(text: string) {
    setManifest(null);
    setDiff(null);
    setRules(null);
    setServer(null);
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      setErrors(["INVALID_JSON"]);
      return;
    }
    const v = validateManifest(raw);
    setErrors(v.errors);
    if (!v.manifest) {
      add(`رُفض البيان: ${v.errors.length} خطأ`);
      return;
    }
    const { data, error } = await supabase
      .from("schedule_sessions")
      .select(
        "id, day_of_week, start_time, end_time, room_id, instructor_id, teaching_assignment_id, delivery_group_id, cohort_id",
      )
      .eq("schedule_version_id", v.manifest.draft_version_id);
    if (error) {
      setErrors([error.message]);
      return;
    }
    const live = (data ?? []) as (LiveSession & {
      delivery_group_id: string | null;
      cohort_id: string | null;
    })[];
    const groupIds = [...new Set(live.map((s) => s.delivery_group_id).filter(Boolean))] as string[];
    const [members, preview] = await Promise.all([
      rpc("itcs_cutover_session_units", { p_version: v.manifest.draft_version_id }),
      rpc(
        v.manifest["profile"] === RELAYOUT_PROFILE
          ? "itcs_relayout_preview"
          : "itcs_cutover_preview",
        { p_version: v.manifest.draft_version_id, p_manifest: v.manifest },
      ),
    ]);
    if (members.error || preview.error) {
      setErrors([(members.error ?? preview.error)!.message]);
      return;
    }
    const units = new Map<string, string[]>();
    for (const r of (members.data ?? []) as { session_id: string; unit: string }[])
      units.set(r.session_id, [...(units.get(r.session_id) ?? []), r.unit]);
    const state = preview.data as Record<string, unknown>;
    const replacements = (state["replacements"] ?? []) as {
      replaces: string;
      scoped_assignment: string | null;
      instructor: string;
    }[];
    const scoped = new Map(
      replacements
        .filter((r) => r.scoped_assignment)
        .map((r) => [
          r.replaces,
          { assignment_id: r.scoped_assignment!, instructor_id: r.instructor },
        ]),
    );
    setManifest(v.manifest);
    setDiff(diffAgainstLive(v.manifest, live, scoped));
    setRules(targetPathRules(v.manifest, (id) => units.get(id) ?? []));
    setServer(state);
    add(`قُرئ البيان: ${v.manifest.sessions.length} جلسة، ${groupIds.length} مجموعة`);
  }

  async function serverPreview() {
    if (!manifest) return;
    setBusy(true);
    const { data, error } = await rpc(
      manifest["profile"] === RELAYOUT_PROFILE ? "itcs_relayout_preview" : "itcs_cutover_preview",
      {
        p_version: manifest.draft_version_id,
        p_manifest: manifest,
      },
    );
    setBusy(false);
    if (error) {
      add(`HOLD — المعاينة من الخادم: ${error.message}`);
      return;
    }
    setServer(data as Record<string, unknown>);
    add("نجحت معاينة الخادم");
  }

  async function runStage(stage: Stage) {
    if (!manifest || !server) return;
    const targetVersion =
      typeof server["relayout_version_id"] === "string"
        ? server["relayout_version_id"]
        : manifest.draft_version_id;
    setBusy(true);
    try {
      const snap = await rpc("itcs_cutover_published_snapshot", {
        p_published: manifest.published_version_id,
      });
      if (snap.error) throw new Error(snap.error.message);
      if (stage === "publish") {
        // Official quality pipeline: snapshot revision -> score -> persist_schedule_quality_run.
        const ver = await supabase
          .from("schedule_versions")
          .select("college_id")
          .eq("id", targetVersion)
          .single();
        if (ver.error || !ver.data) throw new Error(ver.error?.message ?? "VERSION_NOT_FOUND");
        const q = await scoreScheduleVersion({
          collegeId: ver.data.college_id,
          scheduleVersionId: targetVersion,
          persist: true,
        }).catch((e: Error) => {
          throw new Error(`QUALITY_RUN_FAILED: ${e.message}`);
        });
        add(
          `فحص الجودة: ${q.result.total_score} — تعارضات إلزامية ${q.result.hard_conflicts_count}`,
        );
        if (q.result.hard_conflicts_count !== 0) throw new Error("QUALITY_HARD_CONFLICTS");
      }
      const { data, error } = await rpc("itcs_cutover_execute", {
        p_stage: stage,
        p_version: targetVersion,
        p_published: manifest.published_version_id,
        p_manifest: manifest,
        p_manifest_sha: server["manifest_sha"],
        p_expected_published_snapshot: snap.data,
      });
      if (error) throw new Error(error.message);
      add(`PASS ${stage}: ${JSON.stringify(data)}`);
      await invalidateTeachingAssignmentReadModels(queryClient);
      await serverPreview();
    } catch (e) {
      add(`HOLD — أُلغيت المرحلة ${stage} كاملة: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const structuralOk = !!diff?.ok;
  const repl = (server?.["replacements"] as Repl[] | undefined) ?? [];
  const crossPending = Number(
    server?.["cross_college_not_applied"] ?? manifest?.replacements.length ?? 0,
  );
  const serverOk =
    !!server &&
    server["missing"] === 0 &&
    server["drift"] === 0 &&
    server["extra"] === 0 &&
    server["identity_ok"] === true &&
    server["version_status"] === "draft";
  const applied = ((server?.["runs"] as { stage: string }[] | undefined) ?? []).some(
    (r) => r.stage === "applied",
  );

  return (
    <div dir="rtl" className="space-y-4 p-6">
      <h1 className="text-2xl font-bold">انتقال جدول كلية الحاسوب وتقنية المعلومات</h1>
      <OperationalAdoptionSection busy={busy} onBusy={setBusy} />
      <Card className="space-y-2 p-4">
        <p className="font-medium">المقترح 15 — نسخة المراجعة 30/9</p>
        <p className="text-sm text-muted-foreground">
          مسودة المقترح كاملة مع الإسنادات والمواعيد والتداخلات التي تحتاج معالجة قبل تحويلها إلى
          نسخة جدولة.
        </p>
        <Button asChild variant="outline">
          <Link to="/itcs-review-proposal">فتح مسودة المقترح للمراجعة</Link>
        </Button>
      </Card>
      <Card className="space-y-2 p-4">
        <p className="text-sm text-muted-foreground">ارفع ملف {MANIFEST_FILE}</p>
        <input
          type="file"
          accept="application/json"
          aria-label="ملف البيان"
          onChange={(e) => e.target.files?.[0] && void e.target.files[0].text().then(onText)}
        />
        <details>
          <summary className="cursor-pointer text-sm">لصق محتوى البيان</summary>
          <textarea
            aria-label="محتوى البيان"
            dir="ltr"
            className="mt-2 w-full rounded border p-2 font-mono text-xs"
            rows={5}
            value={manifestText}
            onChange={(e) => setManifestText(e.target.value)}
          />
          <Button
            variant="outline"
            disabled={!manifestText.trim() || busy}
            onClick={() => void onText(manifestText)}
          >
            قراءة البيان
          </Button>
        </details>
        {errors.length > 0 && (
          <ul className="text-sm text-destructive">
            {errors.slice(0, 20).map((e) => (
              <li key={e}>{e}</li>
            ))}
          </ul>
        )}
      </Card>
      {manifest?.["profile"] === RELAYOUT_PROFILE && (
        <Card className="space-y-1 p-4 text-sm">
          <p>ينشئ التطبيق مسودة من المنشور ويحفظ المحاضرات الـ282 وساعاتها ومسارات الطلاب.</p>
          <p>
            مطابقة الإسنادات الأحدث: تصميم المترجمات لد. مبارك السفياني، والتوجيه والتبديل لد. معاذ
            الصبري.
          </p>
          <p>
            وثيق الأربعاء من 8 صباحًا. تبقى بعض فراغات الطلاب والمحاضرين موضحة في تقرير المراجعة.
          </p>
        </Card>
      )}
      {diff && rules && (
        <Card className="grid gap-2 p-4 text-sm md:grid-cols-3">
          <Stat label="مفقودة" v={diff.missing.length} />
          <Stat label="انحراف عن المسودة (محلي)" v={diff.drift.length} />
          <Stat label="زائدة في المسودة" v={diff.extra.length} />
          <Stat label="نظري خارج 08–14" v={rules.theory.length} />
          <Stat label="عملي خارج 08–16" v={rules.lab.length} />
          <Stat label="تعارض قاعات (تقريبي)" v={rules.roomClashes} />
          <Stat label="تعارض طلاب" v={rules.studentClashes} />
          <Stat label="وحدات طلاب فوق 4 أيام" v={rules.overFourDays.length} />
          <Stat label="أيام بمحاضرة واحدة" v={rules.singleDays} />
          <Stat label="مجموعات غير مربوطة بمسار طلاب" v={rules.incompleteUnits.length} />
          <Stat label="بين كليات غير مطبقة (خادم)" v={server ? crossPending : "—"} />
        </Card>
      )}
      {repl.length > 0 && (
        <Card className="p-4 text-sm">
          <h2 className="mb-2 font-semibold">الاستبدالات</h2>
          <ul>
            {repl.map((r) => (
              <li key={r.replaces}>
                {r.replaces} — {r.cross_college ? "بين كليات" : "داخلي"} — {r.state}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <div className="flex flex-wrap gap-2">
        <Button disabled={!structuralOk || busy} onClick={() => void serverPreview()}>
          معاينة من الخادم
        </Button>
        <Button
          variant="outline"
          disabled={!serverOk || busy || crossPending === 0}
          onClick={() => void runStage("requests")}
        >
          1) إرسال طلبات الكليات الأصلية
        </Button>
        <Button
          variant="outline"
          disabled={
            !serverOk ||
            busy ||
            applied ||
            repl.some(
              (r) => r.cross_college && !["awaiting_home_decision", "applied"].includes(r.state),
            )
          }
          onClick={() => void runStage(crossPending > 0 ? "approve" : "apply")}
        >
          2) تطبيق التوزيع المدقق (تبقى مسودة)
        </Button>
        <Button
          variant="outline"
          disabled={
            busy ||
            !manifest ||
            server?.["version_status"] !== "draft" ||
            crossPending !== 0 ||
            Number(server?.["drift"] ?? 0) === 0 ||
            Number(server?.["missing"] ?? 1) !== 0 ||
            Number(server?.["extra"] ?? 1) !== 0
          }
          onClick={() => void runStage("rooms")}
        >
          اعتماد تصحيح القاعات
        </Button>
        <Button
          variant="destructive"
          disabled={!serverOk || busy || !applied}
          onClick={() => void runStage("publish")}
        >
          3) فحص الجودة والنشر
        </Button>
      </div>
      <Card className="p-4">
        <h2 className="mb-2 font-semibold">سجل العمليات</h2>
        <pre className="whitespace-pre-wrap text-xs">{log.join("\n") || "—"}</pre>
      </Card>
    </div>
  );
}

function OperationalAdoptionSection({
  busy,
  onBusy,
}: {
  busy: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [preview, setPreview] = useState<OperationalAdoptionPreview | null>(null);
  const [checkedReference, setCheckedReference] = useState<string | null>(null);
  const [confirmation, setConfirmation] = useState<OperationalAdoptionPreview | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const ready = operationalAdoptionReadiness(preview);
  const checked =
    !!preview && checkedReference === operationalAdoptionReference(preview) && ready.canApply;

  function hold(reason: unknown) {
    const code = reason instanceof Error ? reason.message : "OPERATIONAL_REQUEST_FAILED";
    setError(`تعذرت المتابعة. حدّث المطابقة وأعد الفحص. (${code})`);
    setMessage("");
  }

  async function refresh() {
    const fresh = await fetchOperationalAdoptionPreview(operationalRpc);
    setPreview(fresh);
    setCheckedReference((reference) =>
      reference === operationalAdoptionReference(fresh) ? reference : null,
    );
    return fresh;
  }

  async function load() {
    onBusy(true);
    setError("");
    setMessage("");
    try {
      await refresh();
    } catch (reason) {
      setPreview(null);
      setCheckedReference(null);
      hold(reason);
    } finally {
      onBusy(false);
    }
  }

  async function run(stage: OperationalAdoptionStage, reviewed = preview) {
    if (!reviewed || busy) return;
    onBusy(true);
    setError("");
    setMessage("");
    let receipt: OperationalAdoptionReceipt | null = null;
    try {
      receipt = await executeOperationalAdoptionStage(
        operationalRpc,
        stage,
        reviewed,
        checkedReference,
      );
      if (stage === "operational_check") {
        setCheckedReference(operationalAdoptionReference(reviewed));
        setMessage("نجح الفحص الكامل دون حفظ تغييرات. يمكن تطبيق المطابقة على النسخة التي فُحصت.");
      } else if (stage === "operational_apply") {
        setCheckedReference(null);
      } else {
        setCheckedReference(null);
      }
    } catch (reason) {
      setCheckedReference(null);
      hold(reason);
    }
    try {
      // Also refresh after an unrecognised response: the transaction may
      // have committed even when its receipt cannot be accepted by the UI.
      if (stage !== "operational_check") await invalidateTeachingAssignmentReadModels(queryClient);
      const verified = await refresh();
      if (
        receipt &&
        stage === "operational_check" &&
        (!operationalAdoptionReadiness(verified).canCheck ||
          operationalAdoptionReference(verified) !== operationalAdoptionReference(reviewed))
      )
        throw new Error("OPERATIONAL_REFERENCE_CHANGED");
      if (receipt && stage === "operational_apply") {
        if (
          !operationalAdoptionReadiness(verified).canQualityCheck ||
          verified.applied_receipt?.after_snapshot !== receipt.after_snapshot
        )
          throw new Error("OPERATIONAL_APPLY_POSTVERIFY_FAILED");
        setMessage("تمت مطابقة الإسنادات والمواعيد في المسودة. يلزم فحص جودة حديث قبل النشر.");
      }
      if (receipt && stage === "operational_publish") {
        if (
          verified.version_status !== "published" ||
          verified.published_receipt?.after_snapshot !== receipt.after_snapshot ||
          verified.current_snapshot !== receipt.after_snapshot ||
          verified.published_receipt?.quality_run_id !== receipt.quality_run_id
        )
          throw new Error("OPERATIONAL_PUBLISH_POSTVERIFY_FAILED");
        setMessage("تم نشر الجدول المطابق: 273 جلسة و624 ساعة أسبوعيًا.");
      }
    } catch (reason) {
      setPreview(null);
      setCheckedReference(null);
      hold(reason);
    } finally {
      onBusy(false);
    }
  }

  async function checkQuality() {
    if (!preview || busy) return;
    onBusy(true);
    setError("");
    setMessage("");
    try {
      const fresh = await fetchOperationalAdoptionPreview(operationalRpc);
      if (operationalAdoptionReference(fresh) !== operationalAdoptionReference(preview))
        throw new Error("OPERATIONAL_REFERENCE_CHANGED");
      if (!operationalAdoptionReadiness(fresh).canQualityCheck)
        throw new Error("OPERATIONAL_STAGE_NOT_READY");
      const quality = await scoreScheduleVersion({
        collegeId: fresh.college_id,
        scheduleVersionId: fresh.version_id,
        persist: true,
      });
      if (quality.result.hard_conflicts_count !== 0) throw new Error("QUALITY_HARD_CONFLICTS");
      const verified = await refresh();
      if (!operationalAdoptionReadiness(verified).canPublish)
        throw new Error("QUALITY_RUN_NOT_FRESH_OR_PUBLISH_NOT_READY");
      setMessage("نجح فحص الجودة على المسودة الحالية دون تعارضات إلزامية. أصبح النشر متاحًا.");
    } catch (reason) {
      setPreview(null);
      setCheckedReference(null);
      hold(reason);
    } finally {
      onBusy(false);
    }
  }

  return (
    <Card className="space-y-4 p-4" aria-labelledby="operational-adoption-title">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="operational-adoption-title" className="text-lg font-semibold">
          اعتماد الإسناد التشغيلي الحالي
        </h2>
        <Button variant="outline" disabled={busy} onClick={() => void load()}>
          {preview ? "تحديث المطابقة الحالية" : "تحميل المطابقة الحالية"}
        </Button>
      </div>
      <OperationalAdoptionImpacts />
      {preview && (
        <div className="space-y-2 text-sm">
          <p>
            حالة الجدول:{" "}
            {preview.version_status === "published"
              ? "منشور"
              : preview.version_status === "draft"
                ? "مسودة"
                : "قيد المراجعة"}
            {preview.published_receipt
              ? " — تم النشر بوثيقة اعتماد مطابقة."
              : ready.canQualityCheck
                ? " — التطبيق مطابق ومعتمد، ويلزم فحص الجودة للنشر."
                : ready.canCheck
                  ? " — يطابق المرجع الحالي وجاهز للفحص."
                  : " — شروط المطابقة غير مكتملة؛ أعد التحميل قبل المتابعة."}
          </p>
          {preview.limitations.length > 0 && (
            <ul className="list-inside list-disc text-muted-foreground">
              {preview.limitations.map((limitation, index) => (
                <li key={index}>
                  {operationalLimitationLabels[limitation] ??
                    "توجد ملاحظة إضافية على المطابقة؛ راجع نتيجة الفحص قبل الاعتماد."}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          disabled={busy || !ready.canCheck}
          onClick={() => void run("operational_check")}
        >
          1) فحص المطابقة دون حفظ
        </Button>
        <Button disabled={busy || !checked} onClick={() => setConfirmation(preview)}>
          2) تطبيق المطابقة في المسودة
        </Button>
        <Button
          variant="outline"
          disabled={busy || !ready.canQualityCheck}
          onClick={() => void checkQuality()}
        >
          فحص جودة الجدول
        </Button>
        <Button
          variant="destructive"
          disabled={busy || !ready.canPublish}
          onClick={() => void run("operational_publish")}
        >
          3) نشر الجدول المطابق
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        يتاح التطبيق بعد نجاح الفحص. ويتاح النشر بعد اعتماد التطبيق وفحص جودة حديث للنسخة الحالية.
      </p>
      {message && (
        <p role="status" aria-live="polite" className="text-sm">
          {message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <AlertDialog open={!!confirmation} onOpenChange={(open) => !open && setConfirmation(null)}>
        <AlertDialogContent dir="rtl">
          <AlertDialogHeader>
            <AlertDialogTitle>تأكيد مطابقة الإسناد التشغيلي الحالي</AlertDialogTitle>
            <AlertDialogDescription>
              ستُطبق المطابقة على 273 جلسة و624 ساعة أسبوعيًا، مع تغيير إسناد أو محاضر 39 جلسة،
              وإلغاء 31 استبدالًا خاصًا بالمسودة لاعتماد 30 إسنادًا أساسيًا وإسناد سبق اعتماده، مع
              الحفاظ على هويات 4 إسنادات سبق اعتمادها. تشمل الخطة 3 تغييرات مواعيد سبق اعتمادها و26
              تغييرًا إضافيًا. ينخفض إجمالي انتظار الطلاب 57 ساعة طالب أسبوعيًا، لكن انتظار 149
              طالبًا في 6 شعب يزيد بمجموع 243 ساعة طالب أسبوعيًا. لا تضيف الخطة أيام حضور للطلاب.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>إلغاء</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy || !checked}
              onClick={() => {
                const reviewed = confirmation;
                setConfirmation(null);
                if (reviewed) void run("operational_apply", reviewed);
              }}
            >
              تطبيق المطابقة
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}

function OperationalAdoptionImpacts() {
  return (
    <div className="space-y-2 text-sm">
      <p>الجدول الحالي: 273 جلسة، بإجمالي 624 ساعة تدريس أسبوعيًا.</p>
      <p>
        مطابقة الإسنادات الحالية تغيّر الإسناد أو المحاضر في 39 جلسة، وتلغي 31 استبدالًا خاصًا
        بالمسودة لاعتماد 30 إسنادًا أساسيًا وإسناد سبق اعتماده، مع الحفاظ على هويات 4 إسنادات سبق
        اعتمادها.
      </p>
      <p>تغييرات المواعيد: 3 تغييرات سبق اعتمادها، و26 تغييرًا إضافيًا؛ المجموع 29.</p>
      <p>
        ينخفض إجمالي انتظار الطلاب بمقدار 57 ساعة طالب أسبوعيًا. لكن الانتظار يزيد لدى 149 طالبًا في
        6 شعب بمجموع 243 ساعة طالب أسبوعيًا؛ لا تضيف الخطة أيام حضور للطلاب.
      </p>
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
