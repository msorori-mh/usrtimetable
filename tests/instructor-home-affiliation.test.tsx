import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { InstructorHomeAffiliation } from "../src/components/instructor-home-affiliation";

const jawf = {
  home_college_id: "jawf",
  home_college: "كلية التربية والعلوم الإنسانية والتطبيقية - الجوف",
  home_department: "قسم نظم المعلومات",
};

test("a Jawf lecturer stored in ITCS displays the approved home and visiting status", () => {
  const html = renderToStaticMarkup(
    <InstructorHomeAffiliation
      home={jawf}
      currentCollegeId="itcs"
      defaultCategoryLabel="محاضر دائم"
    />,
  );
  expect(html).toContain(jawf.home_college);
  expect(html).toContain("القسم الأصلي: قسم نظم المعلومات");
  expect(html).toContain("محاضر من كلية أخرى");
  expect(html).not.toContain("محاضر دائم");
});

test("the same lecturer is native in the home college", () => {
  const html = renderToStaticMarkup(
    <InstructorHomeAffiliation
      home={jawf}
      currentCollegeId="jawf"
      defaultCategoryLabel="محاضر دائم"
    />,
  );
  expect(html).toContain("محاضر دائم");
  expect(html).not.toContain("محاضر من كلية أخرى");
});

test("missing home and missing home department stay explicit", () => {
  const pending = renderToStaticMarkup(
    <InstructorHomeAffiliation currentCollegeId="itcs" defaultCategoryLabel="محاضر دائم" />,
  );
  expect(pending).toContain("بحاجة إلى مراجعة");
  expect(pending).not.toContain("محاضر دائم");
  const missingDepartment = renderToStaticMarkup(
    <InstructorHomeAffiliation
      home={{ ...jawf, home_department: null }}
      currentCollegeId="itcs"
      defaultCategoryLabel="محاضر دائم"
    />,
  );
  expect(missingDepartment).toContain("غير محدد — يحتاج استكمالًا");
});

test("loading and failed queries do not show a cached home as confirmed", () => {
  const loading = renderToStaticMarkup(
    <InstructorHomeAffiliation
      home={jawf}
      currentCollegeId="itcs"
      defaultCategoryLabel="محاضر دائم"
      isLoading
    />,
  );
  const failed = renderToStaticMarkup(
    <InstructorHomeAffiliation
      home={jawf}
      currentCollegeId="itcs"
      defaultCategoryLabel="محاضر دائم"
      isError
    />,
  );
  expect(loading).toContain("جارٍ تحميل");
  expect(failed).toContain("تعذر تحميل");
  expect(loading).not.toContain("محاضر من كلية أخرى");
  expect(failed).not.toContain(jawf.home_college);
});
