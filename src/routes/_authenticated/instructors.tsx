import { FacultyHomeReview } from "@/components/faculty-workflow";
import { InstructorHomeAffiliation } from "@/components/instructor-home-affiliation";
import { FacultyIdentityLink } from "@/components/faculty-identity-link";
import { createFileRoute, Link } from "@tanstack/react-router";
import { instructorStatusLabel } from "@/lib/excel-import/instructor-sheet";
import { useEffect, useState } from "react";
import { useActiveCollege } from "@/hooks/use-colleges";
import { CollegeSwitcher } from "@/components/college-switcher";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogFooter,
} from "@/components/ui/dialog";
import { UserSquare2, Pencil, Trash2, Printer } from "lucide-react";
import { categorizeInstructor, CATEGORY_LABEL_AR } from "@/lib/instructor-category";
import { availabilityStatusLabelAr } from "@/lib/instructor-metadata";
import {
  INSTRUCTOR_REVIEW_LABELS,
  isMissingInstructorDepartment,
  isMissingInstructorSpecialization,
  parseInstructorReviewSearch,
} from "@/lib/data-onboarding/instructor-review";
import { AdminExportMenu } from "@/components/admin-export-menu";
import { activeFilters, instructorsExportDataset } from "@/lib/admin-export/datasets";
import {
  DEFAULT_DIRECTORY_FILTERS,
  INSTRUCTOR_SORT_LABEL_AR,
  hasActiveDirectoryFilters,
  type InstructorSortKey,
} from "@/lib/instructors/directory-filters";
import { QueryErrorNotice } from "@/components/app-states/query-error-notice";
import { confirmAction } from "@/components/confirm-dialog";
import { ShowMoreRows } from "@/components/app-states/show-more-rows";
import { formatDecimal, formatNumber } from "@/lib/format";
import { useInstructorDirectory, type InstructorJump } from "@/hooks/use-instructor-directory";
import { UniversityInstructorSearch } from "@/components/instructors/university-instructor-search";
import { InstructorFormFields } from "@/components/instructors/instructor-form-fields";

export const Route = createFileRoute("/_authenticated/instructors")({
  head: () => ({ meta: [{ title: "المحاضرون" }] }),
  validateSearch: parseInstructorReviewSearch,
  component: InstructorsPage,
});


function InstructorsPage() {
  const { active, setActiveId } = useActiveCollege();
  const [jump, setJump] = useState<InstructorJump | null>(null);
  const [jumpVersion, setJumpVersion] = useState(0);
  useEffect(() => {
    if (jump && active?.id === jump.collegeId) setJump(null);
  }, [active?.id, jump]);
  // A college switch must not retain an edit form belonging to the previous college.
  return (
    <InstructorDirectory
      key={`${active?.id ?? "no-college"}:${jumpVersion}`}
      initialJump={jump?.collegeId === active?.id ? jump : null}
      onOpenUniversityResult={(target) => {
        setJump(target);
        setJumpVersion((version) => version + 1);
        setActiveId(target.collegeId);
      }}
    />
  );
}

