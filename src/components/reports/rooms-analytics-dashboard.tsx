import { useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, Cell, Label, Pie, PieChart, XAxis, YAxis } from "recharts";
import { AlertTriangle, Building2, ChevronDown, Info, Microscope } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  ROOMS_REPORT_SUMMARY_HEADERS,
  utilizationBand,
  type RoomsReportAnalytics,
  type RoomsReportSummaryRow,
  type RoomsUtilizationBand,
} from "@/lib/print-center/rooms-report";

type View = "all" | "hall" | "lab";
type Band = "all" | RoomsUtilizationBand;
type SortKey = "utilization" | "free" | "capacity" | "sessions";

const CHART_CONFIG = {
  utilization: { label: "استغلال الوقت", color: "var(--color-primary)" },
  used: { label: "مستخدمة", color: "var(--color-primary)" },
  free: { label: "فارغة", color: "var(--color-muted-foreground)" },
} satisfies ChartConfig;

const heatClass = (value: number) => {
  if (value >= 90) return "bg-destructive text-destructive-foreground";
  if (value >= 70) return "bg-warning text-warning-foreground";
  if (value >= 40) return "bg-primary/70 text-primary-foreground";
  if (value > 0) return "bg-secondary text-secondary-foreground";
  return "bg-muted text-muted-foreground";
};

