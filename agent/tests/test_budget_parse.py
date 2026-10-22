"""
קליטת התקציב (scripts/load_budget.py) — זיהוי הדוח, המרות, הצלבה ומיתר.

סינתטי לגמרי, כמו שאר הבדיקות: דוחות EPR מזויפים ב-xlsx ו-ZIP מיתר מזויף
בתיקייה זמנית, והרצה ב---dry-run — בלי מסד ובלי קבצים אמיתיים של מנשה.
"""
import io
import json
import subprocess
import sys
import zipfile
from datetime import date

from _harness import AGENT_DIR, Checks, Sandbox

SCRIPTS = AGENT_DIR.parent / "scripts"
sys.path.insert(0, str(SCRIPTS))
import budget_fields as F   # noqa: E402
import load_budget as L     # noqa: E402

from openpyxl import Workbook  # noqa: E402

check = Checks("קליטת תקציב — EPR ומיתר")

CARD_HEADERS = ["כרטיס", "שם כרטיס", "תקציב הוצאות", "תקציב הכנסות", "תקציב תקופתי", "ביצוע", "",
                "שריון", "יתרה תקופתית", "יתרה", "דרישה", "יתרה אחרי דרישה"]
ACTION_HEADERS = ["כרטיס", "שם", "שנה", "תאריך ארוע", "תאריך פרעון", "מספר פקודה", "חשבון_נגדי",
                  "שם_חשבון_נגדי", "פרטים", "חובה", "זכות", "יתרה", "אסמכתא1", "אסמכתא2", "תמחיר1",
                  "תמחיר2", "מסמך", "התאמה"]


def xlsx(path, headers, rows):
    book = Workbook()
    sh = book.active
    sh.append(headers)
    for r in rows:
        sh.append(r)
    book.save(path)
    return path


def run(*args):
    proc = subprocess.run([sys.executable, str(SCRIPTS / "load_budget.py"), *args],
                          capture_output=True, text=True, encoding="utf-8", errors="replace")
    return proc


# ── 1. זיהוי סוג הדוח והצעת המיפוי ──────────────────────────────────
check("דוח כרטיסים מזוהה", F.detect_kind(CARD_HEADERS), "cards")
check("דוח פעולות מזוהה", F.detect_kind(ACTION_HEADERS), "actions")
check("כותרות זרות אינן מזוהות", F.detect_kind(["שם", "טלפון"]), None)
mapping, _ = F.propose("actions", ACTION_HEADERS)
check("'שם' הוא שם הכרטיס ו'שם_חשבון_נגדי' הוא הצד השני",
      (mapping["שם"], mapping["שם_חשבון_נגדי"]), ("card_name", "counter_name"))
check("תמחיר2 והתאמה לא מותאמים", (mapping["תמחיר2"], mapping["התאמה"]), (None, None))
check("אין שדות חובה חסרים", F.missing_required("actions", mapping), [])

# ── 2. המרות ─────────────────────────────────────────────────────────
check("מספר כרטיס מ-float", L.to_code(1311000920.0), "1311000920")
check("תאריך טקסט dd/mm/yy", L.to_date("16/10/25"), date(2025, 10, 16))
check("'0' אינו תאריך", L.to_date("0"), None)
check("תא ריק נשאר ריק — לא אפס", L.to_num(""), None)
check("מספר מיתר עם רווחים ונקודה מובילה", L.to_num("     .21"), 0.21)

