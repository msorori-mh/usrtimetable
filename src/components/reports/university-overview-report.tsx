import { useState } from "react";
import {
  Building2,
  BookOpen,
  Clock3,
  FlaskConical,
  GraduationCap,
  Users,
  ChevronDown,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  overviewNumber as num,
  summarizeUniversityOverview,
  type CollegeOverview,
  type ResourceOverview,
} from "@/lib/reports/university-overview";

const hours = (n: number | null) => (n === null ? "غير محسوب" : `${num(n)} س`);
const pct = (n: number | null) => (n === null ? "—" : `${num(n)}٪`);
const sourceLabels: Record<string, string> = {
  published: "منشور",
  draft: "مسودة",
  review: "قيد المراجعة",
  approved: "معتمد",
};

export function UtilizationBar({ value, label }: { value: number | null; label: string }) {
  return (
    <div className="uo-utilization">
      <div className="uo-utilization-label">
        <span>{label}</span>
        <b>{pct(value)}</b>
      </div>
      <div className="uo-meter" role="img" aria-label={`${label}: ${pct(value)}`}>
        {value !== null && (
          <span
            className={value >= 90 ? "uo-meter-high" : ""}
            style={{ width: `${Math.min(100, Math.max(0, value))}%` }}
          />
        )}
      </div>
    </div>
  );
}

export function ResourceCard({
  title,
  data,
  kind,
}: {
  title: string;
  data: ResourceOverview;
  kind: "hall" | "lab";
}) {
  const Icon = kind === "hall" ? Building2 : FlaskConical;
  return (
    <section className={`uo-resource uo-resource-${kind}`} aria-label={title}>
      <div className="uo-resource-title">
        <span className="uo-resource-icon">
          <Icon size={19} />
        </span>
        <h3>{title}</h3>
        <strong>{num(data.count)}</strong>
      </div>
      <div className="uo-resource-seats">
        <b>{num(data.seats ?? data.knownSeats)}</b>
        <span>
          {data.seats === null && data.knownSeats != null
            ? `مقعد محسوب من السجلات؛ سعة ${num(data.unresolvedSeatRooms)} قاعة غير محسومة (إجمالي جزئي)`
            : "مقعد في الموارد المسجلة"}
        </span>
      </div>
      <dl className="uo-resource-hours">
        <div>
          <dt>الإتاحة الأسبوعية</dt>
          <dd>{hours(data.capacityHours)}</dd>
        </div>
        <div>
          <dt>المجدول في النسخ المختارة</dt>
          <dd>{hours(data.scheduledHours)}</dd>
        </div>
        <div>
          <dt>المستخدم داخل الإتاحة</dt>
          <dd>{hours(data.occupiedHours)}</dd>
        </div>
        <div>
          <dt>غير المشغول داخل الإتاحة</dt>
          <dd>{hours(data.freeHours)}</dd>
        </div>
      </dl>
      <UtilizationBar value={data.utilization} label="استخدام الوقت المتاح" />
      {((data.outsideHours ?? 0) > 0 || (data.overlapHours ?? 0) > 0) && (
        <p className="uo-row-note">
          خارج الإتاحة {hours(data.outsideHours)} · التداخل {hours(data.overlapHours)} — مؤشرات
          مراجعة مستقلة لا ترفع نسبة الاستغلال.
        </p>
      )}
      <p className="uo-fine">
        {num(data.usedCount)} مستخدمة في الجدول · {num(data.unusedCount)} بلا محاضرات مسجلة
      </p>
    </section>
  );
}

