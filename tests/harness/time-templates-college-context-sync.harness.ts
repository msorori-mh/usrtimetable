/**
 * College context sync regression harness for time-slot templates.
 * Proves shared active-college store + page helpers (no DB, no reload).
 */
import {
  ACTIVE_COLLEGE_STORAGE_KEY,
  buildCollegeScopedSavePayload,
  collegeScopedQueryKey,
  getActiveCollegeId,
  resolveActiveCollege,
  setActiveCollegeId,
  shouldResetTermFilter,
  subscribeActiveCollegeId,
  type CollegeRefLike,
} from "../../src/lib/active-college-store";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

/** Minimal localStorage polyfill for Node harness. */
function installLocalStoragePolyfill() {
  const store = new Map<string, string>();
  const ls = {
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    setItem(key: string, value: string) {
      store.set(key, String(value));
    },
    removeItem(key: string) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
  };
  (globalThis as { localStorage?: typeof ls }).localStorage = ls;
  if (typeof (globalThis as { window?: unknown }).window === "undefined") {
    (globalThis as { window?: object }).window = globalThis;
  }
  return store;
}

function run() {
  installLocalStoragePolyfill();

  const collegeA: CollegeRefLike = {
    id: "college-a",
    name: "كلية الآداب والعلوم الإنسانية",
    code: "ARTS",
    university_id: "uni-1",
  };
  const collegeB: CollegeRefLike = {
    id: "college-b",
    name: "كلية تكنولوجيا المعلومات وعلوم الحاسوب",
    code: "IT",
    university_id: "uni-1",
  };
  const colleges = [collegeA, collegeB];

  // 1) Start with college A
  setActiveCollegeId(collegeA.id);
  assert(getActiveCollegeId() === collegeA.id, "1 start activeId=A");
  assert(localStorage.getItem(ACTIVE_COLLEGE_STORAGE_KEY) === collegeA.id, "1 persisted A");

  // 2) Context card resolves A
  const cardA = resolveActiveCollege(colleges, getActiveCollegeId());
  assert(cardA?.id === collegeA.id, "2 card shows A id");
  assert(cardA?.name === collegeA.name, "2 card shows A name");

  // Simulate page + switcher as two independent subscribers (former bug: separate useState)
  const views = {
    switcherId: getActiveCollegeId(),
    pageId: getActiveCollegeId(),
    pageName: resolveActiveCollege(colleges, getActiveCollegeId())?.name ?? null,
  };
  const unsubSwitcher = subscribeActiveCollegeId(() => {
    views.switcherId = getActiveCollegeId();
  });
  const unsubPage = subscribeActiveCollegeId(() => {
    views.pageId = getActiveCollegeId();
    views.pageName = resolveActiveCollege(colleges, getActiveCollegeId())?.name ?? null;
  });

  // 3–4) Change to B → both switcher and page/card update immediately (no remount)
  setActiveCollegeId(collegeB.id);
  assert(views.switcherId === collegeB.id, "3 switcher shows B");
  assert(views.pageId === collegeB.id, "4 page activeId=B immediately");
  assert(views.pageName === collegeB.name, "4 context card shows B name immediately");

  // 5) Query key uses B
  const qk = collegeScopedQueryKey("tst", getActiveCollegeId(), "all");
  assert(qk[0] === "tst" && qk[1] === collegeB.id, "5 queryKey uses B");
  assert(qk[1] !== collegeA.id, "5 queryKey does not keep A");

  // 6) Invalid academic term is reset
  const termsForB = [{ id: "term-b-1" }, { id: "term-b-2" }];
  assert(
    shouldResetTermFilter("term-a-stale", termsForB) === true,
    "6 stale term from A is invalid for B",
  );
  assert(shouldResetTermFilter("term-b-1", termsForB) === false, "6 valid B term kept");
  assert(shouldResetTermFilter("all", termsForB) === false, "6 all stays");

  // 7) Save uses collegeId of B at save time
  const savePayload = buildCollegeScopedSavePayload(collegeB.id, {
    study_system: "regular",
    day_of_week: 6,
    start_time: "08:00",
    end_time: "10:00",
    slot_duration_minutes: 120,
    is_active: true,
  });
  assert(savePayload.college_id === collegeB.id, "7 save college_id=B");
  assert(savePayload.college_id !== collegeA.id, "7 save does not use A");

  // 8) Repeated switching A → B → A → B never resurrects stale views
  const sequence = [collegeA.id, collegeB.id, collegeA.id, collegeB.id];
  const observed: Array<{ id: string | null; name: string | null }> = [];
  for (const id of sequence) {
    setActiveCollegeId(id);
    const resolved = resolveActiveCollege(colleges, getActiveCollegeId());
    observed.push({ id: views.pageId, name: views.pageName });
    assert(views.pageId === id, `8 page synced to ${id}`);
    assert(views.switcherId === id, `8 switcher synced to ${id}`);
    assert(resolved?.id === id, `8 resolve matches ${id}`);
    assert(
      collegeScopedQueryKey("terms-min", getActiveCollegeId())[1] === id,
      `8 terms query scoped to ${id}`,
    );
  }
  assert(observed[0].name === collegeA.name, "8 step1 name A");
  assert(observed[1].name === collegeB.name, "8 step2 name B");
  assert(observed[2].name === collegeA.name, "8 step3 name A again");
  assert(observed[3].name === collegeB.name, "8 step4 name B again");
  assert(observed[3].id === collegeB.id, "8 final id B — no stale A");

  // 9) No reload / remount required: subscribers already updated in-place
  assert(typeof unsubSwitcher === "function" && typeof unsubPage === "function", "9 live subs");
  unsubSwitcher();
  unsubPage();

  // No silent fallback to another college when id is unknown
  assert(resolveActiveCollege(colleges, "missing") === null, "no silent fallback");

  console.log("PASS time-templates-college-context-sync.harness.ts");
}

run();