# ── 3. הצלבה: ביצוע = Σ(זכות − חובה) של תנועות השנה ──────────────────
with Sandbox() as folder:
    cards = xlsx(folder / "cards.xlsx", CARD_HEADERS, [
        [1311000920, "הכנסה ממשרד החינוך", 0, 818000, 818000, 242333, None, 0, -575667, -575667, 0, -575667],
        [1811000110, "שכר", -1135000, 0, -1135000, -1000, None, 0, 1134000, 1134000, 0, 1134000],
    ])
    actions = xlsx(folder / "actions.xlsx", ACTION_HEADERS, [
        [1311000920, "הכנסה", 0, "0", "0", 0, 0, "", " יתרת פתיחה", 0, 0, 224104, "0", "0", 0, 0, 0, 0],
        [1311000920, "הכנסה", 2025, "16/10/25", "16/10/25", 1, 7400005000, "בנק", "שנה קודמת", 0, 26260, 1, "0", "0", 0, 0, 0, 0],
        [1311000920, "הכנסה", 2026, "12/04/26", "12/04/26", 2, 7400005000, "בנק", "א", 0, 25948, 1, "0", "0", 0, 0, 0, 0],
        [1311000920, "הכנסה", 2026, "29/06/26", "29/06/26", 3, 7400005000, "בנק", "ב", 0, 216385, 1, "0", "0", 0, 0, 0, 0],
        [1811000110, "שכר", 2026, "01/03/26", "01/03/26", 4, 0, "", "שכר", 1000, 0, 1, "0", "0", 0, 0, 0, 0],
    ])
    report = folder / "r.json"
    p = run("--code", "1400000", "--year", "2026", "--file", str(cards), "--file", str(actions),
            "--dry-run", "--report-json", str(report))
    r = json.loads(report.read_text(encoding="utf-8"))
    check("ריצה יבשה עוברת", p.returncode, 0)
    check("ההצלבה מתיישבת בשני הכרטיסים", (r["crosscheck"]["checked"], r["crosscheck"]["matched"]), (2, 2))
    check("יתרת הפתיחה מסומנת ולא נספרת", r["counts"]["transactions"], 5)

    # כרטיס שהביצוע שלו לא מתיישב — אזהרה, לא עצירה
    cards_bad = xlsx(folder / "cards_bad.xlsx", CARD_HEADERS, [
        [1311000920, "הכנסה", 0, 818000, 818000, 999, None, 0, 0, 0, 0, 0],
    ])
    p = run("--code", "1400000", "--year", "2026", "--file", str(cards_bad), "--file", str(actions),
            "--dry-run", "--report-json", str(report))
    r = json.loads(report.read_text(encoding="utf-8"))
    check("פער בהצלבה הוא אזהרה", (p.returncode, any(w["kind"] == "crosscheck" for w in r["warnings"])), (0, True))

    # ── 4. קלט ריק — סירוב לפני כל כתיבה (מלכודת 30) ──
    empty = xlsx(folder / "empty.xlsx", CARD_HEADERS, [])
    p = run("--code", "1400000", "--year", "2026", "--file", str(empty), "--dry-run",
            "--report-json", str(report))
    r = json.loads(report.read_text(encoding="utf-8"))
    check("קובץ כרטיסים ריק נדחה", (p.returncode != 0, bool(r["errors"])), (True, True))

# ── 5. מיתר: החשבונית מול הפירוט, לפי "הפרש לתשלום" ─────────────────
INVOICE = ("חודש חישוב,חודש תחולה,חשבות,סמל מוטב,שם מוטב,קוד נושא,תאור נושא,סך הכל מגיע,שולם,"
           "הפרש לתשלום,יתרת חוב,יתרת ביצוע החודש,הערות\n"
           "9/2026,09/2026,מטה,999,רשות,003,גנים,1000,0,1000,0,1000,\n"
           "9/2026,05/2026,מטה,999,רשות,003,גנים,2000,1950,50,0,50,\n"
           "9/2026,09/2026,התישבות,999,רשות,001,שכל,300,0,300,0,300,\n")
GARDENS = ("חודש חישוב,סמל מוטב,שם מוטב,סמל ישוב,שם ישוב,קוד נושא,חודש תחולה,עלות,סכום מחושב,"
           "סכום מחושב קודם,הפרש מחושב\n"
           "9/2026,999,רשות,1,א,003,09/2025,10,1000,0,1000\n"
           "9/2026,999,רשות,1,א,003,05/2026,10,2000,1950,50\n")
