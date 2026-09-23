import { ArrowLeft, ClipboardList, Construction } from "lucide-react";
import type { LeadershipCollege } from "@/lib/reports/leadership";
import {
  ACADEMIC_STAFFING_NOTICE,
  ACADEMIC_STAFFING_STATUS,
  ACADEMIC_STAFFING_TITLE,
  STAFFING_VERIFICATION_REQUIREMENTS,
  buildStaffingReadiness,
  type StaffingObservation,
} from "@/lib/reports/academic-staffing";

export function AcademicStaffingEntry({ onOpen }: { onOpen: () => void }) {
  return (
    <section
      className="leadership-section staffing-entry"
      aria-labelledby="staffing-entry-title"
      data-testid="academic-staffing-entry"
    >
      <div className="leadership-section-heading">
        <h2 id="staffing-entry-title" className="flex items-center gap-2">
          <ClipboardList size={21} aria-hidden="true" />
          {ACADEMIC_STAFFING_TITLE}
        </h2>
        <span className="staffing-development-status" role="status">
          <Construction size={16} aria-hidden="true" />
          {ACADEMIC_STAFFING_STATUS}
        </span>
      </div>
      <div className="staffing-entry-body">
        <p>{ACADEMIC_STAFFING_NOTICE}</p>
        <button type="button" className="leadership-action report-no-print" onClick={onOpen}>
          عرض جاهزية بيانات الاحتياج
          <ArrowLeft size={16} aria-hidden="true" />
        </button>
      </div>
    </section>
  );
}

function Observation({ value }: { value: StaffingObservation }) {
  return (
    <div className={`staffing-observation staffing-observation--${value.state}`}>
      <span className="staffing-observation-label">
        {value.state === "available"
          ? "متاح للمراجعة"
          : value.state === "incomplete"
            ? "يحتاج استكمالًا"
            : "غير متحقق"}
      </span>
      <p>{value.detail}</p>
    </div>
  );
}

/** No data fetches and no extra scope: only rows already authorized by leadership_overview. */
export function AcademicStaffingPanel({
  colleges,
  stale = false,
}: {
  colleges: LeadershipCollege[];
  stale?: boolean;
}) {
  const rows = colleges.map(buildStaffingReadiness);
  return (
    <section
      className="staffing-panel space-y-4"
      dir="rtl"
      aria-label={ACADEMIC_STAFFING_TITLE}
      data-testid="academic-staffing-panel"
    >
      <div className="staffing-notice" role="status">
        <h2>
          <Construction size={20} aria-hidden="true" />
          {ACADEMIC_STAFFING_STATUS}
        </h2>
        <p>{ACADEMIC_STAFFING_NOTICE}</p>
        <p>
          المرحلة الحالية: رصد جاهزية البيانات. وجود قيم مسجلة لا يثبت اعتمادها لحساب الاحتياج
          الوظيفي.
        </p>
      </div>
      {stale && (
        <p role="alert" className="staffing-note">
          تعذر تحديث البيانات؛ هذه آخر قراءة ناجحة، ولا يعتمد عليها لإثبات الاكتمال.
        </p>
      )}
      <section className="leadership-section" aria-labelledby="staffing-matrix-title">
        <div className="leadership-section-heading">
          <h2 id="staffing-matrix-title">مصفوفة جاهزية بيانات الكليات</h2>
          <span className="leadership-section-note">
            {rows.length.toLocaleString("ar")} كلية ضمن النطاق المعروض
          </span>
        </div>
        {rows.length === 0 ? (
          <p className="p-4 text-sm">
            لا تتوفر بيانات كليات ضمن النطاق الحالي. لا يمكن إثبات الاكتمال.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="leadership-table staffing-matrix">
              <caption className="sr-only">
                رصد أولي للقيم المتاحة، وليس اعتمادًا للاحتياج أو الدرجات الوظيفية
              </caption>
              <thead>
                <tr>
                  <th scope="col">الكلية</th>
                  <th scope="col">الفترة</th>
                  <th scope="col">البرامج والمجموعات</th>
                  <th scope="col">الأنصبة</th>
                  <th scope="col">الرتب</th>
                  <th scope="col">توزيع الساعات</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.collegeId}>
                    <th scope="row">
                      <span>{row.college}</span>
                      <span className="staffing-row-status">{row.status}</span>
                    </th>
                    <td>
                      <Observation value={row.period} />
                    </td>
                    <td>
                      <Observation value={row.demand} />
                    </td>
                    <td>
                      <Observation value={row.quotas} />
                    </td>
                    <td>
                      <Observation value={row.ranks} />
                    </td>
                    <td>
                      <Observation value={row.assignments} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <section className="leadership-section" aria-labelledby="staffing-evidence-title">
        <div className="leadership-section-heading">
          <h2 id="staffing-evidence-title">متطلبات اعتماد النتائج</h2>
          <span className="leadership-section-note">لم يثبت اكتمالها بعد</span>
        </div>
        <ul className="staffing-evidence-list">
          {STAFFING_VERIFICATION_REQUIREMENTS.map((item) => (
            <li key={item.id}>
              <h3>{item.title}</h3>
              <p>{item.detail}</p>
              <p className="staffing-evidence-owner">جهة المراجعة: {item.owner}</p>
            </li>
          ))}
        </ul>
      </section>
      <section className="staffing-results" aria-label="حالة نتائج الاحتياج">
        {[
          [
            "الاحتياج الحالي والدرجات المقترحة",
            "يحتاج إثبات صفة التعيين والأهلية والأنصبة والعبء الأساسي والشواغر.",
          ],
          [
            "توقعات النمو 10% و15%",
            "تحتاج أعداد دفعات معتمدة وانتقال المستويات وحدود المجموعات وخطة الكادر.",
          ],
        ].map(([title, detail]) => (
          <div key={title} className="staffing-result">
            <h3>{title}</h3>
            <strong>{ACADEMIC_STAFFING_STATUS}</strong>
            <p>{detail}</p>
          </div>
        ))}
      </section>
      <p className="staffing-note">
        نقص النصاب يعني ساعات غير مستكملة لدى العضو. عجز الكادر الدائم وقرار التوظيف يتطلبان حسابًا
        مستقلاً حسب التخصص والفئة؛ اكتمال الإسناد أو نشر الجدول لا يثبت كفاية المعينين.
      </p>
    </section>
  );
}
