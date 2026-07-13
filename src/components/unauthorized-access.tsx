import { Link } from "@tanstack/react-router";
import { ShieldOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  UNAUTHORIZED_BACK_HOME_LABEL_AR,
  UNAUTHORIZED_BACK_HOME_TO,
  UNAUTHORIZED_PAGE_MESSAGE_AR,
} from "@/lib/unauthorized-access";

/** Clear Forbidden / Unauthorized state — does not change roles or fetch protected data. */
export function UnauthorizedAccess() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center px-4">
      <div className="max-w-md text-center">
        <span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-lg bg-muted text-muted-foreground">
          <ShieldOff className="h-6 w-6" aria-hidden />
        </span>
        <h1 className="text-xl font-semibold">{UNAUTHORIZED_PAGE_MESSAGE_AR}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          تم منع الوصول إلى هذه الصفحة وفق صلاحيات حسابك.
        </p>
        <Button asChild className="mt-6">
          <Link to={UNAUTHORIZED_BACK_HOME_TO}>{UNAUTHORIZED_BACK_HOME_LABEL_AR}</Link>
        </Button>
      </div>
    </div>
  );
}
