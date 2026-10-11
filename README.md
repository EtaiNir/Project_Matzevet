# ממשק אינטרנטי לניהול נתוני תלמידים

ממשק React לניהול נתוני תלמידים ממשרד החינוך, מחליף מערכת Access קיימת.
מסמך האפיון המלא: [docs/project-spec.md](docs/project-spec.md).

## הרצה מקומית

```bash
npm install
cp .env.example .env   # מלא URL ו-anon key של Supabase
npm run dev
```

## סקריפטים
- `npm run dev` — שרת פיתוח (Vite)
- `npm run build` — בדיקת טיפוסים (tsc) + build לפרודקשן
- `npm run preview` — תצוגה מקדימה של ה-build
- `npm run lint` — ESLint

## מבנה
```
src/                   הפרונטאנד — המצבת, ומודול הבגרות ב-src/pages/bagrut/
supabase/migrations/   001 … 031 — אינדקס ב-docs/database.md
supabase/functions/    admin-users, bagrut-ai
scripts/               עדכון חודשי, קליטת גנים וסבבי בגרות
agent/                 סוכן העיבוד שרץ אצל סבא
docs/                  התיעוד — להתחיל ב-docs/README.md
```
המבנה המלא: [docs/architecture.md](docs/architecture.md).

## הקמה מאפס
[docs/setup-and-run.md](docs/setup-and-run.md) — מסד, מיגרציות
(`scripts/run_migrations.py`), טעינה, משתמש ראשון, פריסה ו-Edge Functions.

## מה מומש
**המצבת:** טבלה ראשית עם תצורות, בורר שדות, סינון מתקדם, מיון, כרטיס
תלמיד, זיהוי אחים, ייצוא לאקסל, עמודות משלי, טבלאות ייעודיות ושיתוף,
פיבוטים, קליטת גנים, וממשק מנהל. **מודול זכאות לבגרות:** תמונת מצב,
רשימות, בקרה לפי מקצוע, כרטיס תלמיד ומחזור התערבות עם AI. הכול RTL.
הפירוט: [docs/features.md](docs/features.md).