SACAL = ("חודש חישוב,סמל מוטב,שם מוטב,סמל מוסד,שם מוסד,מגמה,סכום מחושב,סכום מחושב קודם,הפרש מחושב\n"
         "9/2026,999,רשות,360123,מקיף,0094,300,0,300\n")
with Sandbox() as folder:
    zpath = folder / "meitar.zip"
    with zipfile.ZipFile(zpath, "w") as z:
        z.writestr("999_9_2026CHESHBONIT.csv", "﻿" + INVOICE)
        z.writestr("999_9_2026GY003EZ.csv", "﻿" + GARDENS)
        z.writestr("999_9_2026SACAL.csv", "﻿" + SACAL)
    parsed = L.parse_meitar_zip(zpath)
    check("חודש החישוב מהשם", parsed["calc_month"], date(2026, 9, 1))
    check("SACAL משויך לנושא 001", {r["topic_code"] for r in parsed["rows"] if r["source_file"] == "SACAL"}, {"001"})
    check("עמודה שאינה בליבה נשמרת ב-extra",
          next(r["extra"] for r in parsed["rows"] if r["source_file"] == "SACAL"), {"מגמה": "0094"})
    rc = L.reconcile_meitar(parsed)
    check("כל הנושאים מתיישבים לפי הפרש לתשלום", (rc["matched"], rc["total"]), (2, 2))

# ── 6. נושא מיתר לתנועה — המספר האחרון בטקסט שהוא נושא מוכר ─────────
KNOWN = {2, 9, 40, 222, 614}
check("המספר האחרון ולא שם הנושא", L.topic_of(" סייעת 2 והעשרה -רשמי 614 גן זית", KNOWN), "614")
check("ריפוד לשלוש ספרות כמו בקובצי המיתר", L.topic_of("שאילת מורים (איחוד) 40 מקיף גוונים", KNOWN), "040")
check("טווח ותאריך אינם נושא", L.topic_of("תקשוב 9-10/25 סיגלן מחשבים", KNOWN), None)
check("מספר לפני שנה אינו נושא", L.topic_of("פ.נ. 9 2025 פקודת הכנסות לקבל", KNOWN), None)
check("מספר שאינו נושא מוכר — בלי נושא", L.topic_of("קרן קרב 333 שבילי רעות", KNOWN), None)
check("הכנסה לפי הספרה השנייה כשאין דוח כרטיסים", (L.is_income_card("1311000920", {}), L.is_income_card("1811000110", {})), (True, False))

# ── 7. קובץ התוספתיים ותאריך הנתונים (אייל, 21.10) ─────────────────
EXTRAS_HEADERS = ["קוד כרטיס", "תאור סעיף", "קטגוריה 1", "קטגוריה 2", "קטגוריה 3", "במיתר", "הכנסה", "הוצאה",
                  "תכנית שנה נוכחית הכנסות", "תכנית שנה נוכחית הוצאות", "צפי הוצאות לסוף שנה",
                  "הערות לתכנון תקציב"]
check("קובץ התוספתיים מזוהה", F.detect_kind(EXTRAS_HEADERS), "extras")
emap, _ = F.propose("extras", EXTRAS_HEADERS)
check("הדגלים והתכנית מותאמים", (emap["במיתר"], emap["הוצאה"], emap["תכנית שנה נוכחית הוצאות"]),
      ("in_meitar", "is_expense", "plan_expense"))
ex = L.parse_xls_rows("extras", EXTRAS_HEADERS, [
    [1811000110, "שכר", "חינוך", "", "", True, False, True, 0, "₪1,135,000", "", "לבדוק"],
    [None, "סה\"כ", "", "", "", "", "", "", "", "", "", ""],
], emap)
check("שורת הסיכום שבתחתית אינה כרטיס", len(ex), 1)
check("₪ ופסיקים — מספר; ריק נשאר ריק",
      (ex[0]["plan_expense"], ex[0]["forecast_expense"]), (1135000.0, None))
