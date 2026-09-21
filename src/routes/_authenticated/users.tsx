import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, type AppRole } from "@/hooks/use-current-user";
import {
  adminCreateUser,
  adminGeneratePasswordReset,
  adminListUserMeta,
  adminSetUserEnabled,
} from "@/lib/users.functions";
import { UnauthorizedAccess } from "@/components/unauthorized-access";
import {
  resolveAdminReadablePageAccess,
  isInstitutionalReadOnlyViewer,
  READ_ONLY_VIEW_BADGE_AR,
  shouldLoadSuperAdminPageData,
} from "@/lib/unauthorized-access";
import {
  LEADERSHIP_ROLE_LABEL_AR,
  LEADERSHIP_ROLE_HINT_AR,
  COLLEGE_DEAN_ROLE_LABEL_AR,
  COLLEGE_DEAN_ROLE_HINT_AR,
  INSTITUTIONAL_VIEWER_CREATE_NOTE_AR,
  INSTITUTIONAL_VIEWER_ROLE_HINT_AR,
  INSTITUTIONAL_VIEWER_ROLE_LABEL_AR,
  READ_ONLY_CREATE_NOTE_AR,
  READ_ONLY_ROLE_HINT_AR,
  READ_ONLY_ROLE_LABEL_AR,
  assignsAllColleges,
  requiresCollegeAssignment,
  requiresExactlyOneCollege,
} from "@/lib/viewer-roles";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import {
  Users,
  Plus,
  KeyRound,
  Power,
  Copy,
  ShieldCheck,
  ShieldAlert,
  AlertTriangle,
} from "lucide-react";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "إدارة المستخدمين" }] }),
  component: UsersPage,
});

const ROLE_LABELS: Record<AppRole, string> = {
  university_leadership: LEADERSHIP_ROLE_LABEL_AR,
  college_dean: COLLEGE_DEAN_ROLE_LABEL_AR,
  super_admin: "Super Admin",
  college_admin: "مدير كلّية",
  read_only: READ_ONLY_ROLE_LABEL_AR,
  institutional_viewer: INSTITUTIONAL_VIEWER_ROLE_LABEL_AR,
};

const ROLE_TONE: Record<AppRole, string> = {
  university_leadership: "bg-primary/10 text-primary border-primary/30",
  college_dean: "bg-emerald-500/10 text-emerald-800 border-emerald-500/30",
  super_admin: "bg-primary/10 text-primary border-primary/20",
  college_admin: "bg-accent/20 text-accent-foreground border-accent/30",
  read_only: "bg-muted text-muted-foreground border-border",
  institutional_viewer: "bg-secondary text-primary border-primary/20",
};

const ROLE_HINTS: Record<AppRole, string> = {
  university_leadership: LEADERSHIP_ROLE_HINT_AR,
  college_dean: COLLEGE_DEAN_ROLE_HINT_AR,
  super_admin: "صلاحيات كاملة على جميع الكلّيات، وإدارة المستخدمين والأدوار.",
  college_admin: "كامل صلاحيات العمليات داخل الكلّيات المُسندة له، بما فيها الاستيراد من Excel.",
  read_only: READ_ONLY_ROLE_HINT_AR,
  institutional_viewer: INSTITUTIONAL_VIEWER_ROLE_HINT_AR,
};

type SecurityEventRow = {
  id: number;
  actor_id: string | null;
  event: string;
  severity: string;
  details: unknown;
  target_id: string | null;
  created_at: string;
};

const SENSITIVE_DETAIL_KEY = /token|secret|password|api[_-]?key|jwt|authorization|cookie/i;

export function redactSecurityDetails(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactSecurityDetails);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, nested]) => [
      key,
      SENSITIVE_DETAIL_KEY.test(key) ? "•••" : redactSecurityDetails(nested),
    ]),
  );
}

const SECURITY_EVENT_LABELS: Record<string, string> = {
  rate_limit_exceeded: "تجاوز حد العمليات الحساسة",
};

type UserRow = {
  id: string;
  email: string | null;
  full_name: string | null;
  created_at: string;
  roles: AppRole[];
  collegeIds: string[];
  last_sign_in_at: string | null;
  banned_until: string | null;
};

