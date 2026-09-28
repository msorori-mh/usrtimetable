# STAGING-E2E-RUNBOOK-02

## قرار المرحلة

هذا المسار ينشر **Worker تجريبيًا فقط** من رأس الفرع
`codex/staging-instructor-builder-20260928`. لا يدمج الفرع، ولا يطبق migrations، ولا
يعدل النسخ المنشورة. أي تطابق بين هوية Supabase التجريبية وهوية المشروع الموجودة في
`supabase/config.toml` يوقف المسار قبل البناء والنشر.

## الحماية

- التشغيل يدوي بإدخال `DEPLOY_STAGING_ONLY`، أو بإضافة وسم PR باسم
  `deploy-staging` إلى الفرع الرسمي نفسه.
- المهمة مرتبطة بـGitHub Environment باسم `staging`; يجب تفعيل required reviewers
  عليه قبل إضافة الأسرار.
- SHA المطلوب يجب أن يساوي رأس الفرع البعيد حرفيًا.
- اسم Worker يجب أن يحتوي `staging`، ورابط الاختبار لا يمكن أن يكون
  `gomufadhala.com`.
- مشروع Supabase التجريبي يجب أن يكون مشروعًا مختلفًا ومستقلًا؛ لا يقبل الحارس
  المشروع التشغيلي أو مفاتيح بأدوار مقلوبة.
- الاختبار في المتصفح مصادق عليه لكنه للقراءة فقط. إثباتات الكتابة والرفض تعمل على
  PostgreSQL مؤقت داخل CI.

## إعداد GitHub Environment

أنشئ Environment باسم `staging` ثم أضف:

| النوع    | الاسم                               | الغرض                                       |
| -------- | ----------------------------------- | ------------------------------------------- |
| Variable | `STAGING_WORKER_NAME`               | اسم مميز، مثل `usrtimetable-pr-344-staging` |
| Variable | `STAGING_BASE_URL`                  | اختياري إذا أعاد Wrangler رابط النشر        |
| Secret   | `CLOUDFLARE_ACCOUNT_ID`             | حساب Cloudflare المخصص للاختبار             |
| Secret   | `CLOUDFLARE_API_TOKEN`              | رمز محدود بنشر Worker التجريبي فقط          |
| Secret   | `STAGING_SUPABASE_URL`              | رابط مشروع Supabase التجريبي المستقل        |
| Secret   | `STAGING_SUPABASE_PROJECT_ID`       | مرجع المشروع التجريبي                       |
| Secret   | `STAGING_SUPABASE_PUBLISHABLE_KEY`  | المفتاح العام للمشروع التجريبي              |
| Secret   | `STAGING_SUPABASE_SERVICE_ROLE_KEY` | مفتاح الخدمة للمشروع التجريبي فقط           |
| Secret   | `STAGING_ADMIN_EMAIL`               | حساب آلي داخل قاعدة الاختبار                |
| Secret   | `STAGING_ADMIN_PASSWORD`            | كلمة مرور الحساب الآلي                      |

يجب أن يكون حساب الاختبار معزولًا وغير مستخدم في الإنتاج، وألا يطلب رمز MFA يدويًا
أثناء التشغيل الآلي. لا تُنسخ بيانات أشخاص أو جداول منشورة حقيقية إلى هذا المشروع.

## بوابات التنفيذ

1. مطابقة SHA مع رأس الفرع الرسمي.
2. فحص هوية Cloudflare وSupabase وإثبات العزل.
3. اختبارات قواعد الجدولة والبناء اليدوي للمحاضر.
4. اختبار PostgreSQL حقيقي لقاعدة المحاضر الواحد للنظري/العملي.
5. TypeScript وبناء Nitro/Cloudflare.
6. إعادة فحص ناتج Wrangler وربطه باسم Worker التجريبي.
7. النشر عبر Wrangler المثبت بإصدار محدد.
8. تسجيل دخول آلي وفحص صفحات بناء الجدول والإتاحة والسياسات دون كتابة.

## التشغيل

من Actions شغّل `deploy-staging` وحدد SHA كاملًا واكتب
`DEPLOY_STAGING_ONLY`. قبل دمج الـworkflow لأول مرة، يمكن تشغيله على PR الرسمي فقط
بإضافة وسم `deploy-staging` بعد موافقة مراجع GitHub Environment.

## الإيقاف والاستعادة

- عند فشل أي بوابة يتوقف المسار ولا يشغّل خطوات النشر اللاحقة.
- لا توجد migrations أو عملية تنظيف بيانات ضمن هذا workflow.
- rollback التطبيق يتم من Cloudflare بإعادة نشر الإصدار السابق للـWorker التجريبي أو
  حذفه؛ لا يمس ذلك الإنتاج.
- يحتفظ CI بصورة الصفحة عند فشل اختبار المتصفح.

## المرجع التقني

- Cloudflare: <https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/>
- Wrangler configuration: <https://developers.cloudflare.com/workers/wrangler/configuration/>
- Wrangler Action: <https://github.com/cloudflare/wrangler-action>
