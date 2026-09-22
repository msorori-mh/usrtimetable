import React from "react";
import assert from "node:assert/strict";
import { mock, test } from "node:test";
import { renderToString } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";

let active: { id: string; name: string } | null = null;
let canManage = true;
const search = { step: "instructors", entity: "instructors" };
const navigate = () => {};
let Page: React.ComponentType;

mock.module("@tanstack/react-router", {
  namedExports: {
    createFileRoute: () => (options: { component: React.ComponentType }) => {
      Page = options.component;
      return { useSearch: () => search, useNavigate: () => navigate };
    },
    Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
      <a href={to}>{children}</a>
    ),
  },
});
mock.module("../src/hooks/use-colleges.ts", {
  namedExports: { useActiveCollege: () => ({ active }) },
});
mock.module("../src/hooks/use-can-manage.ts", {
  namedExports: { useCanManageActiveCollege: () => canManage },
});
mock.module("../src/components/college-switcher.tsx", {
  namedExports: { CollegeSwitcher: () => <span>{active?.name}</span> },
});
mock.module("../src/integrations/supabase/client.ts", {
  namedExports: {
    supabase: {
      from: () => {
        throw new Error("This render must not read or write live data");
      },
    },
  },
});
mock.module("../src/lib/data-onboarding/snapshot.ts", {
  namedExports: {
    fetchOnboardingReadinessSnapshot: () => {
      throw new Error("Use only the college-scoped fixture cache");
    },
  },
});
mock.module("../src/components/data-onboarding/import-workspace.tsx", {
  namedExports: {
    ImportWorkspace: () => <div>IMPORT_FOR_{active?.id}</div>,
  },
});

const { PREPARATION_STEPS } = await import("../src/lib/data-onboarding/preparation");
await import("../src/routes/_authenticated/data-onboarding");
const { ExistingScheduleWorkspace } =
  await import("../src/components/data-onboarding/existing-schedule-workspace");

const colleges = [
  { id: "7168345f-cf9d-4789-b2ad-547abb687dc8", name: "الحاسوب" },
  { id: "arts", name: "الآداب" },
  { id: "business", name: "العلوم الإدارية" },
  { id: "law", name: "الشريعة" },
];

function fixture(id: string) {
  return {
    steps: PREPARATION_STEPS.map((s) => ({
      id: s.id,
      status: "complete",
      detailAr: `READINESS_FOR_${id}`,
    })),
    hasElectives: false,
    newFlowIssues: [],
    checkedAt: "2026-09-22T00:00:00Z",
  };
}
function client() {
  return new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity } } });
}

test("every college sees the same nine preparation steps even when existing intake is enabled", () => {
  const cache = client();
  for (const college of colleges) {
    cache.setQueryData(["data-onboarding-readiness", college.id], fixture(college.id));
    cache.setQueryData(["existing-terms", college.id], [{ id: `term-${college.id}` }]);
    cache.setQueryData(["existing-mode", college.id, `term-${college.id}`], true);
  }
  for (const college of colleges) {
    active = college;
    canManage = true;
    const html = renderToString(
      <QueryClientProvider client={cache}>
        <Page />
      </QueryClientProvider>,
    );
    assert.equal((html.match(/data-testid="onboarding-step-/g) ?? []).length, 9, college.name);
    assert.match(html, /role="tab"[^>]*aria-selected="true"[^>]*>تجهيز البيانات/);
    assert.match(html, /role="tab"[^>]*aria-selected="false"[^>]*>الجداول القائمة/);
    assert.ok(html.includes(`READINESS_FOR_${college.id}`));
    assert.ok(html.includes(`IMPORT_FOR_<!-- -->${college.id}`));
    assert.ok(
      !html.includes('aria-label="الجداول القائمة"'),
      "existing records are an optional tab",
    );
    for (const other of colleges.filter((c) => c.id !== college.id)) {
      assert.ok(!html.includes(`READINESS_FOR_${other.id}`), "no previous college readiness");
    }
  }
  cache.clear();
});

test("read-only users retain the preparation steps without import or activation actions", () => {
  active = colleges[1];
  canManage = false;
  const cache = client();
  cache.setQueryData(["data-onboarding-readiness", active.id], fixture(active.id));
  const html = renderToString(
    <QueryClientProvider client={cache}>
      <Page />
    </QueryClientProvider>,
  );
  assert.match(html, /onboarding-readonly-note/);
  assert.equal((html.match(/data-testid="onboarding-step-/g) ?? []).length, 9);
  assert.ok(!html.includes("IMPORT_FOR_"));
  assert.ok(!html.includes("استخدام الجداول القائمة"));
  cache.clear();
});

test("no selected college shows a clear prompt without data from another college", () => {
  active = null;
  const cache = client();
  const html = renderToString(
    <QueryClientProvider client={cache}>
      <Page />
    </QueryClientProvider>,
  );
  assert.ok(html.includes("اختر الكلية لعرض خطوات تجهيز بياناتها"));
  assert.ok(!html.includes("READINESS_FOR_"));
  cache.clear();
});

test("IT can open its existing-schedule workspace using the same scoped queries as other colleges", () => {
  const cache = client();
  const id = colleges[0].id;
  cache.setQueryData(["existing-terms", id], [{ id: "it-term", name: "الفصل الأول" }]);
  cache.setQueryData(["existing-mode", id, "it-term"], true);
  cache.setQueryData(["existing-source", id, "it-term"], {
    rows: [],
    rooms: [],
    instructors: [],
    plans: [],
  });
  const html = renderToString(
    <QueryClientProvider client={cache}>
      <ExistingScheduleWorkspace collegeId={id} canManage={false} />
    </QueryClientProvider>,
  );
  assert.match(html, /aria-label="الجداول القائمة"/);
  assert.ok(html.includes("لم تُدخل جداول لهذا الفصل بعد"));
  cache.clear();
});

test("a missing intake term has an explicit empty state and preserves access to preparation", () => {
  const cache = client();
  cache.setQueryData(["existing-terms", "empty"], []);
  const html = renderToString(
    <QueryClientProvider client={cache}>
      <ExistingScheduleWorkspace collegeId="empty" canManage />
    </QueryClientProvider>,
  );
  assert.ok(html.includes("لا يوجد فصل أول"));
  assert.ok(html.includes("تبويب تجهيز البيانات"));
  assert.ok(!html.includes("استخدام الجداول القائمة"));
  cache.clear();
});

test("an intake term lookup failure is visible and retryable instead of rendering a blank tab", () => {
  const cache = client();
  cache.setQueryDefaults(["existing-terms", "failed"], { retryOnMount: false });
  const query = cache.getQueryCache().build(cache, { queryKey: ["existing-terms", "failed"] });
  query.setState({ status: "error", error: new Error("Term lookup failed") });
  const html = renderToString(
    <QueryClientProvider client={cache}>
      <ExistingScheduleWorkspace collegeId="failed" canManage />
    </QueryClientProvider>,
  );
  assert.match(html, /role="alert"/);
  assert.ok(html.includes("Term lookup failed"));
  assert.ok(html.includes("إعادة المحاولة"));
  assert.ok(!html.includes("استخدام الجداول القائمة"));
  cache.clear();
});
