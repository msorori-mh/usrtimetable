import { writeFileSync } from "node:fs";
import { TEMPLATES } from "../src/lib/excel-import/templates.ts";
import {
  ACTIVE_NEW_FLOW_ENTITIES,
  LEGACY_ONLY_ENTITIES,
  IMPORT_CONTRACT_VERSION,
} from "../src/lib/excel-import/registry.ts";

const lines: string[] = [];
lines.push("# مصفوفة عقود قوالب الاستيراد النهائية");
lines.push("");
lines.push(`**Contract version:** ${IMPORT_CONTRACT_VERSION}`);
lines.push("**Source:** `src/lib/excel-import/templates.ts` + validators + RPC dispatch");
lines.push("**قاعدة:** أسماء الأعمدة الإنجليزية (`key`) ثابتة؛ العناوين العربية للعرض فقط.");
lines.push("");
lines.push("## قيم مرجعية رسمية (Pilot)");
lines.push("");
lines.push("| المجال | القيم |");
lines.push("|--------|--------|");
lines.push("| study_system (Pilot) | `regular`, `parallel` |");
lines.push(
  "| study_system (Schema cohorts) | `regular`, `parallel`, `evening`, `distance`, `other` |",
);
lines.push("| component_type (قابل للإسناد) | `theory`, `practical`, `tutorial`, `project` |");
lines.push("| component_type (Schema + ممنوع للإسناد) | `summer_training` |");
lines.push("| boolean | `true` / `false` (ويُقبل أيضًا 1/0/نعم/لا في الـ validator) |");
lines.push("| days (daily_breaks) | `0..6` مفصولة بفواصل (0=الأحد) |");
lines.push(
  "| room_type | `lecture_hall`, `computer_lab`, `network_lab`, `cybersecurity_lab`, `electronics_lab`, `workshop`, `seminar_room` |",
);
lines.push("| count_status | `estimated`, `confirmed`, `locked` |");
lines.push("| term_type | `first`, `second` |");
lines.push("| employment_type | `full_time`, `part_time`, `visiting` |");
lines.push("");

function emitEntity(entity: string) {
  const tpl = TEMPLATES[entity];
  if (!tpl) return;
  lines.push(`## ${entity}`);
  lines.push("");
  lines.push(`- **Label:** ${tpl.label}`);
  lines.push(`- **Sheet:** ${tpl.sheetName}`);
  lines.push(`- **Natural key:** ${tpl.uniqueKeyLabel} (\`${tpl.uniqueKey}\`)`);
  lines.push(`- **Commit:** commit_import_job_atomic`);
  lines.push("");
  lines.push(
    "| column_name | Arabic label | required/optional | data type | allowed values | normalization | reference entity | validation error code | natural-key | example | notes |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|");
  for (const c of tpl.columns) {
    const req = c.required ? "required" : "optional";
    const dt = c.type || "text";
    const allowed = (c.enumValues || []).join(", ") || "—";
    const norm =
      dt === "boolean" ? "toBool" : dt === "number" ? "Number" : dt === "time" ? "HH:MM" : "trim";
    let ref = "—";
    if (c.key.includes("program")) ref = "academic_programs.code";
    else if (c.key.includes("department")) ref = "departments.code";
    else if (c.key.includes("term")) ref = "academic_terms.code";
    else if (c.key.includes("course")) ref = "courses.code";
    else if (c.key.includes("employee")) ref = "instructors.employee_number";
    else if (c.key.includes("cohort")) ref = "academic_cohorts.code";
    else if (c.key.includes("delivery_group")) ref = "delivery_groups.group_code";
    else if (c.key.includes("elective_slot")) ref = "elective_slots.slot_code";
    else if (c.key === "plan_code") ref = "study_plans.code";
    else if (c.key === "room_type" || c.key === "required_room_type") ref = "rooms.room_type enum";
    const err = c.required ? "missing_required / unknown_*" : "invalid_enum / type";
    const nk = tpl.uniqueKey === c.key ? "yes" : tpl.uniqueKey === "_logical" ? "composite" : "no";
    const notes =
      c.key === "room_type_code"
        ? "legacy alias only"
        : c.key === "component_type"
          ? "summer_training forbidden at validate+RPC"
          : "";
    lines.push(
      `| ${c.key} | ${c.header} | ${req} | ${dt} | ${allowed} | ${norm} | ${ref} | ${err} | ${nk} | ${c.example ?? ""} | ${notes} |`,
    );
  }
  lines.push("");
}

lines.push("# ACTIVE_NEW_FLOW");
lines.push("");
for (const e of ACTIVE_NEW_FLOW_ENTITIES) emitEntity(e);

lines.push("# LEGACY_ONLY (مخفي من واجهة التشغيل الجديد)");
lines.push("");
for (const e of LEGACY_ONLY_ENTITIES) emitEntity(e);

lines.push("## Generated / UI-managed (لا قوالب تشغيلية جديدة)");
lines.push("");
lines.push("| entity | classification | notes |");
lines.push("|---|---|---|");
lines.push("| delivery_groups | GENERATED_NOT_IMPORTED | generate_cohort_delivery_groups |");
lines.push("| cohort_curriculum | GENERATED_NOT_IMPORTED | generate_cohort_curriculum |");
lines.push("| schedule_versions / schedule_sessions | GENERATED_NOT_IMPORTED | schedule builder |");
lines.push("| instructor_availability | UI_MANAGED_NOT_IMPORTED | /availability |");
lines.push("| time_slot_templates | UI_MANAGED_NOT_IMPORTED | UI time templates |");
lines.push("| faculty_workload_policies | UI_MANAGED_NOT_IMPORTED | no ImportEntity |");
lines.push("| colleges | UI_MANAGED_NOT_IMPORTED | foundation UI (لا استيراد) |");

writeFileSync("docs/IMPORT-TEMPLATES-FINAL-CONTRACT-MATRIX.md", lines.join("\n"), "utf8");
console.log("Wrote docs/IMPORT-TEMPLATES-FINAL-CONTRACT-MATRIX.md");
