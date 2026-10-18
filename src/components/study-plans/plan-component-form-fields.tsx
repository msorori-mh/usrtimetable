import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  COMPENSATION_MODES,
  COMPENSATION_MODE_LABEL_AR,
  COMPONENT_TYPE_LABEL_AR,
  PLAN_COMPONENT_TYPES,
  normalizeComponentFormRoomType,
  type ComponentForm,
  type PlanContext,
  type RoomTypeOption,
} from "@/lib/academic-delivery/plan-course-editor";
import { findTutorialRoomType, tutorialRoomTypeIsLocked } from "@/lib/academic-delivery/tutorial-room-type";

/** Fields of the plan-course component (lecture/lab) editor — split from plan-courses-manager.tsx (L-14). */
const NONE = "__none__";

export function PlanComponentFormFields({
  ctx,
  collegeId,
  componentForm,
  setComponentForm,
  roomTypes,
}: {
  ctx: PlanContext;
  collegeId: string;
  componentForm: ComponentForm;
  setComponentForm: (next: ComponentForm) => void;
  roomTypes: RoomTypeOption[] | undefined;
}) {
  return (
    <>
      <div>
        <Label htmlFor="plan-courses-f10" className="text-xs">نوع المحاضرة</Label>
        <Select
          value={componentForm.component_type}
          onValueChange={(v) =>
            setComponentForm(
              normalizeComponentFormRoomType(
                ctx,
                { ...componentForm, component_type: v },
                roomTypes ?? [],
              ),
            )
          }
        >
          <SelectTrigger id="plan-courses-f10">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PLAN_COMPONENT_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {COMPONENT_TYPE_LABEL_AR[t]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="plan-courses-f3" className="text-xs">الساعات الأسبوعية</Label>
        <Input id="plan-courses-f3"
          type="number"
          min={0}
          value={componentForm.weekly_contact_hours}
          onChange={(e) =>
            setComponentForm({
              ...componentForm,
              weekly_contact_hours: Number(e.target.value),
            })
          }
        />
      </div>
      <div>
        <Label htmlFor="plan-courses-f11" className="text-xs">نوع القاعة المطلوب</Label>
        <Select
          value={componentForm.required_room_type_id ?? NONE}
          disabled={tutorialRoomTypeIsLocked(componentForm.component_type)}
          onValueChange={(v) =>
            setComponentForm({
              ...componentForm,
              required_room_type_id: v === NONE ? null : v,
            })
          }
        >
          <SelectTrigger id="plan-courses-f11" data-testid="plan-component-room-type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={NONE}>بدون تحديد</SelectItem>
            {(tutorialRoomTypeIsLocked(componentForm.component_type)
              ? ((): RoomTypeOption[] => {
                  const lh = findTutorialRoomType(roomTypes ?? [], collegeId);
                  return lh ? [lh] : [];
                })()
              : (roomTypes ?? [])
            ).map((r) => (
              <SelectItem key={r.id} value={r.id}>
                {r.name_ar}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {tutorialRoomTypeIsLocked(componentForm.component_type) ? (
          <p className="mt-1 text-[11px] text-muted-foreground">
            محاضرة التمارين تُدرَّس دائمًا في قاعة محاضرات.
          </p>
        ) : null}
      </div>
      <div>
        <Label htmlFor="plan-courses-f12" className="text-xs">طريقة الاحتساب</Label>
        <Select
          value={componentForm.compensation_mode}
          onValueChange={(v) =>
            setComponentForm({ ...componentForm, compensation_mode: v })
          }
        >
          <SelectTrigger id="plan-courses-f12">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {COMPENSATION_MODES.map((m) => (
              <SelectItem key={m} value={m}>
                {COMPENSATION_MODE_LABEL_AR[m]}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div>
        <Label htmlFor="plan-courses-f4" className="text-xs">حجم المجموعة (اختياري)</Label>
        <Input id="plan-courses-f4"
          type="number"
          min={1}
          value={componentForm.explicit_group_size ?? ""}
          onChange={(e) =>
            setComponentForm({
              ...componentForm,
              explicit_group_size: e.target.value ? Number(e.target.value) : null,
            })
          }
        />
      </div>
      <div className="flex flex-col gap-1 text-xs">
        <label className="flex items-center gap-2">
          <Checkbox
            checked={componentForm.is_timetabled}
            onCheckedChange={(v) =>
              setComponentForm({ ...componentForm, is_timetabled: !!v })
            }
          />
          مجدول في الجدول
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={componentForm.counts_toward_regular_load}
            onCheckedChange={(v) =>
              setComponentForm({
                ...componentForm,
                counts_toward_regular_load: !!v,
              })
            }
          />
          يُحتسب في النصاب
        </label>
        <label className="flex items-center gap-2">
          <Checkbox
            checked={componentForm.counts_toward_overtime}
            onCheckedChange={(v) =>
              setComponentForm({ ...componentForm, counts_toward_overtime: !!v })
            }
          />
          يُحتسب في الساعات الإضافية
        </label>
      </div>
    </>
  );
}
