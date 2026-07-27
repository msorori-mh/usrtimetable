/**
 * Unauthorized access UX regression harness for /users (pure logic + source guards).
 * No DB, no network, no full-page reload.
 */
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveCaughtErrorDisplayKind,
  resolveSuperAdminPageAccess,
  shouldLoadSuperAdminPageData,
  UNAUTHORIZED_BACK_HOME_LABEL_AR,
  UNAUTHORIZED_BACK_HOME_TO,
  UNAUTHORIZED_PAGE_MESSAGE_AR,
} from "../../src/lib/unauthorized-access";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "../..");

function readSrc(rel: string) {
  return readFileSync(join(root, rel), "utf8");
}

function run() {
  // 1) read_only → Forbidden/Unauthorized state for /users (super_admin-only page)
  const readOnlyMe = {
    isSuperAdmin: false,
    isCollegeAdmin: false,
    isReadOnly: true,
  };
  const readOnlyAccess = resolveSuperAdminPageAccess(readOnlyMe, false);
  assert(readOnlyAccess === "forbidden", "1 read_only access=forbidden");

  // 2) Clear Arabic permission message
  assert(
    UNAUTHORIZED_PAGE_MESSAGE_AR === "ليس لديك صلاحية للوصول إلى هذه الصفحة",
    "2 unauthorized message exact",
  );

  // 3) Back-to-home action label + target
  assert(UNAUTHORIZED_BACK_HOME_LABEL_AR === "العودة إلى الرئيسية", "3 back-home label exact");
  assert(UNAUTHORIZED_BACK_HOME_TO === "/dashboard", "3 back-home to dashboard");

  // 4) Do not load users-admin content while denied
  assert(
    shouldLoadSuperAdminPageData(readOnlyAccess) === false,
    "4 no admin data load when forbidden",
  );
  assert(shouldLoadSuperAdminPageData("loading") === false, "4 no admin data load while loading");

  // 5) super_admin can open /users
  const superMe = { isSuperAdmin: true };
  const superAccess = resolveSuperAdminPageAccess(superMe, false);
  assert(superAccess === "allowed", "5 super_admin access=allowed");
  assert(shouldLoadSuperAdminPageData(superAccess) === true, "5 super_admin loads data");

  // college_admin also blocked from /users (unchanged privilege)
  const collegeAdminAccess = resolveSuperAdminPageAccess(
    { isSuperAdmin: false, isCollegeAdmin: true },
    false,
  );
  assert(collegeAdminAccess === "forbidden", "5b college_admin still forbidden on /users");

  // 6) Real generic errors must NOT become Unauthorized
  assert(
    resolveCaughtErrorDisplayKind(new Error("حدث خطأ غير متوقع")) === "generic",
    "6 generic arabic error stays generic",
  );
  assert(
    resolveCaughtErrorDisplayKind(new Error("network timeout")) === "generic",
    "6 network error stays generic",
  );
  assert(
    resolveCaughtErrorDisplayKind(new Error("Internal Server Error")) === "generic",
    "6 500-like error stays generic",
  );
  assert(
    resolveCaughtErrorDisplayKind(new Error(UNAUTHORIZED_PAGE_MESSAGE_AR)) === "unauthorized",
    "6 explicit unauthorized message classified",
  );

  // Loading state
  assert(resolveSuperAdminPageAccess(undefined, true) === "loading", "loading while me pending");

  // --- Source guards: /users UX wiring ---
  const usersSrc = readSrc("src/routes/_authenticated/users.tsx");
  assert(!usersSrc.includes("throw redirect"), "users must not throw redirect in render");
  assert(usersSrc.includes("UnauthorizedAccess"), "users renders UnauthorizedAccess");
  assert(usersSrc.includes("resolveSuperAdminPageAccess"), "users uses access helper");
  assert(usersSrc.includes("enabled: canLoadAdminData"), "users gates admin queries");
  assert(
    usersSrc.includes('queryKey: ["colleges-min"]') &&
      usersSrc.includes("enabled: canLoadAdminData"),
    "colleges-min also gated",
  );

  const unauthorizedUi = readSrc("src/components/unauthorized-access.tsx");
  assert(unauthorizedUi.includes("UNAUTHORIZED_PAGE_MESSAGE_AR"), "UI shows permission message");
  assert(unauthorizedUi.includes("UNAUTHORIZED_BACK_HOME_LABEL_AR"), "UI shows back-home button");
  assert(
    !unauthorizedUi.includes("window.location") && !unauthorizedUi.includes("location.reload"),
    "no full-page reload",
  );

  // Root error component must keep generic copy (not convert all errors to permission UX)
  const rootSrc = readSrc("src/routes/__root.tsx");
  assert(rootSrc.includes("حدث خطأ غير متوقع"), "root keeps generic error title");
  assert(
    !rootSrc.includes(UNAUTHORIZED_PAGE_MESSAGE_AR),
    "root ErrorComponent not remapped to unauthorized message",
  );

  // 7) /import, /auto-schedule, published schedules privilege posture unchanged
  const importSrc = readSrc("src/routes/_authenticated/import.tsx");
  assert(importSrc.includes("useCanManageActiveCollege"), "7 import still uses canManage gate");
  assert(
    importSrc.includes("لا تملك صلاحية الاستيراد لهذه الكلّية"),
    "7 import still blocks non-managers",
  );

  const autoSrc = readSrc("src/routes/_authenticated/auto-schedule.tsx");
  assert(
    autoSrc.includes("disabled={!canManage || !versionId || run.isPending || readinessIncomplete}"),
    "7 auto-schedule run stays disabled without canManage or complete readiness",
  );

  const publishedSrc = readSrc("src/routes/_authenticated/published-schedules.tsx");
  assert(
    !publishedSrc.includes("isSuperAdmin") && !publishedSrc.includes("throw redirect"),
    "7 published schedules stays viewable (no super_admin-only throw)",
  );

  const layoutSrc = readSrc("src/components/app-layout.tsx");
  assert(
    /to:\s*"\/users"[\s\S]*?roles:\s*\["super_admin"\]/.test(layoutSrc),
    "7 nav /users still super_admin only",
  );
  assert(
    /to:\s*"\/import"[\s\S]*?roles:\s*\["super_admin",\s*"college_admin"\]/.test(layoutSrc),
    "7 nav /import roles unchanged",
  );
  assert(
    /to:\s*"\/auto-schedule"[\s\S]*?roles:\s*\["super_admin",\s*"college_admin"\]/.test(layoutSrc),
    "7 nav /auto-schedule roles unchanged",
  );
  assert(
    /to:\s*"\/published-schedules"[\s\S]*?roles:\s*ALL/.test(layoutSrc),
    "7 nav published-schedules still ALL roles",
  );

  // Server-side admin gate unchanged (no privilege expansion)
  const usersFn = readSrc("src/lib/users.functions.ts");
  assert(
    usersFn.includes('eq("role", "super_admin")'),
    "server assertInstitutionAdmin still super_admin only",
  );
  assert(
    usersFn.includes("Forbidden: institution admin only"),
    "server forbidden message retained",
  );

  console.log("unauthorized-access-ux harness: PASS");
}

run();
