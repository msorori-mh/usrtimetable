import { useEffect, useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, History } from "lucide-react";
import { useActiveCollege } from "@/hooks/use-colleges";
import { useCurrentUser } from "@/hooks/use-current-user";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AUDIT_PAGE_SIZE,
  KNOWN_AUDIT_ACTIONS,
  actionLabel,
  actorDisplay,
  diffBeforeAfter,
  fetchActorProfiles,
  fetchAuditLogsPage,
  formatValue,
  redactDetails,
  summarizeDetails,
  type AuditLogRow,
} from "@/lib/audit-logs/model";

/**
 * Audit Viewer — READ-ONLY (A4-AUDIT-VIEWER-DESIGN-01).
 * No-write guarantee: this file contains no insert/update/delete call and
 * never calls the audit-write helper; enforcement stays in RLS (`al_select`)
 * and in the missing UPDATE/DELETE grants on public.audit_logs.
 * Sidebar/nav visibility is UX only — RLS is the authorization boundary.
 */
export const Route = createFileRoute("/_authenticated/audit-logs")({
  head: () => ({ meta: [{ title: "سجل التدقيق" }] }),
  component: AuditLogsPage,
});

function AuditLogsPage() {
  const { active } = useActiveCollege();
  const { data: me } = useCurrentUser();
  const isSuperAdmin = Boolean(me?.isSuperAdmin);

  const [action, setAction] = useState("");
  const [entity, setEntity] = useState("");
  const [actorId, setActorId] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([]);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [total, setTotal] = useState<number | null>(null);

  const filters = {
    // college_admin / read_only: implicit college scoping from RLS — the viewer
    // deliberately does NOT offer them a college selector (design §4.4).
    collegeId: active?.id ?? null,
    action: action || null,
    entity: entity.trim() || null,
    actorId: isSuperAdmin && actorId.trim() ? actorId.trim() : null,
    from: from || null,
    to: to || null,
    cursor,
  };

  const { data: page, isLoading } = useQuery({
    queryKey: ["audit-logs", filters],
    enabled: Boolean(active),
    queryFn: () => fetchAuditLogsPage(filters),
    placeholderData: (prev) => prev,
  });

  // Total is only requested on the first page (keyset cursor makes later
  // counts shrink); keep the first-page count for display.
  useEffect(() => {
    if (!cursor && page?.total !== null && page?.total !== undefined) setTotal(page.total);
  }, [cursor, page?.total]);

  const actorIds = useMemo(
    () => (page?.rows ?? []).map((r) => r.actor_id).filter((v): v is string => Boolean(v)),
    [page],
  );
  const { data: profiles } = useQuery({
    queryKey: ["audit-logs-actors", actorIds],
    enabled: actorIds.length > 0,
    queryFn: () => fetchActorProfiles(actorIds),
  });

  const resetPaging = () => {
    setCursor(null);
    setCursorStack([]);
    setExpandedId(null);
  };
  const goNext = () => {
    if (!page?.nextCursor) return;
    setCursorStack((s) => [...s, cursor]);
    setCursor(page.nextCursor);
    setExpandedId(null);
  };
  const goPrev = () => {
    setCursorStack((s) => {
      const next = [...s];
      const prev = next.pop() ?? null;
      setCursor(prev);
      return next;
    });
    setExpandedId(null);
  };

  return (
    <div className="mx-auto max-w-6xl space-y-4">
      <header className="flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <History className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">سجل التدقيق</h1>
          <p className="text-sm text-muted-foreground">
            من غيّر ماذا وأين ومتى — عرض للقراءة فقط. الإنفاذ في RLS؛ لا توجد أي عملية كتابة من هذه
            الشاشة.
          </p>
        </div>
        {/* College selector = UX only, super_admin only (design §4.4). */}
        {isSuperAdmin && <CollegeSwitcher />}
      </header>

      <Card className="grid grid-cols-1 gap-3 p-4 md:grid-cols-5">
        <div>
          <Label>من تاريخ</Label>
          <Input
            type="date"
            value={from}
            onChange={(e) => {
              setFrom(e.target.value);
              resetPaging();
            }}
          />
        </div>
        <div>
          <Label>إلى تاريخ</Label>
          <Input
            type="date"
            value={to}
            onChange={(e) => {
              setTo(e.target.value);
              resetPaging();
            }}
          />
        </div>
        <div>
          <Label>الإجراء</Label>
          <select
            className="w-full rounded-md border border-input bg-background p-2 text-sm"
            value={action}
            onChange={(e) => {
              setAction(e.target.value);
              resetPaging();
            }}
          >
            <option value="">الكل</option>
            {KNOWN_AUDIT_ACTIONS.map((a) => (
              <option key={a.value} value={a.value}>
                {a.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <Label>الكيان</Label>
          <Input
            placeholder="مثال: schedule_sessions"
            value={entity}
            onChange={(e) => {
              setEntity(e.target.value);
              resetPaging();
            }}
          />
        </div>
        {isSuperAdmin ? (
          <div>
            <Label>المستخدم (UUID)</Label>
            <Input
              placeholder="actor_id"
              value={actorId}
              onChange={(e) => {
                setActorId(e.target.value);
                resetPaging();
              }}
            />
          </div>
        ) : (
          <div className="flex items-end text-xs text-muted-foreground">
            نطاق العرض: كليتك فقط (بموجب RLS).
          </div>
        )}
      </Card>

      {!active ? (
        <Card className="p-6 text-center text-muted-foreground">اختر كلّية للبدء.</Card>
      ) : isLoading && !page ? (
        <Card className="p-6 text-center text-muted-foreground">جارٍ تحميل السجل…</Card>
      ) : page?.error ? (
        <Card className="border-red-500/30 bg-red-500/5 p-6 text-sm text-red-700">
          تعذر تحميل سجل التدقيق (فشل الاستعلام — لم تُعرض حالة فارغة بدلًا منه): {page.error}
        </Card>
      ) : !page || page.rows.length === 0 ? (
        <Card className="p-6 text-center text-muted-foreground">لا توجد سجلات</Card>
      ) : (
        <>
          <Card className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-muted/40 text-muted-foreground">
                <tr>
                  <th className="px-3 py-2 text-right">الوقت</th>
                  <th className="px-3 py-2 text-right">المستخدم</th>
                  <th className="px-3 py-2 text-right">الإجراء</th>
                  <th className="px-3 py-2 text-right">الكيان</th>
                  <th className="px-3 py-2 text-right">ملخص</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody>
                {page.rows.map((row) => (
                  <AuditRow
                    key={row.id}
                    row={row}
                    actorName={actorDisplay(row.actor_id, profiles ?? new Map(), isSuperAdmin)}
                    expanded={expandedId === row.id}
                    onToggle={() => setExpandedId(expandedId === row.id ? null : row.id)}
                  />
                ))}
              </tbody>
            </table>
          </Card>
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              {total !== null ? `الإجمالي: ${total}` : ""} · حجم الصفحة: {AUDIT_PAGE_SIZE}
            </span>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" disabled={cursorStack.length === 0} onClick={goPrev}>
                السابق
              </Button>
              <Button variant="outline" size="sm" disabled={!page.nextCursor} onClick={goNext}>
                التالي
              </Button>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function AuditRow({
  row,
  actorName,
  expanded,
  onToggle,
}: {
  row: AuditLogRow;
  actorName: string;
  expanded: boolean;
  onToggle: () => void;
}) {
  const chips = summarizeDetails(row.details).slice(0, 3);
  const diff = expanded ? diffBeforeAfter(row.details?.before, row.details?.after) : [];
  return (
    <>
      <tr className="border-t">
        <td className="whitespace-nowrap px-3 py-2" title={row.created_at}>
          {new Date(row.created_at).toLocaleString("ar")}
        </td>
        <td className="px-3 py-2">{actorName}</td>
        <td className="px-3 py-2">
          <Badge variant="outline">{actionLabel(row.action)}</Badge>
        </td>
        <td className="px-3 py-2">
          <span className="font-mono text-xs">{row.entity}</span>
          {row.entity_id && (
            <span className="ms-1 text-xs text-muted-foreground">…{row.entity_id.slice(0, 8)}</span>
          )}
        </td>
        <td className="px-3 py-2">
          <div className="flex flex-wrap gap-1">
            {chips.map((c) => (
              <Badge key={c.key} variant="secondary" className="max-w-56 truncate text-[11px]">
                {c.key}: {c.value}
              </Badge>
            ))}
            {chips.length === 0 && <span className="text-xs text-muted-foreground">—</span>}
          </div>
        </td>
        <td className="px-3 py-2">
          <Button variant="ghost" size="sm" onClick={onToggle}>
            {expanded ? <ChevronUp className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          </Button>
        </td>
      </tr>
      {expanded && (
        <tr className="border-t bg-muted/20">
          <td colSpan={6} className="px-4 py-3">
            {diff.length > 0 ? (
              <div className="mb-3">
                <p className="mb-2 text-xs font-semibold text-muted-foreground">
                  الفروقات (الحقول المتغيرة فقط):
                </p>
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-muted-foreground">
                      <th className="px-2 py-1 text-right">الحقل</th>
                      <th className="px-2 py-1 text-right">قبل</th>
                      <th className="px-2 py-1 text-right">بعد</th>
                    </tr>
                  </thead>
                  <tbody>
                    {diff.map((d) => (
                      <tr key={d.field} className="border-t border-border/50">
                        <td className="px-2 py-1 font-mono">{d.field}</td>
                        <td className="px-2 py-1 text-red-700">{formatValue(d.before)}</td>
                        <td className="px-2 py-1 text-emerald-700">{formatValue(d.after)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="mb-2 text-xs text-muted-foreground">لا توجد فروقات قبل/بعد لهذا السجل.</p>
            )}
            <details>
              <summary className="cursor-pointer text-xs text-muted-foreground">
                التفاصيل الكاملة (بعد الإخفاء الآمن للحقول الحساسة)
              </summary>
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-2 text-[11px]" dir="ltr">
                {JSON.stringify(redactDetails(row.details ?? {}), null, 2)}
              </pre>
            </details>
          </td>
        </tr>
      )}
    </>
  );
}
