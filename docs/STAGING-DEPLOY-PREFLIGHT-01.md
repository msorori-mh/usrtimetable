# STAGING-DEPLOY-PREFLIGHT-01

## القرار

- **مرشح المصدر: PASS.**
- **الدفع إلى GitHub: AUTHORIZED.** وصلة GitHub الرسمية للحساب `tarasana-mufadhala` تملك صلاحية `push` على المستودع؛ يبقى الدفع محصورًا في الفرع المعزول ولا يتضمن دمجًا.
- **النشر إلى staging: BLOCKED.** لا توجد في المستودع هوية بيئة Cloudflare تجريبية معتمدة (account/worker/route)، ولا أسرار وصول متاحة. الحزمة المولدة تقترح الاسم العام `tanstack-start-ts` فقط، ولذلك يمنع التشغيل المغلق تنفيذ `wrangler deploy` إلى هدف غير معلوم.
- **الإنتاج: خارج النطاق.** لم تُعدّل بيانات الإنتاج أو النسخ المنشورة ولم تُطبّق migrations في هذه المرحلة.

## خط الأساس والعزل

| البند | القيمة |
| --- | --- |
| المستودع الرسمي | `https://github.com/msorori-mh/usrtimetable.git` |
| `origin/main` عند بدء المرحلة | `80f483e1e33ff08429311ae9cc881e0b37f61ca5` |
| حالة CI لذلك الالتزام | `runtime-gates`, PostgreSQL proof, وbackup/restore: PASS |
| اللقطة المحلية القديمة | `635594ccad22940b151494f6a63463f28867a502`، orphan بلا merge-base مع `origin/main` |
| الفرع المعزول | `codex/staging-instructor-builder-20260928` |
| worktree | `/workspace/scratch/31a5a755f704/staging-candidate-usrtimetable` |

لم يُنفذ merge بين التاريخين غير المرتبطين. أُنشئ الفرع المعزول من `origin/main`، ثم طُبّق فرق العمل المقبول فقط. بقيت ملفات cutover الحديثة ومهاجرات `20260928080000` إلى `20260928100000` واختباراتها موجودة.

## أدلة القبول على المرشح المعزول

| البوابة | النتيجة |
| --- | --- |
| `git diff --check` | PASS |
| `tsc --noEmit` | PASS |
| Harness | 76 نجاحًا، 0 فشل، 0 مفقود |
| Harness runner | 4 نجاحات، 0 فشل |
| عقود الخوارزمية | 124 نجاحًا، 0 فشل |
| الإتاحة/قاعدة المحاضر/لوحة القيادة | 81 نجاحًا، 0 فشل |
| السياسات وITCS cutover | 56 نجاحًا في 10 ملفات، 0 فشل |
| ESLint للنطاق المتغير | 0 خطأ، 3 تحذيرات Fast Refresh غير حاجبة |
| بناء Vite + SSR + Nitro/Cloudflare | PASS |

عولج أثناء البوابة اعتماد اختبار `instructor-type-hydration` على `import.meta.dir` الخاص بـBun، واستُبدل بمسار قياسي مبني على `import.meta.url`؛ ثم أعيد الاختبار ونجح.

## مسار النشر المكتشف

- البناء يستخدم Nitro preset: `cloudflare-module`.
- ناتج البناء صالح تقنيًا لـWrangler.
- لا يوجد `wrangler.toml`/`wrangler.jsonc` معتمد في المصدر يحدد حساب staging أو اسم Worker مميزًا أو route تجريبيًا.
- لا يوجد workflow نشر في `.github/workflows`; الموجود بوابات CI فقط.
- مصادقة Git عبر الطرفية غير متاحة، لكن وصلة GitHub الرسمية تملك صلاحية الدفع. لم تُكتشف بيانات اعتماد Cloudflare أو بيئة staging معتمدة.

تشغيل أمر النشر من المخرجات الحالية قد ينشئ/يستبدل Worker بالاسم العام في حساب غير مثبت؛ لذلك هو ممنوع حتى تُعرّف بيئة staging صراحة.

## ضوابط قاعدة البيانات

- migrations الجديدة موجودة في المرشح كمصدر حقيقة، لكنها لم تُطبّق هنا.
- migrations الإصلاحية `20260928030000` و`20260928040000` مرتبطة بخط أساس بيانات محدد وتفشل مغلقة عند اختلافه.
- أي staging لقاعدة البيانات يجب أن يكون restore/clone مع ledger migrations مطابق، أو يخضع لخطة baseline مستقلة؛ لا يجوز تشغيل سلسلة migrations عمياء على قاعدة فارغة أو على الإنتاج.

## بوابة الانتقال التالية

يلزم قبل النشر التجريبي:

1. تثبيت هوية Cloudflare staging: account، Worker مخصص، route/domain تجريبي، والأسرار داخل GitHub Environment محمي.
2. اعتماد workflow نشر staging مقيدًا بالفرع وبـSHA، دون migrations أو إنتاج.
3. دفع الفرع المعزول ونجاح CI على SHA نفسه.
4. نشر الحزمة إلى staging فقط، ثم تشغيل E2E مصادق عليه على مسودة `TEST_ONLY` وتنظيفها بدقة.

لا يصبح الإنتاج مسموحًا تلقائيًا بعد نجاح staging؛ يحتاج بوابة وتفويضًا منفصلين.
