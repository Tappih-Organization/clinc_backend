# نظرة عامة على المشروع - ClinicPro/Tappih

## وصف المشروع
نظام إدارة عيادات طبية شامل مبني على تقنيات حديثة، يتضمن ميزات ذكاء اصطناعي لتحليل الأشعة والفحوصات الطبية.

---

## الموديولات الأساسية

### Backend (clinc_backend)
- **التقنيات**: Node.js, TypeScript, Express, MongoDB
- **الموديولات الأساسية**:
  - إدارة المرضى (Patients)
  - المواعيد (Appointments)
  - السجلات الطبية (Medical Records)
  - الفواتير والمدفوعات (Invoices & Payments)
  - الوصفات الطبية (Prescriptions)
  - المختبرات (Laboratory)
  - المخزون (Inventory)
  - الموظفين والأدوار (Users & Roles)
  - الأقسام (Departments)
  - العيادات (Clinics)

### Frontend (clinc_frontend)
- **التقنيات**: React, TypeScript, Vite, Tailwind CSS
- **المكونات**: واجهة مستخدم حديثة لإدارة جميع العمليات

---

## ميزات الذكاء الاصطناعي (AI)

### 1. تحليل الأشعة السينية (X-ray Analysis)
- **الموقع**: `clinc_backend/src/controllers/xrayAnalysisController.ts`
- **النموذج المستخدم**: Google Gemini AI
- **الوظيفة**: تحليل صور الأشعة السينية للأسنان
- **المخرجات**:
  - ملخص حالة الأسنان
  - تحديد المشاكل (رقم السن والمشكلة)
  - اقتراح الأدوية المناسبة
  - توصيات للتشخيص الإضافي

### 2. تحليل تقارير الفحوصات (AI Test Analysis)
- **الموقع**: `clinc_backend/src/controllers/aiTestAnalysisController.ts`
- **النموذج المستخدم**: Google Gemini AI
- **الوظيفة**: تحليل صور تقارير الفحوصات المخبرية (PDF/Image)
- **المخرجات**:
  - استخراج جميع المعاملات والقيم
  - تحديد النتائج غير الطبيعية
  - التفسير السريري
  - التوصيات الطبية

### 3. مقارنة تقارير الفحوصات (AI Test Comparison)
- **الموقع**: `clinc_backend/src/controllers/aiTestComparisonController.ts`
- **النموذج المستخدم**: Google Gemini AI
- **الوظيفة**: مقارنة عدة تقارير فحوصات لنفس المريض
- **المخرجات**:
  - تتبع التغييرات في القيم عبر الزمن
  - تحليل الاتجاهات
  - تقرير مقارن شامل

---

## النماذج (Models)
- `XrayAnalysis.ts` - تخزين تحليلات الأشعة
- `AITestAnalysis.ts` - تخزين تحليلات الفحوصات
- `AITestComparison.ts` - تخزين المقارنات

---

## API Endpoints
- `POST /api/xray-analysis` - تحليل الأشعة
- `POST /api/ai-test-analysis/analyze` - تحليل تقرير فحص
- `POST /api/ai-test-comparison/compare` - مقارنة التقارير

---

## التبعيات (Dependencies)
- `@google/genai` - Google Gemini AI SDK
- `multer` - رفع الملفات
- `pdf-parse` - معالجة ملفات PDF
