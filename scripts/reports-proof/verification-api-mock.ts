export async function issueReportVerification() {
  return "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
}
export async function resolveReportVerification(id: string) {
  if (new URLSearchParams(location.search).get("fail")) throw Error("offline");
  return id === "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"
    ? {
        available: true,
        college_name: "كلية الاختبار",
        term_name: "الفصل الأول",
        version_name: "VERSION_PROOF",
        report_kind: "instructor",
        status: "published",
        issued_at: "2026-09-18T00:00:00Z",
        version_updated_at: "2026-09-18T00:00:00Z",
        unchanged: true,
        is_latest: true,
      }
    : { available: false };
}