export function UniversitySummary({
  rows,
  uniqueFaculty,
  onSelect,
}: {
  rows: CollegeOverview[];
  uniqueFaculty?: number | null;
  onSelect: (id: string) => void;
}) {
  const total = summarizeUniversityOverview(rows, uniqueFaculty);
  const highestDemand = [...rows]
    .filter((c) => c.requiredHours !== null)
    .sort((a, b) => b.requiredHours! - a.requiredHours!)[0];
  const highestLabs = [...rows]
    .filter((c) => c.labs.utilization !== null && c.labs.count > 0)
    .sort((a, b) => b.labs.utilization! - a.labs.utilization!)[0];
  const mostFree = [...rows]
    .filter((c) => c.halls.freeHours !== null && c.halls.count > 0)
    .sort((a, b) => b.halls.freeHours! - a.halls.freeHours!)[0];
  const metrics = [
    { label: "كلية", value: total.colleges, icon: Building2 },
    { label: "قسم أكاديمي", value: total.departments, icon: BookOpen },
    { label: "برنامج نشط", value: total.programs, icon: GraduationCap },
    { label: "عضو هيئة تدريس", value: total.faculty, icon: Users },
    {
      label: `ساعة تدريس مطلوبة أسبوعيًا · ${total.requiredScope} من ${total.colleges} كليات`,
      value: total.requiredHours,
      icon: Clock3,
    },
    {
      label: `محاضرة في الجداول المعروضة · ${total.scheduledScope} من ${total.colleges} كليات`,
      value: total.sessions,
      icon: BookOpen,
    },
  ];
  return (
    <div className="uo-summary" data-testid="university-overview-summary">
      <section className="uo-hero">
        <div className="uo-hero-copy">
          <span className="uo-eyebrow">جامعة إقليم سبأ</span>
          <h2>الصورة الأكاديمية والتشغيلية</h2>
          <p>الأقسام، العبء التدريسي، الكادر والموارد التعليمية في قراءة واحدة.</p>
        </div>
        <div className="uo-hero-stat">
          <strong>{num(total.scheduledHours)}</strong>
          <span>
            ساعة مجدولة أسبوعيًا · {total.scheduledScope} من {total.colleges} كليات
          </span>
        </div>
      </section>
      {(total.requiredScope < total.colleges || total.scheduledScope < total.colleges) && (
        <p className="uo-fine" role="note">
          إجمالي جزئي للبيانات المتاحة: احتياج التدريس من {total.requiredScope} من {total.colleges}{" "}
          كليات، والجداول من {total.scheduledScope} من {total.colleges} كليات. الكليات ذات البيانات
          غير المكتملة باقية في المقارنة أدناه.
        </p>
      )}
      <div className="uo-stat-grid">
        {metrics.map(({ label, value, icon: Icon }) => (
          <div className="uo-stat" key={label}>
            <Icon size={18} aria-hidden />
            <strong>{num(value)}</strong>
            <span>{label}</span>
          </div>
        ))}
      </div>
      <div className="uo-resources">
        <ResourceCard title="قاعات المحاضرات" data={total.halls} kind="hall" />
        <ResourceCard title="المعامل والورش" data={total.labs} kind="lab" />
      </div>
      <p className="uo-fine uo-resource-definition">
        قاعة القردعي مشتركة وتُحسب مرة واحدة في إجمالي الجامعة، وإتاحتها موزعة بين الكليات. عند
        اختلاف سعة القاعة المشتركة بين سجلات الكليات يُعرض مجموع المقاعد المتسقة في السجلات كإجمالي
        جزئي، مع بيان عدد القاعات ذات السعة غير المحسومة. المقاعد تعبّر عن سعة الأماكن في اللحظة
        نفسها؛ الساعات تعبّر عن إتاحتها خلال الأسبوع. «المستخدم» هو اتحاد فترات الإشغال داخل الإتاحة
        المعتمدة، أما المجدول خارجها والتداخل فيظهران كمؤشري مراجعة مستقلين. يجمع هذا التقرير إشغال
        الموارد المستضافة من نسخ الكليات المختارة؛ لذلك قد يزيد عن تقرير نسخة كلية منفردة.
      </p>
      <div className="uo-insights">
        {[
          {
            label: "أكبر احتياج تدريسي",
            college: highestDemand,
            value: hours(highestDemand?.requiredHours ?? null),
            note: "بحسب مجموعات التدريس النشطة",
          },
          {
            label: "أعلى استخدام للمعامل",
            college: highestLabs,
            value: pct(highestLabs?.labs.utilization ?? null),
            note: "نسبة الوقت المشغول إلى الوقت المتاح",
          },
          {
            label: "أكثر وقت قاعات غير مشغول",
            college: mostFree,
            value: hours(mostFree?.halls.freeHours ?? null),
            note: "فرصة للدراسة قبل إعادة توزيع الاستخدام",
          },
        ].map((item) => (
          <button
            key={item.label}
            type="button"
            disabled={!item.college}
            className="uo-insight"
            onClick={() => item.college && onSelect(item.college.id)}
          >
            <span>
              {item.label}
              <ArrowUpRight size={16} aria-hidden />
            </span>
            <b>{item.value}</b>
            <strong>{item.college?.name ?? "البيانات غير كافية"}</strong>
            <small>{item.note}</small>
          </button>
        ))}
      </div>
      <section className="uo-panel">
        <div className="uo-section-heading">
          <div>
            <span className="uo-eyebrow">المقارنة بين الكليات</span>
            <h2>من الإجمالي إلى تفاصيل كل كلية</h2>
          </div>
          <span className="uo-fine">اضغط اسم الكلية لعرض تفاصيلها</span>
        </div>
        <div className="uo-table-scroll">
          <table>
            <caption className="sr-only">ملخص الكليات والاحتياج التدريسي والموارد</caption>
            <thead>
              <tr>
                <th>الكلية</th>
                <th>الأقسام</th>
                <th>البرامج</th>
                <th>الساعات المطلوبة</th>
                <th>الساعات المجدولة</th>
                <th>الكادر</th>
                <th>القاعات</th>
                <th>المعامل</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((c) => (
                <tr key={c.id}>
                  <th scope="row">
                    <button type="button" className="uo-table-link" onClick={() => onSelect(c.id)}>
                      {c.name}
                    </button>
                  </th>
                  <td>{num(c.departmentCount)}</td>
                  <td>{num(c.programCount)}</td>
                  <td>{num(c.requiredHours)}</td>
                  <td>{num(c.scheduledHours)}</td>
                  <td>{num(c.facultyCount)}</td>
                  <td>{num(c.halls.count)}</td>
                  <td>{num(c.labs.count)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

export function CollegeOverviewCard({
  college: c,
  expanded = false,
}: {
  college: CollegeOverview;
  expanded?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const show = expanded || open;
  return (
    <article className="uo-college uo-panel" id={`college-${c.id}`} data-testid="college-overview">
      <header className="uo-college-heading">
        <div>
          <span className="uo-eyebrow">ملخص الكلية</span>
          <h2>{c.name}</h2>
          <p>
            {num(c.departmentCount)} أقسام · {num(c.programCount)} برامج نشطة · {num(c.courseCount)}{" "}
            مقررات مطروحة
          </p>
        </div>
        <span
          className={`uo-source-tag ${c.source?.status === "published" ? "" : "uo-source-working"}`}
        >
          {c.source ? (sourceLabels[c.source.status] ?? c.source.status) : "لا توجد نسخة"}
        </span>
      </header>
      <div className="uo-college-stats">
        <div>
          <Clock3 size={18} />
          <strong>{num(c.requiredHours)}</strong>
          <span>ساعة تدريس مطلوبة</span>
        </div>
        <div>
          <BookOpen size={18} />
          <strong>{num(c.scheduledHours)}</strong>
          <span>ساعة في الجدول المعروض</span>
        </div>
        <div>
          <Users size={18} />
          <strong>{num(c.facultyCount)}</strong>
          <span>عضو يتبع الكلية</span>
        </div>
        <div>
          <GraduationCap size={18} />
          <strong>{num(c.contributors)}</strong>
          <span>مساهم بالتدريس</span>
        </div>
      </div>
      <div className="uo-resources">
        <ResourceCard title="قاعات المحاضرات المخصصة للكلية" data={c.halls} kind="hall" />
        <ResourceCard title="المعامل والورش التابعة للكلية" data={c.labs} kind="lab" />
      </div>
      {(c.hostedElsewhereHours ?? 0) > 0 && (
        <p className="uo-fine">
          {hours(c.hostedElsewhereHours)} من تدريس هذه الكلية تُنفذ في موارد تابعة لكليات أخرى.
          أعداد الموارد أعلاه تخص المسجل باسم الكلية؛ إشغال الموارد المستضافة يُحتسب لدى الكلية
          المالكة لتجنب التكرار.
        </p>
      )}
      <div className="uo-college-action report-no-print">
        <Button
          variant="outline"
          onClick={() => setOpen(!show)}
          aria-expanded={show}
          aria-controls={`details-${c.id}`}
          disabled={expanded}
        >
          <ChevronDown size={16} className={show ? "rotate-180" : ""} />
          {show ? "التفاصيل معروضة" : "الأقسام والقاعات والكادر بالتفصيل"}
        </Button>
        <span className="uo-fine">
          {num(c.sessionCount)} محاضرة · {num(c.groups)} مجموعة تدريس
        </span>
      </div>
      <div id={`details-${c.id}`} className={`uo-college-details ${show ? "" : "uo-collapsed"}`}>
        <section>
          <div className="uo-section-heading">
            <div>
              <span className="uo-eyebrow">الاحتياج الأكاديمي</span>
              <h3>الساعات التدريسية لكل قسم</h3>
            </div>
            <span className="uo-unit">ساعات أسبوعية</span>
          </div>
          <div className="uo-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>القسم</th>
                  <th>البرامج</th>
                  <th>المجموعات</th>
                  <th>نظري</th>
                  <th>عملي</th>
                  <th>أخرى</th>
                  <th>المطلوب</th>
                  <th>المجدول</th>
                </tr>
              </thead>
              <tbody>
                {c.departments.map((d) => (
                  <tr key={d.id}>
                    <th scope="row">{d.name}</th>
                    <td>{num(d.programs)}</td>
                    <td>{num(d.groups)}</td>
                    <td>{num(d.theoryHours)}</td>
                    <td>{num(d.practicalHours)}</td>
                    <td>{num(d.otherHours)}</td>
                    <td>
                      <b>{num(d.requiredHours)}</b>
                    </td>
                    <td>{num(d.scheduledHours)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>الإجمالي</th>
                  <td>{num(c.programCount)}</td>
                  <td>{num(c.groups)}</td>
                  <td>{num(c.theoryHours)}</td>
                  <td>{num(c.practicalHours)}</td>
                  <td>{num(c.otherHours)}</td>
                  <td>{num(c.requiredHours)}</td>
                  <td>{num(c.scheduledHours)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="uo-fine">
            الاحتياج من المجموعات النشطة، والمجدول من النسخة المعروضة. المحاضرة المشتركة تُحسب مرة
            واحدة في قسم مجموعتها المالكة حتى لا يتكرر العبء في إجمالي الكلية.
          </p>
        </section>
        <section>
          <div className="uo-section-heading">
            <div>
              <span className="uo-eyebrow">الموارد التعليمية</span>
              <h3>السعة والاستخدام لكل قاعة ومعمل</h3>
            </div>
            <span className="uo-unit">مقاعد + ساعات أسبوعية</span>
          </div>
          <div className="uo-table-scroll">
            <table>
              <thead>
                <tr>
                  <th>القاعة أو المعمل</th>
                  <th>النوع</th>
                  <th>المقاعد</th>
                  <th>الإتاحة</th>
                  <th>المجدول</th>
                  <th>المستخدم داخل الإتاحة</th>
                  <th>غير المشغول داخل الإتاحة</th>
                  <th>خارج الإتاحة</th>
                  <th>الاستخدام</th>
                  <th>المحاضرات</th>
                </tr>
              </thead>
              <tbody>
                {c.rooms.map((r) => (
                  <tr key={r.id}>
                    <th scope="row">
                      {r.name}
                      {r.issue && <small className="uo-row-note">{r.issue}</small>}
                    </th>
                    <td>{r.type}</td>
                    <td>{num(r.seats)}</td>
                    <td>{num(r.capacityHours)}</td>
                    <td>{num(r.scheduledHours)}</td>
                    <td>{num(r.occupiedHours)}</td>
                    <td>{num(r.freeHours)}</td>
                    <td>{num(r.outsideHours)}</td>
                    <td>{pct(r.utilization)}</td>
                    <td>{num(r.sessions)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!c.rooms.length && (
            <p className="uo-fine">لا توجد موارد نشطة مسجلة باسم هذه الكلية في النطاق المتاح.</p>
          )}
          {(c.hostedElsewhereHours ?? 0) > 0 && (
            <p className="uo-fine">
              {hours(c.hostedElsewhereHours)} من تدريس الكلية تُنفذ في موارد تابعة لكليات أخرى؛
              تُحتسب في تدريس هذه الكلية وفي إشغال الكلية المالكة للمكان.
            </p>
          )}
          {c.otherRooms.count > 0 && (
            <p className="uo-row-note">
              {num(c.otherRooms.count)} موارد تحتاج تحديد النوع؛ ظاهرة في القائمة ولا تُصنف تلقائيًا
              قاعات أو معامل.
            </p>
          )}
        </section>
        <section className="uo-staff">
          <div className="uo-section-heading">
            <div>
              <span className="uo-eyebrow">الكادر الأكاديمي</span>
              <h3>التبعية والمشاركة في التدريس</h3>
            </div>
          </div>
          <div className="uo-staff-grid">
            <p>
              <b>{num(c.facultyCount)}</b> في سجل الكلية الأصلية
            </p>
            <p>
              <b>{num(c.activeFacultyCount)}</b> عضو نشط
            </p>
            <p>
              <b>{num(c.contributors)}</b> مساهم بالتدريس في الكلية
            </p>
            <p>
              <b>{num(c.externalContributors)}</b> من كليات أخرى
            </p>
          </div>
          <div className="uo-staff-breakdown">
            <div>
              <h4>الدرجات العلمية</h4>
              <div className="uo-pills">
                {Object.entries(c.ranks)
                  .filter(([, v]) => v > 0)
                  .map(([label, value]) => (
                    <span key={label}>
                      {label}
                      <b>{num(value)}</b>
                    </span>
                  ))}
              </div>
            </div>
            <div>
              <h4>حالة التوافر المسجلة</h4>
              <div className="uo-pills">
                {Object.entries(c.availability)
                  .filter(([, v]) => v > 0)
                  .map(([label, value]) => (
                    <span key={label}>
                      {label}
                      <b>{num(value)}</b>
                    </span>
                  ))}
              </div>
            </div>
          </div>
          <p className="uo-fine">
            الكادر يُنسب إلى الكلية الأصلية. المساهمون قد يدرّسون في أكثر من كلية؛ لذلك لا يُجمع
            عددهم لإنتاج عدد أعضاء الجامعة.
          </p>
        </section>
      </div>
      <details className="uo-source-details">
        <summary>
          مصدر الأرقام
          {c.issues.length ? ` · ${num(c.issues.length)} ملاحظات للمراجعة` : " وطريقة الحساب"}
        </summary>
        <p>
          {c.source?.name ?? "لا توجد نسخة جدول متاحة"}
          {c.source ? ` — ${sourceLabels[c.source.status] ?? c.source.status}` : ""}
        </p>
        {c.sourceNote && <p>{c.sourceNote}</p>}
        <p>
          الأقسام والبرامج من البنية النشطة، واحتياج الساعات من مجموعات التدريس الحالية. الموارد
          وإتاحتها من السجل الحالي؛ إشغالها من الجداول المختارة المتاحة لهذا الحساب، بما فيها
          استضافة كليات أخرى.
        </p>
        <p>
          الوقت المستخدم هو اتحاد فترات الإشغال داخل ساعات الإتاحة؛ التداخل وخارج الإتاحة يظهران
          كملاحظات مستقلة ولا يُضافان إلى الوقت المستخدم أو يُخصمان مرتين من الوقت الحر. بيانات هذه
          اللوحة تجمع إشغال الموارد المستضافة من الجداول المختارة لجميع الكليات المتاحة للحساب.
        </p>
        {c.issues.length > 0 && (
          <ul>
            {c.issues.map((issue) => (
              <li key={issue}>{issue}</li>
            ))}
          </ul>
        )}
      </details>
    </article>
  );
}