function MetricHint({ kind }: { kind: "time" | "capacity" }) {
  const text =
    kind === "time"
      ? "الساعات المستخدمة ÷ الساعات المتاحة للمورد."
      : "متوسط الطلاب الفعلي في الجلسة ÷ سعة المورد.";
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger asChild>
          <Info
            className="inline h-3.5 w-3.5 cursor-help text-muted-foreground"
            aria-label={text}
          />
        </TooltipTrigger>
        <TooltipContent>{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

function RankingList({ title, rows }: { title: string; rows: RoomsReportSummaryRow[] }) {
  return (
    <Card className="p-4">
      <h3 className="mb-3 text-sm font-bold">{title}</h3>
      <ol className="space-y-2">
        {rows.map((row, index) => (
          <li key={row.room_id} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">
              <b className="ms-2 text-muted-foreground">{index + 1}</b>
              {row.room_name}
            </span>
            <span className="shrink-0 font-semibold tabular-nums">{row.utilization}</span>
          </li>
        ))}
      </ol>
    </Card>
  );
}

export function RoomsAnalyticsDashboard({
  summary,
  analytics,
}: {
  summary: RoomsReportSummaryRow[];
  analytics: RoomsReportAnalytics;
}) {
  const [view, setView] = useState<View>("all");
  const [band, setBand] = useState<Band>("all");
  const [sort, setSort] = useState<SortKey>("utilization");
  const [detailsOpen, setDetailsOpen] = useState(false);
  const rows = useMemo(() => {
    const filtered = summary.filter(
      (row) =>
        (view === "all" || row.room_category === view) &&
        (band === "all" || utilizationBand(row.utilization_percent) === band),
    );
    return filtered.sort((a, b) => {
      if (sort === "free") return b.free_hours - a.free_hours;
      if (sort === "capacity") return Number(b.capacity || 0) - Number(a.capacity || 0);
      if (sort === "sessions") return b.session_count - a.session_count;
      return b.utilization_percent - a.utilization_percent;
    });
  }, [summary, view, band, sort]);
  const heatSlots = [...new Set(analytics.heatmap.map((cell) => cell.slot))];
  const heatDays = [...new Set(analytics.heatmap.map((cell) => cell.day))];
  const totalUsed = summary.reduce((sum, row) => sum + row.used_hours, 0);
  const totalFree = summary.reduce((sum, row) => sum + row.free_hours, 0);

  return (
    <div className="space-y-6" data-testid="rooms-analytics-dashboard">
      <section className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card className="p-5">
          <div className="flex items-center gap-2">
            <Building2 className="h-5 w-5 text-primary" />
            <h2 className="font-bold">الملخص التنفيذي</h2>
          </div>
          <p className="mt-3 text-sm leading-7">{analytics.insight}</p>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div>
              <dt className="text-muted-foreground">القاعات النظرية</dt>
              <dd className="text-lg font-bold">{analytics.halls}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">المعامل</dt>
              <dd className="text-lg font-bold">{analytics.labs}</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">متوسط القاعات</dt>
              <dd className="text-lg font-bold">{analytics.hallAverageUtilization}%</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">متوسط المعامل</dt>
              <dd className="text-lg font-bold">{analytics.labAverageUtilization}%</dd>
            </div>
          </dl>
          <div className="mt-4 flex flex-wrap gap-2">
            <Badge variant="destructive">مزدحم ≥90%: {analytics.bands.crowded}</Badge>
            <Badge variant="secondary">متوسط 80–89%: {analytics.bands.medium}</Badge>
            <Badge variant="outline">منخفض &lt;80%: {analytics.bands.low}</Badge>
          </div>
        </Card>
        <Card className="p-4">
          <h3 className="text-sm font-bold">الإجمالي العام</h3>
          <ChartContainer config={CHART_CONFIG} className="mx-auto h-52 max-w-xs aspect-square">
            <PieChart>
              <ChartTooltip content={<ChartTooltipContent hideLabel />} />
              <Pie
                data={[
                  { name: "used", value: totalUsed },
                  { name: "free", value: totalFree },
                ]}
                dataKey="value"
                nameKey="name"
                innerRadius={54}
                outerRadius={78}
              >
                <Cell fill="var(--color-used)" />
                <Cell fill="var(--color-free)" />
                <Label
                  position="center"
                  value={`${Math.round((totalUsed / Math.max(1, totalUsed + totalFree)) * 100)}%`}
                  className="fill-foreground text-lg font-bold"
                />
              </Pie>
              <ChartLegend content={<ChartLegendContent />} />
            </PieChart>
          </ChartContainer>
          <p className="text-center text-xs text-muted-foreground">
            {totalUsed} ساعة مستخدمة · {totalFree} ساعة فارغة
          </p>
        </Card>
      </section>

      <section className="grid gap-4 md:grid-cols-2">
        <RankingList title="أعلى 5 استخدامًا" rows={analytics.topFive} />
        <RankingList title="أقل 5 استخدامًا" rows={analytics.bottomFive} />
      </section>

      <section className="grid gap-4 xl:grid-cols-2" data-testid="rooms-report-charts">
        <Card className="p-4">
          <h3 className="mb-3 font-bold">ترتيب استغلال الوقت</h3>
          <ChartContainer config={CHART_CONFIG} className="h-[420px] w-full aspect-auto">
            <BarChart
              data={[...summary].sort((a, b) => b.utilization_percent - a.utilization_percent)}
              layout="vertical"
              margin={{ right: 12, left: 20 }}
            >
              <CartesianGrid horizontal={false} />
              <XAxis type="number" domain={[0, "dataMax"]} tickFormatter={(v) => `${v}%`} />
              <YAxis
                type="category"
                dataKey="room_name"
                width={92}
                tickLine={false}
                axisLine={false}
              />
              <ChartTooltip content={<ChartTooltipContent />} />
              <Bar
                dataKey="utilization_percent"
                name="utilization"
                fill="var(--color-utilization)"
                radius={3}
              />
            </BarChart>
          </ChartContainer>
        </Card>
        <Card className="p-4">
          <h3 className="mb-3 font-bold">المستخدم مقابل الفارغ</h3>
          <ChartContainer config={CHART_CONFIG} className="h-[420px] w-full aspect-auto">
            <BarChart data={summary} margin={{ right: 12, left: 12 }}>
              <CartesianGrid vertical={false} />
              <XAxis
                dataKey="room_name"
                tickLine={false}
                axisLine={false}
                interval={0}
                angle={-35}
                textAnchor="end"
                height={90}
              />
              <YAxis />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="used_hours" name="used" stackId="hours" fill="var(--color-used)" />
              <Bar
                dataKey="free_hours"
                name="free"
                stackId="hours"
                fill="var(--color-free)"
                radius={[3, 3, 0, 0]}
              />
            </BarChart>
          </ChartContainer>
        </Card>
        <Card className="p-4 xl:col-span-2">
          <h3 className="mb-3 font-bold">مقارنة القاعات النظرية والمعامل</h3>
          <ChartContainer config={CHART_CONFIG} className="h-72 w-full aspect-auto">
            <BarChart data={analytics.comparison}>
              <CartesianGrid vertical={false} />
              <XAxis dataKey="category" />
              <YAxis />
              <ChartTooltip content={<ChartTooltipContent />} />
              <ChartLegend content={<ChartLegendContent />} />
              <Bar dataKey="usedHours" name="used" fill="var(--color-used)" radius={3} />
              <Bar dataKey="freeHours" name="free" fill="var(--color-free)" radius={3} />
              <Bar
                dataKey="averageUtilization"
                name="utilization"
                fill="var(--color-utilization)"
                radius={3}
              />
            </BarChart>
          </ChartContainer>
          <p className="mt-2 text-xs text-muted-foreground">
            القيم النصية: القاعات {analytics.hallAverageUtilization}% · المعامل{" "}
            {analytics.labAverageUtilization}%.
          </p>
        </Card>
      </section>

      <Card className="overflow-hidden p-4" data-testid="rooms-heatmap">
        <h3 className="font-bold">كثافة الإشغال حسب اليوم والفترة</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          تعرض كل خلية عدد الموارد المشغولة من الموارد المتاحة ونسبة الإشغال.
        </p>
        <div className="mt-4 overflow-x-auto">
          <div
            className="grid min-w-[720px] gap-1"
            style={{ gridTemplateColumns: `7rem repeat(${heatSlots.length}, minmax(6rem, 1fr))` }}
          >
            <span />
            {heatSlots.map((slot) => (
              <b key={slot} className="p-2 text-center text-xs">
                {slot}
              </b>
            ))}
            {heatDays.flatMap((day) => {
              const cells = analytics.heatmap.filter((cell) => cell.day === day);
              return [
                <b key={`day-${day}`} className="p-2 text-sm">
                  {cells[0]?.dayLabel}
                </b>,
                ...cells.map((cell) => (
                  <div
                    key={`${day}-${cell.slot}`}
                    title={`${cell.occupiedRooms} من ${cell.availableRooms} · ${cell.utilizationPercent}%`}
                    className={`rounded-sm p-2 text-center text-xs font-semibold ${heatClass(cell.utilizationPercent)}`}
                  >
                    {cell.occupiedRooms}/{cell.availableRooms}
                    <br />
                    {cell.utilizationPercent}%
                  </div>
                )),
              ];
            })}
          </div>
        </div>
      </Card>

      {analytics.highTimeLowCapacity.length > 0 && (
        <Card className="border-warning p-4" data-testid="rooms-capacity-waste">
          <div className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            <h3 className="font-bold">استغلال زمني مرتفع مع ملء سعة منخفض</h3>
          </div>
          <p className="mt-1 text-xs text-muted-foreground">
            قراءة وصفية لحجم القاعة فقط؛ لا تغيّر الجدول.
          </p>
          <ul className="mt-3 grid gap-2 sm:grid-cols-2">
            {analytics.highTimeLowCapacity.map((row) => (
              <li key={row.room_id} className="text-sm">
                {row.room_name}: وقت {row.utilization} · سعة {row.capacity_efficiency_percent}%
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Collapsible open={detailsOpen} onOpenChange={setDetailsOpen}>
        <Card className="p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h2 className="font-bold">جدول التفاصيل</h2>
              <p className="text-xs text-muted-foreground">
                استغلال الوقت منفصل عن كفاءة استغلال السعة.
              </p>
            </div>
            <CollapsibleTrigger asChild>
              <Button variant="outline">
                <ChevronDown className={detailsOpen ? "rotate-180" : ""} />
                {detailsOpen ? "إخفاء التفاصيل" : "عرض التفاصيل"}
              </Button>
            </CollapsibleTrigger>
          </div>
          <CollapsibleContent className="mt-4 space-y-4">
            <div className="report-no-print flex flex-wrap gap-3">
              <Tabs
                value={view}
                onValueChange={(value) => setView(value as View)}
                className="min-w-0 flex-1"
              >
                <TabsList>
                  <TabsTrigger value="all">الكل</TabsTrigger>
                  <TabsTrigger value="hall">
                    <Building2 />
                    القاعات النظرية
                  </TabsTrigger>
                  <TabsTrigger value="lab">
                    <Microscope />
                    المعامل
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <Select value={band} onValueChange={(value) => setBand(value as Band)}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">كل مستويات الاستغلال</SelectItem>
                  <SelectItem value="crowded">مزدحم ≥90%</SelectItem>
                  <SelectItem value="medium">متوسط 80–89%</SelectItem>
                  <SelectItem value="low">منخفض &lt;80%</SelectItem>
                </SelectContent>
              </Select>
              <Select value={sort} onValueChange={(value) => setSort(value as SortKey)}>
                <SelectTrigger className="w-44">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="utilization">الفرز: استغلال الوقت</SelectItem>
                  <SelectItem value="free">الفرز: الساعات الفارغة</SelectItem>
                  <SelectItem value="capacity">الفرز: السعة</SelectItem>
                  <SelectItem value="sessions">الفرز: عدد الجلسات</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    {ROOMS_REPORT_SUMMARY_HEADERS.map((header) => (
                      <TableHead key={header.key} className="whitespace-nowrap">
                        {header.label}
                        {header.key === "utilization" && (
                          <>
                            {" "}
                            <MetricHint kind="time" />
                          </>
                        )}
                        {header.key === "capacity_efficiency_percent" && (
                          <>
                            {" "}
                            <MetricHint kind="capacity" />
                          </>
                        )}
                      </TableHead>
                    ))}
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.room_id}>
                      {ROOMS_REPORT_SUMMARY_HEADERS.map((header) => (
                        <TableCell key={header.key} className="whitespace-nowrap">
                          {String(row[header.key])}
                          {header.key === "free_hours" && row.overbooked_hours > 0 && (
                            <Badge variant="destructive" className="me-2">
                              تجاوز الإتاحة {row.overbooked_hours}س
                            </Badge>
                          )}
                        </TableCell>
                      ))}
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CollapsibleContent>
        </Card>
      </Collapsible>
    </div>
  );
}
