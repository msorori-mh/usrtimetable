import { describe, expect, test } from "bun:test";
import { reportSessionKindAr } from "../src/lib/reports/session-mappers";

describe("report session kind label", () => {
  test("tutorials are shown as تطبيقات, not as theory", () => {
    expect(reportSessionKindAr("tutorial")).toBe("تطبيقات");
  });

  test("lab and lecture keep their labels", () => {
    expect(reportSessionKindAr("lab")).toBe("عملي");
    expect(reportSessionKindAr("lecture")).toBe("نظري");
    expect(reportSessionKindAr(null)).toBe("نظري");
  });
});
