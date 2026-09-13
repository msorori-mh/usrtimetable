/**
 * REPORTS-COLLEGE-SWITCH-01 — persistent college context bar for /reports.
 *
 * Reports-only accounts (e.g. «مشاهد») have every assigned college in
 * `user_colleges` but no operational page that lets them switch the active
 * college, so they were stuck on whatever id was last stored locally. This bar
 * renders inside the /reports layout (above <Outlet />) so the hub and every
 * sub-report share the same switch. Read-only: it only writes the shared
 * active-college id, never any academic data.
 */
import { School } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveCollege } from "@/hooks/use-colleges";
import { entityDisplayName } from "@/lib/entity-display";

export function ReportsCollegeBar() {
  const { colleges, activeId, active, setActiveId, isLoading } = useActiveCollege();

  return (
    <div
      className="report-no-print flex min-w-0 flex-wrap items-center gap-3 rounded-lg border border-border bg-card/60 px-3 py-2"
      dir="rtl"
      data-testid="reports-college-bar"
    >
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-secondary text-primary">
        <School className="h-4 w-4" />
      </span>
      <span className="text-sm font-medium text-muted-foreground">الكلية</span>

      {isLoading ? (
        <span className="text-sm text-muted-foreground">جارٍ تحميل الكلّيات...</span>
      ) : colleges.length === 0 ? (
        <span className="text-sm text-muted-foreground">
          لا توجد كلّيات متاحة لحسابك. تواصل مع المدير العام لإسناد كلّية.
        </span>
      ) : colleges.length === 1 ? (
        <span
          className="text-sm font-semibold text-foreground"
          data-testid="reports-college-single"
        >
          {entityDisplayName(colleges[0])}
        </span>
      ) : (
        <div className="min-w-[16rem]">
          <Select value={activeId ?? undefined} onValueChange={setActiveId}>
            <SelectTrigger aria-label="اختيار الكلية للتقارير">
              <SelectValue placeholder="اختر كلّية" />
            </SelectTrigger>
            <SelectContent>
              {colleges.map((c) => (
                <SelectItem key={c.id} value={c.id}>
                  {entityDisplayName(c)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {colleges.length > 1 && (
        <span className="text-xs text-muted-foreground">
          {colleges.length} كلّية متاحة · التقارير تتبع الكلية المختارة
          {active ? ` (${active.name})` : ""}
        </span>
      )}
    </div>
  );
}
