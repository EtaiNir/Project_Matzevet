# CLAUDE.md

## מה הפרויקט הזה

ממשק אינטרנטי לניהול נתוני תלמידים ממשרד החינוך, מיועד למועצות אזוריות בישראל. מחליף מערכת Access קיימת.

**מסמך האפיון המלא נמצא ב-`docs/project-spec.md` — תקרא אותו לפני שאתה מתחיל לעבוד על כל משימה.**

## Tech Stack

- **Frontend:** React + Tailwind CSS
- **Database:** Supabase (PostgreSQL)
- **Auth:** Supabase Auth (מייל + סיסמה)
- **Hosting:** Netlify — https://moonlit-macaron-430f54.netlify.app
  בחשבון של **איתי**, מושך מ-`EtaiNir/Project_Matzevet`.
  הכתובת הישנה (`astounding-pudding-d07e8f`) הושבתה.
- **Export:** כותב XLSX משלנו ([`lib/xlsx.ts`](src/lib/xlsx.ts)) — בלי
  תלויות. SheetJS הוסר: הגרסה החינמית אינה כותבת עיצוב, ו-`npm install`
  נכשל ברשת הזו ב-`SELF_SIGNED_CERT_IN_CHAIN`
- **Language:** TypeScript

## כללים קריטיים

- **RTL מלא** — כל הממשק בעברית, direction: rtl, יישור לימין
- **כתוב עברית ישירות בקוד** — לא Unicode escapes, לא משתנים באנגלית לטקסטים בעברית
- **רשות = עולם** — כל רשות מקומית רואה רק את הנתונים שלה. טבלה נפרדת לכל רשות ב-Supabase
- **הכל ואז מצמצמים** — הטבלה נפתחת עם כל התלמידים, המשתמש מסנן משם
- **ייצוא לאקסל = הדוח היחיד** — אין מחולל דוחות, המשתמש בונה תמהיל שדות ומייצא
- **תא ריק במקור נשאר ריק באתר** — לא ממציאים ערכים, לא ממלאים ברירות מחדל
- **לא מסננים תלמידים בעיבוד** — טוענים הכל ומסמנים; הסינון קורה בתצוגה.
  סבא: *"עדיף להשאיר תלמיד במערכת מאשר למחוק אותו"*

## ⚠️ שני ריפואים — לדחוף לשניהם

```
NightKing1234/student-dashboard   ← מקור האמת. כאן עובדים
EtaiNir/Project_Matzevet          ← מראה. רק ממנו Netlify בונה
```

הפיצול קיים כי ה-Netlify של איתי לא הצליח לראות ריפו של חשבון אחר.
`origin` מוגדר עם **שני push URLs**, כך ש-`git push` אחד מגיע לשניהם:

```bash
git remote -v      # חייבות להופיע שתי שורות (push) תחת origin
```

**אם יש רק אחת — האתר החי יפגר אחרי הקוד בשקט.** אין שגיאה, הבנייה
פשוט לא רצה. ראה [decisions/009](docs/decisions/009-hosting-split.md).

## 🔒 פרטיות — הכלל שגובר על הכל

הנתונים כוללים **תעודות זהות, כתובות וטלפונים של אלפי קטינים**.

- **קבצי מצב"ת לעולם לא עולים לגיט** ולא ל-GitHub Actions. הריפו כולל את
  `student-dashboard/` בלבד; `Itay_Modules/` נשאר מקומי.
- `.env` ו-`.env.db` ב-`.gitignore` — לעולם לא לכתוב סוד בקוד או בתיעוד.
- באתר: כותרת `X-Robots-Tag: noindex` ב-`netlify.toml`.
- רק ה-**anon key** נכנס לפרונטאנד. `service_role` משמש סקריפטים בלבד.

## הרשאות — שלוש שכבות

| שכבה | קובע |
|-------|------|
| `role` | מה מותר לעשות (`viewer` / `admin` / `super_admin`) |
| `scope_level` + `scope_values` | **אילו תלמידים** נראים (מועצתי / יישובי / בית-ספרי) |
| `is_suspended` | חוסם הכול — גם טוקן שכבר הונפק |

**הכול נאכף ב-RLS, לא בתצוגה.** מנהל-על עובר את `has_authority` לכל רשות;
משתמש רגיל מוגבל ל-`authority_codes` שלו. פרטים: [decisions/004](docs/decisions/004-admin-interface-and-agent.md).

פירוט מלא (תוויות תצוגה, העלאת מצב"ת, `service_role`, מנהל-העל האחרון,
`admin_audit`): [supabase/CLAUDE.md](supabase/CLAUDE.md).

## מלכודת שחוצה שכבות

3. **`CODE_STATUS_RISHUM_TA` בטבלה אינו סטטוס הרישום** — המילון ממפה אליו
   את `תקינות שיבוץ`. סטטוס הרישום האמיתי הוא `MATZAV_RISHUM_CODE/TEUR`.

## מפתח המלכודות

33 מלכודות מתועדות. כל אחת יושבת ב-`CLAUDE.md` של האזור שבו היא קורית,
ו-Claude Code טוען אותו אוטומטית כשעובדים על קבצים באותה תיקייה.

| קובץ | מלכודות | נושא |
|------|---------|------|
| [src/CLAUDE.md](src/CLAUDE.md) | 4, 7, 14, 15, 17, 18, 19, 23, 26, 31 | ממשק, משתני סביבה, שגיאות, state |
| [supabase/CLAUDE.md](supabase/CLAUDE.md) | 8, 16, 20, 21, 22, 24, 25, 28 | RLS, מיגרציות, Edge Functions, משתמשים |
| [scripts/CLAUDE.md](scripts/CLAUDE.md) (וגם `agent/`) | 1, 2, 5, 6, 9–13, 27, 29, 30, 32, 33 | pipeline, טעינה, הסוכן, מיפוי AI |
| הקובץ הזה | 3 | משמעות שדות |

**מלכודת חדשה** — המספר הפנוי הבא (34 ואילך), בקובץ של האזור שלה, ושורה
בטבלה הזו. אם היא חוצה אזורים — כאן.

## מבנה תיקיות

```
src/                         — הפרונטאנד (React)            ← src/CLAUDE.md
supabase/                    — מיגרציות ו-Edge Functions     ← supabase/CLAUDE.md
scripts/                     — טעינה ל-Supabase, עדכון חודשי ← scripts/CLAUDE.md
agent/                       — סוכן העיבוד שרץ אצל סבא       ← agent/CLAUDE.md
docs/                        — תיעוד פרויקט (Obsidian vault)
docs/project-spec.md         — מסמך אפיון מלא (המקור האמיתי)
docs/decisions/              — החלטות שמתקבלות תוך כדי פיתוח
docs/meetings/               — סיכומי פגישות
```

## כשמתלבט

- תקרא שוב את `docs/project-spec.md`
- אם ההחלטה לא מכוסה שם, תשאל אותי
- אם עשית החלטה טכנית משמעותית, תכתוב אותה בקובץ חדש ב-`docs/decisions/`
