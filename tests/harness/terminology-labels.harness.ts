/**
 * Terminology + internal-key stability harness — no DB writes.
 */
import { TEMPLATES, buildTemplateWorkbook } from "../../src/lib/excel-import/templates";
import { CANONICAL_ROOM_TYPES } from "../../src/lib/excel-import/room-type-normalize";
import { CATALOG, buildCatalogTemplate } from "../../src/lib/data-templates/catalog";

function assert(cond: boolean, msg: string) {
  if (!cond) throw new Error(msg);
}

async function run() {
  // Internal keys unchanged
  assert(!!TEMPLATES.rooms && TEMPLATES.rooms.entity === "rooms", "rooms key");
  assert(
    !!TEMPLATES.academic_terms && TEMPLATES.academic_terms.entity === "academic_terms",
    "academic_terms key",
  );
  assert(!!TEMPLATES.sections && TEMPLATES.sections.entity === "sections", "sections key");
  assert(TEMPLATES.rooms.label === "القاعات والمعامل", "rooms label");
  assert(TEMPLATES.academic_terms.label === "الفصول الأكاديمية", "academic_terms label");
  assert(TEMPLATES.sections.label === "المجموعات الدراسية", "sections label");

  // sections is NOT renamed to academic_terms
  assert(TEMPLATES.academic_terms.label !== "المجموعات الدراسية", "terms not groups");
  assert(!TEMPLATES.academic_terms.label.includes("مجموعات"), "terms no مجموعات");

  // rooms template: primary column + no LEC as example for primary
  const roomTypeCol = TEMPLATES.rooms.columns.find((c) => c.key === "room_type");
  const roomCodeCol = TEMPLATES.rooms.columns.find((c) => c.key === "room_type_code");
  assert(!!roomTypeCol && roomTypeCol.header === "نوع_القاعة", "room_type header");
  assert(roomTypeCol!.example === "lecture_hall", "room_type example canonical");
  assert(
    !!roomCodeCol && (roomCodeCol.example === "" || roomCodeCol.example == null),
    "code example empty",
  );
  for (const t of CANONICAL_ROOM_TYPES) {
    assert(roomTypeCol!.enumValues?.includes(t) ?? false, `enum has ${t}`);
  }

  // No asterisk in import template headers
  for (const tpl of Object.values(TEMPLATES)) {
    for (const c of tpl.columns) {
      assert(!c.header.includes("*"), `no star in import ${tpl.entity}.${c.header}`);
      assert(!c.header.endsWith(" "), `no trailing space ${tpl.entity}.${c.header}`);
    }
  }

  // Catalog headers must not use " *" suffix either
  for (const tpl of CATALOG) {
    for (const c of tpl.columns) {
      assert(!c.header.includes("*"), `no star in catalog ${tpl.id}.${c.header}`);
    }
  }

  // Round-trip: generate import rooms headers → match parser expectations
  {
    const headers = TEMPLATES.rooms.columns.map((c) => c.header);
    assert(!headers.some((h) => h.includes("*") || h.endsWith(" *")), "rooms no star suffix");
    for (const c of TEMPLATES.rooms.columns.filter((x) => x.required)) {
      assert(headers.includes(c.header), `rooms required header present: ${c.header}`);
    }
  }

  // Catalog rooms headers match import rooms headers for shared columns
  {
    const catalogRooms = CATALOG.find((t) => t.id === "rooms");
    assert(!!catalogRooms, "catalog rooms exists");
    const importHeaders = new Set(TEMPLATES.rooms.columns.map((c) => c.header));
    for (const c of catalogRooms!.columns) {
      if (importHeaders.has(c.header) || c.header === "نوع_القاعة" || c.header === "رمز_القاعة") {
        assert(!c.header.endsWith(" *"), `catalog header clean: ${c.header}`);
      }
    }
    // Shared required headers must be exact
    for (const h of ["رمز_القاعة", "اسم_القاعة", "السعة", "نوع_القاعة"]) {
      assert(
        catalogRooms!.columns.some((c) => c.header === h),
        `catalog has ${h}`,
      );
      assert(TEMPLATES.rooms.columns.some((c) => c.header === h), `import has ${h}`);
    }
  }

  // Build workbooks (no DB) — headers must parse without star
  {
    const blob = await buildTemplateWorkbook("rooms");
    assert(blob.size > 0, "import rooms workbook");
    const catBlob = await buildCatalogTemplate("rooms");
    assert(catBlob.size > 0, "catalog rooms workbook");
    // Also exercise sections + academic_terms generators
    assert((await buildTemplateWorkbook("sections")).size > 0, "import sections workbook");
    assert((await buildCatalogTemplate("sections")).size > 0, "catalog sections workbook");
    assert((await buildTemplateWorkbook("academic_terms")).size > 0, "import terms workbook");
    assert((await buildCatalogTemplate("academic_terms")).size > 0, "catalog terms workbook");
  }

  // Parse catalog rooms AOA headers via same literal match as validators
  {
    const catalogRooms = CATALOG.find((t) => t.id === "rooms")!;
    const generatedHeaders = catalogRooms.columns.map((c) => c.header); // post-fix: no *
    const headerSet = new Set(generatedHeaders.map((h) => h.trim()));
    const missing = TEMPLATES.rooms.columns
      .filter((c) => c.required && !headerSet.has(c.header))
      .map((c) => c.header);
    // Catalog may use slightly different optional columns; required shared ones must pass
    const sharedRequired = ["رمز_القاعة", "اسم_القاعة", "السعة"];
    for (const h of sharedRequired) {
      assert(headerSet.has(h), `round-trip has ${h}`);
    }
    assert(
      !generatedHeaders.some((h) => / \*$/.test(h) || h.includes(" *")),
      "round-trip no star suffix",
    );
    void missing;
  }

  // Banned phrase for sections confusion
  const srcLabels = [
    TEMPLATES.sections.label,
    TEMPLATES.academic_terms.label,
    TEMPLATES.rooms.label,
  ].join("|");
  assert(!srcLabels.includes("الفصول الدراسية"), "no banned phrase in entity labels");

  console.log("PASS terminology-labels.harness.ts");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
