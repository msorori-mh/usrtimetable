# تجاوزات الاعتماديات وسلسلة التوريد (M-29)

يجب أن يكون لكل سطر في `package.json` → `overrides` سبب موثّق هنا وشرط لإزالته. أي تجاوز جديد
يُضاف إلى هذا الجدول في نفس الـ PR. التدقيق الأسبوعي `.github/workflows/dependency-audit.yml`
يفشل عند وجود ثغرات `high` أو `critical`، وDependabot (`.github/dependabot.yml`) يقترح التحديثات أسبوعيًا.

## overrides

| الحزمة | النسخة المفروضة | السبب | متى يُزال |
| --- | --- | --- | --- |
| `seroval` | `1.6.8` | ثغرة **حرجة** GHSA-mv8w-475r-vwqw في نسخ seroval الأقدم التي تسحبها `@tanstack/react-router` / `@tanstack/react-start` (تسلسل/فك تسلسل حالة SSR). | عندما تعتمد نسخ TanStack المثبتة مباشرة على seroval ≥ 1.6.8. |
| `undici` | `7.29.0` | إصلاحات أمنية في عميل HTTP الذي تستخدمه أدوات البناء/nitro (تسريب ترويسات عند إعادة التوجيه واستهلاك موارد). | عند ترقية nitro/miniflare إلى نسخة تعتمد على undici ≥ 7.29. |
| `minimatch` | `10.2.3` | ثغرة ReDoS في نسخ minimatch الأقدم التي تسحبها أدوات lint/build. | عندما لا يطلب أي اعتماد نسخة أقدم (`bun pm why minimatch`). |
| `js-yaml` | `4.3.0` | ثغرة prototype pollution في `merge` (`<<`) في نسخ js-yaml الأقدم (أدوات ESLint/البناء). | عند خلو الشجرة من js-yaml < 4.3. |
| `postcss` | `8.5.18` | إصلاح تحليل CSS (line-return parsing) في نسخ postcss الأقدم ضمن Tailwind/Vite. | عند ترقية Vite/Tailwind لنسخ تطلبه أصلًا. |
| `esbuild` | `0.28.1` | خادم التطوير في esbuild < 0.25 يسمح لأي موقع بقراءة الردود (GHSA-67mh-4wv8-2f99)؛ ونسخة موحدة لكل الأدوات. | عند اعتماد Vite المثبت على esbuild ≥ 0.28. |
| `@babel/core` | `7.29.7` | ثغرات ReDoS في مساعدات Babel الأقدم المستخدمة في `@vitejs/plugin-react`. | عند ترقية plugin-react. |

> ملاحظة: لم يُوثَّق سبب التجاوزات عند إضافتها. سببا seroval وesbuild مؤكدان؛ أسباب undici وminimatch
> وjs-yaml وpostcss و@babel/core أعلاه **مستنتجة** من الاستشارات المعروفة لتلك الحزم ولم تُتحقق
> (لا وصول للشبكة عند الكتابة). أول من يشغّل `bun audit` بعد إزالة أي سطر مؤقتًا يجب أن يكتب معرف
> الاستشارة الفعلي هنا أو يزيل التجاوز إن لم يعد لازمًا.

## تثبيتات مقصودة (ليست overrides)

- **`nitro` = `3.0.260603-beta`** (devDependency): خادم البناء المستخدم مباشرة في `vite.config.ts`
  (`nitro/vite`، preset `cloudflare_module`). مثبّت على نسخة beta محددة لأن سلسلة 3.x لم تصدر مستقرة
  بعد ولأن شكل `.output/server/wrangler.json` الذي يتحقق منه `deploy-preflight.mjs` مختبر معها.
  الانتقال إلى المستقر: عند صدور `nitro@3.0.0` — يُختبر بـ `bun run build` (وفحص `wrangler.json`)
  ثم نشر staging (`deploy-staging.yml`) قبل الإنتاج. Dependabot يتجاهل nitro عمدًا.
