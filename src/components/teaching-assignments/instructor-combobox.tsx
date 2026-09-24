import { useMemo, useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  instructorSearchHaystack,
  type InstructorSearchCandidate,
} from "@/lib/teaching-assignments/instructor-search";
import { instructorDisplayName } from "@/lib/entity-display";

interface InstructorComboboxProps {
  candidates: readonly InstructorSearchCandidate[];
  /** Current instructor_id — the exact value the save flow expects. */
  value: string;
  onChange: (instructorId: string) => void;
  disabled?: boolean;
}

/**
 * TA-SEARCH-01 — searchable instructor picker for the assignment dialog.
 * Searches displayed Arabic/English name or employee number
 * (case-insensitive, trimmed). Never creates instructors and never keeps
 * free text: only picking a listed candidate changes the value.
 */
export function InstructorCombobox({
  candidates,
  value,
  onChange,
  disabled = false,
}: InstructorComboboxProps) {
  const [open, setOpen] = useState(false);
  const selected = useMemo(
    () => candidates.find((c) => c.instructor_id === value),
    [candidates, value],
  );

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id="ta-v2-instructor-combobox"
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          aria-label="المدرس"
          disabled={disabled}
          data-testid="ta-v2-instructor-select"
          dir="rtl"
          className="w-full justify-between text-right font-normal"
        >
          {selected ? (
            <span className="truncate">{instructorDisplayName(selected)}</span>
          ) : (
            <span className="text-muted-foreground">اختر مدرساً</span>
          )}
          <ChevronsUpDown className="ms-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command
          filter={(candidateValue, search) =>
            candidateValue.includes(search.trim().toLocaleLowerCase()) ? 1 : 0
          }
        >
          <CommandInput
            placeholder="ابحث بالاسم أو رقم الموظف…"
            aria-label="بحث عن مدرس"
            data-testid="ta-v2-instructor-search"
            onKeyDown={(e) => {
              if (e.key === "Escape") setOpen(false);
            }}
          />
          <CommandList>
            <CommandEmpty data-testid="ta-v2-instructor-empty">لا يوجد مدرس مطابق</CommandEmpty>
            <CommandGroup>
              {candidates.map((c) => (
                <CommandItem
                  key={c.instructor_id}
                  value={instructorSearchHaystack(c)}
                  data-testid="ta-v2-instructor-option"
                  onSelect={() => {
                    onChange(c.instructor_id);
                    setOpen(false);
                  }}
                >
                  <Check
                    className={cn(
                      "ms-2 h-4 w-4",
                      value === c.instructor_id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">{instructorDisplayName(c)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
