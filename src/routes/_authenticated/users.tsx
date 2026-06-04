import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser, type AppRole } from "@/hooks/use-current-user";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { Users } from "lucide-react";

export const Route = createFileRoute("/_authenticated/users")({
  head: () => ({ meta: [{ title: "إدارة المستخدمين" }] }),
  component: UsersPage,
});

const ROLE_LABELS: Record<AppRole, string> = {
  super_admin: "مدير عام",
  college_admin: "مدير كلّية",
  read_only: "قراءة فقط",
};

function UsersPage() {
  const { data: me } = useCurrentUser();
  const qc = useQueryClient();
  const [expandedUser, setExpandedUser] = useState<string | null>(null);

  const { data: users, isLoading } = useQuery({
    queryKey: ["all-users"],
    queryFn: async () => {
      const [{ data: profiles }, { data: roles }, { data: ucs }] = await Promise.all([
        supabase.from("profiles").select("id, full_name, email, created_at").order("created_at"),
        supabase.from("user_roles").select("user_id, role"),
        supabase.from("user_colleges").select("user_id, college_id"),
      ]);
      return (profiles ?? []).map((p) => ({
        ...p,
        roles: (roles ?? []).filter((r) => r.user_id === p.id).map((r) => r.role as AppRole),
        collegeIds: (ucs ?? []).filter((u) => u.user_id === p.id).map((u) => u.college_id),
      }));
    },
  });

  const { data: colleges } = useQuery({
    queryKey: ["colleges-min"],
    queryFn: async () => (await supabase.from("colleges").select("id, name").order("name")).data ?? [],
  });

  const setRole = useMutation({
    mutationFn: async ({ userId, role, on }: { userId: string; role: AppRole; on: boolean }) => {
      if (on) {
        const { error } = await supabase.from("user_roles").insert({ user_id: userId, role });
        if (error && !error.message.includes("duplicate")) throw error;
      } else {
        const { error } = await supabase.from("user_roles").delete().eq("user_id", userId).eq("role", role);
        if (error) throw error;
      }
      await logAudit({ action: on ? "grant_role" : "revoke_role", entity: "user_roles", entityId: userId, details: { role } });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["all-users"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggleCollege = useMutation({
    mutationFn: async ({ userId, collegeId, on }: { userId: string; collegeId: string; on: boolean }) => {
      if (on) {
        const { error } = await supabase.from("user_colleges").insert({ user_id: userId, college_id: collegeId });
        if (error && !error.message.includes("duplicate")) throw error;
      } else {
        const { error } = await supabase.from("user_colleges").delete().eq("user_id", userId).eq("college_id", collegeId);
        if (error) throw error;
      }
      await logAudit({ action: on ? "assign_college" : "unassign_college", entity: "user_colleges", entityId: userId, collegeId, details: {} });
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["all-users"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  const collegeMap = useMemo(() => new Map((colleges ?? []).map((c) => [c.id, c.name])), [colleges]);

  if (me && !me.isSuperAdmin) throw redirect({ to: "/dashboard" });

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-8 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <Users className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold">إدارة المستخدمين</h1>
          <p className="text-sm text-muted-foreground">
            عيّن أدوار المستخدمين، وأسندهم إلى كلّيات. إنشاء حسابات جديدة يتم من صفحة التسجيل.
          </p>
        </div>
      </header>

      <Card className="overflow-hidden">
        {isLoading ? (
          <p className="p-6 text-center text-muted-foreground">جارٍ التحميل...</p>
        ) : (
          <ul className="divide-y divide-border">
            {users?.map((u) => {
              const expanded = expandedUser === u.id;
              return (
                <li key={u.id} className="p-5">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div>
                      <p className="font-semibold">{u.full_name ?? u.email}</p>
                      <p className="text-xs text-muted-foreground" dir="ltr">{u.email}</p>
                      <div className="mt-2 flex flex-wrap gap-1">
                        {u.roles.length === 0 && <span className="text-xs text-muted-foreground">لا أدوار</span>}
                        {u.roles.map((r) => (
                          <span key={r} className="rounded bg-secondary px-2 py-0.5 text-[11px] font-medium text-secondary-foreground">
                            {ROLE_LABELS[r]}
                          </span>
                        ))}
                        {u.collegeIds.map((cid) => (
                          <span key={cid} className="rounded bg-accent/20 px-2 py-0.5 text-[11px] font-medium text-accent-foreground">
                            {collegeMap.get(cid) ?? "—"}
                          </span>
                        ))}
                      </div>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => setExpandedUser(expanded ? null : u.id)}>
                      {expanded ? "إغلاق" : "إدارة"}
                    </Button>
                  </div>

                  {expanded && (
                    <div className="mt-5 grid gap-6 rounded-lg bg-muted/30 p-4 md:grid-cols-2">
                      <div>
                        <p className="mb-3 text-sm font-semibold">الأدوار</p>
                        <div className="space-y-2">
                          {(Object.keys(ROLE_LABELS) as AppRole[]).map((role) => {
                            const isOn = u.roles.includes(role);
                            const isSelf = u.id === me?.id;
                            const disabled = role === "super_admin" && isSelf && isOn; // prevent removing own super_admin
                            return (
                              <label key={role} className="flex items-center gap-2 text-sm">
                                <Checkbox
                                  checked={isOn}
                                  disabled={disabled || setRole.isPending}
                                  onCheckedChange={(v) => setRole.mutate({ userId: u.id, role, on: !!v })}
                                />
                                {ROLE_LABELS[role]}
                                {disabled && <span className="text-xs text-muted-foreground">(لا يمكنك إزالة دورك الخاص)</span>}
                              </label>
                            );
                          })}
                        </div>
                      </div>

                      <div>
                        <p className="mb-3 text-sm font-semibold">الكلّيات المُسندة</p>
                        {(!colleges || colleges.length === 0) ? (
                          <p className="text-xs text-muted-foreground">لا توجد كلّيات بعد. أنشئ كلّية أولاً.</p>
                        ) : (
                          <AddCollegeAssign
                            collegeOptions={colleges}
                            assigned={u.collegeIds}
                            onAdd={(cid) => toggleCollege.mutate({ userId: u.id, collegeId: cid, on: true })}
                          />
                        )}
                        <div className="mt-3 space-y-1">
                          {u.collegeIds.map((cid) => (
                            <div key={cid} className="flex items-center justify-between rounded border border-border bg-card px-3 py-1.5 text-sm">
                              <span>{collegeMap.get(cid) ?? cid}</span>
                              <Button size="sm" variant="ghost" onClick={() => toggleCollege.mutate({ userId: u.id, collegeId: cid, on: false })}>
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
  collegeOptions, assigned, onAdd,
}: { collegeOptions: { id: string; name: string }[]; assigned: string[]; onAdd: (id: string) => void }) {
  const [val, setVal] = useState("");
  const available = collegeOptions.filter((c) => !assigned.includes(c.id));
  return (
    <div className="flex gap-2">
      <Select value={val} onValueChange={setVal}>
        <SelectTrigger><SelectValue placeholder="اختر كلّية لإسنادها" /></SelectTrigger>
        <SelectContent>
          {available.length === 0 && <SelectItem value="__none" disabled>كل الكلّيات مُسندة</SelectItem>}
          {available.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}
        </SelectContent>
      </Select>
      <Button type="button" size="sm" disabled={!val || val === "__none"} onClick={() => { onAdd(val); setVal(""); }}>
        إسناد
      </Button>
    </div>
  );
}
