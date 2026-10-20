import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { categorizeInstructor, INSTRUCTOR_FORM_HINT_AR } from "@/lib/instructor-category";
import {
  INSTRUCTOR_AVAILABILITY_OPTIONS,
  DEFAULT_AVAILABILITY_STATUS,
} from "@/lib/instructor-metadata";
import {
  EFFECTIVE_QUOTA_FORMULA_AR,
  isHourlyContractTypeCode,
} from "@/lib/instructors/effective-hours";
import {
  ADMINISTRATIVE_POSITION_OPTIONS,
  requiresAdministrativeDepartment,
} from "@/lib/instructors/administrative-positions";
import { userErrorMessage } from "@/lib/user-error";
import { useInstructorDirectory, RANKS } from "@/hooks/use-instructor-directory";

/** Ordered add/edit form of the instructors page (split from instructors.tsx, L-14). */
export function InstructorFormFields({ dir }: { dir: ReturnType<typeof useInstructorDirectory> }) {
  const {
    active,
    accessibleColleges,
    canManage,
    editing,
    form,
    setForm,
    repairField,
    specializationRef,
    departmentRef,
    typesLoading,
    typesError,
    supportName,
    setSupportName,
    registrationMatches,
    affiliationDepts,
    supportQuery,
    addSupport,
    typeRows,
    selectedType,
    hourlyContract,
    effectiveQuota,
  } = dir;
  return (
    <div className="space-y-3" data-testid="instructor-ordered-form">
      <div data-field-order="1-affiliation-college">
        <Label>{hourlyContract ? "الكلية المتعاقد فيها" : "الكلية التابع لها"}</Label>
        <Select
          disabled
          value={form.affiliation_college_id || undefined}
          onValueChange={(v) =>
            setForm({
              ...form,
              affiliation_college_id: v,
              affiliation_department_id: "",
              administrative_department_id: "",
              administrative_support_department_id: "",
            })
          }
        >
          <SelectTrigger>
            <SelectValue placeholder="اختر الكلية" />
          </SelectTrigger>
          <SelectContent>
            {(accessibleColleges ?? []).map((college) => (
              <SelectItem key={college.id} value={college.id}>
                {college.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div data-field-order="2-category">
        <Label htmlFor="instructor-form-f9">الحالة الوظيفية</Label>
        <Select
          value={form.instructor_type_id || "_none"}
          onValueChange={(v) => {
            const id = v === "_none" ? "" : v;
            const type = typeRows.find((t) => t.id === id);
            const hourly = isHourlyContractTypeCode(type?.code);
            setForm({
              ...form,
              instructor_type_id: id,
              administrative_release_hours: hourly ? 0 : form.administrative_release_hours,
              administrative_support_department_id: hourly
                ? ""
                : form.administrative_support_department_id,
              administrative_position: hourly ? "" : form.administrative_position,
              administrative_department_id: hourly ? "" : form.administrative_department_id,
              employment_type:
                type?.code === "con" || type?.code === "annual_contract"
                  ? "contract"
                  : type?.code === "permanent"
                    ? "full_time"
                    : form.employment_type,
            });
          }}
        >
          <SelectTrigger id="instructor-form-f9" data-testid="instructor-category-select">
            <SelectValue placeholder={typesLoading ? "جارٍ تحميل الفئات…" : "اختر الفئة"} />
          </SelectTrigger>
          <SelectContent>
            {editing && !form.instructor_type_id && (
              <SelectItem value="_none">— غير محدد —</SelectItem>
            )}
            {editing &&
              form.instructor_type_id &&
              !typeRows.some((t) => t.id === form.instructor_type_id) && (
                <SelectItem value={form.instructor_type_id}>
                  {editing.type_name ?? "الحالة المسجلة"}
                </SelectItem>
              )}
            {typeRows
              .filter(
                (t) =>
                  t.id === editing?.instructor_type_id ||
                  ["permanent", "annual_contract", "con"].includes(t.code?.toLowerCase() ?? ""),
              )
              .map((t) => (
                <SelectItem key={t.id} value={t.id}>
                  {t.code === "annual_contract" ? "متعاقد سنوي" : t.name_ar}
                </SelectItem>
              ))}
          </SelectContent>
        </Select>
        {typesLoading && (
          <p
            className="mt-1 text-xs text-muted-foreground"
            data-testid="instructor-category-loading"
          >
            جارٍ تحميل فئات المحاضرين…
          </p>
        )}
        {typesError && (
          <p className="mt-1 text-xs text-destructive" data-testid="instructor-category-error">
            تعذر تحميل فئات المحاضرين. حدّث الصفحة وحاول مرة أخرى.
          </p>
        )}
        {!typesLoading && !typesError && typeRows.length === 0 && (
          <p className="mt-1 text-xs text-amber-700" data-testid="instructor-category-empty">
            لا توجد فئات محاضرين مفعّلة لهذه الكلية بعد.
          </p>
        )}
        {selectedType && (
          <p className="mt-1 text-xs text-muted-foreground">
            {INSTRUCTOR_FORM_HINT_AR[categorizeInstructor(selectedType)]}
          </p>
        )}
      </div>

      <div className="rounded-md border bg-muted/30 p-3" data-testid="automatic-faculty-number">
        <Label>الرقم الجامعي — تلقائي</Label>
        <p className="mt-1 text-sm" dir="ltr">
          {editing?.university_number ??
            (selectedType?.code === "permanent"
              ? "USABA-P-…"
              : selectedType?.code === "annual_contract"
                ? "USABA-C-…"
                : selectedType?.code === "con"
                  ? "USABA-H-…"
                  : "—")}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          يُصدر الرقم عند الحفظ بعد اختيار الكلية والحالة الوظيفية. عند تغيير الفئة يُحفظ الرقم
          السابق مع بقاء هوية المحاضر وإسناداته. إذا كان المحاضر مسجلاً في كلية أخرى، تُربط سجلاته
          بعد التحقق من هويته.
        </p>
      </div>

      {!hourlyContract && (
        <div data-field-order="2-employee-number">
          <Label htmlFor="instructor-form-f1">رقم الموارد البشرية (اختياري)</Label>
          <Input
            id="instructor-form-f1"
            value={form.employee_number}
            onChange={(e) => setForm({ ...form, employee_number: e.target.value })}
          />
        </div>
      )}

      <div data-field-order="3-default-name">
        <Label htmlFor="instructor-form-f2">الاسم الافتراضي</Label>
        <Input
          id="instructor-form-f2"
          value={form.full_name}
          onChange={(e) => setForm({ ...form, full_name: e.target.value })}
        />
      </div>

      <div data-field-order="4-full-arabic-name">
        {!editing && (registrationMatches.data?.length ?? 0) > 0 && (
          <div role="status" className="mb-3 rounded border p-3 text-sm">
            <b>سجلات موجودة تحتاج المراجعة قبل الإضافة</b>
            {registrationMatches.data?.map((m) => (
              <p key={m.university_number}>
                {m.name} — {m.university_number} — {m.home_college ?? "تبعية تحتاج مراجعة"}
              </p>
            ))}
            <p>
              إن كان المحاضر مسجلًا، استخدمه من صفحة الإسناد. تشابه الأسماء لا يدمج الهويات
              تلقائيًا.
            </p>
          </div>
        )}
        {registrationMatches.error && (
          <p role="alert">
            تعذر فحص السجلات الموجودة: {userErrorMessage(registrationMatches.error)}
          </p>
        )}
        <Label htmlFor="instructor-form-f3">الاسم الرباعي</Label>
        <Input
          id="instructor-form-f3"
          value={form.full_name_ar}
          onChange={(e) => setForm({ ...form, full_name_ar: e.target.value })}
        />
      </div>

      <div
        data-field-order="6-affiliation-department"
        className={
          repairField === "missing_department"
            ? "rounded-md border border-amber-500 bg-amber-50/40 p-2"
            : undefined
        }
      >
        <Label htmlFor="instructor-department">
          {hourlyContract ? "القسم المتعاقد فيه" : "القسم التابع له"}
        </Label>
        <Select
          value={form.affiliation_department_id || undefined}
          onValueChange={(v) =>
            setForm({
              ...form,
              affiliation_department_id: v,
              administrative_department_id: "",
              administrative_support_department_id: "",
            })
          }
          disabled={!form.affiliation_college_id}
        >
          <SelectTrigger id="instructor-department" ref={departmentRef}>
            <SelectValue placeholder="اختر القسم" />
          </SelectTrigger>
          <SelectContent>
            {(affiliationDepts ?? []).map((d) => (
              <SelectItem key={d.id} value={d.id}>
                {d.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div data-field-order="7-specialization">
        <Label htmlFor="instructor-specialization">التخصص</Label>
        <Input
          id="instructor-specialization"
          ref={specializationRef}
          value={form.specialization}
          onChange={(e) => setForm({ ...form, specialization: e.target.value })}
        />
      </div>

      <div data-field-order="8-rank">
        <Label htmlFor="instructor-form-f10">الرتبة العلمية</Label>
        <Select
          value={form.academic_rank}
          onValueChange={(v) => setForm({ ...form, academic_rank: v })}
        >
          <SelectTrigger id="instructor-form-f10">
            <SelectValue placeholder="اختر الرتبة" />
          </SelectTrigger>
          <SelectContent>
            {RANKS.map((r) => (
              <SelectItem key={r} value={r}>
                {r}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div data-field-order="9-base-quota">
        <Label htmlFor="instructor-form-f4">النصاب الأساسي الأسبوعي</Label>
        <Input
          id="instructor-form-f4"
          type="number"
          min={0}
          value={form.max_weekly_hours}
          onChange={(e) =>
            setForm({
              ...form,
              max_weekly_hours: Number(e.target.value),
            })
          }
        />
      </div>

      {!hourlyContract && (
        <div data-field-order="10-admin-release">
          <Label htmlFor="instructor-form-f5">ساعات الإعفاء الإداري</Label>
          <Input
            id="instructor-form-f5"
            type="number"
            min={0}
            value={form.administrative_release_hours}
            onChange={(e) =>
              setForm({
                ...form,
                administrative_release_hours: Number(e.target.value),
              })
            }
          />
        </div>
      )}
      <p className="rounded border bg-muted/30 p-2 text-xs" data-testid="effective-weekly-quota">
        {EFFECTIVE_QUOTA_FORMULA_AR}: <b>{effectiveQuota} ساعة</b>
      </p>

      {!hourlyContract && (
        <div data-field-order="11-administrative-position" className="space-y-2">
          <Label htmlFor="instructor-form-f11">المنصب الإداري في حال توافره</Label>
          <Select
            value={form.administrative_position || "_none"}
            onValueChange={(v) =>
              setForm({
                ...form,
                administrative_position: v === "_none" ? "" : v,
                administrative_support_department_id:
                  v === "department_head" ? form.administrative_support_department_id : "",
                administrative_department_id:
                  v === "department_head" ? form.administrative_department_id : "",
              })
            }
          >
            <SelectTrigger id="instructor-form-f11">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="_none">— بدون منصب إداري —</SelectItem>
              {ADMINISTRATIVE_POSITION_OPTIONS.map((position) => (
                <SelectItem key={position.value} value={position.value}>
                  {position.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {requiresAdministrativeDepartment(form.administrative_position) && (
            <div className="space-y-3">
              <Label htmlFor="instructor-form-f12">نوع الجهة الإدارية</Label>
              <Select
                value={form.administrative_department_kind}
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    administrative_department_kind: v,
                    administrative_department_id: "",
                    administrative_support_department_id: "",
                  })
                }
              >
                <SelectTrigger id="instructor-form-f12" aria-label="نوع الجهة الإدارية">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="academic">قسم أكاديمي</SelectItem>
                  <SelectItem value="support">قسم مساند</SelectItem>
                </SelectContent>
              </Select>
              <Label htmlFor="instructor-form-f13">القسم الذي يرأسه</Label>
              <Select
                value={
                  (form.administrative_department_kind === "support"
                    ? form.administrative_support_department_id
                    : form.administrative_department_id) || undefined
                }
                onValueChange={(v) =>
                  setForm({
                    ...form,
                    [form.administrative_department_kind === "support"
                      ? "administrative_support_department_id"
                      : "administrative_department_id"]: v,
                  })
                }
              >
                <SelectTrigger id="instructor-form-f13" aria-label="القسم الذي يرأسه">
                  <SelectValue placeholder="اختر القسم" />
                </SelectTrigger>
                <SelectContent>
                  {(form.administrative_department_kind === "support"
                    ? (supportQuery.data ?? [])
                    : (affiliationDepts ?? [])
                  ).map((d) => (
                    <SelectItem key={d.id} value={d.id}>
                      {d.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.administrative_department_kind === "support" && (
                <div className="space-y-2">
                  {supportQuery.isPending && (
                    <p className="text-sm">جارٍ تحميل الأقسام المساندة…</p>
                  )}
                  {supportQuery.isError && (
                    <Button variant="outline" onClick={() => void supportQuery.refetch()}>
                      إعادة تحميل الأقسام المساندة
                    </Button>
                  )}
                  {!supportQuery.isPending &&
                    !supportQuery.isError &&
                    !supportQuery.data?.length && (
                      <p className="text-sm text-muted-foreground">
                        لا توجد أقسام مساندة مسجلة لهذه الكلية.
                      </p>
                    )}
                  {canManage && (
                    <div className="flex gap-2">
                      <Input
                        aria-label="اسم قسم مساند جديد"
                        placeholder="اسم قسم مساند جديد"
                        value={supportName}
                        onChange={(e) => setSupportName(e.target.value)}
                        maxLength={150}
                      />
                      <Button
                        variant="outline"
                        disabled={addSupport.isPending || !supportName.trim()}
                        onClick={() => addSupport.mutate()}
                      >
                        إضافة
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      <div data-field-order="12-availability-status">
        <Label htmlFor="instructor-form-f14">الحالة</Label>
        <Select
          value={form.availability_status || DEFAULT_AVAILABILITY_STATUS}
          onValueChange={(v) => setForm({ ...form, availability_status: v })}
        >
          <SelectTrigger id="instructor-form-f14" data-testid="instructor-availability-select">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {INSTRUCTOR_AVAILABILITY_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value}>
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <div data-field-order="13-email">
        <Label htmlFor="instructor-form-f6">البريد الإلكتروني</Label>
        <Input
          id="instructor-form-f6"
          dir="ltr"
          type="email"
          value={form.email}
          onChange={(e) => setForm({ ...form, email: e.target.value })}
        />
      </div>

      <div data-field-order="14-phone">
        <Label htmlFor="instructor-form-f7">رقم التلفون/الواتساب</Label>
        <Input
          id="instructor-form-f7"
          dir="ltr"
          value={form.phone}
          onChange={(e) => setForm({ ...form, phone: e.target.value })}
        />
      </div>

      <div
        data-field-order="15-active"
        className="flex items-center justify-between rounded border border-border p-3"
      >
        <Label htmlFor="instructor-form-f8">نشط</Label>
        <Switch
          id="instructor-form-f8"
          checked={form.is_active}
          onCheckedChange={(v) => setForm({ ...form, is_active: v })}
        />
      </div>
    </div>
  );
}
