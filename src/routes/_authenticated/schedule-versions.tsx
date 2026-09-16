import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCanManageActiveCollege } from "@/hooks/use-can-manage";
import { useCurrentUser } from "@/hooks/use-current-user";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import {
  CalendarClock,
  Plus,
  ExternalLink,
  Copy,
  History,
  AlertTriangle,
  CheckCircle2,
} from "lucide-react";
import {
  STATUS_LABEL_AR,
  STATUS_BADGE_VARIANT,
  nextActions,
  evaluateEligibility,
  validateGate,
  transitionVersion,
  cloneVersion,
  type SVStatus,
} from "@/lib/schedule-versions/lifecycle";
import {
  DeliveryCoverageCard,
  useDeliveryCoverage,
} from "@/components/schedule-versions/delivery-coverage-card";
import { coverageBlockers } from "@/lib/schedule-versions/delivery-coverage";

export const Route = createFileRoute("/_authenticated/schedule-versions")({
  head: () => ({ meta: [{ title: "نسخ الجدول الزمني" }] }),
  component: SchedVersionsPage,
});

function SchedVersionsPage() {
  const { active } = useActiveCollege();
  const canManage = useCanManageActiveCollege();
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [termId, setTermId] = useState<string>("");
  const [notes, setNotes] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [cloneFor, setCloneFor] = useState<{ id: string; name: string } | null>(null);

  const { data: terms } = useQuery({
    queryKey: ["terms-for-sv", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("academic_terms")
        .select("id, name, code, academic_year")
        .eq("college_id", active!.id)
        .order("start_date", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const { data: versions } = useQuery({
    queryKey: ["schedule_versions_list", active?.id],
    enabled: !!active,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_versions")
        .select("id, name, status, academic_term_id, notes, created_at, is_coordination")
        .eq("college_id", active!.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return (data ?? []) as unknown as Array<{
        id: string;
        name: string;
        status: string;
        academic_term_id: string;
        notes: string | null;
        created_at: string;
        is_coordination: boolean;
      }>;
    },
  });

  const create = useMutation({
    mutationFn: async () => {
      if (!active || !termId || !name.trim()) throw new Error("الرجاء استكمال البيانات");
      const { data, error } = await supabase
        .from("schedule_versions")
        .insert({
          college_id: active.id,
          academic_term_id: termId,
          name: name.trim(),
          notes: notes.trim() || null,
          status: "draft",
        })
        .select("id")
        .single();
      if (error) throw error;
      await logAudit({
        action: "create",
        entity: "schedule_versions",
        entityId: data.id,
        collegeId: active.id,
        details: { name, term_id: termId },
      });
      return data.id;
    },
    onSuccess: (id) => {
      toast.success("تم إنشاء نسخة الجدول");
      qc.invalidateQueries({ queryKey: ["schedule_versions_list"] });
      setOpen(false);
      setName("");
      setNotes("");
      setTermId("");
      // The V2 Schedule Builder is the primary editing surface. It selects the
      // newest version automatically and keeps all conflict/save gates intact.
      navigate({ to: "/schedule-builder" });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  const termName = (id: string) => terms?.find((t) => t.id === id)?.name ?? "—";

  return (
    <div className="space-y-6" dir="rtl">
      <div className="flex min-w-0 flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">مراجعة واعتماد الجدول</h1>
          <p className="text-sm text-muted-foreground">
            أنشئ النسخة، افتح مساحة البناء، ثم راجع التعارضات والجودة قبل الاعتماد والنشر.
          </p>
        </div>
        <div className="flex w-full min-w-0 flex-wrap items-center gap-2 lg:w-auto">
          <CollegeSwitcher />
          <Button variant="outline" asChild>
            <Link to="/schedule-builder">
              <CalendarClock className="h-4 w-4 ml-1" /> فتح مساحة البناء
            </Link>
          </Button>
          <Button variant="outline" asChild>
            <Link to="/published-schedules">
              <CheckCircle2 className="h-4 w-4 ml-1" /> الجداول المنشورة
            </Link>
          </Button>
          <Dialog open={open} onOpenChange={setOpen}>
            <DialogTrigger asChild>
              <Button disabled={!canManage}>
                <Plus className="h-4 w-4 ml-1" /> نسخة جديدة
              </Button>
            </DialogTrigger>
            <DialogContent dir="rtl">
              <DialogHeader>
                <DialogTitle>إنشاء نسخة جدول</DialogTitle>
              </DialogHeader>
              <div className="space-y-3">
                <div>
                  <Label>الفصل الدراسي</Label>
                  <Select value={termId} onValueChange={setTermId}>
                    <SelectTrigger>
                      <SelectValue placeholder="اختر الفصل" />
                    </SelectTrigger>
                    <SelectContent>
                      {(terms ?? []).map((t) => (
                        <SelectItem key={t.id} value={t.id}>
                          {t.name} {t.academic_year ? `— ${t.academic_year}` : ""}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>الاسم</Label>
                  <Input
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="مثال: المسودة الأولى"
                  />
                </div>
                <div>
                  <Label>ملاحظات</Label>
                  <Input value={notes} onChange={(e) => setNotes(e.target.value)} />
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  إلغاء
                </Button>
                <Button onClick={() => create.mutate()} disabled={create.isPending}>
                  إنشاء
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </div>

      {!active ? (
        <Card className="p-6 text-center text-muted-foreground">اختر كلية للبدء</Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {(versions ?? []).map((v) => (
            <VersionCard
              key={v.id}
              v={v}
              termName={termName(v.academic_term_id)}
              collegeId={active.id}
              canManage={canManage}
              expanded={expandedId === v.id}
              onToggle={() => setExpandedId(expandedId === v.id ? null : v.id)}
              onClone={() => setCloneFor({ id: v.id, name: v.name })}
            />
          ))}
          {versions && versions.length === 0 && (
            <Card className="p-6 text-center text-muted-foreground col-span-full">
              لا توجد نسخ. أنشئ نسخة جديدة للبدء.
            </Card>
          )}
        </div>
      )}

      {cloneFor && active && (
        <CloneDialog
          collegeId={active.id}
          sourceId={cloneFor.id}
          sourceName={cloneFor.name}
          terms={terms ?? []}
          canMarkDisposable={!!me?.isSuperAdmin}
          onClose={() => setCloneFor(null)}
          onCloned={() => {
            setCloneFor(null);
            qc.invalidateQueries({ queryKey: ["schedule_versions_list"] });
          }}
        />
      )}
    </div>
  );
}

function VersionCard({
  v,
  termName,
  collegeId,
  canManage,
  expanded,
  onToggle,
  onClone,
}: {
  v: {
    id: string;
    name: string;
    status: string;
    academic_term_id: string;
    notes: string | null;
    created_at: string;
    is_coordination?: boolean;
  };
  termName: string;
  collegeId: string;
  canManage: boolean;
  expanded: boolean;
  onToggle: () => void;
  onClone: () => void;
}) {
  const qc = useQueryClient();
  const status = v.status as SVStatus;
  const actions = nextActions(status);
  const coordination = useMutation({
    mutationFn: async () => {
      const { error } = await (
        supabase as unknown as {
          rpc(
            name: string,
            args: Record<string, string>,
          ): Promise<{ error: { message: string } | null }>;
        }
      ).rpc("set_schedule_coordination_version", {
        p_college_id: collegeId,
        p_version_id: v.id,
      });
      if (error) {
        if (error.message.includes("CROSS_COLLEGE_INSTRUCTOR_CONFLICT"))
          throw new Error(
            "يتعارض وقت محاضر مع جدول معتمد للتنسيق في كلية أخرى. عالج التعارض أولًا.",
          );
        if (error.message.includes("COORDINATION_TERM_DATES_REQUIRED"))
          throw new Error("استكمل تواريخ الفصل الدراسي قبل اعتماد نسخة التنسيق.");
        throw new Error("تعذر اختيار نسخة التنسيق؛ أعد المحاولة.");
      }
    },
    onSuccess: () => {
      toast.success("تم اختيار نسخة التنسيق لهذا الفصل");
      qc.invalidateQueries({ queryKey: ["schedule_versions_list"] });
    },
    onError: (e) => toast.error(e.message),
  });

  const elig = useQuery({
    queryKey: ["sv-eligibility", v.id],
    enabled: expanded,
    queryFn: () => evaluateEligibility({ collegeId, scheduleVersionId: v.id }),
  });

  // Mirrors the DB delivery-coverage guard so blockers are visible before acting.
  const coverage = useDeliveryCoverage({
    collegeId,
    scheduleVersionId: v.id,
    enabled: expanded,
  });

  const events = useQuery({
    queryKey: ["sv-events", v.id],
    enabled: expanded,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("schedule_version_events")
        .select("*")
        .eq("schedule_version_id", v.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data ?? [];
    },
  });

  const doTransition = useMutation({
    mutationFn: async (to: SVStatus) => {
      await transitionVersion({
        collegeId,
        scheduleVersionId: v.id,
        from: status,
        to,
      });
      await logAudit({
        action: `sv_transition_${to}`,
        entity: "schedule_versions",
        entityId: v.id,
        collegeId,
        details: { from: status, to },
      });
    },
    onSuccess: () => {
      toast.success("تم تحديث الحالة");
      qc.invalidateQueries({ queryKey: ["schedule_versions_list"] });
      qc.invalidateQueries({ queryKey: ["sv-eligibility", v.id] });
      qc.invalidateQueries({ queryKey: ["sv-events", v.id] });
      qc.invalidateQueries({
        queryKey: ["sv-delivery-coverage", collegeId, v.id],
      });
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Card className="min-w-0 space-y-2 overflow-hidden p-4">
      <div className="flex items-center justify-between">
        <div className="flex min-w-0 items-center gap-2">
          <CalendarClock className="h-4 w-4 text-muted-foreground" />
          <span className="min-w-0 break-words font-semibold">{v.name}</span>
        </div>
        <Badge variant={STATUS_BADGE_VARIANT[status] ?? "secondary"}>
          {STATUS_LABEL_AR[status] ?? status}
        </Badge>
      </div>
      <div className="text-xs text-muted-foreground">الفصل: {termName}</div>
      {["draft", "review", "approved"].includes(status) && (
        <Button
          size="sm"
          variant="outline"
          disabled={!canManage || !!v.is_coordination || coordination.isPending}
          onClick={() => coordination.mutate()}
        >
          {v.is_coordination ? "نسخة التنسيق بين الكليات" : "اختيار للتنسيق بين الكليات"}
        </Button>
      )}
      {v.notes && <div className="break-words text-xs">{v.notes}</div>}
      <div className="text-[10px] text-muted-foreground">
        {new Date(v.created_at).toLocaleString("ar")}
      </div>

      <div className="flex gap-2 flex-wrap">
        <Button variant="outline" size="sm" asChild className="flex-1">
          <Link to="/timetable/$versionId" params={{ versionId: v.id }}>
            <ExternalLink className="h-4 w-4 ml-1" /> فتح
          </Link>
        </Button>
        <Button variant="outline" size="sm" onClick={onToggle}>
          {expanded ? "إخفاء" : "الإجراءات"}
        </Button>
      </div>

      {expanded && (
        <div className="border-t pt-3 space-y-3">
          {elig.isLoading ? (
            <p className="text-xs text-muted-foreground">جارٍ الفحص...</p>
          ) : elig.data ? (
            <div className="space-y-2">
              <div className="grid grid-cols-3 gap-2 text-center text-[11px]">
                <Stat label="محاضرات" value={elig.data.sessionsCount} />
                <Stat
                  label="تعارضات إلزامية"
                  value={elig.data.hardConflicts}
                  accent={elig.data.hardConflicts > 0 ? "danger" : "ok"}
                />
                <Stat label="جودة" value={elig.data.qualityScore ?? "—"} />
              </div>
              <DeliveryCoverageCard
                collegeId={collegeId}
                scheduleVersionId={v.id}
                coverage={coverage.data}
                isLoading={coverage.isLoading}
              />

              {elig.data.warnings.length > 0 && (
                <div className="rounded bg-amber-50 dark:bg-amber-950/30 p-2 text-[11px] flex gap-1">
                  <AlertTriangle className="h-3 w-3 mt-0.5 text-amber-600" />
                  <div>{elig.data.warnings.join(" • ")}</div>
                </div>
              )}

              <div className="space-y-1">
                {actions.length === 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    لا توجد إجراءات متاحة لهذه الحالة.
                  </p>
                )}
                {actions.map((a) => {
                  const blockers = [
                    ...validateGate(a.to, elig.data!),
                    ...coverageBlockers(a.to, coverage.data),
                  ];
                  const blocked = blockers.length > 0;
                  return (
                    <div key={a.to} className="flex flex-col gap-1">
                      <Button
                        size="sm"
                        variant={a.kind === "rollback" ? "outline" : "default"}
                        disabled={!canManage || blocked || doTransition.isPending}
                        onClick={() => doTransition.mutate(a.to)}
                      >
                        {a.label}
                      </Button>
                      {blocked && (
                        <div className="text-[10px] text-destructive flex gap-1">
                          <AlertTriangle className="h-3 w-3 mt-0.5" /> {blockers.join(" • ")}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              <Button
                size="sm"
                variant="outline"
                className="w-full"
                disabled={!canManage}
                onClick={onClone}
              >
                <Copy className="h-4 w-4 ml-1" /> استنساخ النسخة
              </Button>
            </div>
          ) : null}

          {events.data && events.data.length > 0 && (
            <div className="border-t pt-2">
              <div className="text-[11px] font-semibold flex items-center gap-1 mb-1">
                <History className="h-3 w-3" /> سجل الأحداث
              </div>
              <ul className="space-y-0.5 max-h-32 overflow-y-auto text-[10px]">
                {events.data.map((e) => (
                  <li key={e.id} className="flex justify-between border-b py-0.5 gap-2">
                    <span>
                      {eventLabel(e.event_type)}{" "}
                      {e.from_status && `(${e.from_status}→${e.to_status})`}
                    </span>
                    <span className="text-muted-foreground">
                      {new Date(e.created_at).toLocaleString("ar")}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function CloneDialog({
  collegeId,
  sourceId,
  sourceName,
  terms,
  onClose,
  onCloned,
  canMarkDisposable,
}: {
  collegeId: string;
  sourceId: string;
  sourceName: string;
  terms: Array<{ id: string; name: string; academic_year: string | null }>;
  onClose: () => void;
  onCloned: () => void;
  canMarkDisposable: boolean;
}) {
  const [tid, setTid] = useState("");
  const [nm, setNm] = useState(`${sourceName} (نسخة)`);
  const [disposableTest, setDisposableTest] = useState(false);

  const m = useMutation({
    mutationFn: async () => {
      if (!tid || !nm.trim()) throw new Error("الرجاء إدخال الفصل والاسم");
      const id = await cloneVersion({
        collegeId,
        sourceVersionId: sourceId,
        targetTermId: tid,
        newName: nm.trim(),
        disposableTest: canMarkDisposable && disposableTest,
      });
      await logAudit({
        action: "sv_clone",
        entity: "schedule_versions",
        entityId: id,
        collegeId,
        details: {
          source: sourceId,
          disposable_test: canMarkDisposable && disposableTest,
        },
      });
      return id;
    },
    onSuccess: () => {
      toast.success("تم الاستنساخ");
      onCloned();
    },
    onError: (e) => toast.error((e as Error).message),
  });

  return (
    <Dialog open onOpenChange={(b) => !b && onClose()}>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>استنساخ نسخة الجدول</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>الفصل الدراسي الهدف</Label>
            <Select value={tid} onValueChange={setTid}>
              <SelectTrigger>
                <SelectValue placeholder="اختر الفصل" />
              </SelectTrigger>
              <SelectContent>
                {terms.map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.name} {t.academic_year ? `— ${t.academic_year}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>اسم النسخة الجديدة</Label>
            <Input value={nm} onChange={(e) => setNm(e.target.value)} />
          </div>
          {canMarkDisposable && (
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={disposableTest}
                onChange={(e) => setDisposableTest(e.target.checked)}
              />
              <span>
                وسم كـ disposable_test (قابل للحذف الآمن لاحقًا عبر مسار الـ purge الرسمي فقط).
                النسخ العادية تبقى غير قابلة للحذف عبر هذا المسار.
              </span>
            </label>
          )}
          <p className="text-[11px] text-muted-foreground">
            يُنسخ: بيانات النسخة + محاضرات الجدول. لا يُنسخ: فحوصات التعارض، نتائج الجودة، عمليات
            الجدولة التلقائية.
          </p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            إلغاء
          </Button>
          <Button onClick={() => m.mutate()} disabled={m.isPending}>
            استنساخ
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: number | string;
  accent?: "ok" | "danger";
}) {
  const c = accent === "danger" ? "text-destructive" : accent === "ok" ? "text-emerald-600" : "";
  return (
    <div className="rounded border p-1.5">
      <div className={`text-base font-bold ${c}`}>{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function eventLabel(t: string): string {
  const m: Record<string, string> = {
    submitted_for_review: "أُرسل للمراجعة",
    approved: "اعتُمد",
    published: "نُشر",
    archived: "أُرشف",
    cloned: "استنسخ",
    rolled_back_to_draft: "أُعيد إلى مسودة",
    rolled_back_to_review: "أُعيد إلى المراجعة",
    reverted: "تراجع",
  };
  return m[t] ?? t;
}
