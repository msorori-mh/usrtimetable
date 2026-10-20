import { useEffect, useState } from "react";
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
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Shared confirmation for destructive or irreversible actions.
 *
 * Replaces the native `window.confirm()` (unstyled, not RTL-aware, blocked in
 * some embedded browsers). Mount <ConfirmHost /> once (AppLayout does), then:
 *
 *   if (!(await confirmAction({ title: "حذف الجلسة؟", destructive: true }))) return;
 *
 * For cascade deletes, publishing and similar actions pass `typedConfirmation`
 * (usually the entity name): the confirm button stays disabled until the user
 * types it exactly.
 */
export type ConfirmOptions = {
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  typedConfirmation?: string;
};

type Pending = ConfirmOptions & { resolve: (ok: boolean) => void };

let listener: ((p: Pending) => void) | null = null;
const queue: Pending[] = [];

export function confirmAction(options: ConfirmOptions): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const pending: Pending = { ...options, resolve };
    if (listener) listener(pending);
    else queue.push(pending);
  });
}

export function ConfirmHost() {
  const [current, setCurrent] = useState<Pending | null>(null);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    listener = (p) => {
      setTyped("");
      setCurrent(p);
    };
    const next = queue.shift();
    if (next) listener(next);
    return () => {
      listener = null;
    };
  }, []);

  const close = (ok: boolean) => {
    if (!current) return;
    current.resolve(ok);
    setCurrent(null);
    const next = queue.shift();
    if (next) {
      setTyped("");
      setCurrent(next);
    }
  };

  const needsTyping = Boolean(current?.typedConfirmation);
  const typedOk = !needsTyping || typed.trim() === current?.typedConfirmation?.trim();

  return (
    <AlertDialog open={Boolean(current)} onOpenChange={(open) => !open && close(false)}>
      <AlertDialogContent dir="rtl">
        <AlertDialogHeader>
          <AlertDialogTitle className="text-start">{current?.title}</AlertDialogTitle>
          {current?.description && (
            <AlertDialogDescription className="text-start whitespace-pre-line">
              {current.description}
            </AlertDialogDescription>
          )}
        </AlertDialogHeader>
        {needsTyping && (
          <div className="space-y-2">
            <label htmlFor="confirm-typed" className="text-sm">
              للتأكيد اكتب: <span className="font-semibold">{current?.typedConfirmation}</span>
            </label>
            <Input
              id="confirm-typed"
              value={typed}
              autoComplete="off"
              onChange={(e) => setTyped(e.target.value)}
            />
          </div>
        )}
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel onClick={() => close(false)}>
            {current?.cancelLabel ?? "إلغاء"}
          </AlertDialogCancel>
          <AlertDialogAction
            disabled={!typedOk}
            className={cn(current?.destructive && buttonVariants({ variant: "destructive" }))}
            onClick={(e) => {
              e.preventDefault();
              if (typedOk) close(true);
            }}
          >
            {current?.confirmLabel ?? "تأكيد"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
