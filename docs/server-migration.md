# מעבר לשרת — מה רץ איפה

## חלוקת האחריות

| רכיב | איפה הוא רץ | הערה |
|------|-------------|------|
| האתר (React) | **Netlify** | סטטי, זמין 24/7, לא תלוי במחשב שלך |
| מסד הנתונים | **Supabase** | ענן, כבר שם |
| ה-pipeline + קבצי המצב"ת | **מחשב מקומי → שרת** | ראה למטה |

ה-pipeline **לא יכול** לרוץ על Netlify: הוא רץ ~30 שניות עם pandas, קורא 6 קבצי CSV
וכותב שני קבצי אקסל של כמה MB. פונקציות Netlify הן JavaScript, נחתכות אחרי שניות
בודדות, ואין להן דיסק מתמיד.

## מה כבר הוכן למעבר

הקוד כבר נייד — אין צורך לערוך אותו כדי להעביר אותו:

1. **נתיבים יחסיים** — `config/merge_files.json` מכיל `../tables` במקום נתיב מוחלט.
   הם נפתרים מול תיקיית ה-pipeline, כך שהתיקייה יכולה לשבת בכל מקום בדיסק.
2. **`os.path.join` במקום backslash** — 19 חיבורי נתיבים הומרו. נקי יותר, וגם
   יעבוד על לינוקס אם יידרש בעתיד.
3. **דריסה דרך משתני סביבה** — בלי לגעת בקונפיג:
   - `MATZEVET_DICT_FOLDER` — תיקיית המילונים
   - `MATZEVET_DATA_FOLDER` — תיקיית קבצי המצב"ת
   - `MATZEVET_OUTPUT_FOLDER` — תיקיית הפלט
4. **פרטי DB בקובץ נפרד** — `.env.db` (לא בגיט), נטען אוטומטית ע"י `update_from_moe.py`.

## איך מעבירים לשרת

**השרת של אייל הוא Windows**, כמו מחשב הפיתוח — לכן המעבר הוא כמעט
העתק-הדבק, בלי התאמות מערכת הפעלה.

```powershell
# 1. להעתיק לשרת:
#      Itay_Modules\                (ה-pipeline + המילונים)
#      student-dashboard\scripts\   (update_from_moe.py, load_main.py)
#      student-dashboard\.env.db    (פרטי החיבור ל-DB)

# 2. תלויות
pip install pandas numpy openpyxl psycopg2-binary requests

# 3. אם מבנה התיקיות שונה — לדרוס בלי לערוך קונפיג
$env:MATZEVET_DATA_FOLDER = "D:\matzevet\incoming"

# 4. הרצה
python scripts\update_from_moe.py --code 1400000
```

`.env.db` נטען אוטומטית, כך שאין צורך להגדיר `PGHOST`/`PGPASSWORD` בכל הרצה.

### אוטומציה חודשית — Task Scheduler

```powershell
$action = New-ScheduledTaskAction -Execute "python" `
    -Argument "scripts\update_from_moe.py --code 1400000" `
    -WorkingDirectory "D:\matzevet\student-dashboard"
$trigger = New-ScheduledTaskTrigger -Weekly -DaysOfWeek Sunday -At 6am
Register-ScheduledTask -TaskName "עדכון מצבת חודשי" -Action $action -Trigger $trigger
```

> קבצי המצב"ת החדשים צריכים להיות בתיקיית הקלט לפני ההרצה. אם משרד החינוך
> מפיץ אותם ידנית — השלב הזה נשאר ידני; הסקריפט אינו מוריד אותם.

## אם בעתיד עוברים ללינוקס

רלוונטי **רק** אם השרת יהיה לינוקס:

- **tkinter** — כמה מודולים מייבאים אותו בראש הקובץ (שאריות מבורר קבצים ידני).
  על שרת בלי GUI צריך `python3-tk` מותקן, או להסיר את היבוא.
- **שמות תיקיות בעברית** — עובדים, אבל אפשר לשנות את `data_folder` בקונפיג
  לשם באנגלית אם זה מציק.

## ⚠️ מה לא לעשות

**לא להעלות את קבצי המצב"ת לגיט ולא להריץ את ה-pipeline ב-GitHub Actions.**
הקבצים מכילים תעודות זהות, כתובות וטלפונים של אלפי קטינים. הם חייבים להישאר
על מחשב או שרת בשליטתך. `.gitignore` של הפרויקט חוסם `.env` ו-`.env.db`, אבל
תיקיית `Itay_Modules` כולה אינה חלק מהריפו של האתר — וכך זה צריך להישאר.

---

# פריסת Edge Functions

| פונקציה | מה | סוד נדרש |
|---|---|---|
| `admin-users` | יצירת משתמש, סיסמה, השהיה ומחיקה (`service_role`) | — (מוגדר אוטומטית) |
| `bagrut-ai` | ניתוח AI לתלמיד בבגרות — מצב ותוכנית (מיגרציה 031) | `ANTHROPIC_API_KEY` |

ה-CLI של Supabase **לא עובד ברשת הזו** — נטספארק מיירט את ה-TLS והוא נכשל ב-
`TransportError`. הפריסה נעשית ישירות מול ה-Management API, ש-curl כן מצליח לפנות אליו.

הטוקן והמפתח יושבים מקומית ב-`.env.deploy` (`SUPABASE_ACCESS_TOKEN`,
`ANTHROPIC_API_KEY`) — בתיקייה הראשית, חסום ב-`.gitignore`.

```bash
TOKEN=<supabase-access-token>   # https://supabase.com/dashboard/account/tokens
REF=agcoeqshvkyopjjdvril
SLUG=admin-users                # או bagrut-ai

# metadata.json:  {"entrypoint_path":"index.ts","name":"<SLUG>","verify_jwt":true}

curl -X POST -H "Authorization: Bearer $TOKEN" \
  -F "metadata=@metadata.json;type=application/json" \
  -F "file=@supabase/functions/$SLUG/index.ts;type=application/typescript" \
  "https://api.supabase.com/v1/projects/$REF/functions/deploy?slug=$SLUG"
```

**סוד לפונקציה** (פעם אחת; לא נכנס לקוד ולא לגיט):

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '[{"name":"ANTHROPIC_API_KEY","value":"<key>"}]' \
  "https://api.supabase.com/v1/projects/$REF/secrets"
```

**שתי מלכודות שעלו בפריסה הראשונה:**

1. **`entrypoint_path` חובה.** ה-endpoint הישן (`POST /functions` עם `body` ב-JSON)
   מחזיר `ACTIVE` אבל הפונקציה נופלת ב-`BOOT_ERROR`, כי לא הוגדר entrypoint.
   יש להשתמש ב-`/functions/deploy` עם multipart.
2. **`jsr:` לא נתמך** בסביבת הריצה. להשתמש ב-
   `https://esm.sh/@supabase/supabase-js@2.45.0`.

---

# סוכן העיבוד

רץ 24/7 על מחשב נפרד ומזין את המערכת משני מקורות: העלאה מהאתר, ותיקייה
מקומית שאליה מגיעים קובצי משרד החינוך. פרטים מלאים:
[agent/README.md](../agent/README.md).

לפני כל עדכון הוא מגבה את הטבלה הקיימת לקובץ אקסל ב-`agent/backups/`,
12 גיבויים אחרונים לכל מועצה. הגיבויים מכילים תעודות זהות ולכן נשארים
על אותו מחשב בלבד — הם חסומים ב-`.gitignore` ואסור להעלות אותם לענן.
