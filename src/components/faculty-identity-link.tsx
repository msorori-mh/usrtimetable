import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/use-current-user";
import { supabase } from "@/integrations/supabase/client";
import { withUniversityNumbers } from "@/lib/instructors/university-number";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";

export function FacultyIdentityLink({
  instructorId,
  name,
}: {
  instructorId: string;
  name: string;
}) {
  const { data: me } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const qc = useQueryClient();
  const candidates = useQuery({
    queryKey: ["faculty-identity-link-candidates", instructorId],
    enabled: open && !!me?.isSuperAdmin,
    queryFn: async () => {
      const rows: { id: string; full_name: string }[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await supabase
          .from("instructors")
          .select("id, full_name")
          .order("id")
          .range(offset, offset + 499);
        if (error) throw error;
        rows.push(...(data ?? []));
        if (!data || data.length < 500) break;
      }
      return withUniversityNumbers(rows.filter((row) => row.id !== instructorId));
    },
  });
  const link = useMutation({
    mutationFn: async () => {
      if (!confirmed || !target) throw new Error("اختر السجل وأكد التحقق من هوية المحاضر");
      const { error } = await supabase.rpc("link_verified_faculty_identity", {
        p_instructor_id: instructorId,
        p_university_number: target,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["instructors"] });
      void qc.invalidateQueries({ queryKey: ["report-instructor-directory"] });
      void qc.invalidateQueries({ queryKey: ["is-ins"] });
      void qc.invalidateQueries({ queryKey: ["faculty-identity-link-candidates"] });
      setOpen(false);
      setConfirmed(false);
      setTarget("");
      toast.success("تم توحيد الهوية الجامعية مع الحفاظ على الإسنادات والجداول");
    },
    onError: (error: Error) => toast.error(error.message),
  });
  if (!me?.isSuperAdmin) return null;
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          ربط الهوية الجامعية
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl">
        <DialogHeader>
          <DialogTitle>ربط سجل {name} بنفس المحاضر</DialogTitle>
        </DialogHeader>
        <p className="text-sm">
          اختر السجل المعتمد لنفس الشخص. سيُستخدم رقمه الجامعي للسجلات المرتبطة، مع الاحتفاظ
          بالأرقام السابقة والإسنادات والجداول.
        </p>
        <label>
          السجل المعتمد
          <select
            aria-label="السجل المعتمد للهوية الجامعية"
            className="w-full rounded border p-2"
            value={target}
            onChange={(event) => {
              setTarget(event.target.value);
              setConfirmed(false);
            }}
          >
            <option value="">اختر المحاضر ورقمه الجامعي</option>
            {(candidates.data ?? [])
              .filter((row) => row.university_number)
              .map((row) => (
                <option key={row.id} value={row.university_number!}>
                  {row.full_name} — {row.university_number}
                </option>
              ))}
          </select>
        </label>
        {candidates.error && <p role="alert">تعذر تحميل السجلات. أعد فتح النافذة للمحاولة.</p>}
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(event) => setConfirmed(event.target.checked)}
          />
          تحققت أن السجلين لنفس الشخص، وليس مجرد تشابه أسماء.
        </label>
        <Button
          disabled={!target || !confirmed || link.isPending || candidates.isLoading}
          onClick={() => link.mutate()}
        >
          تأكيد ربط الهوية
        </Button>
      </DialogContent>
    </Dialog>
  );
}
