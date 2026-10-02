import { describe, expect, it, vi } from "vitest";
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import {
  invalidateTeachingAssignmentReadModels,
  isTeachingAssignmentReadModelQuery,
} from "@/lib/teaching-assignments/query-invalidation";
import {
  useCreateTeachingAssignmentV2,
  useDeactivateTeachingAssignmentV2,
  useUpdateTeachingAssignmentV2,
} from "@/hooks/use-teaching-assignments-v2";

const mutationHarness = vi.hoisted(() => ({
  client: null as QueryClient | null,
  onSuccess: null as ((result: { ok: boolean; action?: string }) => void) | null,
}));
vi.mock("@tanstack/react-query", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-query")>()),
  useQueryClient: () => mutationHarness.client,
  useMutation: (options: { onSuccess: NonNullable<typeof mutationHarness.onSuccess> }) => {
    mutationHarness.onSuccess = options.onSuccess;
    return options;
  },
}));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/academic-delivery/teaching-assignments-v2-service", () => ({
  createTeachingAssignmentV2: vi.fn(),
  deactivateTeachingAssignmentV2: vi.fn(),
  listTeachingAssignmentWorkspace: vi.fn(),
  previewInstructorWorkloadAfterAssignment: vi.fn(),
  updateTeachingAssignmentV2: vi.fn(),
}));

describe("teaching assignment read-model invalidation", () => {
  for (const [name, hook] of [
    ["create", useCreateTeachingAssignmentV2],
    ["update", useUpdateTeachingAssignmentV2],
    ["deactivate", useDeactivateTeachingAssignmentV2],
  ] as const) {
    it(`refreshes assignment and report reads only after a successful ${name} mutation`, () => {
      const client = new QueryClient();
      mutationHarness.client = client;
      const keys = [
        ["teaching-assignment-workspace-v2", { collegeId: "college", programId: "p1" }],
        ["teaching-assignment-workspace-v2", { collegeId: "college", programId: "p2" }],
        ["university-instructor-schedule", "user", true, "college", "lecturer", "draft"],
        ["plt-version-sessions", "college", "draft", "all"],
      ];
      try {
        keys.forEach((key) => client.setQueryData(key, "cached"));
        hook({ collegeId: "college", programId: "p1" });
        mutationHarness.onSuccess!({ ok: false });
        keys.forEach((key) => expect(client.getQueryState(key)?.isInvalidated).toBe(false));
        mutationHarness.onSuccess!({ ok: true, action: name });
        keys.forEach((key) => expect(client.getQueryState(key)?.isInvalidated).toBe(true));
      } finally {
        mutationHarness.client = null;
        mutationHarness.onSuccess = null;
        client.clear();
      }
    });
  }

  it("refetches an open lecturer report and keeps its published version historical", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { staleTime: Infinity, retry: false } },
    });
    let draftInstructor = "old-instructor";
    let draftReads = 0;
    let publishedReads = 0;
    const draftKey = [
      "university-instructor-schedule",
      "user",
      true,
      "college",
      "lecturer",
      "draft",
    ];
    const publishedKey = [
      "university-instructor-schedule",
      "user",
      true,
      "college",
      "lecturer",
      "published",
    ];
    const draft = new QueryObserver(client, {
      queryKey: draftKey,
      queryFn: async () => {
        draftReads++;
        return { version: "draft", instructor: draftInstructor };
      },
    });
    const published = new QueryObserver(client, {
      queryKey: publishedKey,
      queryFn: async () => {
        publishedReads++;
        return { version: "published", instructor: "old-instructor" };
      },
    });
    const unsubscribers = [draft.subscribe(() => {}), published.subscribe(() => {})];
    try {
      await Promise.all([draft.refetch(), published.refetch()]);
      expect(client.getQueryData(draftKey)).toEqual({
        version: "draft",
        instructor: "old-instructor",
      });
      const readsBefore = [draftReads, publishedReads];
      draftInstructor = "new-instructor"; // Represents an already committed draft replacement.
      await invalidateTeachingAssignmentReadModels(client);
      expect(draftReads).toBe(readsBefore[0] + 1);
      expect(publishedReads).toBe(readsBefore[1] + 1);
      expect(client.getQueryData(draftKey)).toEqual({
        version: "draft",
        instructor: "new-instructor",
      });
      expect(client.getQueryData(publishedKey)).toEqual({
        version: "published",
        instructor: "old-instructor",
      });
    } finally {
      unsubscribers.forEach((unsubscribe) => unsubscribe());
      client.clear();
    }
  });

  it("marks inactive assignment filter variants and session reports stale without evicting lookups", async () => {
    const client = new QueryClient();
    const affected = [
      ["teaching-assignment-workspace-v2", { collegeId: "a", programId: "p1" }],
      ["teaching-assignment-workspace-v2", { collegeId: "a", programId: "p2" }],
      ["teaching-assignment-workspace-v2", { collegeId: "b", scheduleVersionId: "draft" }],
      ["instructor-teaching-colleges", "user", true, "college", "lecturer"],
      ["rep-iw-sess", "college", "draft"],
      ["plt-version-sessions", "college", "draft", "all"],
      ["current-timetable-print", "college", "draft", "all"],
      ["current-timetable-coverage", "college", "draft"],
      ["sv-eligibility", "draft"],
      ["print-center-sessions", "draft", "college", {}],
      ["schedule-builder", "sessions", "college", "term", "draft", "all"],
      ["schedule-builder", "v2-work-items", "draft", "all", "all", "all"],
      ["schedule-builder", "versions", "college", "term"],
    ];
    const unrelated = [
      ["schedule-builder", "rooms", "college"],
      ["schedule-builder", "settings", "college"],
      ["report-terms", "college"],
      ["current-user"],
    ];
    try {
      [...affected, ...unrelated].forEach((key) => client.setQueryData(key, { retained: true }));
      await invalidateTeachingAssignmentReadModels(client);
      affected.forEach((key) => expect(client.getQueryState(key)?.isInvalidated).toBe(true));
      unrelated.forEach((key) => expect(client.getQueryState(key)?.isInvalidated).toBe(false));
      [...affected, ...unrelated].forEach((key) =>
        expect(client.getQueryData(key)).toEqual({ retained: true }),
      );
    } finally {
      client.clear();
    }
  });

  it("recognizes assignment-dependent faculty rosters without invalidating instructor type lookups", () => {
    expect(
      isTeachingAssignmentReadModelQuery({
        queryKey: ["instructors", "college", "home-roster", "all"],
      }),
    ).toBe(true);
    expect(
      isTeachingAssignmentReadModelQuery({
        queryKey: ["instructors", "university-roster", "user"],
      }),
    ).toBe(true);
    expect(isTeachingAssignmentReadModelQuery({ queryKey: ["instructor-types", "college"] })).toBe(
      false,
    );
  });
});
