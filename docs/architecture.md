# ארכיטקטורה — סקירה כללית

מסמך זה מתאר את המבנה הטכני של המערכת: המצבת (שלב א'), ומעליה מודול
זכאות לבגרות — המודול הראשון בפורטל ([החלטה 014](decisions/014-bagrut-module.md)).
המקור לדרישות: [project-spec.md](project-spec.md).

## תרשים זרימה כללי

```
קבצי מצב"ת (משרד החינוך, CSV)
        │
        ▼
  Pipeline פייתון (8 מודולים)  ← קוד קיים, לא נבנה כאן
        │  מפיק 2 קבצי אקסל: ראשי (~156 שדות) + תוספתים
        ▼
  update_from_moe.py → load_main.py
        │  מיפוי עברית→אנגלית, ניקוי, המרת סוגים
        ▼
  Supabase (PostgreSQL + Auth + RLS)   ← ענן, זמין תמיד
        │
        ▼
  אפליקציית React (הפרונטאנד)          ← Netlify, פריסה אוטומטית מגיטהאב
        │
        ▼
  משתמשים (עובדי מועצות ובתי ספר)
```

## שלוש השכבות

### 1. מסד הנתונים — Supabase (PostgreSQL)
- **טבלה נפרדת לכל רשות** (`students_{code}`, למשל `students_1400000`) — עיקרון "רשות = עולם".
- טבלת `users` משותפת + טבלת `authorities`.
- **RLS** (Row Level Security): כל משתמש רואה רק את הרשויות המשויכות אליו.
- **Auth**: כניסה במייל+סיסמה דרך Supabase Auth.
- פרטים מלאים: [database.md](database.md).

### 2. שכבת הטעינה — סקריפטים בפייתון
- ממירה את פלט ה-pipeline (כותרות בעברית) לעמודות ה-DB (אנגלית) וטוענת ל-Supabase.
- פרטים מלאים: [data-loading.md](data-loading.md).

### 3. הפרונטאנד — React + TypeScript
- **המצבת:** טבלה מרכזית אחת עם 5 תצורות, סינון, מיון, כרטיס תלמיד,
  וייצוא לאקסל; עמודות משלי, טבלאות ייעודיות ופיבוטים.
- **מודול הבגרות** (`/bagrut/:code/:school` — כל בית ספר בנפרד, [016](decisions/016-bagrut-per-school.md)):
  תמונת מצב, רשימת תלמידים, בקרה לפי מקצוע, כרטיס תלמיד עם לשונית המעקב,
  תוכנית בית הספר, וקליטת סבב. מתג "מצבת | זכאות לבגרות" בכותרת.
- RTL מלא, רספונסיבי.
- פרטים מלאים: [features.md](features.md).

## Technology Stack

| שכבה | טכנולוגיה |
|------|-----------|
| Frontend | React 18 + TypeScript + Vite |
| עיצוב | Tailwind CSS (RTL) |
| טבלה | flex + `@tanstack/react-virtual` (וירטואליזציה) |
| ניתוב | `react-router-dom` |
| מסד נתונים / אימות | Supabase (PostgreSQL + Auth) |
| ייצוא אקסל | כותב XLSX משלנו ([`lib/xlsx.ts`](../src/lib/xlsx.ts)), בלי תלויות — SheetJS הוסר ([007](decisions/007-client-side-features.md)) |
| גרפים (בגרות) | SVG משלנו, בלי ספרייה |
| לוגיקת שרת | Supabase Edge Functions (Deno) |
| AI | Claude — מיפוי שדות בגנים (בסוכן), ניתוח תלמיד בבגרות (Edge Function) |
| טעינת נתונים | Python (`pandas`, `psycopg2`, `requests`) |
| אירוח | Netlify (פריסה אוטומטית מגיטהאב — מהריפו `EtaiNir/Project_Matzevet`, [009](decisions/009-hosting-split.md)) |

## מבנה תיקיות

```
student-dashboard/
├── src/
│   ├── config/       fields.ts (כל השדות + תוויות), presets.ts (התצורות), site.ts (מותג)
│   ├── lib/          supabase.ts, students.ts, filters.ts, table.ts, xlsx.ts, exportExcel.ts,
│                     extraColumns.ts, savedViews.ts, computed.ts, bagrut.ts, bagrutCycle.ts
│   ├── context/      AuthContext.tsx (אימות + פרופיל משתמש)
│   ├── components/   StudentTable, StudentsRail, RailTopBar, FilterBar, FieldPicker, StudentCard,
│                     admin/ (לשוניות ממשק המנהל)
│   ├── pages/        Landing, About, Contact, Login, Dashboard, SavedViews, Pivot, Admin,
│                     ClientDetail, UpdateData, UpdateGanim
│   │   └── bagrut/   BagrutShell, BagrutHome, BagrutStudents, BagrutStudent, BagrutCycle,
│                     BagrutSubject, BagrutProgram, BagrutUpload
│   ├── App.tsx, main.tsx, index.css
├── supabase/
│   ├── migrations/   001 … 031 (+027b) — אינדקס ב-database.md
│   └── functions/    admin-users (ניהול משתמשים), bagrut-ai (ניתוח AI לתלמיד)
├── scripts/          update_from_moe.py, load_main.py, load_tier_b.py, load_bagrut.py,
│                     run_migrations.py, create_user.py
├── agent/            סוכן העיבוד שרץ אצל סבא — agent/README.md
└── docs/             התיעוד הזה
```

## עקרונות מנחים (מהאפיון)
- **RTL מלא**, כל הטקסט בעברית.
- **רשות = עולם** — הפרדת נתונים מלאה ברמת ה-DB.
- **הכל ואז מצמצמים** — הטבלה נפתחת עם כל התלמידים, ומשם מסננים.
- **ייצוא לאקסל = הדוח היחיד** בשלב א'.
- **תא ריק במקור = ריק באתר** — לא ממציאים ערכים.
- **לא מסננים תלמידים בעיבוד** — טוענים הכל, מסמנים במצב רישום, ומסננים בתצוגה.

## זרימת העדכון החודשי

```
משתמש באתר                Supabase                 מחשב הסוכן
──────────                ────────                 ──────────
מעלה 6 קבצים ──────────►  Storage
                          moe_uploads = ממתין
                                 ▲
                                 │ בדיקה כל 5 שניות
                                 └──────────────────  הסוכן
                                                        │
                                          מוריד ← מריץ pipeline
                                          ← מגבה ← טוען
                                                        │
                          students_{code} ◄────────────┘
```

הסוכן **פונה החוצה בלבד** — אין פורט פתוח ואין דרך להגיע אליו מבחוץ.

## מה רץ איפה

| רכיב | מיקום |
|------|-------|
| האתר | Netlify — זמין 24/7, לא תלוי במחשב |
| מסד הנתונים | Supabase |
| ה-pipeline + הסוכן | מחשב של סבא ([agent/README.md](../agent/README.md)) |
| ניהול משתמשים | Supabase Edge Function (`admin-users`) |
| ניתוח AI לתלמיד בבגרות | Supabase Edge Function (`bagrut-ai`) — קוראת בהרשאות המורה, שולחת ל-Claude בלי שם ובלי ת"ז. סוד: `ANTHROPIC_API_KEY` |
| קליטת גנים (דרג ב') וסבבי בגרות | הסוכן — אותו תור-ועיבוד כמו המצב"ת |

ה-pipeline **אינו יכול** לרוץ ב-Netlify: pandas, ~30 שניות, וכתיבת קבצי אקסל.