function InstructorDirectory({
  initialJump,
  onOpenUniversityResult,
}: {
  initialJump: InstructorJump | null;
  onOpenUniversityResult: (target: InstructorJump) => void;
}) {
  const { review } = parseInstructorReviewSearch(Route.useSearch());
  const navigate = Route.useNavigate();
  const dir = useInstructorDirectory({ initialJump, review });
  const {
    active,
    accessibleColleges,
    canManage,
    canEdit,
    qc,
    scope,
    setScope,
    open,
    setOpen,
    editing,
    setEditing,
    form,
    setForm,
    repairField,
    setRepairField,
    directory,
    setDirectory,
    setDirectoryField,
    specializationRef,
    departmentRef,
    depts,
    deptsError,
    types,
    typesLoading,
    typesError,
    supportName,
    setSupportName,
    affiliationCollegeId,
    registrationMatches,
    affiliationDepts,
    affiliationDeptsError,
    supportQuery,
    addSupport,
    rows,
    isLoading,
    isError,
    rosterError,
    refetch,
    save,
    del,
    startEdit,
    startCreate,
    deptMap,
    typeRows,
    typeMap,
    selectedType,
    scopeLabel,
    rowCategoryLabel,
    hourlyContract,
    effectiveQuota,
    reviewRows,
    departmentLabel,
    visibleRows,
    rowWindow,
    lookupError,
    availableRanks,
  } = dir;
  return (
    <div className="mx-auto max-w-5xl" dir="rtl">
      <header className="mb-6 flex items-center gap-3">
        <span className="grid h-11 w-11 place-items-center rounded-lg bg-secondary text-primary">
          <UserSquare2 className="h-5 w-5" />
        </span>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">المحاضرون</h1>
          <p className="text-sm text-muted-foreground">قائمة أعضاء هيئة التدريس في الكلّية.</p>
        </div>
      </header>
      {active && <FacultyHomeReview collegeId={active.id} />}

      <div className="mb-4 space-y-2">
        <label className="flex flex-wrap items-center gap-3">
          <span>قائمة المحاضرين</span>
          <select
            aria-label="قائمة المحاضرين"
            className="rounded border bg-background p-2"
            value={scope}
            onChange={(event) => {
              setScope(event.target.value as typeof scope);
              setDirectory({ ...DEFAULT_DIRECTORY_FILTERS });
              setOpen(false);
              setEditing(null);
            }}
          >
            <option value="home">أعضاء الكلية</option>
            <option value="visiting">مكلّفون من كليات أخرى</option>
            <option value="pending">تبعية تحتاج مراجعة</option>
          </select>
        </label>
        <p className="text-sm text-muted-foreground">
          {scope === "home"
            ? "هذه القائمة لأعضاء الكلية الأصلية فقط."
            : scope === "visiting"
              ? "محاضرون لهم إسناد أو جدول في الكلية الحالية. تُعدّل بياناتهم من كليتهم الأصلية."
              : "سجلات سابقة لم تُحسم كليتها الأصلية. يستكمل الأدمن تبعيتها من تسوية السجلات أعلاه."}
        </p>
      </div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <CollegeSwitcher />
        <div className="flex flex-wrap gap-2">
          {canManage && active && (
            <Button asChild variant="outline">
              <Link to="/reports/instructors" aria-label="فتح كشف بيانات محاضري الكلية للطباعة">
                <Printer className="me-2 h-4 w-4" />
                طباعة بيانات محاضري الكلية
              </Link>
            </Button>
          )}
          <AdminExportMenu
            testId="instructors-export"
            disabled={!active || (visibleRows ?? []).length === 0}
            dataset={() =>
              instructorsExportDataset({
                rows: (visibleRows ?? []).map((i) => ({
                  ...i,
                  home_college_name: i.home_college_name ?? "تحتاج مراجعة",
                  category_label: rowCategoryLabel(i),
                  needs_review:
                    isMissingInstructorSpecialization(i) || isMissingInstructorDepartment(i),
                })),
                collegeName: active?.name ?? null,
                departmentLabel: (id) => (id ? (deptMap.get(id) ?? "") : "بدون قسم"),
                categoryLabel: (id) =>
                  CATEGORY_LABEL_AR[categorizeInstructor(typeMap.get(id ?? "") ?? null)] ?? "",
                availabilityLabel: (v) => availabilityStatusLabelAr(v),
                filters: activeFilters([
                  { label: "القائمة", value: scopeLabel },
                  {
                    label: "مرشّح المراجعة",
                    value: review ? INSTRUCTOR_REVIEW_LABELS[review] : "",
                  },
                ]),
              })
            }
          />
        </div>
        {canEdit && (
          <Dialog open={open} onOpenChange={setOpen}>
            {canManage && (
              <DialogTrigger asChild>
                <Button onClick={startCreate}>محاضر جديد</Button>
              </DialogTrigger>
            )}
            <DialogContent
              className="max-h-[90dvh] max-w-lg overflow-y-auto"
              onOpenAutoFocus={(event) => {
                if (!editing || !repairField) return;
                event.preventDefault();
                if (repairField === "missing_specialization") specializationRef.current?.focus();
                else departmentRef.current?.focus();
              }}
            >
              <DialogHeader>
                <DialogTitle>
                  {editing ? `تعديل بيانات ${editing.full_name}` : "محاضر جديد"}
                </DialogTitle>
              </DialogHeader>
              <InstructorFormFields dir={dir} />
              <DialogFooter>
                <Button variant="outline" onClick={() => setOpen(false)}>
                  إلغاء
                </Button>
                <Button onClick={() => save.mutate()} disabled={save.isPending}>
                  حفظ
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        )}
      </div>

      <UniversityInstructorSearch
        onOpenResult={(target) => {
          if (review) {
            void navigate({
              search: parseInstructorReviewSearch({ review: "all" }),
              replace: true,
            });
          }
          onOpenUniversityResult(target);
        }}
      />

      {lookupError && (
        <QueryErrorNotice
          className="mb-4"
          title="تعذّر تحميل أقسام الكلية؛ قد تظهر الأقسام كـ «بدون قسم»."
          error={lookupError}
        />
      )}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="min-w-64">
          <Label htmlFor="instructor-review-filter">عرض البيانات</Label>
          <Select
            value={review ?? "all"}
            onValueChange={(value) =>
              void navigate({
                search: parseInstructorReviewSearch({ review: value }),
                replace: true,
              })
            }
          >
            <SelectTrigger id="instructor-review-filter">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">كل المدرسين</SelectItem>
              {Object.entries(INSTRUCTOR_REVIEW_LABELS).map(([value, label]) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canManage && (
          <Button asChild variant="outline">
            <Link to="/data-onboarding" search={{ step: "readiness_check" }}>
              العودة إلى المراجعة النهائية
            </Link>
          </Button>
        )}
      </div>

      <Card className="mb-4 space-y-3 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-72 flex-1">
            <Label htmlFor="instructor-search">بحث</Label>
            <Input
              id="instructor-search"
              value={directory.search}
              onChange={(e) => setDirectoryField("search", e.target.value)}
              placeholder="ابحث بالاسم أو الرقم الجامعي أو رقم الموظف أو البريد أو القسم…"
            />
          </div>
          <div className="min-w-44">
            <Label htmlFor="instructor-department-filter">القسم</Label>
            <Select
              value={directory.departmentId}
              onValueChange={(v) => setDirectoryField("departmentId", v)}
            >
              <SelectTrigger id="instructor-department-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأقسام</SelectItem>
                <SelectItem value="none">بدون قسم</SelectItem>
                {Array.from(deptMap, ([id, name]) => ({ id, name })).map((d) => (
                  <SelectItem key={d.id} value={d.id}>
                    {d.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-40">
            <Label htmlFor="instructor-status-filter">حالة العضو</Label>
            <Select value={directory.status} onValueChange={(v) => setDirectoryField("status", v)}>
              <SelectTrigger id="instructor-status-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">الكل</SelectItem>
                <SelectItem value="active">نشط</SelectItem>
                <SelectItem value="inactive">غير نشط</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-44">
            <Label htmlFor="instructor-rank-filter">الرتبة</Label>
            <Select value={directory.rank} onValueChange={(v) => setDirectoryField("rank", v)}>
              <SelectTrigger id="instructor-rank-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الرتب</SelectItem>
                {availableRanks.map((r) => (
                  <SelectItem key={r} value={r}>
                    {r}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-44">
            <Label htmlFor="instructor-type-filter">نوع العضو</Label>
            <Select value={directory.typeId} onValueChange={(v) => setDirectoryField("typeId", v)}>
              <SelectTrigger id="instructor-type-filter">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">كل الأنواع</SelectItem>
                <SelectItem value="none">بدون نوع</SelectItem>
                {Array.from(typeMap.values()).map((t) => (
                  <SelectItem key={t.id} value={t.id}>
                    {t.code === "annual_contract" ? "متعاقد سنوي" : t.name_ar}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="min-w-44">
            <Label htmlFor="instructor-sort">الفرز</Label>
            <Select
              value={directory.sortKey}
              onValueChange={(v) => setDirectoryField("sortKey", v as InstructorSortKey)}
            >
              <SelectTrigger id="instructor-sort">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {Object.entries(INSTRUCTOR_SORT_LABEL_AR).map(([value, label]) => (
                  <SelectItem key={value} value={value}>
                    {label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button
            variant="outline"
            onClick={() =>
              setDirectoryField("sortDirection", directory.sortDirection === "asc" ? "desc" : "asc")
            }
            aria-label="اتجاه الفرز"
          >
            {directory.sortDirection === "asc" ? "تصاعدي ↑" : "تنازلي ↓"}
          </Button>
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
          <p data-testid="instructors-count" className="text-muted-foreground">
            عرض {formatNumber(visibleRows?.length ?? 0)} من {formatNumber(rows?.length ?? 0)}
          </p>
          {hasActiveDirectoryFilters(directory) && (
            <Button variant="ghost" onClick={() => setDirectory({ ...DEFAULT_DIRECTORY_FILTERS })}>
              مسح الفلاتر
            </Button>
          )}
        </div>
      </Card>

      {review && active && !isLoading && !isError && (
        <Card className="mb-4 space-y-2 border-amber-500/40 p-4" role="status">
          <p className="font-semibold">{INSTRUCTOR_REVIEW_LABELS[review]}</p>
          <p className="text-sm">
            السجلات التي تحتاج استكمالًا: {formatNumber(visibleRows?.length ?? 0)} من إجمالي{" "}
            {formatNumber(rows?.length ?? 0)}{" "}
            مدرسًا في {active.name}.
          </p>
          <p className="text-sm text-muted-foreground">
            {canManage
              ? "اضغط زر الاستكمال بجانب الاسم لفتح الحقل الناقص. تتحدث القائمة ونتيجة المراجعة بعد الحفظ."
              : "صلاحيتك للقراءة فقط. يظهر النقص بجانب كل اسم؛ يستكمل الأدمن أو مدير الكلية البيانات."}
          </p>
        </Card>
      )}
      <Card className="overflow-hidden">
        {!active ? (
          <p className="p-6 text-center text-muted-foreground">اختر كلية لعرض المدرسين.</p>
        ) : isError ? (
          <div className="p-4">
            <QueryErrorNotice
              title="تعذر تحميل بيانات المدرسين. لا يمكن تأكيد اكتمال المراجعة."
              error={rosterError}
              onRetry={() => void refetch()}
            />
          </div>
        ) : isLoading ? (
          <p className="p-6 text-center text-muted-foreground">جارٍ التحميل...</p>
        ) : !visibleRows || visibleRows.length === 0 ? (
          <div className="space-y-2 p-6 text-center text-muted-foreground">
            <p>
              {hasActiveDirectoryFilters(directory)
                ? "لا توجد نتائج مطابقة للبحث أو الفلاتر الحالية."
                : review
                  ? "لا توجد سجلات ناقصة بهذا المعيار في الكلية الحالية."
                  : "لا يوجد محاضرون بعد."}
            </p>
            {hasActiveDirectoryFilters(directory) && (
              <Button
                variant="outline"
                onClick={() => setDirectory({ ...DEFAULT_DIRECTORY_FILTERS })}
              >
                مسح الفلاتر
              </Button>
            )}
          </div>
        ) : (
          <>
          <ul className="divide-y divide-border">
            {rowWindow.visible.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-3 p-4">
                <div className="min-w-0">
                  <p className="font-semibold">
                    {i.full_name}{" "}
                    {!i.is_active && (
                      <span className="ms-2 rounded bg-muted px-2 py-0.5 text-[10px]">
                        {instructorStatusLabel(i.is_active, i.notes)}
                      </span>
                    )}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    الحالة: {availabilityStatusLabelAr(i.availability_status)}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    الرقم الجامعي: <span dir="ltr">{i.university_number ?? "—"}</span>
                  </p>
                  <FacultyIdentityLink
                    instructorId={i.id}
                    collegeId={i.college_id}
                    name={i.full_name}
                  />
                  <p
                    className={`mt-1 text-sm ${isMissingInstructorSpecialization(i) ? "font-medium text-amber-800" : "text-muted-foreground"}`}
                  >
                    التخصص:{" "}
                    {isMissingInstructorSpecialization(i)
                      ? "غير محدد — يحتاج استكمالًا"
                      : i.specialization}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {i.academic_rank ?? "—"} · {formatDecimal(i.max_weekly_hours)} س/أسبوع
                  </p>
                  <InstructorHomeAffiliation
                    home={{
                      home_college_id: i.home_college_id,
                      home_college: i.home_college_name,
                      home_department: i.home_department,
                    }}
                    currentCollegeId={active.id}
                    defaultCategoryLabel={rowCategoryLabel(i)}
                  />
                  {(i.email || i.phone) && (
                    <p className="text-xs text-muted-foreground" dir="ltr">
                      {i.email ?? ""} {i.phone ? ` · ${i.phone}` : ""}
                    </p>
                  )}
                  {i.admin_tasks && (
                    <p className="text-xs text-muted-foreground">الصفة: {i.admin_tasks}</p>
                  )}
                </div>
                {canEdit && i.can_edit && (
                  <div className="flex flex-wrap gap-1">
                    {(review || isMissingInstructorSpecialization(i)) && (
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => startEdit(i, review ?? "missing_specialization")}
                      >
                        {review === "missing_department" ? "استكمال القسم" : "استكمال التخصص"}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      aria-label={`تعديل ${i.full_name}`}
                      onClick={() => startEdit(i)}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </Button>
                    {canManage && i.can_delete && (
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`حذف ${i.full_name}`}
                        onClick={async () => {
                          const ok = await confirmAction({
                            title: `حذف المحاضر «${i.full_name}»؟`,
                            description:
                              "يُحذف سجل المحاضر من كليته الأصلية. لا يمكن التراجع عن هذا الإجراء.",
                            confirmLabel: "حذف",
                            destructive: true,
                            typedConfirmation: i.full_name,
                          });
                          if (ok) del.mutate(i.id);
                        }}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
          <ShowMoreRows
            shown={rowWindow.shown}
            total={rowWindow.total}
            hasMore={rowWindow.hasMore}
            onShowMore={rowWindow.showMore}
            onShowAll={rowWindow.showAll}
          />
          </>
        )}
      </Card>
    </div>
  );
}