function UsersPage() {
  const { data: me, isLoading: meLoading } = useCurrentUser();
  const pageAccess = resolveAdminReadablePageAccess(me, meLoading);
  const viewOnly = isInstitutionalReadOnlyViewer(me);
  const canLoadAdminData = shouldLoadSuperAdminPageData(pageAccess);
  const qc = useQueryClient();
  const [expandedUser, setExpandedUser] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [roleFilter, setRoleFilter] = useState<string>("all");
  const [collegeFilter, setCollegeFilter] = useState<string>("all");

  const listMeta = useServerFn(adminListUserMeta);
  const createUserFn = useServerFn(adminCreateUser);
  const setEnabledFn = useServerFn(adminSetUserEnabled);
  const resetFn = useServerFn(adminGeneratePasswordReset);

  const { data: users, isLoading } = useQuery({
    queryKey: ["all-users-admin", viewOnly],
    enabled: canLoadAdminData,
    queryFn: async (): Promise<UserRow[]> => {
      const [{ data: profiles }, { data: roles }, { data: ucs }, meta] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email, created_at").order("created_at"),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("user_colleges").select("user_id, college_id"),
        // Institutional viewer never touches the admin-only Auth metadata endpoint.
        viewOnly
          ? Promise.resolve([] as Awaited<ReturnType<typeof listMeta>>)
          : listMeta().catch(() => [] as Awaited<ReturnType<typeof listMeta>>),
      ]);

      const metaMap = new Map((meta ?? []).map((m) => [m.id, m]));
      return (profiles ?? []).map((p) => ({
        id: p.id,
        email: p.email,
        full_name: p.full_name,
        created_at: p.created_at,
        roles: (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role as AppRole),
        collegeIds: (ucs ?? []).filter((u) => u.user_id === p.id).map((u) => u.college_id),
        last_sign_in_at: metaMap.get(p.id)?.last_sign_in_at ?? null,
        banned_until: metaMap.get(p.id)?.banned_until ?? null,
      }));
    },
  });

  const { data: colleges } = useQuery({
    queryKey: ["colleges-min"],
    enabled: canLoadAdminData,
    queryFn: async () =>
      (await supabase.from("colleges").select("id, name").order("name")).data ?? [],
  });

  const canViewSecurityEvents = me?.isSuperAdmin === true;
  const {
    data: securityEvents,
    isLoading: securityEventsLoading,
    error: securityEventsError,
  } = useQuery({
    queryKey: ["security-events-recent"],
    enabled: canViewSecurityEvents,
    refetchInterval: 60_000,
    queryFn: async (): Promise<SecurityEventRow[]> => {
      const { data, error } = await supabase
        .from("security_events")
        .select("id, actor_id, event, severity, details, target_id, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []) as SecurityEventRow[];
    },
  });

  const securityEvents24h = useMemo(() => {
    const cutoff = Date.now() - 24 * 60 * 60 * 1000;
    return (securityEvents ?? []).filter((event) => new Date(event.created_at).getTime() >= cutoff);
  }, [securityEvents]);

  const setRole = useMutation({
    mutationFn: async ({ userId, role, on }: { userId: string; role: AppRole; on: boolean }) => {
      if (on) {
        const { error } = await supabase
          .from("user_roles")
          .insert({ user_id: userId, role: role as never });
        if (error && !error.message.includes("duplicate")) throw error;
        // Academic affairs reads every college: assign them
        // all here too (a database trigger is the authoritative safety net).
        // Multi-role safety: never widen an account that carries an admin role.
        const existingRoles = (
          (await supabase.from("user_roles").select("role").eq("user_id", userId)).data ?? []
        ).map((r) => r.role as AppRole);
        const isAdminAccount =
          existingRoles.includes("super_admin") || existingRoles.includes("college_admin");
        if (assignsAllColleges(role as never) && !isAdminAccount) {
          const all = (await supabase.from("colleges").select("id")).data ?? [];
          if (all.length > 0) {
            const { error: ucErr } = await supabase.from("user_colleges").upsert(
              all.map((c) => ({ user_id: userId, college_id: c.id })),
              { onConflict: "user_id,college_id", ignoreDuplicates: true },
            );
            if (ucErr && !ucErr.message.includes("duplicate")) throw ucErr;
          }
        }
      } else {
        const { error } = await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", userId)
          .eq("role", role as never);
        if (error) throw error;
      }
      await logAudit({
        action: "role_changed",
        entity: "user_roles",
        entityId: userId,
        details: { role, on },
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["all-users-admin"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleCollege = useMutation({
    mutationFn: async ({
      userId,
      collegeId,
      on,
    }: {
      userId: string;
      collegeId: string;
      on: boolean;
    }) => {
      if (on) {
        const { error } = await supabase
          .from("user_colleges")
          .insert({ user_id: userId, college_id: collegeId });
        if (error && !error.message.includes("duplicate")) throw error;
      } else {
        const { error } = await supabase
          .from("user_colleges")
          .delete()
          .eq("user_id", userId)
          .eq("college_id", collegeId);
        if (error) throw error;
      }
      await logAudit({
        action: on ? "college_assignment_added" : "college_assignment_removed",
        entity: "user_colleges",
        entityId: userId,
        collegeId,
        details: {},
      });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["all-users-admin"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const setEnabled = useMutation({
    mutationFn: async ({ userId, enabled }: { userId: string; enabled: boolean }) =>
      setEnabledFn({ data: { user_id: userId, enabled } }),
    onSuccess: () => {
      toast.success("تم التحديث");
      qc.invalidateQueries({ queryKey: ["all-users-admin"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const sendReset = useMutation({
    mutationFn: async ({ userId, email }: { userId: string; email: string }) =>
      resetFn({ data: { user_id: userId, email } }),
    onSuccess: (res) => {
      if (res?.action_link) {
        navigator.clipboard?.writeText(res.action_link).catch(() => {});
        toast.success("تم إنشاء رابط إعادة تعيين كلمة المرور ونسخه");
      } else {
        toast.success("تم إرسال طلب إعادة تعيين كلمة المرور");
      }
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const collegeMap = useMemo(
    () => new Map((colleges ?? []).map((c) => [c.id, c.name])),
    [colleges],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (users ?? []).filter((u) => {
      if (q) {
        const hay = `${u.full_name ?? ""} ${u.email ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      if (roleFilter !== "all" && !u.roles.includes(roleFilter as AppRole)) return false;
      if (collegeFilter !== "all" && !u.collegeIds.includes(collegeFilter)) return false;
      return true;
    });
  }, [users, search, roleFilter, collegeFilter]);

  if (pageAccess === "loading") {
    return <p className="p-6 text-center text-muted-foreground">جارٍ التحميل...</p>;
  }
  if (pageAccess === "forbidden") {
    return <UnauthorizedAccess />;
  }

  return (
    <div className="mx-auto max-w-6xl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <Users className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">إدارة المستخدمين</h1>
          <p className="text-sm text-muted-foreground">
            إنشاء الحسابات، تعيين الأدوار، إسناد الكلّيات، تعطيل/تمكين، وإعادة تعيين كلمة المرور.
          </p>
        </div>
        {!viewOnly && (
          <div className="flex flex-wrap gap-2">
            <CreateUserDialog
              colleges={colleges ?? []}
              presetRole="institutional_viewer"
              presetName={INSTITUTIONAL_VIEWER_ROLE_LABEL_AR}
              triggerLabel="إنشاء مشاهد مؤسسي"
              triggerVariant="outline"
              onCreate={async (input) => {
                await createUserFn({ data: input });
                qc.invalidateQueries({ queryKey: ["all-users-admin"] });
              }}
            />
            <CreateUserDialog
              colleges={colleges ?? []}
              presetRole="university_leadership"
              triggerLabel="إنشاء حساب للإدارة العليا"
              triggerVariant="outline"
              onCreate={async (input) => {
                await createUserFn({ data: input });
                qc.invalidateQueries({ queryKey: ["all-users-admin"] });
              }}
            />
            <CreateUserDialog
              colleges={colleges ?? []}
              presetRole="college_admin"
              triggerLabel="إنشاء مدير كلّية"
              triggerVariant="outline"
              triggerIcon={<ShieldCheck className="ml-1 h-4 w-4" />}
              onCreate={async (input) => {
                await createUserFn({ data: input });
                qc.invalidateQueries({ queryKey: ["all-users-admin"] });
              }}
            />
            <CreateUserDialog
              colleges={colleges ?? []}
              onCreate={async (input) => {
                await createUserFn({ data: input });
                qc.invalidateQueries({ queryKey: ["all-users-admin"] });
              }}
            />
          </div>
        )}
      </header>

      {canViewSecurityEvents && (
        <Card className="mb-4 border-amber-500/30 p-4" data-testid="security-events-panel">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <ShieldAlert className="h-5 w-5 text-amber-600" />
              <div>
                <h2 className="font-semibold">التنبيهات الأمنية</h2>
                <p className="text-xs text-muted-foreground">
                  قراءة فقط — أحدث 50 حدثًا، مع تحديث تلقائي كل دقيقة.
                </p>
              </div>
            </div>
            <Badge
              variant="outline"
              className={
                securityEvents24h.length > 0
                  ? "border-amber-500/40 bg-amber-500/10 text-amber-700"
                  : "border-emerald-500/40 bg-emerald-500/10 text-emerald-700"
              }
            >
              آخر 24 ساعة: {securityEvents24h.length}
            </Badge>
          </div>

          {securityEventsLoading ? (
            <p className="text-sm text-muted-foreground">جارٍ تحميل الأحداث الأمنية...</p>
          ) : securityEventsError ? (
            <p className="text-sm text-destructive" role="alert">
              تعذر قراءة سجل التنبيهات الأمنية. لم يتم افتراض أن الحالة آمنة.
            </p>
          ) : (securityEvents ?? []).length === 0 ? (
            <p className="text-sm text-muted-foreground">لا توجد أحداث أمنية مسجلة.</p>
          ) : (
            <div className="max-h-80 space-y-2 overflow-y-auto">
              {(securityEvents ?? []).map((event) => (
                <details key={event.id} className="rounded-md border border-border p-3">
                  <summary className="cursor-pointer text-sm">
                    <span className="font-medium">
                      {SECURITY_EVENT_LABELS[event.event] ?? event.event}
                    </span>
                    <span className="mx-2 text-muted-foreground">·</span>
                    <span className="text-xs text-muted-foreground">
                      {new Date(event.created_at).toLocaleString("ar")}
                    </span>
                    <Badge variant="outline" className="mr-2">
                      {event.severity}
                    </Badge>
                  </summary>
                  <div className="mt-2 text-xs text-muted-foreground">
                    <p dir="ltr">actor: {event.actor_id ?? "system"}</p>
                    {event.target_id && <p dir="ltr">target: {event.target_id}</p>}
                    <pre
                      className="mt-2 overflow-x-auto rounded bg-muted p-2 text-[11px]"
                      dir="ltr"
                    >
                      {JSON.stringify(redactSecurityDetails(event.details), null, 2)}
                    </pre>
                  </div>
                </details>
              ))}
            </div>
          )}
        </Card>
      )}

      <Card className="mb-4 p-4">
        <div className="grid gap-3 md:grid-cols-3">
          <div>
            <Label className="text-xs">بحث</Label>
            <Input
              placeholder="بحث بالاسم أو البريد"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          <div>
            <Label className="text-xs">الدور</Label>
            <Select value={roleFilter} onValueChange={setRoleFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأدوار</SelectItem>
                {(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs">الكلّية</Label>
            <Select value={collegeFilter} onValueChange={setCollegeFilter}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الكلّيات</SelectItem>
                {(colleges ?? []).map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      </Card>

      <Card className="overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-center text-muted-foreground">جارٍ التحميل...</p>
        ) : filtered.length === 0 ? (
          <p className="p-6 text-center text-muted-foreground">لا نتائج مطابقة.</p>
        ) : (
          <ul className="divide-y divide-border">
            {filtered.map((u) => {
              const expanded = expandedUser === u.id;
              const disabled =
                u.banned_until !== null &&
                u.banned_until !== "none" &&
                new Date(u.banned_until) > new Date();
              return (
                <li key={u.id} className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <p className="truncate font-semibold">{u.full_name ?? u.email}</p>
                        {disabled && (
                          <Badge
                            variant="outline"
                            className="border-red-500/30 bg-red-500/10 text-red-600"
                          >
                            معطّل
                          </Badge>
                        )}
                      </div>
                      <p className="text-xs text-muted-foreground" dir="ltr">
                        {u.email}
                      </p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {u.roles.length === 0 && (
                          <span className="text-xs text-muted-foreground">لا أدوار</span>
                        )}
                        {u.roles.map((r) => (
                          <Badge key={r} variant="outline" className={ROLE_TONE[r]}>
                            {ROLE_LABELS[r]}
                          </Badge>
                        ))}
                        {u.collegeIds.map((cid) => (
                          <Badge key={cid} variant="secondary" className="font-normal">
                            {collegeMap.get(cid) ?? "—"}
                          </Badge>
                        ))}
                      </div>
                      {u.roles.includes("college_admin") && u.collegeIds.length === 0 && (
                        <button
                          type="button"
                          onClick={() => setExpandedUser(u.id)}
                          className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-[11px] font-medium text-amber-700 transition-colors hover:bg-amber-500/20"
                        >
                          <AlertTriangle className="h-3.5 w-3.5" />
                          دور غير مفعّل — لم تُسنَد كلّية. اضغط للإسناد
                        </button>
                      )}
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        آخر دخول:{" "}
                        {u.last_sign_in_at
                          ? new Date(u.last_sign_in_at).toLocaleString("ar")
                          : "لم يُسجَّل دخول بعد"}
                      </p>
                    </div>
                    {viewOnly ? (
                      <span className="text-xs text-muted-foreground">
                        {READ_ONLY_VIEW_BADGE_AR}
                      </span>
                    ) : (
                      <div className="flex flex-wrap items-center gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() =>
                            u.email && sendReset.mutate({ userId: u.id, email: u.email })
                          }
                          disabled={sendReset.isPending || !u.email}
                        >
                          <KeyRound className="ml-1 h-3.5 w-3.5" />
                          إعادة تعيين كلمة المرور
                        </Button>
                        <Button
                          size="sm"
                          variant={disabled ? "default" : "outline"}
                          onClick={() =>
                            setEnabled.mutate({
                              userId: u.id,
                              enabled: disabled,
                            })
                          }
                          disabled={setEnabled.isPending || u.id === me?.id}
                        >
                          <Power className="ml-1 h-3.5 w-3.5" />
                          {disabled ? "تمكين" : "تعطيل"}
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setExpandedUser(expanded ? null : u.id)}
                        >
                          {expanded ? "إغلاق" : "إدارة"}
                        </Button>
                      </div>
                    )}
                  </div>

                  {expanded && (
                    <div className="mt-5 grid gap-6 rounded-lg bg-muted/30 p-4 md:grid-cols-2">
                      <div>
                        <p className="mb-3 text-sm font-semibold">الأدوار</p>
                        <div className="space-y-2">
                          {(Object.keys(ROLE_LABELS) as AppRole[]).map((role) => {
                            const isOn = u.roles.includes(role);
                            const isSelf = u.id === me?.id;
                            const lockSelf = role === "super_admin" && isSelf && isOn;
                            return (
                              <div
                                key={role}
                                className="rounded-md border border-border/60 bg-card/50 p-2"
                              >
                                <label className="flex items-center gap-2 text-sm">
                                  <Checkbox
                                    checked={isOn}
                                    disabled={lockSelf || setRole.isPending}
                                    onCheckedChange={(v) => {
                                      setRole.mutate({
                                        userId: u.id,
                                        role,
                                        on: !!v,
                                      });
                                      if (
                                        v &&
                                        role === "college_admin" &&
                                        u.collegeIds.length === 0
                                      ) {
                                        toast.info("لا تنسَ إسناد كلّية — الدور لا يُفعّل بدونها");
                                      }
                                    }}
                                  />
                                  {ROLE_LABELS[role]}
                                  {lockSelf && (
                                    <span className="text-xs text-muted-foreground">
                                      (لا يمكنك إزالة دورك)
                                    </span>
                                  )}
                                </label>
                                <p className="mt-1 pr-6 text-[11px] leading-relaxed text-muted-foreground">
                                  {ROLE_HINTS[role]}
                                </p>
                              </div>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <p className="mb-3 text-sm font-semibold">الكلّيات المُسندة</p>
                        {u.roles.includes("university_leadership") && (
                          <p className="mb-2 text-sm text-primary">
                            الإدارة العليا تقرأ تقارير جميع الكليات تلقائيًا. الإسنادات التالية تخص
                            الأدوار الأخرى فقط.
                          </p>
                        )}
                        {!colleges || colleges.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            لا توجد كلّيات بعد. أنشئ كلّية أولاً.
                          </p>
                        ) : (
                          <AddCollegeAssign
                            collegeOptions={colleges}
                            assigned={u.collegeIds}
                            onAdd={(cid) =>
                              toggleCollege.mutate({
                                userId: u.id,
                                collegeId: cid,
                                on: true,
                              })
                            }
                          />
                        )}
                        <div className="mt-3 space-y-1">
                          {u.collegeIds.map((cid) => (
                            <div
                              key={cid}
                              className="flex items-center justify-between rounded border border-border bg-card px-3 py-1.5 text-sm"
                            >
                              <span>{collegeMap.get(cid) ?? cid}</span>
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  toggleCollege.mutate({
                                    userId: u.id,
                                    collegeId: cid,
                                    on: false,
                                  })
                                }
                              >
                                إزالة
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>
    </div>
  );
}

function AddCollegeAssign({
  collegeOptions,
  assigned,
  onAdd,
}: {
  collegeOptions: { id: string; name: string }[];
  assigned: string[];
  onAdd: (id: string) => void;
}) {
  const [val, setVal] = useState("");
  const available = collegeOptions.filter((c) => !assigned.includes(c.id));
  return (
    <div className="flex gap-2">
      <Select value={val} onValueChange={setVal}>
        <SelectTrigger>
          <SelectValue placeholder="اختر كلّية لإسنادها" />
        </SelectTrigger>
        <SelectContent>
          {available.length === 0 && (
            <SelectItem value="__none" disabled>
              كل الكلّيات مُسندة
            </SelectItem>
          )}
          {available.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              {c.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      <Button
        type="button"
        size="sm"
        disabled={!val || val === "__none"}
        onClick={() => {
          onAdd(val);
          setVal("");
        }}
      >
        إسناد
      </Button>
    </div>
  );
}

function CreateUserDialog({
  colleges,
  onCreate,
  presetRole,
  presetName = "",
  triggerLabel = "مستخدم جديد",
  triggerVariant = "default",
  triggerIcon,
}: {
  colleges: { id: string; name: string }[];
  presetRole?: AppRole;
  presetName?: string;
  triggerLabel?: string;
  triggerVariant?: "default" | "outline";
  triggerIcon?: ReactNode;
  onCreate: (input: {
    full_name: string;
    email: string;
    password: string;
    role: AppRole;
    college_ids: string[];
  }) => Promise<void>;
}) {
  const initialRole: AppRole = presetRole ?? "read_only";
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    full_name: presetName,
    email: "",
    password: "",
    role: initialRole,
    college_ids: [] as string[],
  });
  const [busy, setBusy] = useState(false);

  const reset = () =>
    setForm({
      full_name: presetName,
      email: "",
      password: "",
      role: initialRole,
      college_ids: [],
    });

  const submit = async () => {
    if (!form.full_name.trim() || !form.email.trim() || form.password.length < 8) {
      toast.error("الاسم، البريد، وكلمة مرور لا تقل عن 8 أحرف مطلوبة");
      return;
    }
    // «إدارة الشؤون الأكاديمية» never picks colleges by hand: every current
    // college is sent, and the server recomputes the full list anyway.
    const collegeIds =
      form.role === "university_leadership"
        ? []
        : assignsAllColleges(form.role)
          ? colleges.map((c) => c.id)
          : form.college_ids;
    if (requiresCollegeAssignment(form.role) && collegeIds.length === 0) {
      toast.error("يجب إسناد كلّية واحدة على الأقل لهذا الدور");
      return;
    }
    if (requiresExactlyOneCollege(form.role) && collegeIds.length !== 1) {
      toast.error("يجب إسناد كلية واحدة فقط لعميد الكلية");
      return;
    }
    setBusy(true);
    try {
      await onCreate({ ...form, college_ids: collegeIds });

      toast.success("تم إنشاء المستخدم");
      setOpen(false);
      reset();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "فشل الإنشاء");
    } finally {
      setBusy(false);
    }
  };

  const generatePassword = () => {
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789!@#$%";
    const random = crypto.getRandomValues(new Uint32Array(18));
    const s = "A7!" + Array.from(random, (value) => chars[value % chars.length]).join("");
    setForm((f) => ({ ...f, password: s }));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={triggerVariant}>
          {triggerIcon ?? <Plus className="ml-1 h-4 w-4" />}
          {triggerLabel}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {presetRole === "institutional_viewer"
              ? "إنشاء حساب مشاهد مؤسسي"
              : presetRole === "college_admin"
                ? "إنشاء مدير كلّية"
                : "إنشاء مستخدم"}
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
          {(form.role === "read_only" ||
            form.role === "college_dean" ||
            assignsAllColleges(form.role)) && (
            <p className="rounded-md bg-secondary p-3 text-sm">
              {form.role === "institutional_viewer"
                ? INSTITUTIONAL_VIEWER_CREATE_NOTE_AR
                : form.role === "college_dean"
                  ? COLLEGE_DEAN_ROLE_HINT_AR
                  : READ_ONLY_CREATE_NOTE_AR}
            </p>
          )}
          {form.role === "university_leadership" && (
            <p className="rounded-md bg-primary/10 p-3 text-sm">
              {LEADERSHIP_ROLE_HINT_AR} يشمل الكليات الحالية وأي كلية تُضاف لاحقًا، دون إسناد
              صلاحيات إدارة الكليات.
            </p>
          )}
          <div>
            <Label>الاسم الكامل</Label>
            <Input
              value={form.full_name}
              onChange={(e) => setForm({ ...form, full_name: e.target.value })}
            />
          </div>
          <div>
            <Label>البريد الإلكتروني</Label>
            <Input
              type="email"
              dir="ltr"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
            />
          </div>
          <div>
            <Label>كلمة مرور مؤقتة</Label>
            <div className="flex gap-2">
              <Input
                dir="ltr"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
              <Button type="button" variant="outline" size="sm" onClick={generatePassword}>
                توليد
              </Button>
              {form.password && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard?.writeText(form.password).catch(() => {});
                    toast.success("تم النسخ");
                  }}
                >
                  <Copy className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <p className="mt-1 text-[11px] text-muted-foreground">
              {form.role === "super_admin"
                ? "8 أحرف على الأقل."
                : "كلمة مؤقتة؛ سيُلزم المستخدم بتعيين كلمة خاصة به عند أول دخول، من ٨ أحرف على الأقل تشمل حروفًا ومعها أرقام أو رموز."}
            </p>
          </div>
          <div>
            <Label>الدور</Label>
            <Select
              value={form.role}
              disabled={presetRole === "institutional_viewer"}
              onValueChange={(v) => setForm({ ...form, role: v as AppRole })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {(Object.keys(ROLE_LABELS) as AppRole[]).map((r) => (
                  <SelectItem key={r} value={r}>
                    {ROLE_LABELS[r]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="mt-1 text-[11px] text-muted-foreground">{ROLE_HINTS[form.role]}</p>
          </div>
          {assignsAllColleges(form.role) && (
            <div className="rounded-md border border-border p-3">
              <Label>الكلّيات المُسندة</Label>
              <p className="mt-1 text-[11px] text-muted-foreground">
                تُسند تلقائيًا <strong>جميع الكلّيات</strong> الحالية، وأي كلّية تُنشأ لاحقًا تُسند
                لهذا الحساب تلقائيًا. القراءة فقط، بلا أي صلاحية تعديل.
              </p>
            </div>
          )}
          {requiresCollegeAssignment(form.role) && (
            <div>
              <Label>
                الكلّيات المُسندة <span className="text-destructive">*</span>
              </Label>
              <p className="mb-1 text-[11px] text-muted-foreground">
                {form.role === "college_admin"
                  ? "سيحصل على كامل صلاحيات العمليات داخل الكلّيات المحددة. الإسناد إلزامي."
                  : form.role === "college_dean"
                    ? "اختر كلية واحدة فقط؛ ستُعرض لوحة القيادة وبيانات هذه الكلية دون غيرها."
                    : "اختر الكلّيات المسموح بعرض تقاريرها فقط. الإسناد إلزامي."}
              </p>
              {colleges.length === 0 ? (
                <p className="text-xs text-muted-foreground">أنشئ كلّية أولاً.</p>
              ) : (
                <div className="max-h-40 space-y-1 overflow-y-auto rounded border border-border p-2">
                  {colleges.map((c) => {
                    const checked = form.college_ids.includes(c.id);
                    return (
                      <label key={c.id} className="flex items-center gap-2 text-sm">
                        <Checkbox
                          checked={checked}
                          onCheckedChange={(v) =>
                            setForm((f) => ({
                              ...f,
                              college_ids: v
                                ? f.role === "college_dean"
                                  ? [c.id]
                                  : [...f.college_ids, c.id]
                                : f.college_ids.filter((id) => id !== c.id),
                            }))
                          }
                        />
                        {c.name}
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
            إلغاء
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "جارٍ الإنشاء…" : "إنشاء"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
