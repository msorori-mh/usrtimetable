import { createFileRoute, redirect } from "@tanstack/react-router";
import { parsePreparationSearch } from "@/lib/data-onboarding/preparation";

export const Route = createFileRoute("/_authenticated/data-templates")({
  validateSearch: parsePreparationSearch,
  beforeLoad: ({ search }) => {
    throw redirect({ to: "/data-onboarding", search: { ...search, help: true }, replace: true });
  },
});
