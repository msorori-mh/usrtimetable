import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
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
  resolveSuperAdminPageAccess,
  shouldLoadSuperAdminPageData,
} from "@/lib/unauthorized-access";
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
import { Users, Plus, KeyRound, Power, Copy, ShieldCheck, AlertTriangle } from "lucide-react";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "إدارة المستخدمين" }] }),
  component: UsersPage,
});

const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "مدير المؤسسة",
  college_admin: "مدير كلّية",
  read_only: "مشاهد",
};

const ROLE_TONE: Record<AppRole, string> = {
  super_admin: "bg-primary/10 text-primary border-primary/20",
  college_admin: "bg-accent/20 text-accent-foreground border-accent/30",
  read_only: "bg-muted text-muted-foreground border-border",
};

const ROLE_HINTS: Record<AppRole, string> = {
  super_admin: "صلاحيات كاملة على جميع الكلّيات، وإدارة المستخدمين والأدوار.",
  college_admin: "كامل صلاحيات العمليات داخل الكلّيات المُسندة له، بما فيها الاستيراد من Excel.",
  read_only: "اطّلاع فقط على بيانات الكلّيات المُسندة، بدون أي تعديل.",
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
  const pageAccess = resolveSuperAdminPageAccess(me, meLoading);
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
    queryKey: ["all-users-admin"],
    enabled: canLoadAdminData,
    queryFn: async (): Promise<UserRow[]> => {
      const [{ data: profiles }, { data: roles }, { data: ucs }, meta] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email, created_at").order("created_at"),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("user_colleges").select("user_id, college_id"),
        listMeta().catch(() => [] as Awaited<ReturnType<typeof listMeta>>),
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

  const setRole = useMutation({
    mutationFn: async ({ userId, role, on }: { userId: string; role: AppRole; on: boolean }) => {
      if (on) {
        const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
        if (error && !error.message.includes("duplicate")) throw error;
      } else {
        const { error } = await supabase
          .from("user_roles")
          .delete()
          .eq("user_id", userId)
          .eq("role", role);
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
        <div className="flex flex-wrap gap-2">
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
      </header>

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
                      <p className="mt-2 text-[11px] text-muted-foreground">
                        آخر دخول:{" "}
                        {u.last_sign_in_at
                          ? new Date(u.last_sign_in_at).toLocaleString("ar")
                          : "لم يُسجَّل دخول بعد"}
                      </p>
                    </div>
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
                        onClick={() => setEnabled.mutate({ userId: u.id, enabled: disabled })}
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
                              <label key={role} className="flex items-center gap-2 text-sm">
                                <Checkbox
                                  checked={isOn}
                                  disabled={lockSelf || setRole.isPending}
                                  onCheckedChange={(v) =>
                                    setRole.mutate({ userId: u.id, role, on: !!v })
                                  }
                                />
                                {ROLE_LABELS[role]}
                                {lockSelf && (
                                  <span className="text-xs text-muted-foreground">
                                    (لا يمكنك إزالة دورك)
                                  </span>
                                )}
                              </label>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <p className="mb-3 text-sm font-semibold">الكلّيات المُسندة</p>
                        {!colleges || colleges.length === 0 ? (
                          <p className="text-xs text-muted-foreground">
                            لا توجد كلّيات بعد. أنشئ كلّية أولاً.
                          </p>
                        ) : (
                          <AddCollegeAssign
                            collegeOptions={colleges}
                            assigned={u.collegeIds}
                            onAdd={(cid) =>
                              toggleCollege.mutate({ userId: u.id, collegeId: cid, on: true })
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
}: {
  colleges: { id: string; name: string }[];
  onCreate: (input: {
    full_name: string;
    email: string;
    password: string;
    role: AppRole;
    college_ids: string[];
  }) => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    full_name: "",
    email: "",
    password: "",
    role: "read_only" as AppRole,
    college_ids: [] as string[],
  });
  const [busy, setBusy] = useState(false);

  const reset = () =>
    setForm({ full_name: "", email: "", password: "", role: "read_only", college_ids: [] });

  const submit = async () => {
    if (!form.full_name.trim() || !form.email.trim() || form.password.length < 8) {
      toast.error("الاسم، البريد، وكلمة مرور لا تقل عن 8 أحرف مطلوبة");
      return;
    }
    if (form.role !== "super_admin" && form.college_ids.length === 0) {
      toast.error("يجب إسناد كلّية واحدة على الأقل لهذا الدور");
      return;
    }
    setBusy(true);
    try {
      await onCreate(form);
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
    let s = "";
    for (let i = 0; i < 14; i++) s += chars[Math.floor(Math.random() * chars.length)];
    setForm((f) => ({ ...f, password: s }));
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="ml-1 h-4 w-4" />
          مستخدم جديد
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>إنشاء مستخدم</DialogTitle>
        </DialogHeader>
        <div className="space-y-3">
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
            <p className="mt-1 text-[11px] text-muted-foreground">8 أحرف على الأقل.</p>
          </div>
          <div>
            <Label>الدور</Label>
            <Select
              value={form.role}
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
          </div>
          {form.role !== "super_admin" && (
            <div>
              <Label>الكلّيات المُسندة</Label>
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
                                ? [...f.college_ids, c.id]
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
