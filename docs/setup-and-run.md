# הקמה והרצה — מאפס עד אתר עובד

מדריך שחזור: איך להקים את המערכת מאפס, כפי שנעשה בפועל.

## דרישות מוקדמות
- Node.js (npm)
- Python 3 עם `pandas`, `openpyxl`, `psycopg2-binary`, `requests`
- חשבון Supabase (פרויקט קיים)

## שלב 1 — התקנת הפרונטאנד
```bash
cd student-dashboard
npm install
```
> אם ההתקנה נכשלת עם `SELF_SIGNED_CERT_IN_CHAIN` (יירוט SSL ברשת ארגונית):
> `npm config set strict-ssl false`, להתקין, ואז `npm config set strict-ssl true`.
> npm עדיין מאמת שלמות חבילות לפי checksum, אז זה בטוח יחסית.

## שלב 2 — הקמת מסד הנתונים
1. ליצור פרויקט Supabase ולהשיג: Project URL, publishable/anon key, secret key, וסיסמת DB.
2. להריץ את המיגרציות:
```bash
set PGHOST=aws-1-ap-southeast-2.pooler.supabase.com   # session pooler (IPv4)
set PGPORT=5432
set PGUSER=postgres.<project-ref>
set PGPASSWORD=<db-password>
set PGDATABASE=postgres
python scripts/run_migrations.py
```
זה יוצר את `users`, `authorities`, `students_1400000`, ה-RLS והטריגרים.

## שלב 3 — טעינת נתונים
```bash
python scripts/load_main.py --file "<path-to-main.xlsx>" --code 1400000
```
ראה פרטים ב-[data-loading.md](data-loading.md).

## שלב 4 — יצירת משתמש
```bash
set SUPABASE_URL=https://<project-ref>.supabase.co
set SUPABASE_SECRET=<secret-key>
python scripts/create_user.py --email you@example.com --password "..." --role admin --code 1400000 --display "שם"
```

## שלב 5 — הגדרת הפרונטאנד והרצה
צור קובץ `.env` בתיקיית `student-dashboard` (לפרונטאנד).
לסקריפטים בפייתון צור `.env.db` באותה תיקייה — `update_from_moe.py` טוען אותו
אוטומטית, כך שאין צורך להגדיר משתני סביבה ידנית בכל הרצה.

`.env`:
```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<publishable-or-anon-key>
```
ואז:
```bash
npm run dev
```
פתח **http://localhost:5173** והתחבר.

## שלב 6 — פריסה ל-Netlify
- `npm run build` מייצר את `dist/`.
- Netlify בונה אוטומטית בכל push ל-`EtaiNir/Project_Matzevet` — `origin` מוגדר
  עם שני push URLs, כך ש-`git push` אחד מגיע לשני הריפואים ([009](decisions/009-hosting-split.md)).
- שני משתני הסביבה (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`) מוגדרים
  בהגדרות ה-Site. שינוי בהם נכנס רק בבנייה הבאה.
- `netlify.toml` — redirect ל-SPA (`/* → /index.html`) וכותרת `X-Robots-Tag: noindex`.

## שלב 7 — Edge Functions
`admin-users` (ניהול משתמשים) ו-`bagrut-ai` (ניתוח AI בבגרות, דורשת את הסוד
`ANTHROPIC_API_KEY`). ה-CLI של Supabase לא עובד ברשת הזו — הפריסה והסודות
דרך ה-Management API: [server-migration.md](server-migration.md), "פריסת Edge Functions".

## תקלות נפוצות באתר

| התסמין | מה זה |
|--------|-------|
| `Unexpected token '<' ... is not valid JSON` בהעלאת מצב"ת | בקשה קיבלה HTML במקום JSON. אם ה-HTML **בלי** `<!doctype>` — פרוקסי או תוספת דפדפן חסמו אותה, לא האתר. תוספות VPN (Browsec, Windscribe) עושות זאת על העלאות גדולות. לכבות ב-`chrome://extensions` או לעבוד בחלון סתר. [decisions/006](decisions/006-upload-failures-and-vpn.md) |
| הכניסה נכשלת עם "פרטים שגויים" למרות סיסמה נכונה | מפתח סביבה קטוע ב-Netlify. `lib/diagnostics.ts` מציג את אורך המפתח במסך הכניסה |
| ההעלאה נרשמה אבל הסטטוס תקוע ב"ממתין" | הסוכן אינו רץ. לבדוק `agent.log` במחשב שבו הוא מותקן |

## מצב נוכחי (2026-10-11)
- Supabase: פרויקט `agcoeqshvkyopjjdvril`. 8 לקוחות — 5 רשויות עם מצבת
  (`students_{code}`, **165 עמודות**) ו-3 בתי ספר בבגרות בלבד. מיגרציות 001–031.
- משתמש: `eyal.yinnon@gmail.com` (מנהל-על).
- **האתר חי:** https://moonlit-macaron-430f54.netlify.app
  (Netlify של איתי, בונה מ-`EtaiNir/Project_Matzevet` —
  ראה [decisions/009](decisions/009-hosting-split.md))
- גיטהאב: ריפו פרטי `NightKing1234/student-dashboard`, פריסה אוטומטית בכל push.
- ה-pipeline: רץ מקומית, מוכן למעבר לשרת.
