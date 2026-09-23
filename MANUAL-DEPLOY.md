# 🐙 النشر اليدوي على GitHub Pages (بدون أدوات إضافية)

إذا لم ترد استخدام السكريبت التلقائي `deploy-github.sh`، اتبع هذه الخطوات — تحتاج متصفحاً فقط بعد رفع الكود.

## الطريقة السريعة (من الموقع)

1. اذهب إلى: **https://github.com/new**
2. اسم المستودع: `usdt-lyd-scanner` (أو أي اسم)
3. اختر **Public** (ضروري لـ Pages المجانية) ← Create repository
4. في صفحة المستودع: **uploading an existing file** (رابط في الوسط)
5. اسحب **هذه الملفات فقط** إلى المربع:

```
docs/index.html
docs/data.json
docs/history.json
scripts/gh-scan.js
.github/workflows/scanner.yml
scanner.js
package.json
README.md
```

> ⚠️ انتبه: مجلد `.github` يبدأ بنقطة وقد لا يظهر في نافذة السحب على ويندوز — يمكنك إنشاؤه من واجهة GitHub لاحقاً (Add file → Create new file → اكتب `.github/workflows/scanner.yml` والصق المحتوى).

6. اضغط **Commit changes**

## تفعيل GitHub Pages

1. في المستودع: **Settings** ← **Pages** (من القائمة الجانبية)
2. تحت "Build and deployment":
   - Source: **Deploy from a branch**
   - Branch: **main** والمجلد: **/docs** ← Save

## تفعيل GitHub Actions (الماسح التلقائي)

1. **Settings** ← **Actions** ← **General**
2. تحت "Actions permissions": اختر **Allow all actions and reusable workflows** ← Save
3. اذهب لتبويب **Actions** في المستودع
4. إن كان السير معطلاً اضغط **Enable workflows**
5. لاختبار فوري: اختر **USDT/LYD Price Scanner** ← **Run workflow** ← **Run**

## النتيجة

- 🌐 رابط لوحتك: `https://USERNAME.github.io/usdt-lyd-scanner/`
- ⏱️ الماسح يعمل **كل دقيقة** تلقائياً ويحدّث الأسعار
- 🔔 التنبيهات تعمل في متصفحك كالمعتاد
- 💰 التكلفة: مجانية تماماً (Pages + Actions غير محدود للمستودعات العامة)

## ملاحظات

- المستودع العام ضروري لـ Pages المجانية؛ المستودع الخاص يحتاج خطة مدفوعة
- **المسح كل دقيقة**: Actions مجاني غير محدود للمستودعات العامة — الحساب التفصيلي في [docs/ACTIONS-COST.md](docs/ACTIONS-COST.md)
- لو أردت تقليل التكرار، عدّل `cron` في `.github/workflows/scanner.yml` (مثال كل 5 دقائق: `*/5 * * * *`)
- البيانات العامة (data.json) لا تحتوي أي معلومات شخصية — فقط الأسعار
