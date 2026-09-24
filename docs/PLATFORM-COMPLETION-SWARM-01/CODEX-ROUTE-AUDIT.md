# CODEX Route Audit

Baseline: `2b375b3` · Branch: `codex/platform-product-e2e-completion-01`

Legend: **P** implemented/covered by shared layout or route; **L** isolated Legacy route; **N/A** not an operational write route. All authenticated routes inherit RTL, responsive shell, active navigation, college scoping, and the authentication boundary. Query errors are handled by React Query or route-specific error UI; New Flow embeds were checked by the static contract harness.

| Product page               | Route                    | Loading | Empty |                Error/403 | RTL/mobile/desktop | Breadcrumb/nav |       Query/PostgREST | Flow |
| -------------------------- | ------------------------ | ------: | ----: | -----------------------: | -----------------: | -------------: | --------------------: | ---- |
| لوحة التحكم                | `/dashboard`             |       P |     P |                        P |                  P |              P |                     P | New  |
| دليل تجهيز البيانات        | `/data-templates`        |       P |     P |                        P |                  P |              P |                     P | New  |
| استيراد البيانات           | `/import`                |       P |     P |                        P |                  P |              P |                     P | New  |
| سجل الاستيراد              | `/import-history`        |       P |     P |                        P |                  P |              P |                     P | New  |
| الجامعة                    | `/universities`          |       P |     P |                        P |                  P |              P |                     P | New  |
| الكليات                    | `/colleges`              |       P |     P |                        P |                  P |              P |                     P | New  |
| الأقسام                    | `/departments`           |       P |     P |                        P |                  P |              P |                     P | New  |
| البرامج                    | `/programs`              |       P |     P |                        P |                  P |              P |                     P | New  |
| الخطط الدراسية             | `/study-plans`           |       P |     P |                        P |                  P |              P |                     P | New  |
| المقررات                   | `/courses`               |       P |     P |                        P |                  P |              P |                     P | New  |
| المقررات المشتركة          | `/shared-courses`        |       P |     P |                        P |                  P |              P |                     P | New  |
| الفصول الأكاديمية          | `/terms`                 |       P |     P |                        P |                  P |              P |                     P | New  |
| التقويم                    | `/academic-calendar`     |       P |     P |                        P |                  P |              P |                     P | New  |
| الدفعات                    | `/academic-cohorts`      |       P |     P |                        P |                  P |              P |           explicit FK | New  |
| أعداد الدفعات              | `/scheduling-headcounts` |       P |     P |                        P |                  P |              P |                     P | New  |
| المحاضرون                  | `/instructors`           |       P |     P |                        P |                  P |              P |                     P | New  |
| أنواع المحاضرين            | `/instructor-types`      |       P |     P |                        P |                  P |              P |                     P | New  |
| المباني                    | `/buildings`             |       P |     P |                        P |                  P |              P |                     P | New  |
| أنواع القاعات              | `/room-types`            |       P |     P |                        P |                  P |              P |                     P | New  |
| القاعات والمعامل           | `/rooms`                 |       P |     P |                        P |                  P |              P |                     P | New  |
| أنواع المحاضرات            | `/session-types`         |       P |     P |                        P |                  P |              P |                     P | New  |
| أيام وفترات الدوام         | `/time-slots`            |       P |     P |                        P |                  P |              P |                     P | New  |
| الاستراحات                 | `/daily-breaks`          |       P |     P |                        P |                  P |              P |                     P | New  |
| قوالب الوقت                | `/time-slot-templates`   |       P |     P |                        P |                  P |              P |                     P | New  |
| عدم التوفر                 | `/availability`          |       P |     P |                        P |                  P |              P |                     P | New  |
| مجموعات المحاضرات والمعامل | `/delivery-groups`       |       P |     P |                        P |                  P |              P |           explicit FK | New  |
| الإسناد التدريسي           | `/teaching-assignments`  |       P |     P |                        P |                  P |              P |                RPC V2 | New  |
| جاهزية البيانات            | `/data-readiness`        |       P |     P |                        P |                  P |              P |  aggregate/all errors | New  |
| إعدادات الجدولة            | `/scheduling-settings`   |       P |     P |                        P |                  P |              P |                     P | New  |
| إعدادات القيود             | `/constraint-settings`   |       P |     P |                        P |                  P |              P |                     P | New  |
| بناء الجدول                | `/schedule-builder`      |       P |     P |                        P |                  P |              P |      V2 workspace RPC | New  |
| الجدولة التلقائية          | `/auto-schedule`         |       P |     P |                        P |                  P |              P | readiness fail-closed | New  |
| نسخ الجدول                 | `/schedule-versions`     |       P |     P |                        P |                  P |              P |         lifecycle RPC | New  |
| فحص التعارضات              | `/conflict-checks`       |       P |     P |                        P |                  P |              P |                     P | New  |
| جودة الجدول                | `/schedule-quality`      |       P |     P |                        P |                  P |              P |                     P | New  |
| الجداول المنشورة           | `/published-schedules`   |       P |     P |                        P |                  P |              P |                     P | New  |
| التقارير                   | `/reports` + children    |       P |     P |                        P |                  P |              P | qualified/read models | New  |
| المستخدمون                 | `/users`                 |       P |     P | explicit super-admin 403 |                  P |              P |                     P | New  |
| الشعب القديمة              | `/sections`              |       P |     P |                        P |                  P |         hidden |              isolated | L    |
| عروض المقررات القديمة      | `/course-offerings`      |       P |     P |                        P |                  P |         hidden |              isolated | L    |

## Closure notes

- New Flow terminology is guarded statically; internal table/RPC/key names remain unchanged.
- `/auto-schedule` now fails closed while readiness is loading, unavailable, or has critical blockers, and links directly to `/data-readiness`.
- Large operational lists already use bounded queries or filtering where applicable; the audit found no new N+1 loop in the modified path.
- Live RPC/RLS verification for `super_admin`, `college_admin`, and `read_only` requires authenticated production accounts and is deferred to Cursor without production writes.
