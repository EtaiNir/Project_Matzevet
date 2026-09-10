# תיעוד הפרויקט

Vault תיעוד (Obsidian) לפרויקט ממשק ניהול נתוני תלמידים.

## מסמכים

| מסמך | תיאור |
|------|--------|
| [project-spec.md](project-spec.md) | **מסמך האפיון המלא** — מקור האמת לדרישות |
| [architecture.md](architecture.md) | סקירת הארכיטקטורה, שלוש השכבות, מבנה תיקיות |
| [database.md](database.md) | סכימת ה-DB, טבלאות, RLS, שדות מחושבים |
| [data-loading.md](data-loading.md) | טעינת נתונים מקבצי ה-pipeline ל-Supabase |
| [features.md](features.md) | מיפוי פיצ'רים של שלב א' לקוד |
| [setup-and-run.md](setup-and-run.md) | מדריך הקמה והרצה מאפס |
| [server-migration.md](server-migration.md) | מה רץ איפה, העברה לשרת, ופריסת Edge Functions |
| [../agent/README.md](../agent/README.md) | סוכן העיבוד — התקנה והפעלה |
| [tier-b-template.md](tier-b-template.md) | תבנית קובץ הקליטה לדרג ב' (גנים, לידה עד 3, קידום נוער, חינוך ביתי) |
| [extra-fields-design.md](extra-fields-design.md) | אפיון העמודות שהמשתמש מוסיף (טקסט/סימון) והמסכים הייעודיים |
| [dedup-review.md](dedup-review.md) | השוואת שני מנועי הדדופ, לקראת מעבר עם סבא |
| [dev-log.md](dev-log.md) | יומן פיתוח כרונולוגי |
| [decisions/](decisions/) | החלטות טכניות |
| [meetings/](meetings/) | סיכומי פגישות |

## התחלה מהירה
1. לקרוא את [architecture.md](architecture.md) להבנת המבנה.
2. לעקוב אחר [setup-and-run.md](setup-and-run.md) להקמה והרצה.
3. לעיין ב-[features.md](features.md) לראות מה מומש.

## סטטוס נוכחי

**שלב א' מומש, והמערכת חיה בענן.**

- 🌐 האתר: **https://moonlit-macaron-430f54.netlify.app**
  — דף בית ציבורי, אודות ופרטי קשר **לפני** הכניסה.
  רץ ב-Netlify של איתי ([009](decisions/009-hosting-split.md));
  היעד הוא סאב-דומיין תחת `meiryoffe.co.il`
- 🗄 Supabase: 5 רשויות · 20 מיגרציות · Edge Function לניהול משתמשים
- 🤖 סוכן עיבוד אוטומטי — העלאה באתר מפעילה עדכון בלי מגע יד
- 📁 סריקת תיקייה מקומית — קבצים שמגיעים למחשב מעובדים מעצמם
- 🔒 העלאת מצב"ת — מנהל רשות בלבד, נאכף ב-RLS
- 🔄 עדכון ידני (גיבוי בלבד): `python scripts/update_from_moe.py --code 1400000`

בפגישת 19.8 הודגמה כל השרשרת חי: סבא העלה בעצמו ששה קבצים והטבלה
התעדכנה, ומועצה חדשה (מטה יהודה) הוקמה מאפס תוך כדי השיחה.

מ-10.9.2026 המשתמש מוסיף **עמודות משלו** (טקסט ותיבות סימון) ובונה
**טבלאות ייעודיות** — תת-קבוצות קבועות עם עמודות ניהול משלהן. שתיהן
שורדות את העדכון החודשי בלי שום שינוי בסוכן. מסך התלמידים נבנה מחדש
סביב סרגל מסכים אנכי מימין.

ראה [dev-log.md](dev-log.md) לפרטים, ו-[decisions/](decisions/) להחלטות —
האחרונה היא [010](decisions/010-students-rail-and-pinning.md).

**הסיכון הפתוח הגדול ביותר:** מעבר שנת לימודים 26→27 — ביוני–יולי מגיעים
12 קבצים במקום 6, והסוכן עלול לדרוס שנה בשנייה.
