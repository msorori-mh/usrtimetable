import { useRef, useState } from "react";
import { Printer } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import {
  buildStudyPlansPrint,
  type PrintablePlan,
  type PrintableCourse,
} from "@/lib/study-plans/print";
import { requestPrint, PRINT_REQUEST_DISPATCHED_AR } from "@/lib/print-center/print-action";

export function PrintPlansButton({
  collegeId,
  collegeName,
  plans,
  disabled,
}: {
  collegeId: string;
  collegeName: string;
  plans: PrintablePlan[];
  disabled?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  const [html, setHtml] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const preview = async () => {
    if (busy || !plans.length) return;
    setBusy(true);
    setReady(false);
    try {
      const result = [];
      // Read every page of each selected plan; never print a silently truncated list.
      for (const plan of plans) {
        const courses: PrintableCourse[] = [];
        for (let from = 0; ; from += 500) {
          const { data, error } = await supabase
            .from("plan_courses")
            .select(
              "id, semester, is_required, course:courses!plan_courses_course_id_fkey(code,name,credit_hours), level:academic_levels!plan_courses_level_id_fkey(name,level_number), components:plan_course_components!plan_course_components_plan_course_id_fkey(component_type,weekly_contact_hours)",
            )
            .eq("college_id", collegeId)
            .eq("study_plan_id", plan.id)
            .order("id")
            .range(from, from + 499);
          if (error) throw error;
          courses.push(...(data ?? []));
          if ((data?.length ?? 0) < 500) break;
        }
        result.push({ plan, courses });
      }
      setHtml(buildStudyPlansPrint(collegeName, result));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "تعذر تحميل مقررات الخطط للطباعة.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        variant="outline"
        disabled={disabled || busy || !plans.length}
        onClick={() => void preview()}
        data-testid="study-plans-print"
      >
        <Printer className="ms-1 h-4 w-4" />
        {busy ? "جارٍ تجهيز الخطط…" : "طباعة الخطط"}
      </Button>
      <Dialog
        open={html !== null}
        onOpenChange={(open) => {
          if (!open) {
            setHtml(null);
            setReady(false);
          }
        }}
      >
        <DialogContent className="max-w-5xl" dir="rtl">
          <DialogHeader>
            <DialogTitle>معاينة طباعة الخطط الدراسية</DialogTitle>
            <DialogDescription>
              الخطط المطابقة لاختيار الكلية والقسم والبرنامج. يمكنك الطباعة أو الحفظ بصيغة PDF.
            </DialogDescription>
          </DialogHeader>
          <Button
            disabled={!ready}
            onClick={() => {
              const result = requestPrint(frame.current?.contentWindow);
              if (result.status === "dispatched") toast.info(PRINT_REQUEST_DISPATCHED_AR);
              else toast.error(result.message);
            }}
          >
            طباعة / حفظ PDF
          </Button>
          <iframe
            ref={frame}
            title="الخطط الدراسية للطباعة"
            className="h-[65vh] w-full rounded border bg-white"
            sandbox="allow-same-origin allow-modals"
            srcDoc={html ?? ""}
            onLoad={() => setReady(true)}
          />
        </DialogContent>
      </Dialog>
    </>
  );
}
