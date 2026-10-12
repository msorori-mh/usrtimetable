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
import { useRouterState } from "@tanstack/react-router";
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
  const compact = useRouterState({
    select: (state) => state.location.pathname.replace(/\/$/, "") === "/reports",
  });
  const { colleges, activeId, active, setActiveId, isLoading } = useActiveCollege();

  return (
    <div
      className={
        compact
          ? "report-no-print flex min-w-0 flex-wrap items-center gap-2 rounded-lg border bg-card px-3 py-2 sm:flex-nowrap sm:gap-3"
          : "report-no-print flex min-w-0 flex-wrap items-center gap-4 rounded-2xl border-2 border-primary/30 bg-gradient-to-l from-primary/10 to-card p-4 shadow-sm sm:p-5"
      }
      dir="rtl"
      data-testid="reports-college-bar"
    >
      <span
        className={
          compact
            ? "grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
            : "grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-primary text-primary-foreground"
        }
      >
        <School className={compact ? "h-4 w-4" : "h-6 w-6"} />
      </span>
      <div className="min-w-0">
        <p
          className={
            compact
              ? "whitespace-normal break-words text-sm font-semibold text-primary"
              : "whitespace-normal break-words text-lg font-bold leading-relaxed text-primary sm:text-xl"
          }
        >
          {isLoading
            ? "تقارير الكلية"
            : colleges.length === 1
              ? entityDisplayName(colleges[0])
              : colleges.length > 1
                ? compact
                  ? "الكلية"
                  : "اختر الكلية لاستعراض تقاريرها"
                : "تقارير الكليات"}
        </p>
        {!compact && (
          <p className="mt-1 text-sm text-muted-foreground">
            {colleges.length > 1
              ? "جميع النتائج أدناه تتبع الكلية المختارة"
              : "الجداول والتقارير الخاصة بكليتك"}
          </p>
        )}
      </div>

      {isLoading ? (
        <span className="text-sm text-muted-foreground">جارٍ تحميل الكلّيات...</span>
      ) : colleges.length === 0 ? (
        <span className="text-sm text-muted-foreground">
          لا توجد كلّيات متاحة لحسابك. تواصل مع المدير العام لإسناد كلّية.
        </span>
      ) : colleges.length > 1 ? (
        <div
          className={
            compact
              ? "min-w-0 flex-1 basis-48"
              : "w-full min-w-0 sm:w-auto sm:min-w-[20rem] sm:flex-1"
          }
        >
          <Select value={activeId ?? undefined} onValueChange={setActiveId}>
            <SelectTrigger
              aria-label="اختيار الكلية للتقارير"
              className={
                compact
                  ? "h-auto min-h-9 w-full bg-background py-1.5 text-start text-sm [&>span]:whitespace-normal"
                  : "h-auto min-h-12 w-full bg-background py-3 text-start text-base font-semibold [&>span]:whitespace-normal"
              }
            >
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
      ) : null}

      {colleges.length > 1 && (
        <span className="text-xs text-muted-foreground">
          {colleges.length} كلّية متاحة
          {!compact && <> · التقارير تتبع الكلية المختارة{active ? ` (${active.name})` : ""}</>}
        </span>
      )}
    </div>
  );
}
