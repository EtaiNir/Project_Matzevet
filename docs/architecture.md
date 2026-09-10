# ארכיטקטורה — סקירה כללית

מסמך זה מתאר את המבנה הטכני של המערכת כפי שנבנתה בשלב א'.
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
- טבלה מרכזית אחת עם 5 תצורות, סינון, מיון, כרטיס תלמיד, וייצוא לאקסל.
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
| ייצוא אקסל | SheetJS (`xlsx`) |
| טעינת נתונים | Python (`pandas`, `psycopg2`, `requests`) |
| אירוח | Netlify (פריסה אוטומטית מגיטהאב) |

## מבנה תיקיות

```
student-dashboard/
├── src/
│   ├── config/       fields.ts (כל השדות + תוויות), presets.ts (5 תצורות)
│   ├── lib/          supabase.ts, students.ts, filters.ts, table.ts, exportExcel.ts,
│                     extraColumns.ts (עמודות המשתמש), savedViews.ts (טבלאות ייעודיות)
│   ├── context/      AuthContext.tsx (אימות + פרופיל משתמש)
│   ├── components/   StudentTable, StudentsRail, RailTopBar, FilterBar, FieldPicker, StudentCard
│   ├── pages/        Login.tsx, Dashboard.tsx, SavedViews.tsx, Pivot.tsx, Admin.tsx
│   ├── App.tsx, main.tsx, index.css
├── supabase/migrations/   001 (users/authorities/RLS) … 020 (עמודות המשתמש וטבלאות ייעודיות)
├── scripts/          run_migrations.py, load_main.py, create_user.py, load_data.py
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

ה-pipeline **אינו יכול** לרוץ ב-Netlify: pandas, ~30 שניות, וכתיבת קבצי אקסל.
