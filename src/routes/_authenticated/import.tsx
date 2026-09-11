import { createFileRoute, redirect } from "@tanstack/react-router";
import { parsePreparationSearch } from "@/lib/data-onboarding/preparation";

export const Route = createFileRoute("/_authenticated/import")({
  validateSearch: parsePreparationSearch,
  beforeLoad: ({ search }) => {
    throw redirect({
      to: "/data-onboarding",
      search: parsePreparationSearch({ ...search, entity: search.entity ?? "academic_terms" }),
      replace: true,
    });
  },
});
