import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useCurrentUser } from "@/hooks/use-current-user";
import { Card } from "@/components/ui/card";
import { School, ShieldCheck } from "lucide-react";

export const Route = createFileRoute("/_authenticated/my-college")({
  head: () => ({ meta: [{ title: "كلّيتي" }] }),
  component: MyCollegePage,
});

function MyCollegePage() {
  const { data: user } = useCurrentUser();

  const { data: colleges, isLoading } = useQuery({
    queryKey: ["my-colleges", user?.collegeIds],
    enabled: !!user,
    queryFn: async () => {
      if (!user || user.collegeIds.length === 0) return [];
      const { data, error } = await supabase
        .from("colleges")
        .select("id, name, code, universities(name)")
        .in("id", user.collegeIds);
      if (error) throw error;
      return data ?? [];
    },
  });

  return (
    <div className="mx-auto max-w-4xl">
      <header className="mb-8 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <School className="h-5 w-5" />
        </span>
        <div>
          <h1 className="text-2xl font-bold">كلّيتي</h1>
          <p className="text-sm text-muted-foreground">الكلّيات المُسنَدة إليك ضمن النظام.</p>
        </div>
      </header>

      {isLoading && <p className="text-muted-foreground">جارٍ التحميل...</p>}

      {!isLoading && (!colleges || colleges.length === 0) && (
        <Card className="border-warning/40 bg-warning/10 p-6 text-center">
          <ShieldCheck className="mx-auto mb-2 h-6 w-6 text-warning-foreground" />
          <p className="font-medium">لم يتم إسنادك إلى أي كلّية بعد</p>
          <p className="mt-1 text-sm text-muted-foreground">تواصل مع المدير العام لإسنادك إلى كلّيتك.</p>
        </Card>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        {colleges?.map((c) => (
          <Card key={c.id} className="p-6">
            <p className="text-xs text-muted-foreground">{c.universities?.name}</p>
            <h2 className="mt-1 text-xl font-bold">{c.name}</h2>
            <p className="mt-4 text-xs text-muted-foreground">
              الأقسام، المواد، والجداول ستضاف في المراحل القادمة.
            </p>
          </Card>
        ))}
      </div>
    </div>
  );
}
