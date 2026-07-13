/**
 * Unsaved local-change confirmation — discard only (no save in this phase).
 */
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function UnsavedLocalChangesDialog({
  open,
  onOpenChange,
  title,
  description,
  stayLabel = "متابعة التعديل",
  discardLabel = "تجاهل التغييرات والمتابعة",
  onStay,
  onDiscard,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: string;
  stayLabel?: string;
  discardLabel?: string;
  onStay: () => void;
  onDiscard: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2 sm:gap-0">
          <AlertDialogCancel
            onClick={() => {
              onStay();
            }}
          >
            {stayLabel}
          </AlertDialogCancel>
          <AlertDialogAction
            onClick={() => {
              onDiscard();
            }}
          >
            {discardLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