check("תיבות סימון", (ex[0]["in_meitar"], ex[0]["is_income"], ex[0]["is_expense"]), (True, False, True))
check("תאריך הנתונים משם דוח EPR", L.as_of_from_name("EprRep19102026153012.xls"), date(2026, 10, 19))

# ── 8. המיתר האוטומטי (024): חודשים, שנה"ל קודמת, ZIP של בית ספר ──
check("חודש בכל הפורמטים שבקבצים",
      [L.parse_month(v) for v in ("01/2026", "9/2026", "2025/09", "202501", "2026-09-01", "אוק-24", "13/2026", "", None)],
      [date(2026, 1, 1), date(2026, 9, 1), date(2025, 9, 1), date(2025, 1, 1), date(2026, 9, 1), date(2024, 10, 1),
       None, None, None])
check("תחילת שנה\"ל: ספטמבר פותח שנה", (L.school_year_start(date(2026, 9, 1)), L.school_year_start(date(2026, 8, 1))),
      (date(2026, 9, 1), date(2025, 9, 1)))
SCHOOL_SHARATIM = ("חודש חישוב,שם מוטב,סמל מוטב,סמל מוסד,שם מוסד,חודש תחולה,קוד נושא,נושא,מספר יחידות,"
                   "סכום מחושב,סכום מחושב קודם,הפרש מחושב\n"
                   "9/2026,רשות,999,360123,מקיף,09/2026,002,שרתים,1,100,0,100\n"
                   "9/2026,רשות,999,360123,מקיף,05/2026,002,שרתים,1,50,40,10\n")
RICUZ = ("חודש חישוב,סמל מוטב,שם מוטב,סמל מוסד,שם מוסד,סכום מחושב,סכום מחושב קודם,הפרש\n"
         "9/2026,999,רשות,360123,מקיף,100,0,100\n")
with Sandbox() as folder:
    zpath = folder / "360123_9_2026_Horada.zip"
    with zipfile.ZipFile(zpath, "w") as z:
        z.writestr("360123_999__9_2026SHARATIM.csv", "﻿" + SCHOOL_SHARATIM)
        z.writestr("360123_999__9_2026RICUZMOSDOT.csv", "﻿" + RICUZ)
        z.writestr("360123_999__9_2026HASNET.csv", "﻿" + "חודש חישוב,נושא תשלום,הפרש מחושב\n9/2026,472,5\n")
    p = L.parse_meitar_zip(zpath)
    check("ZIP של בית ספר: הבעלים הוא המוסד, המוטב מהשם", (p["owner"], p["kind"], p["beneficiary"]),
          ("360123", "mosad", "999"))
    check("RICUZMOSDOT — סיכום המוסד, לא שורות", (len(p["totals"]), p["totals"][0]["computed"],
                                                    any(r["source_file"] == "RICUZMOSDOT" for r in p["rows"])),
          (1, 100.0, False))
    check("תחולה 05/2026 בחודש חישוב 9/2026 — שנה\"ל קודמת", [r["prior_year"] for r in p["rows"]
                                                         if r["source_file"] == "SHARATIM"], [False, True])
    check("HASNET אינו נכנס להתאמה", L.reconcile_meitar(p)["not_in_invoice"], [{"topic": "002", "detail": 110.0}])

    # ZIP עם שני חודשים — נעצר לפני כל כתיבה
    mixed = folder / "mixed.zip"
    with zipfile.ZipFile(mixed, "w") as z:
        z.writestr("999_9_2026GY003EZ.csv", "﻿" + GARDENS)
        z.writestr("999_8_2026GY003EZ.csv", "﻿" + GARDENS)
    report = folder / "r.json"
    proc = run("--code", "1400000", "--year", "2026", "--file", str(mixed), "--dry-run", "--report-json", str(report))
    r = json.loads(report.read_text(encoding="utf-8"))
    check("ZIP עם כמה חודשים נדחה", (proc.returncode != 0, any("כמה חודשים" in e for e in r["errors"])), (True, True))
check("שם אחר — אין תאריך", L.as_of_from_name("cards.xlsx"), None)

check.done()
