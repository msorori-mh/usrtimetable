import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCurrentUser } from "@/hooks/use-current-user";
import { facultyWorkflow } from "@/lib/instructors/faculty-workflow";
import { facultyClient } from "@/lib/instructors/university-number";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { toast } from "sonner";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { FacultyCollegeTransfer } from "@/components/faculty-college-transfer";

export function FacultyIdentityLink({
  instructorId,
  collegeId,
  name,
}: {
  instructorId: string;
  collegeId: string;
  name: string;
}) {
  const { data: me } = useCurrentUser();
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState("link");
  const [transferring, setTransferring] = useState(false);
  const [target, setTarget] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const qc = useQueryClient();
  const normalizedSearch = searchQuery.trim();
  const candidates = useQuery({
    queryKey: ["faculty-identity-link-candidates", instructorId, normalizedSearch],
    enabled: open && action === "link" && !!me?.isSuperAdmin && normalizedSearch.length >= 2,
    queryFn: async () => {
      const { data, error } = await facultyWorkflow.rpc("search_faculty_identity_candidates", {
        p_instructor_id: instructorId,
        p_search: normalizedSearch,
      });
      if (error) throw error;
      return data ?? [];
    },
  });
  const filteredCandidates = normalizedSearch.length >= 2 ? (candidates.data ?? []) : [];

  const submitLink = () => {
    if (!target) {
      toast.error("اختر السجل المعتمد أولًا.");
      return;
    }
    if (!confirmed) {
      toast.error("أكد أن السجلين يعودان لنفس الشخص.");
      return;
    }
    link.mutate();
  };

  const link = useMutation({
    mutationFn: async () => {
      if (
        !confirmed ||
        !target ||
        !filteredCandidates.some((row) => row.university_number === target)
      )
        throw new Error("اختر السجل وأكد أن السجلين يعودان لنفس الشخص.");
      const { error } = await facultyClient.rpc("link_verified_faculty_identity", {
        p_instructor_id: instructorId,
        p_university_number: target,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["instructors"] });
      void qc.invalidateQueries({ queryKey: ["report-instructor-directory"] });
      void qc.invalidateQueries({ queryKey: ["is-ins"] });
      void qc.invalidateQueries({
        queryKey: ["faculty-identity-link-candidates"],
      });
      void qc.invalidateQueries({ queryKey: ["faculty-university-report"] });
      void qc.invalidateQueries({ queryKey: ["faculty-university-choices"] });
      void qc.invalidateQueries({ queryKey: ["faculty-home-profiles"] });
      setOpen(false);
      setConfirmed(false);
      setTarget("");
      setSearchQuery("");
      toast.success("تم توحيد الهوية الجامعية مع الحفاظ على الإسنادات والجداول");
    },
    onError: (error: Error) => toast.error(error.message),
  });

  if (!me?.isSuperAdmin) return null;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (link.isPending || transferring) return;
        setOpen(nextOpen);
        if (!nextOpen) {
          setAction("link");
          setSearchQuery("");
          setTarget("");
          setConfirmed(false);
        }
      }}
    >
      <DialogTrigger asChild>
        <Button size="sm" variant="outline">
          ربط الهوية الجامعية
        </Button>
      </DialogTrigger>
      <DialogContent dir="rtl" className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>إدارة الهوية الجامعية — {name}</DialogTitle>
          <DialogDescription>
            ربط سجلات المحاضر أو تصحيح الكلية التي أُدخل فيها بالخطأ.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={action} onValueChange={setAction} dir="rtl">
          <TabsList aria-label="إجراءات الهوية الجامعية">
            <TabsTrigger value="link" disabled={link.isPending || transferring}>
              ربط بسجل آخر
            </TabsTrigger>
            <TabsTrigger value="transfer" disabled={link.isPending || transferring}>
              نقل إلى كلية أخرى
            </TabsTrigger>
          </TabsList>
          <TabsContent value="link" className="space-y-4">
            <p className="text-sm">
              اختر السجل المعتمد لنفس الشخص. سيُستخدم رقمه الجامعي للسجلات المرتبطة، مع الاحتفاظ
              بالأرقام السابقة والإسنادات والجداول.
            </p>
            <label className="space-y-1">
              <span>بحث عن المحاضر</span>
              <input
                type="search"
                aria-label="البحث في سجلات المحاضرين"
                className="w-full rounded border p-2"
                value={searchQuery}
                onChange={(event) => {
                  setSearchQuery(event.target.value);
                  setTarget("");
                  setConfirmed(false);
                }}
                placeholder="اكتب جزءًا من الاسم أو الرقم الجامعي أو رقم الموظف"
                autoComplete="off"
              />
              {normalizedSearch && (
                <span className="block text-xs text-muted-foreground">
                  {filteredCandidates.length} نتيجة مطابقة
                </span>
              )}
            </label>
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
                <option value="">
                  {normalizedSearch.length < 2
                    ? "اكتب حرفين على الأقل للبحث في الجامعة"
                    : candidates.isLoading
                      ? "جارٍ تحميل المحاضرين..."
                      : filteredCandidates.length === 0 && normalizedSearch
                        ? "لا توجد نتائج مطابقة"
                        : "اختر المحاضر ورقمه الجامعي"}
                </option>
                {filteredCandidates.map((row) => (
                  <option key={row.id} value={row.university_number!}>
                    {row.full_name} — {row.university_number} —{" "}
                    {row.home_college ?? "تبعية تحتاج مراجعة"} —{" "}
                    {row.specialization ?? "تخصص غير محدد"} — {row.employee_number}
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
              disabled={link.isPending || candidates.isLoading || !target || !confirmed}
              onClick={submitLink}
            >
              {link.isPending ? "جارٍ ربط الهوية..." : "تأكيد ربط الهوية"}
            </Button>
          </TabsContent>
          <TabsContent value="transfer">
            <FacultyCollegeTransfer
              key={`${instructorId}:${collegeId}`}
              instructorId={instructorId}
              collegeId={collegeId}
              onBusyChange={setTransferring}
              onTransferred={() => {
                setOpen(false);
                setAction("link");
                setSearchQuery("");
                setTarget("");
                setConfirmed(false);
              }}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}
