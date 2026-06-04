import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-current-user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { Building2, Pencil, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/universities")({
  head: () => ({ meta: [{ title: "إدارة الجامعة" }] }),
  component: UniversitiesPage,
});

function UniversitiesPage() {
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: list, isLoading } = useQuery({
    queryKey: ["universities"],
    queryFn: async () => {
      const { data, error } = await supabase.from("universities").select("*").order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const upsert = useMutation({
    mutationFn: async () => {
      if (editingId) {
        const { error } = await supabase.from("universities").update({ name, code: code || null }).eq("id", editingId);
        if (error) throw error;
        await logAudit({ action: "update", entity: "university", entityId: editingId, details: { name, code } });
      } else {
        const { data, error } = await supabase.from("universities").insert({ name, code: code || null }).select().single();
        if (error) throw error;
        await logAudit({ action: "create", entity: "university", entityId: data.id, details: { name, code } });
      }
    },
    onSuccess: () => {
      toast.success(editingId ? "تم التحديث" : "تم الإنشاء");
      setName(""); setCode(""); setEditingId(null);
      qc.invalidateQueries({ queryKey: ["universities"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("universities").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ action: "delete", entity: "university", entityId: id });
    },
    onSuccess: () => { toast.success("تم الحذف"); qc.invalidateQueries({ queryKey: ["universities"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (user && !user.isSuperAdmin) {
    throw redirect({ to: "/dashboard" });
  }

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-8 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <Building2 className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold">إدارة الجامعة</h1>
          <p className="text-sm text-muted-foreground">أنشئ جامعتك وعدّل بياناتها.</p>
        </div>
      </header>

      <Card className="mb-8 p-6">
        <h2 className="mb-4 font-semibold">{editingId ? "تعديل جامعة" : "إضافة جامعة"}</h2>
        <form
          onSubmit={(e) => { e.preventDefault(); if (!name.trim()) return; upsert.mutate(); }}
          className="grid gap-4 md:grid-cols-[2fr_1fr_auto] md:items-end"
        >
          <div className="space-y-2">
            <Label htmlFor="u-name">اسم الجامعة</Label>
            <Input id="u-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="جامعة كذا" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="u-code">الرمز (اختياري)</Label>
            <Input id="u-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="U01" dir="ltr" />
          </div>
          <div className="flex gap-2">
            <Button type="submit" disabled={upsert.isPending}>{editingId ? "حفظ" : "إضافة"}</Button>
            {editingId && (
              <Button type="button" variant="outline" onClick={() => { setEditingId(null); setName(""); setCode(""); }}>
                إلغاء
              </Button>
            )}
          </div>
        </form>
      </Card>

      <Card className="overflow-hidden">
        <table className="w-full">
          <thead className="bg-muted/40 text-right text-xs uppercase text-muted-foreground">
            <tr>
              <th className="px-4 py-3">الاسم</th>
              <th className="px-4 py-3">الرمز</th>
              <th className="px-4 py-3">تاريخ الإنشاء</th>
              <th className="px-4 py-3 text-left">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">جارٍ التحميل...</td></tr>}
            {list?.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">لا توجد جامعات بعد.</td></tr>}
            {list?.map((u) => (
              <tr key={u.id} className="border-t border-border">
                <td className="px-4 py-3 font-medium">{u.name}</td>
                <td className="px-4 py-3 text-sm text-muted-foreground" dir="ltr">{u.code ?? "—"}</td>
                <td className="px-4 py-3 text-sm text-muted-foreground">
                  {new Date(u.created_at).toLocaleDateString("ar-EG")}
                </td>
                <td className="px-4 py-3 text-left">
                  <div className="inline-flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => { setEditingId(u.id); setName(u.name); setCode(u.code ?? ""); }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { if (confirm("حذف هذه الجامعة وكل كلّياتها؟")) remove.mutate(u.id); }}>
                      <Trash2 className="h-3.5 w-3.5 text-destructive" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
    </div>
  );
}