- **`xlsx` → `npm:@e965/xlsx@0.20.3`**: حزمة SheetJS على npm متوقفة عند 0.18.5 وفيها ثغرتان
  (prototype pollution وReDoS، مصححتان في 0.19.3/0.20.2) لأن SheetJS تنشر النسخ الأحدث على CDN
  خاص بها فقط. `@e965/xlsx` نسخة مطابقة منشورة على npm للنسخة 0.20.3 تبقي `import "xlsx"` كما هو.
  الخطر: ناشر طرف ثالث — قارن tarball مع `https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz`
  عند أي ترقية، أو انتقل إلى رابط CDN الرسمي مباشرة.
- `minimumReleaseAgeExcludes` في `bunfig.toml` فارغة: أُزيلت `@lovable.dev/vite-tanstack-config`
  من المشروع (الخروج من Lovable) واستُبدلت بإعداد Vite صريح.

## مدخلات القفل من سجل Lovable الخاص (تاريخي — يُزال بإعادة توليد القفل)

`bun.lock` يحتوي **133** مدخلًا تُحلّ إلى مرآة npm خاصة بـ Lovable
(`https://europe-west1-npm.pkg.dev/lovable-core-prod/sandbox-npm-cache/…` و`europe-west4`)، لـ 123
حزمة (أبرزها `@tanstack/*` و`@supabase/*` و`@oxc-parser/*` و`@rolldown/*` و`vitest`). المعنى:

- داخل بيئة Lovable تعمل هذه الروابط. خارجها (CI على GitHub أو جهاز مطور) قد يفشل
  `bun install --frozen-lockfile` إن كانت المرآة تتطلب مصادقة أو غير متاحة للعامة.
- 122 منها تحمل `sha512` integrity، فالمحتوى المثبت مطابق لما في القفل أيًا كان المصدر؛
  11 مدخلًا بلا integrity في القفل — هذه أضعف نقطة ويجب إعادة حلها من سجل npm العام.
- العلاج المعتمد (قرار الخروج من Lovable): من بيئة لها وصول إلى `registry.npmjs.org` شغّل
  `scripts/exit-lovable/regenerate-lockfile.sh` (ينقل القفل القديم جانبًا، يثبّت من السجل العام، يتحقق
  من عدم بقاء `lovable-core-prod` أو أي حزمة `@lovable.dev`، ثم يبني)، راجع الفرق، وافتح PR مستقلًا.
  **حتى ذلك الحين يفشل `bun install --frozen-lockfile`** لأن `package.json` لم يعد يطابق القفل.
- `dependency-audit.yml` يطلق تحذيرًا أسبوعيًا ما دامت مدخلات من مرآة خاصة باقية، و
  `tests/no-lovable-coupling.test.mjs` يطبع تحذيرًا بالعدد.

## أدوات الاختبار المثبتة في CI (خارج package.json)

| الأداة | النسخة | أين |
| --- | --- | --- |
| Bun | `1.4.2` | كل الـ workflows (`bun-version`) |
| `@electric-sql/pglite` | `0.3.14` (موحّدة؛ كانت 0.5.8 في workflowين) | اختبارات PGlite |
| `jsdom` | `26.1.0` | `password-onboarding.yml`, `pr-gate.yml` |
| `@playwright/test` | `1.63.0` | تقارير الطباعة وstaging smoke |
| `pymupdf` | `1.24.10` | `repeated-report-header.yml` |
| wrangler | `4.136.3` | `deploy-staging.yml` |

## تثبيت GitHub Actions

`actions/checkout` و`oven-sh/setup-bun` و`actions/upload-artifact` و`cloudflare/wrangler-action`
مثبتة بـ SHA كامل مع تعليق `# vX` (نفس SHAs المعتمدة سابقًا في `deploy-staging.yml`).
`actions/setup-node@v4` ما زال بالوسم لأنه لا يوجد SHA موثّق له في المستودع ولا وصول للشبكة عند
التعديل؛ Dependabot (github-actions) سيقترح تثبيته. لا تقبل SHA دون التحقق من أنه وسم رسمي في
مستودع الـ action.
