import { createFileRoute, redirect } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-current-user";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { logAudit } from "@/lib/audit";
import { School, Pencil, Trash2 } from "lucide-react";

export const Route = createFileRoute("/_authenticated/colleges")({
  head: () => ({ meta: [{ title: "إدارة الكلّيات" }] }),
  component: CollegesPage,
});

function CollegesPage() {
  const { data: user } = useCurrentUser();
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [code, setCode] = useState("");
  const [universityId, setUniversityId] = useState<string>("");
  const [editingId, setEditingId] = useState<string | null>(null);

  const { data: universities } = useQuery({
    queryKey: ["universities"],
    queryFn: async () => (await supabase.from("universities").select("id, name").order("name")).data ?? [],
  });

  const { data: colleges, isLoading } = useQuery({
    queryKey: ["colleges"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("colleges")
        .select("id, name, code, university_id, created_at, universities(name)")
        .order("created_at");
      if (error) throw error;
      return data;
    },
  });

  const upsert = useMutation({
    mutationFn: async () => {
      if (!universityId) throw new Error("اختر الجامعة");
      if (editingId) {
        const { error } = await supabase.from("colleges").update({ name, code: code || null, university_id: universityId }).eq("id", editingId);
        if (error) throw error;
        await logAudit({ action: "update", entity: "college", entityId: editingId, details: { name } });
      } else {
        const { data, error } = await supabase.from("colleges").insert({ name, code: code || null, university_id: universityId }).select().single();
        if (error) throw error;
        await logAudit({ action: "create", entity: "college", entityId: data.id, collegeId: data.id, details: { name } });
      }
    },
    onSuccess: () => {
      toast.success(editingId ? "تم التحديث" : "تم الإنشاء");
      setName(""); setCode(""); setEditingId(null);
      qc.invalidateQueries({ queryKey: ["colleges"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("colleges").delete().eq("id", id);
      if (error) throw error;
      await logAudit({ action: "delete", entity: "college", entityId: id });
    },
    onSuccess: () => { toast.success("تم الحذف"); qc.invalidateQueries({ queryKey: ["colleges"] }); },
    onError: (e: Error) => toast.error(e.message),
  });

  if (user && !user.isSuperAdmin && !user.isInstitutionalViewer) throw redirect({ to: "/dashboard" });
  const canEdit = !!user?.isSuperAdmin;
  const viewOnly = isInstitutionalReadOnlyViewer(user);

  return (
    <div className="mx-auto max-w-5xl">
      <header className="mb-8 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <School className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold">إدارة الكلّيات</h1>
          <p className="text-sm text-muted-foreground">كل كلّية لها بياناتها ومستخدموها المعزولون.</p>
        </div>
      </header>

      {(!universities || universities.length === 0) && (
        <Card className="mb-6 border-warning/40 bg-warning/10 p-4 text-sm">
          أنشئ جامعة أولاً من صفحة <span className="font-semibold">إدارة الجامعة</span>.
        </Card>
      )}

      <Card className="mb-8 p-6">
        <h2 className="mb-4 font-semibold">{editingId ? "تعديل كلّية" : "إضافة كلّية"}</h2>
        <form
          onSubmit={(e) => { e.preventDefault(); if (!name.trim() || !universityId) return; upsert.mutate(); }}
          className="grid gap-4 md:grid-cols-2"
        >
          <div className="space-y-2">
            <Label>الجامعة</Label>
            <Select value={universityId} onValueChange={setUniversityId}>
              <SelectTrigger><SelectValue placeholder="اختر الجامعة" /></SelectTrigger>
              <SelectContent>
                {universities?.map((u) => (
                  <SelectItem key={u.id} value={u.id}>{u.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-name">اسم الكلّية</Label>
            <Input id="c-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="كلّية تكنولوجيا المعلومات" required />
          </div>
          <div className="space-y-2">
            <Label htmlFor="c-code">الرمز (اختياري)</Label>
            <Input id="c-code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="IT" dir="ltr" />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" disabled={upsert.isPending}>{editingId ? "حفظ" : "إضافة"}</Button>
            {editingId && (
              <Button type="button" variant="outline" onClick={() => { setEditingId(null); setName(""); setCode(""); setUniversityId(""); }}>
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
              <th className="px-4 py-3">الكلّية</th>
              <th className="px-4 py-3">الجامعة</th>
              <th className="px-4 py-3">الرمز</th>
              <th className="px-4 py-3 text-left">إجراءات</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">جارٍ التحميل...</td></tr>}
            {colleges?.length === 0 && <tr><td colSpan={4} className="p-6 text-center text-muted-foreground">لا توجد كلّيات بعد.</td></tr>}
            {colleges?.map((c) => (
              <tr key={c.id} className="border-t border-border">
                <td className="px-4 py-3 font-medium">{c.name}</td>
                <td className="px-4 py-3 text-sm text-muted-foreground">{c.universities?.name ?? "—"}</td>
                <td className="px-4 py-3 text-sm text-muted-foreground" dir="ltr">{c.code ?? "—"}</td>
                <td className="px-4 py-3 text-left">
                  <div className="inline-flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => {
                      setEditingId(c.id); setName(c.name); setCode(c.code ?? ""); setUniversityId(c.university_id);
                    }}>
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => { if (confirm("حذف هذه الكلّية؟")) remove.mutate(c.id); }}>
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
