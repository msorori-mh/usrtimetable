# أدلة الطباعة (print proof)

هذا المجلد يحمل مجموعة أدلة مسجّلة (PDF/PNG/XLSX بحجم ~33MB) أُنتجت بـ
`scripts/print-proof/run.py` و`run-shell.py` و`check-print-button.py`. الاختبارات
`tests/print-proof-harness.test.ts` و`tests/launch-closure-04-full-shell-print.test.ts`
و`tests/print-button-dispatch.test.ts` تقرأ ملفات `RESULTS.json` / `PRINT-BUTTON-DIAGNOSIS.json` هنا.

- **لا تُحذف** الملفات الحالية (التاريخ يحتفظ بها على أي حال، وحذفها يكسر الاختبارات أعلاه).
- السكربتات تكتب افتراضيًا إلى `proof-output/print-proof/` (مُتجاهَل في Git). لإعادة تسجيل
  الأدلة الملتزَم بها عمدًا: `PRINT_PROOF_OUT=docs/print-proof python3 scripts/print-proof/run.py`
  ثم `git add -f` للملفات المطلوبة فقط (قواعد `.gitignore` تمنع إضافة PDF/PNG/XLSX جديدة بالخطأ).
- مقترح: تفعيل Git LFS لهذا المجلد (الأسطر المعلّقة في `.gitattributes`) ضمن إعادة كتابة
  تاريخ منسّقة، أو نقل الأدلة الثنائية إلى artifacts الخاصة بـ CI بدل المستودع.

English: committed proof binaries stay (tests read their JSON summaries); new outputs default
to the ignored `proof-output/` folder. Consider Git LFS (see `.gitattributes`).
