# טעינת נתונים — מקבצי ה-pipeline ל-Supabase

מסמך זה מתאר איך הנתונים עוברים מפלט ה-pipeline הפייתוני אל מסד הנתונים.

## העדכון החודשי — פקודה אחת

```bash
python scripts/update_from_moe.py --code 1400000
```

[`update_from_moe.py`](../scripts/update_from_moe.py) מבצע את כל השרשרת:

| שלב | פעולה |
|---|---|
| 0 | בודק משתני DB (נטענים מ-`.env.db`) — **לפני** הרצת ה-pipeline |
| 1 | מריץ את `Main_Module_6_files_using_JSON.py` (8 מודולים, ~30 שניות) |
| 2 | מאתר את הקובץ הראשי ומוודא שהוא **טרי** (`--max-age`, ברירת מחדל 120 דק') |
| 3 | מריץ `load_main.py` — `TRUNCATE` + טעינה, בטרנזקציה אחת |

אם ה-pipeline נכשל — **הסקריפט עוצר ו-Supabase לא נוגעים.**

**דגלים:** `--dry-run` (איתור בלבד) · `--skip-pipeline` (טעינה בלבד, לניסיון חוזר) ·
`--pipeline-only` · `--file <path>` · `--max-age <דקות>`

> קבצי האקסל נשמרים על הדיסק ונשארים שם. הסקריפט לא מוחק אותם.

## הקבצים שה-pipeline מפיק
תחת `Itay_Modules/tables/קבצי מידע משרד החינוך/`:
1. **הקובץ הראשי** — `1400000_Talmidim_...xlsx` (~157 עמודות, כותרות בעברית). זה שנטען בשלב א'.
2. **קובץ התוספתים** — `1400000_additional_fields_filled.xlsx`. מיועד לשלב ד' (טרם נטען).

## הבעיה שנפתרה: תרגום כותרות
הקובץ הראשי מגיע עם **כותרות בעברית** (access_name, למשל "שם משפחה"), כי במקור נועד ל-Access.
בטבלה ב-Supabase העמודות **באנגלית** (python_name, למשל `SHEM_MISHPACHA`), כי שמות עמודות
בעברית ב-Postgres בעייתיים. המיפוי נעשה דרך המילון של ה-pipeline:
`Itay_Modules/tables/columns_name_dictionary.xlsx` (עמודות `python_name` ↔ `access_name`).

## הסקריפט: `scripts/load_main.py`
מבצע, לפי הסדר:
1. **קריאה** של קובץ האקסל (`dtype=str`).
2. **מיפוי כותרות** עברית → python_name לפי המילון; השארת עמודות שקיימות בטבלה בלבד.
3. **מיפוי מועדף** לתוויות דו-משמעיות — למשל "שם מלא1" ממופה ל-`GOREM_KESHER_1_FULL_NAME`
   (ולא ל-`Family_Name`), כי זה השדה שה-UI מציג.
4. **שדה מחושב** — `KITA_MESHULEVET` = "מקבילה" עם מקף לפני הספרות (ט5 → ט-5).
5. **המרת סוגים** — עמודות תאריך/מספר; ערכים לא-תקינים → NULL.
6. **ניקוי ריקים** — מחרוזות ריקות, רווחים, ו-`NaN`/`none`/`null` → NULL.
7. **הסרת כפילויות** לפי תעודת זהות.
8. **הכנסה** — `TRUNCATE` ואז הכנסה בבאצ'ים (הטבלה נדרסת בכל עדכון חודשי).

### באג שתוקן: `NaN` בעמודות טקסט
`df.to_numpy()` המיר ערכי `None` (ריקים) חזרה ל-`float nan`, ו-psycopg2 כתב אותם כמחרוזת
`'NaN'` בעמודות טקסט. הפתרון: המרת כל `nan` חזרה ל-`None` לפני ההכנסה (`x != x` מזהה nan).
כך **תא ריק במקור נשאר ריק באתר**, בלי ערכים מזויפים.

## הרצה
```bash
pip install pandas openpyxl psycopg2-binary requests
set PGHOST=aws-1-ap-southeast-2.pooler.supabase.com
set PGPORT=5432
set PGUSER=postgres.agcoeqshvkyopjjdvril
set PGPASSWORD=<db-password>
set PGDATABASE=postgres
python scripts/load_main.py --file "<path-to-main.xlsx>" --code 1400000
```
> אם הקובץ פתוח ב-Excel הוא נעול — יש להעתיק אותו זמנית או לסגור את Excel לפני הטעינה.

## סקריפטים נוספים
- `scripts/run_migrations.py` — מריץ את כל קבצי ה-SQL מ-`supabase/migrations/` לפי סדר.
- `scripts/create_user.py` — יוצר משתמש ב-Auth ומשייך לרשות (דרך Admin API).
- `scripts/load_data.py` — גרסה חלופית שטוענת דרך REST API (עם service_role key).

## קליטת סבב בגרות — `scripts/load_bagrut.py`

סבב = בית ספר × מועד × שנה. הקלט: T1 ו-T2 מקובץ האקסס של סבא, והמצפן
מקובץ האקסל. [החלטה 014](decisions/014-bagrut-module.md).

```bash
python scripts/load_bagrut.py --accdb "<קובץ.accdb>" --compass "<מצפן.xlsx>" --authority 800037 --school 800037 --season קיץ --year 'תשפ"ו' --dry-run
```

- **`--dry-run` קודם, תמיד.** מפרק הכול ומדפיס ספירות בלבד (בלי שמות,
  ת"ז או ציונים): מקצועות שזוהו ושמם בעברית, בדיקת ציון×משקל=משוקלל,
  ציונים מעל 100, שאלונים יתומים. רק אם הכול תקין — להריץ בלי הדגל.
- **`--index`** טוען גם את אינדקס השאלונים הארצי (טבלה 3 באקסס).
- **הרשות חייבת להתקיים** — ליצור אותה קודם במסך הניהול.
- **קליטה חוזרת של אותו סבב** מוחקת אותו (cascade) וטוענת מחדש. המעקב
  של הצוות **לא נמחק** — הוא לפי בית ספר + ת"ז, לא לפי סבב.
- **קלט ריק → הסקריפט מסרב לפני המחיקה** (מלכודת 30).
- דורש `pyodbc` ואת Microsoft Access Driver (מותקן עם Office).

**פירוק T1 הוא לפי מיקום העמודות, לא לפי השם** — השמות נכתבו ביד ואינם
עקביים. הפירוט ב-[014 §3](decisions/014-bagrut-module.md).

## עדכון חודשי (התהליך העתידי)
1. להריץ את ה-pipeline הפייתוני על קבצי המצב"ת החדשים.
2. להריץ `load_main.py` — הוא עושה TRUNCATE וטוען מחדש את הטבלה הראשית.
3. הנתונים באתר מתעדכנים אוטומטית (האתר קורא ישירות מ-Supabase).
