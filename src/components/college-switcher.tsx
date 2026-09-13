import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useActiveCollege } from "@/hooks/use-colleges";
import { School } from "lucide-react";
import { entityDisplayName } from "@/lib/entity-display";

export function CollegeSwitcher() {
  const { colleges, activeId, setActiveId, isLoading } = useActiveCollege();
  if (isLoading) return <div className="text-sm text-muted-foreground">جارٍ تحميل الكلّيات...</div>;
  if (colleges.length === 0)
    return (
      <div className="rounded-md border border-dashed border-border bg-muted/30 p-4 text-sm text-muted-foreground">
        لا توجد كلّيات متاحة لحسابك. تواصل مع المدير العام لإسناد كلّية.
      </div>
    );
  return (
    <div className="flex items-center gap-2">
      <span className="grid h-9 w-9 place-items-center rounded-md bg-secondary text-primary">
        <School className="h-4 w-4" />
      </span>
      <div className="min-w-[14rem]">
        <Select value={activeId ?? undefined} onValueChange={setActiveId}>
          <SelectTrigger>
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
    </div>
  );
}
