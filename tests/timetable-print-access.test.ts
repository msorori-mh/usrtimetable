import { describe, expect, test } from "bun:test";
import {
  canPrintTimetableVersion,
  canPrintUnpublishedTimetable,
  timetablePrintNotice,
  DRAFT_PRINT_NOTICE_AR,
} from "../src/lib/reports/timetable-print-access";

describe("unpublished timetable print authorization", () => {
  const nonAdmins = [
    {},
    { isCollegeAdmin: true },
    { isReadOnly: true },
    { isInstitutionalViewer: true },
    { isUniversityLeadership: true },
    { isCollegeDean: true },
    { isCollegeAdmin: true, isInstitutionalViewer: true },
  ];
  test("only the general admin may print draft, review, approved or archived versions", () => {
    for (const status of ["draft", "review", "approved", "archived"]) {
      expect(canPrintTimetableVersion(status, { isSuperAdmin: true })).toBe(true);
      for (const viewer of nonAdmins) {
        expect(canPrintTimetableVersion(status, viewer)).toBe(false);
        expect(canPrintUnpublishedTimetable(viewer)).toBe(false);
      }
    }
  });
  test("published schedules retain existing authenticated print behavior", () => {
    for (const viewer of nonAdmins)
      expect(canPrintTimetableVersion("published", viewer)).toBe(true);
  });
  test("missing account or version data fails closed while permissions load", () => {
    expect(canPrintTimetableVersion("draft", undefined)).toBe(false);
    expect(canPrintTimetableVersion("published", null)).toBe(false);
    expect(canPrintTimetableVersion(undefined, { isSuperAdmin: true })).toBe(false);
  });
  test("mixed-college and batch printouts retain an explicit draft notice", () => {
    expect(timetablePrintNotice(["published", "draft"])).toBe(DRAFT_PRINT_NOTICE_AR);
    expect(timetablePrintNotice(["review"])).toBe(DRAFT_PRINT_NOTICE_AR);
    expect(timetablePrintNotice(["published", "published"])).toBeUndefined();
  });
});
