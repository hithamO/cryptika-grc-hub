# What this build contains, what was left out, and why

Version 1.0 · 10 November 2026

## Built and tested

| Area | What works |
|---|---|
| Company profile | Name, sector, country, size, mission, vision, business and cyber objectives |
| Laws and regulations | Mandatory frameworks appear automatically from sector + country; others can be added or removed; mandatory ones cannot be removed |
| Business processes, committees | Register, edit, members |
| Policies | Clauses, each linked to the controls it satisfies; policy-level controls; approval chain; edit lock by step; publish notification to everyone; print view; new versions; registering an already-approved policy |
| Frameworks and control map | 27 frameworks, 7,064 controls, 37,705 links from the Phase 5 maps; search; control page with equivalents, map rows and the organisation's position; own frameworks imported from CSV with own mappings |
| Home | Visual overview: compliance rings, risk heat map, vulnerability and findings charts, work in motion |
| Control map explorer | Interactive web of frameworks → controls → own records; zoom, drag, expand a control's links, tie two controls together |
| Workflow | Approval chains per record type, steps by role, inbox, history, return with comment, notifications |
| Assets, threats, vulnerabilities | Registers; CSV asset import; Nessus CSV import that registers unknown hosts as assets and files findings into categories; threat suggestions by sector |
| Threat mapping and risk register | Threat → vulnerability category or single vulnerability; suggested risks; cyber and business risks; confirmation by the Risk Manager |
| Risk assessments | Selected risks, purpose, appetite; 5×5 scoring; four treatments; controls from frameworks in scope or own; effectiveness with suggestion; calculated residual; sign-off chain |
| Compliance position | Documentation and implementation % per framework; own / inherited / partial / gap; position on frameworks not yet adopted; CSV export |
| Gap assessments | Implementation controls only; suggested department and evidence guidance per control; requests to departments; file upload; valid / invalid with note; return loop |
| Audit | Question pool linked to controls (CSV import); programme built from the pool through the map; sessions; Yes / Partly / No / N/A; automatic and potential findings; corrective actions with verification |
| Reports | Printable management report; CSV exports |
| Administration | People, roles with module permissions and approval level, departments, settings, activity log |
| Platform | Create and suspend organisations, enter a workspace, regulatory rules |

## Left out of this build

| Item | Asked for in | Why it is not here | How it comes back |
|---|---|---|---|
| SLA timers, escalations, SLA dashboard | BRD E1-S6, E1-S7 | Approvals work without them; they need a scheduler and tuning with real usage | Scheduled job reading `workflow_instances.started_at`; one new screen |
| Email notifications | BRD E8-S2 | In-app notifications cover the loop; email needs an SMTP account and templates | Add a mail sender inside `notify()` |
| Calendar | BRD E8-S1 | Dates exist (review dates, due dates, sessions) but there is no aggregate view yet | One read-only screen over existing dates |
| "Implemented controls" catalogue | BRD 6.5 | Replaced by evidence on framework controls plus map inheritance, as described in the recordings | Not planned unless a customer needs it |
| Excel (.xlsx) upload | Recordings | Would require a spreadsheet parser dependency; CSV works today from Excel's "Save as" | Add a parser to the import routes |
| Qualys and other scanner formats; asset-management API | Recordings | One scanner format first | One mapping function per format in `risk.js` |
| Scanning a policy PDF (OCR) and AI checking of clause-to-control links | Recordings (explicitly a future release) | The recording itself defers it; the author is accountable for the links | Later release |
| Adding own controls inside a library framework (e.g. an extra ISO control) | Recordings | Would mix tenant rows into shared frameworks; own frameworks with own mappings give the same result safely | Tenant column on `controls` |
| Arabic interface | BRD ("English first, Arabic later") | All text is in the client files, ready to translate | Translation table + right-to-left stylesheet |
| Single sign-on, API keys, per-tenant branding | BRD Phase 2 | Phase 2 in the BRD itself | When a customer requires them |
| Password reset by email, multi-factor sign-in | — | Depends on email | With email |
| Audit report builder, sampling, timesheets | Replit build | Not in the recordings | On request |
| Trend charts and history of scores | BRD Phase 2 | Needs periodic snapshots | Nightly snapshot table |
| Replacing the control library without resetting data | — | Control ids would need to be matched between versions | Loader that matches on framework + control ID |
| PostgreSQL, running several server copies | BRD NFRs | Not needed for a pilot; see ARCHITECTURE.md §11 | Driver swap in `server/db/index.js` |

## What exists in the product that the competitor demo did not show

Stated in the recordings as the differentiators, and built:

1. Cross-framework inheritance through the unified map, including a starting position on frameworks not yet adopted.
2. Residual risk calculated from rated control effectiveness instead of being typed in.
3. Documentation compliance derived automatically from policy clauses.

## ملخص بالعربية

**ما الذي بُني:** الموديولات الخمسة كما شُرحت في التسجيلات — الحوكمة (ملف الشركة، القوانين والأنظمة الإلزامية حسب القطاع والبلد،
العمليات، اللجان، السياسات ببنودها المربوطة بالضوابط)، محرك سير الموافقات، المخاطر (الأصول، التهديدات، الثغرات مع استيراد Nessus،
ربط التهديدات، سجل المخاطر، تقييم المخاطر مع حساب المتبقي من فعالية الضوابط)، الامتثال (النسبة التلقائية للتشريع من السياسات
المنشورة، وتقييم الفجوات للتطبيق مع طلب الأدلة من الأقسام وحكم مسؤول الامتثال)، والتدقيق (بنك الأسئلة المربوط بالضوابط، برنامج
التدقيق، الملاحظات التلقائية والإجراءات التصحيحية)، مع التقارير وإدارة المستخدمين والصلاحيات وتعدد المستأجرين.

**قاعدة البيانات المرجعية:** خرائط Phase 5 (Task 8 و Task 9) محمّلة كما هي: 27 إطاراً، 7,064 ضابطاً، 37,705 علاقة ربط.

**ما الذي أُجِّل ولماذا:** مؤقتات الـSLA والتصعيد، البريد الإلكتروني، التقويم، رفع ملفات Excel مباشرة (CSV يعمل حالياً)، صيغ
الماسحات الأخرى، قراءة السياسات من PDF، الواجهة العربية، الدخول الموحد. كلها لا تمنع الدورة الأساسية من العمل، وطريقة إضافة كل
واحدة مذكورة في الجدول أعلاه.

**قرارات تحتاج تأكيد صاحب المنتج:** وزن الربط الجزئي (50% افتراضياً)، اعتبار كل ضابط له بُعدان (تشريع وتطبيق)، جمع فعالية
الضوابط المتعددة على الخطر الواحد، وقواعد الإلزام حسب القطاع والبلد (مجموعة أولية تحتاج مراجعة). التفاصيل في ARCHITECTURE.md القسم 10.
