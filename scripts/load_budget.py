"""
קליטת קובצי התקציב — דוחות EPR (כרטיסים, פעולות, הזמנות) ו-ZIP של המיתר.

    python scripts/load_budget.py --code 1400000 --year 2026 \\
        --file "EprRep… ברמת הכרטיס הבודד.xls" --file "EprRep… ברמת הפעולה הבודדת.xls" \\
        --file "Horada (19).zip" --dry-run --report-json report.json

החלטה 023. שני שלבים, כמו קליטת דרג ב' (load_tier_b.py):

  --emit-mapping   מזהה את סוג כל קובץ ומציע התאמת כותרות→שדות (מתבנית
                   שמורה, או ממילון הכותרות ב-budget_fields.py). מדפיס JSON.
  (ברירת מחדל)    טוען לפי המיפוי שאושר (--mapping) או לפי ההצעה (--dry-run).

═══════════════════════════════════════════════════════════════════
מה נבדק לפני כל כתיבה — ונעצר אם נכשל
═══════════════════════════════════════════════════════════════════
• קובץ בלי שורות → סירוב (מלכודת 30: טעינה ריקה הייתה מוחקת את הקיים).
• שדות חובה שלא הותאמו → סירוב.
• הצלבה: "ביצוע" בדוח הכרטיסים = Σ(זכות − חובה) של תנועות השנה בדוח
  הפעולות. נבדק על מנשה 2026 — 410 מתוך 410. פער הוא **אזהרה** ולא עצירה:
  ייתכן ששני הדוחות הופקו בימים שונים.
• מיתר: "הפרש לתשלום" בחשבונית (CHESHBONIT, סכום על כל חודשי התחולה של
  הנושא) מול סכום "הפרש מחושב" בקובצי הפירוט. פער הוא אזהרה, לא עצירה.

═══════════════════════════════════════════════════════════════════
מה נדרס ומה לא
═══════════════════════════════════════════════════════════════════
כרטיסים — לפי (רשות, שנת תקציב). תנועות — לפי טווח התאריכים שבקובץ, ויתרות
הפתיחה מתחלפות. הזמנות — כולן. מיתר — לפי (רשות, חודש חישוב).
**שכבת המשתמש** (קטגוריות, צפי, תכנית, הערות, קבצים) אינה נגעת לעולם.
לפני כל מחיקה — גיבוי xlsx ב-agent/backups/budget_{code}/.
"""
# `dict | None` בחתימות — בלי זה נופל בפייתון 3.9 (המחשב של סבא, אם לא עודכן)
from __future__ import annotations

import argparse
import csv
import hashlib
import io
import json
import os
import re
import sys
import zipfile
from collections import defaultdict
from datetime import date, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import budget_fields as F  # noqa: E402

# הפלט ב-UTF-8 בלי תלות בקונסולה (ראה ההסבר ב-load_tier_b.py)
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8")
    except (AttributeError, ValueError):
        pass

DASHBOARD_DIR = Path(__file__).resolve().parent.parent
BACKUP_DIR = DASHBOARD_DIR / "agent" / "backups"


# ═══════════════════════════ סביבה ═══════════════════════════

def load_env() -> None:
    """טוען .env.db ו-.env.agent, בלי לדרוס משתנים שכבר הוגדרו."""
    for name in (".env.db", ".env.agent"):
        path = DASHBOARD_DIR / name
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, value = line.split("=", 1)
            os.environ.setdefault(key.strip(), value.strip().strip("\"'"))


def connect():
    import psycopg2
    return psycopg2.connect(
        host=os.environ["PGHOST"],
        port=int(os.environ.get("PGPORT", "5432")),
        dbname=os.environ.get("PGDATABASE", "postgres"),
        user=os.environ["PGUSER"],
        password=os.environ["PGPASSWORD"],
        sslmode="require",
        connect_timeout=20,
    )


# ═══════════════════════ המרות ערכים ═══════════════════════
# תא ריק נשאר ריק (CLAUDE.md) — כל המרה מחזירה None ולא אפס.

def to_text(v) -> str | None:
    if v is None:
        return None
    if isinstance(v, float) and v.is_integer():
        v = int(v)
    s = str(v).strip()
    return s or None


def to_num(v) -> float | None:
    if v is None:
        return None
    if isinstance(v, (int, float)):
        return float(v)
    s = str(v).strip().replace(",", "").replace("+", "").replace("₪", "").strip()
    if not s:
        return None
    if s.startswith("."):
        s = "0" + s
    try:
        return float(s)
    except ValueError:
        return None


def to_bool(v) -> bool | None:
    """תיבת סימון מהאקסס: True/False, 1/0, "כן"/"לא". ריק — None."""
    if v is None or v == "":
        return None
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    t = str(v).strip().lower()
    if t in ("true", "1", "כן", "-1", "yes", "v", "✓"):
        return True
    if t in ("false", "0", "לא", "no"):
        return False
    return None


def as_of_from_name(name: str) -> date | None:
    """EPR קורא לדוח EprRepDDMMYYYYHHMMSS — זה תאריך הנתונים (19102026 = 19.10.2026)."""
    m = re.search(r"EprRep(\d{2})(\d{2})(\d{4})", name)
    if not m:
        return None
    try:
        return date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    except ValueError:
        return None


def to_code(v) -> str | None:
    """מספר כרטיס: ב-xls הוא מגיע כ-float (1311000714.0) — מחזירים ספרות בלבד."""
    if v is None:
        return None
    if isinstance(v, float):
        return str(int(v)) if v.is_integer() else None
    s = re.sub(r"\.0+$", "", str(v).strip())
    return s if s.isdigit() else None


def to_date(v) -> date | None:
    """EPR כותב תאריכים כטקסט dd/mm/yy, ו-'0' כשאין תאריך (יתרת פתיחה)."""
    if v is None:
        return None
    if isinstance(v, datetime):
        return v.date()
    if isinstance(v, date):
        return v
    s = str(v).strip()
    m = re.fullmatch(r"(\d{1,2})[/.](\d{1,2})[/.](\d{2}|\d{4})", s)
    if not m:
        return None
    d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
    if y < 100:
        y += 2000
    try:
        return date(y, mo, d)
    except ValueError:
        return None


# ═══════════════════════ קריאת הקבצים ═══════════════════════

def read_sheet(path: Path) -> tuple[list[str], list[list]]:
    """
    כותרות ושורות מהגיליון הראשון. שורת הכותרת = השורה עם הכי הרבה תאי
    טקסט מבין 12 הראשונות (כמו בדרג ב'). תאי תאריך של אקסל → datetime.
    """
    suffix = path.suffix.lower()
    if suffix == ".xls":
        import xlrd
        book = xlrd.open_workbook(str(path))
        sh = book.sheet_by_index(0)

        def cell(r, c):
            ce = sh.cell(r, c)
            if ce.ctype == xlrd.XL_CELL_DATE:
                return xlrd.xldate_as_datetime(ce.value, book.datemode)
            if ce.ctype in (xlrd.XL_CELL_EMPTY, xlrd.XL_CELL_BLANK):
                return None
            return ce.value

        grid = [[cell(r, c) for c in range(sh.ncols)] for r in range(sh.nrows)]
    elif suffix == ".xlsx":
        from openpyxl import load_workbook
        book = load_workbook(str(path), read_only=True, data_only=True)
        grid = [list(row) for row in book.worksheets[0].iter_rows(values_only=True)]
    else:
        raise ValueError(f"סוג קובץ לא נתמך: {path.name}")

    if not grid:
        return [], []
    head_idx = max(range(min(12, len(grid))),
                   key=lambda i: sum(1 for v in grid[i] if isinstance(v, str) and v.strip()))
    headers = [str(v).strip() if v is not None else "" for v in grid[head_idx]]
    rows = [r for r in grid[head_idx + 1:] if any(v not in (None, "") for v in r)]
    return headers, rows


def headers_hash(headers: list[str]) -> str:
    normed = [re.sub(r"\s+", " ", h).strip() for h in headers]
    return hashlib.sha256(json.dumps(normed, ensure_ascii=False).encode()).hexdigest()[:32]


# ═══════════════════════ פענוח לפי סוג ═══════════════════════

def parse_xls_rows(kind: str, headers: list[str], rows: list[list], mapping: dict) -> list[dict]:
    idx = {field: headers.index(h) for h, field in mapping.items() if field and h in headers}
    unmapped = [i for i, h in enumerate(headers) if h and not mapping.get(h) and F.norm(h) not in {F.norm(x) for x in F.IGNORED}]
    out = []
    for line_no, r in enumerate(rows, start=1):
        get = lambda f: r[idx[f]] if f in idx and idx[f] < len(r) else None  # noqa: E731
        if kind == "cards":
            code = to_code(get("card_code"))
            if not code:
                continue
            out.append({
                "card_code": code, "card_name": to_text(get("card_name")),
                **{f: to_num(get(f)) for f in ("budget_expense", "budget_income", "budget_period",
                                               "executed", "reserved", "balance", "demand")},
            })
        elif kind == "actions":
            code = to_code(get("card_code"))
            if not code:
                continue
            details = to_text(get("details"))
            ev = to_date(get("event_date"))
            year = to_num(get("year_field"))
            out.append({
                "card_code": code, "card_name": to_text(get("card_name")),
                "year_field": int(year) if year is not None else None,
                "event_date": ev, "due_date": to_date(get("due_date")),
                "is_opening": ev is None and (year in (None, 0.0)) and "פתיחה" in (details or ""),
                "voucher": to_text(get("voucher")), "counter_account": to_text(get("counter_account")),
                "counter_name": to_text(get("counter_name")), "details": details,
                "debit": to_num(get("debit")), "credit": to_num(get("credit")), "balance": to_num(get("balance")),
                "ref1": to_text(get("ref1")), "ref2": to_text(get("ref2")),
                "cost_center": to_text(get("cost_center")), "document": to_text(get("document")),
                "meitar_topic": None,   # נקבע אחרי שכל הקבצים נקראו — ראה topic_of
                "line_no": line_no,
            })
        elif kind == "extras":
            code = to_code(get("card_code"))
            if not code:
                continue   # שורת הסיכום שבתחתית הייצוא, ושורות ריקות
            out.append({
                "card_code": code, "card_name": to_text(get("card_name")),
                **{f: to_num(get(f)) for f in ("plan_income", "plan_expense", "forecast_income",
                                               "forecast_expense", "next_income", "next_expense")},
                **{f: to_bool(get(f)) for f in ("in_meitar", "is_income", "is_expense", "gefen", "active_prev_year")},
                **{f: to_text(get(f)) for f in ("category1", "category2", "category3", "category_note",
                                                "notes", "owner_name", "money_source")},
            })
        elif kind == "orders":
            no = to_text(get("order_no"))
            if not no:
                continue
            extra = {headers[i]: to_text(r[i]) for i in unmapped if i < len(r) and to_text(r[i]) is not None}
            out.append({
                "order_no": no, "order_date": to_date(get("order_date")),
                "supplier_no": to_text(get("supplier_no")), "supplier_name": to_text(get("supplier_name")),
                "amount": to_num(get("amount")), "not_supplied": to_num(get("not_supplied")),
                "status": to_text(get("status")), "next_approver": to_text(get("next_approver")),
                "details": to_text(get("details")), "department": to_text(get("department")),
                "card_code": to_code(get("card_code")) or to_text(get("card_code")),
                "card_name": to_text(get("card_name")),
                "cost_center1": to_text(get("cost_center1")), "cost_center2": to_text(get("cost_center2")),
                "contract": to_text(get("contract")), "extra": extra or None,
            })
    return out


# ── מיתר ──────────────────────────────────────────────────────────
# שם הקובץ — שתי צורות (נבדק מול הורדות אמת, 22.10):
#   מועצה:    {סמל מוטב}_{חודש}_{שנה}{סוג}.csv              12300141_9_2026SACAL.csv
#   בית ספר:  {סמל מוסד}_{סמל מוטב}__{חודש}_{שנה}{סוג}.csv   360123_12300141__9_2026SACAL.csv
MEITAR_NAME = re.compile(r"^(\d+)(?:_(\d+)_)?_(\d{1,2})_(\d{4})([A-Za-z0-9]+)\.csv$")

# קבצים שאין בהם עמודת קוד נושא. השיוך נבדק מול החשבונית של 9/2026: סכום
# הקובץ = בדיוק הסכום של הנושא (SACAL 749,088.28 = 001; AZAROLIM 1,227.34 = 009;
# MOADON 26,647.5 = 242).
FILE_TOPIC = {"SACAL": ("001", 'שכ"ל על-יסודי'), "AZAROLIM": ("009", "שעורי עזר לעולים"),
              "MOADON": ("242", "מועדוניות ברשויות")}

# קבצים בלי סכומים (משרות, איכלוס כיתות) — נשמרים, לא נכנסים להתאמה ולסכומים.
# HASNET / HASMASLULIM — פירוט של ההסעות (הסכום כבר ב-HASAOT; ב-9/2026 ההפרש בהם 0).
# איתי מוציא את חמשתם מהצבירה. RICUZMOSDOT — הסיכום של מוסד, נשמר בטבלה משלו.
NO_MONEY = {"MISROT", "MISROTGY", "ICHLUSKITOT", "HASNET", "HASMASLULIM"}
INSTITUTION_TOTAL = "RICUZMOSDOT"

HEB_MONTH = {"ינו": 1, "פבר": 2, "מרץ": 3, "מרס": 3, "אפר": 4, "מאי": 5, "יונ": 6, "יול": 7, "אוג": 8,
             "ספט": 9, "אוק": 10, "נוב": 11, "דצמ": 12}


def parse_month(v) -> date | None:
    """
    חודש מכל הפורמטים שבקובצי המיתר: "01/2026", "9/2026", "2025/09" (HASAOT),
    "202501" (SHEFI, HASNET), "2026-09-01", ועברי "אוק-24" (חודש חישוב ב-HASAOT, אצל איתי).
    זהה ל-public.meitar_parse_month במיגרציה 047 (בלי העברי). לא מזוהה — None.
    """
    s = str(v or "").strip()
    y = mo = None
    if m := re.fullmatch(r"(\d{1,2})/(\d{4})", s):
        mo, y = int(m.group(1)), int(m.group(2))
    elif m := re.fullmatch(r"(\d{4})/(\d{1,2})", s):
        y, mo = int(m.group(1)), int(m.group(2))
    elif m := re.match(r"(\d{4})-(\d{1,2})(?:-\d{1,2})?", s):
        y, mo = int(m.group(1)), int(m.group(2))
    elif m := re.fullmatch(r"((?:19|20)\d{2})(\d{2})", s):
        y, mo = int(m.group(1)), int(m.group(2))
    elif m := re.fullmatch(r"(\d{2})(\d{4})", s):
        mo, y = int(m.group(1)), int(m.group(2))
    elif m := re.fullmatch(r"([א-ת]{3})[א-ת]*-(\d{2})", s):
        mo, y = HEB_MONTH.get(m.group(1)), 2000 + int(m.group(2))
    if mo and y and 1 <= mo <= 12 and 1990 <= y <= 2100:
        return date(y, mo, 1)
    return None


def school_year_start(d: date) -> date:
    """1 בספטמבר שפותח את שנה"ל של החודש"""
    return date(d.year if d.month >= 9 else d.year - 1, 9, 1)

CORE = {
    "topic_code":       ("קוד נושא", "נושא תשלום"),
    "topic_name":       ("תאור נושא", "נושא"),
    "institution_code": ("סמל מוסד", "סמל מוסד יעד"),
    "institution_name": ("שם מוסד", "שם מוסד יעד"),
    "settlement_code":  ("סמל ישוב", "סמל ישוב יעד"),
    "settlement_name":  ("שם ישוב",),
    "effect_month":     ("חודש תחולה",),
    "units":            ("מספר יחידות", "מספר משרות"),
    "cost":             ("עלות",),
    "pct":              ("אחוז", "אחוז השתתפות"),
    "computed":         ("סכום מחושב",),
    "computed_prev":    ("סכום מחושב קודם",),
    "diff":             ("הפרש מחושב",),
}
NUMERIC = {"units", "cost", "pct", "computed", "computed_prev", "diff"}
SKIP_EXTRA = {"חודש חישוב", "שם מוטב", "סמל מוטב"}


def read_csv_text(raw: bytes) -> str:
    for enc in ("utf-8-sig", "cp1255"):
        try:
            return raw.decode(enc)
        except UnicodeDecodeError:
            continue
    return raw.decode("utf-8", errors="replace")


def parse_meitar_zip(path: Path) -> dict:
    """
    מחזיר {calc_month, owner, kind, beneficiary, invoice, rows, totals, files, unknown}.
    owner — של מי ה-ZIP: סמל המוטב (מועצה, kind='moteb') או סמל המוסד (בית ספר, 'mosad').
    """
    out = {"calc_month": None, "owner": None, "kind": None, "beneficiary": None, "invoice": [], "rows": [],
           "totals": [], "files": {}, "unknown": [], "months": set(), "owners": set()}
    with zipfile.ZipFile(path) as z:
        for info in z.infolist():
            name = Path(info.filename).name
            m = MEITAR_NAME.match(name)
            if not m:
                if not info.is_dir():
                    out["unknown"].append(name)
                continue
            first, moteb = m.group(1), m.group(2)
            month, year, kind = int(m.group(3)), int(m.group(4)), m.group(5).upper()
            out["months"].add(date(year, month, 1))
            out["owners"].add(first)
            out["calc_month"] = out["calc_month"] or date(year, month, 1)
            out["owner"] = out["owner"] or first
            out["kind"] = out["kind"] or ("mosad" if moteb else "moteb")
            out["beneficiary"] = out["beneficiary"] or (moteb or first)
            reader = csv.DictReader(io.StringIO(read_csv_text(z.read(info))))
            records = [{(k or "").strip(): (v or "").strip() for k, v in r.items()}
                       for r in reader if any((v or "").strip() for v in r.values())]
            out["files"][kind] = len(records)
            if kind == INSTITUTION_TOTAL:
                for r in records:
                    out["totals"].append({
                        "institution_code": r.get("סמל מוסד") or None, "institution_name": r.get("שם מוסד") or None,
                        "computed": to_num(r.get("סכום מחושב")), "computed_prev": to_num(r.get("סכום מחושב קודם")),
                        "diff": to_num(r.get("הפרש")) if r.get("הפרש") else to_num(r.get("הפרש מחושב")),
                    })
                continue
            if kind == "CHESHBONIT":
                for r in records:
                    if not r.get("קוד נושא"):
                        continue
                    out["invoice"].append({
                        "topic_code": r["קוד נושא"].zfill(3), "topic_name": r.get("תאור נושא") or None,
                        "chashavut": r.get("חשבות") or None, "effect_month": r.get("חודש תחולה") or None,
                        "due": to_num(r.get("סך הכל מגיע")), "paid": to_num(r.get("שולם")),
                        "to_pay": to_num(r.get("הפרש לתשלום")), "debt": to_num(r.get("יתרת חוב")),
                        "month_balance": to_num(r.get("יתרת ביצוע החודש")), "notes": r.get("הערות") or None,
                    })
                continue
            for r in records:
                row = {"source_file": kind}
                used = set(SKIP_EXTRA)
                for field, names in CORE.items():
                    hit = next((n for n in names if n in r), None)
                    if hit is None:
                        row[field] = None
                        continue
                    used.add(hit)
                    row[field] = to_num(r[hit]) if field in NUMERIC else (r[hit] or None)
                if row["topic_code"]:
                    row["topic_code"] = row["topic_code"].zfill(3)
                elif kind in FILE_TOPIC:
                    row["topic_code"], row["topic_name"] = FILE_TOPIC[kind]
                # תשלום ידני (YADANIIM): אין "הפרש מחושב" — הסכום כולו שולם החודש
                if row["diff"] is None and kind == "YADANIIM":
                    row["diff"] = row["computed"]
                extra = {k: v for k, v in r.items() if k not in used and v}
                row["extra"] = extra or None
                out["rows"].append(row)
    # חודש התחולה, ו"שייך לשנה"ל קודמת" — נשמר ומסומן, לא נמחק (אייל, 22.10)
    if out["calc_month"]:
        start = school_year_start(out["calc_month"])
        for r in out["rows"] + out["invoice"]:
            r["effect_date"] = parse_month(r.get("effect_month"))
            r["prior_year"] = bool(r["effect_date"] and r["effect_date"] < start)
    return out


def meitar_entity(conn, code: str, m: dict) -> dict | None:
    """
    המקור הרשום של ה-ZIP. בלי חיבור (--dry-run) — לא נבדק, ומוחזר כפי שבקובץ.
    totals_only: ZIP של בית ספר שהמוטב שלו רשום ברשות — השורות כבר ב-ZIP של
    המועצה (זהות, נבדק 22.10); לוקחים ממנו רק את הסיכום הרשמי (RICUZMOSDOT).
    """
    if not m["owner"]:
        return None
    if conn is None:
        return {"code": m["owner"], "kind": m["kind"], "name": None, "totals_only": False, "checked": False}
    with conn.cursor() as cur:
        cur.execute("""select entity_code, kind, name from public.meitar_entities
                        where authority_code = %s and active""", (code,))
        reg = {r[0]: {"code": r[0], "kind": r[1], "name": r[2]} for r in cur.fetchall()}
    e = reg.get(m["owner"])
    if e is None:
        return None
    moteb_registered = m["kind"] == "mosad" and reg.get(m["beneficiary"], {}).get("kind") == "moteb"
    return {**e, "totals_only": moteb_registered, "checked": True}


def reconcile_meitar(parsed: dict) -> dict:
    """
    בחשבונית יש שורה לכל **חודש תחולה** של נושא: "סך הכל מגיע" הוא הסכום
    המחושב לאותו חודש, ו"הפרש לתשלום" (= מגיע − שולם) הוא מה שמשולם עכשיו,
    כולל עדכונים רטרואקטיביים. הוא שמתיישב עם "הפרש מחושב" בפירוט — לא
    "סך הכל מגיע" (נושא 003 ב-9/2026: 1,331,544.80 + 12,860.77 = 1,344,405.57).
    """
    due = defaultdict(float)
    names = {}
    for r in parsed["invoice"]:
        due[r["topic_code"]] += r["to_pay"] or 0
        names[r["topic_code"]] = r["topic_name"]
    detail = defaultdict(float)
    for r in parsed["rows"]:
        if r["source_file"] in NO_MONEY or not r["topic_code"]:
            continue
        detail[r["topic_code"]] += r["diff"] or 0
    mismatches = []
    matched = 0
    for topic, amount in sorted(due.items()):
        got = detail.get(topic)
        if got is not None and abs(got - amount) < 1:
            matched += 1
        else:
            mismatches.append({"topic": topic, "name": names.get(topic), "invoice": round(amount, 2),
                               "detail": None if got is None else round(got, 2)})
    extra = [{"topic": t, "detail": round(v, 2)} for t, v in detail.items() if t not in due and abs(v) > 0.5]
    return {"matched": matched, "total": len(due), "mismatches": mismatches, "not_in_invoice": extra}


# ── נושא מיתר לתנועה ──────────────────────────────────────────────
# באקסס של סבא לכל תקבול ממשרד החינוך יש "מספר נושא במיתר". הוא אינו מוקלד:
# הוא המספר האחרון בטקסט "פרטים" שהוא נושא מוכר —
#   "סייעת 2 והעשרה -רשמי 614 גן זית"  → 614   (ה-2 הוא חלק משם הנושא)
#   "תקשוב 9-10/25 סיגלן מחשבים"       → אין   (טווח ותאריך אינם נושא)
# נבדק מול האקסס: 5,030 תנועות זהות, אף אחת שגויה (20.10). כל השאר — הוצאות
# ותקבולים שאינם מהמיתר — נשארים בלי נושא ("999" באקסס).
TOPIC_TOKEN = re.compile(r"(?<![\d/.\-])(\d{1,3})(?![\d/.\-])(?!\s*\d{4})")


def topic_of(details: str | None, known: set[int]) -> str | None:
    hits = [int(t) for t in TOPIC_TOKEN.findall(details or "") if int(t) in known]
    return f"{hits[-1]:03d}" if hits else None


def is_income_card(code: str, card_dirs: dict[str, str]) -> bool:
    """כמו directionOf ב-lib/budgetCalc.ts: לפי התקציב בדוח הכרטיסים, אחרת לפי הספרה השנייה."""
    if code in card_dirs:
        return card_dirs[code] == "income"
    return len(code) > 1 and code[1].isdigit() and int(code[1]) <= 5


def known_topics(conn, code: str, meitar: list[dict]) -> set[int]:
    """הנושאים המוכרים: מקובצי המיתר שבקליטה הזו, ומכל מה שכבר נקלט לרשות."""
    known = {int(t) for t, _ in FILE_TOPIC.values()}
    for m in meitar:
        known |= {int(r["topic_code"]) for r in m["invoice"] if r["topic_code"].isdigit()}
        known |= {int(r["topic_code"]) for r in m["rows"] if (r["topic_code"] or "").isdigit()}
    if conn is not None:
        with conn.cursor() as cur:
            cur.execute("""select distinct topic_code from public.meitar_invoice where authority_code = %s
                           union select distinct topic_code from public.meitar_rows where authority_code = %s""",
                        (code, code))
            known |= {int(r[0]) for r in cur.fetchall() if r[0] and r[0].isdigit()}
    return known


# ═══════════════════════ זיהוי והצעת מיפוי ═══════════════════════

def describe_file(path: Path, conn=None, code: str | None = None) -> dict:
    if path.suffix.lower() == ".zip":
        return {"kind": "meitar", "headers": [], "mapping": None, "meta": {}, "source": None, "rows": None, "missing": []}
    headers, rows = read_sheet(path)
    kind = F.detect_kind(headers)
    if not kind:
        return {"kind": "unknown", "headers": headers, "mapping": {h: None for h in headers},
                "meta": {}, "source": None, "rows": len(rows), "missing": []}
    mapping, meta, source = None, {}, "dictionary"
    if conn is not None and code:
        with conn.cursor() as cur:
            cur.execute("""select mapping from public.budget_mappings
                            where authority_code = %s and kind = %s and headers_hash = %s""",
                        (code, kind, headers_hash(headers)))
            row = cur.fetchone()
        if row:
            mapping, source = row[0], "saved"
    if mapping is None:
        mapping, meta = F.propose(kind, headers)
    return {"kind": kind, "headers": headers, "mapping": mapping, "meta": meta, "source": source,
            "rows": len(rows), "missing": F.missing_required(kind, mapping)}


# ═══════════════════════ גיבוי ═══════════════════════

def backup_rows(conn, code: str, label: str, sql: str, params: tuple) -> str | None:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        rows = cur.fetchall()
        columns = [d[0] for d in cur.description]
    if not rows:
        return None
    from openpyxl import Workbook
    book = Workbook()
    sheet = book.active
    sheet.title = label[:30]
    sheet.sheet_view.rightToLeft = True
    sheet.append(columns)
    for row in rows:
        sheet.append(["" if v is None else (v if isinstance(v, (int, float)) else str(v)) for v in row])
    folder = BACKUP_DIR / f"budget_{code}"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"{label}_{datetime.now():%Y-%m-%d_%H%M%S}.xlsx"
    book.save(path)
    return str(path)


# ═══════════════════════ הריצה ═══════════════════════

def main() -> None:
    ap = argparse.ArgumentParser(description="קליטת קובצי תקציב (EPR + מיתר)")
    ap.add_argument("--file", action="append", required=True, help="קובץ לקליטה (אפשר כמה)")
    ap.add_argument("--code", required=True, help="קוד הרשות")
    ap.add_argument("--year", type=int, required=True, help="שנת התקציב (קלנדרית) של דוח הכרטיסים")
    ap.add_argument("--upload-id", help="מזהה הקליטה ב-budget_uploads")
    ap.add_argument("--mapping", help="JSON: {שם קובץ: {kind, mapping}} — המיפוי שאושר")
    ap.add_argument("--save-mapping", action="store_true", help="לשמור את המיפוי כתבנית לרשות")
    ap.add_argument("--emit-mapping", action="store_true", help="רק לזהות ולהציע מיפוי; מדפיס JSON")
    ap.add_argument("--dry-run", action="store_true", help="בלי חיבור למסד — רק פענוח, בדיקות ודוח")
    ap.add_argument("--report-json", help="נתיב לכתיבת דוח הקליטה")
    args = ap.parse_args()

    files = [Path(f) for f in args.file]
    for p in files:
        if not p.exists():
            sys.exit(f"הקובץ לא נמצא: {p}")

    conn = None
    if not args.dry_run:
        load_env()
        conn = connect()

    # ── שלב 1: זיהוי והצעה ──
    described = {p.name: describe_file(p, conn, args.code) for p in files}
    if args.emit_mapping:
        # תמיד לאישור באתר, כמו קליטת הגנים (אייל, 21.10) — גם כשיש תבנית שמורה:
        # היא רק ממלאת מראש את ההתאמה. ZIP מיתר לבדו (בלי דוחות) — נטען מיד.
        auto = all(d["kind"] == "meitar" for d in described.values())
        print(json.dumps({"files": described, "auto": auto}, ensure_ascii=False, default=str))
        return

    approved = json.loads(Path(args.mapping).read_text(encoding="utf-8")) if args.mapping else None

    report: dict = {"errors": [], "warnings": [], "fiscal_year": args.year, "files": {},
                    "counts": {}, "backups": []}

    def warn(kind: str, text: str, **detail):
        report["warnings"].append({"kind": kind, "text": text, **detail})

    parsed: dict[str, list] = {"cards": [], "actions": [], "extras": [], "orders": []}
    meitar: list[dict] = []
    kinds_seen: dict[str, str] = {}
    for p in files:
        d = described[p.name]
        kind = d["kind"]
        mapping = d["mapping"]
        if approved and p.name in approved:
            kind = approved[p.name].get("kind") or kind
            mapping = approved[p.name].get("mapping") or mapping
        if kind == "unknown":
            report["errors"].append(f"{p.name}: לא זוהה סוג הקובץ (כרטיסים / פעולות / תוספתיים / הזמנות)")
            continue
        if kind == "meitar":
            m = parse_meitar_zip(p)
            if not m["rows"] and not m["invoice"]:
                report["errors"].append(f"{p.name}: אין בו קובצי מיתר בתבנית {{סמל}}_{{חודש}}_{{שנה}}{{סוג}}.csv")
                continue
            if len(m["months"]) > 1 or len(m["owners"]) > 1:
                report["errors"].append(f"{p.name}: ב-ZIP קבצים של כמה חודשים או מקורות — "
                                        f"{sorted(f'{d:%m/%Y}' for d in m['months'])} · {sorted(m['owners'])}")
                continue
            entity = meitar_entity(conn, args.code, m)
            if entity is None:
                report["errors"].append(f"{p.name}: {'בית הספר' if m['kind'] == 'mosad' else 'המוטב'} {m['owner']} "
                                        f"אינו רשום במקורות המיתר של הרשות — מוסיפים אותו בניהול ← נתונים ← תקציב")
                continue
            m["entity"] = entity
            if m["unknown"]:
                warn("meitar_unknown", f"{p.name}: קבצים שלא זוהו ודולגו — {', '.join(m['unknown'][:5])}")
            m["reconcile"] = reconcile_meitar(m)
            m["file"] = p.name
            meitar.append(m)
            report["files"][p.name] = {"kind": "meitar", "rows": len(m["rows"]) + len(m["invoice"])}
            continue
        if kind in kinds_seen:
            report["errors"].append(f"שני קבצים מאותו סוג ({F.KIND_LABELS[kind]}): {kinds_seen[kind]}, {p.name}")
            continue
        kinds_seen[kind] = p.name
        missing = F.missing_required(kind, mapping)
        if missing:
            report["errors"].append(f"{p.name}: שדות חובה שלא הותאמו — {', '.join(missing)}")
            continue
        headers, rows = read_sheet(p)
        items = parse_xls_rows(kind, headers, rows, mapping)
        if not items:
            report["errors"].append(f"{p.name}: לא נמצאה אף שורה תקינה — סירבתי לטעון קובץ ריק (הוא היה מוחק את הקיים)")
            continue
        parsed[kind] = items
        report["files"][p.name] = {"kind": kind, "rows": len(items)}

    # ── שלב 2: בדיקות ──
    cards, actions, extras, orders = parsed["cards"], parsed["actions"], parsed["extras"], parsed["orders"]
    # תאריך הנתונים: משם דוח ה-EPR; אם אין — יום הקליטה (ראה as_of_from_name)
    stamps = [as_of_from_name(p.name) for p in files if as_of_from_name(p.name)]
    as_of = max(stamps) if stamps else date.today()
    report["as_of"] = as_of.isoformat()
    if cards:
        dup = len(cards) - len({c["card_code"] for c in cards})
        if dup:
            report["errors"].append(f"דוח הכרטיסים: {dup} כרטיסים מופיעים יותר מפעם אחת")
    if actions:
        dated = [a["event_date"] for a in actions if a["event_date"]]
        report["date_range"] = [min(dated).isoformat(), max(dated).isoformat()] if dated else None
        undated = sum(1 for a in actions if not a["event_date"] and not a["is_opening"])
        if undated:
            warn("undated", f"{undated} תנועות בלי תאריך שאינן יתרת פתיחה — נטענות, אבל לא נכנסות לביצוע החודשי")
    if cards and actions:
        sums = defaultdict(float)
        for a in actions:
            if a["event_date"] and a["event_date"].year == args.year:
                sums[a["card_code"]] += (a["credit"] or 0) - (a["debit"] or 0)
        mismatches = [{"card": c["card_code"], "executed": c["executed"], "actions": round(sums.get(c["card_code"], 0), 2)}
                      for c in cards if abs((c["executed"] or 0) - sums.get(c["card_code"], 0)) >= 1]
        report["crosscheck"] = {"checked": len(cards), "matched": len(cards) - len(mismatches),
                                "mismatches": mismatches[:30]}
        if mismatches:
            warn("crosscheck", f"ביצוע לא מתיישב עם התנועות ב-{len(mismatches)} כרטיסים — ייתכן שהדוחות הופקו בימים שונים")
        orphan = {a["card_code"] for a in actions} - {c["card_code"] for c in cards}
        if orphan:
            warn("orphan_cards", f"{len(orphan)} כרטיסים מופיעים בתנועות ולא בדוח הכרטיסים")
    for m in meitar:
        rc = m["reconcile"]
        report.setdefault("meitar", []).append({
            "file": m["file"], "calc_month": m["calc_month"].isoformat() if m["calc_month"] else None,
            "files": m["files"], "invoice_rows": len(m["invoice"]), "rows": len(m["rows"]), "reconcile": rc,
            "entity": m["entity"]["code"], "entity_kind": m["kind"], "entity_name": m["entity"].get("name"),
            "totals_only": m["entity"]["totals_only"],
            "prior_year_rows": sum(1 for r in m["rows"] if r["prior_year"]),
            "institution_totals": m["totals"],
        })
        if rc["mismatches"] and not m["entity"]["totals_only"]:
            warn("meitar_reconcile", f"מיתר {m['calc_month']:%m/%Y}: {len(rc['mismatches'])} מתוך {rc['total']} נושאים "
                 f"לא מתיישבים בין החשבונית לפירוט")
    if extras:
        dup = len(extras) - len({e["card_code"] for e in extras})
        if dup:
            report["errors"].append(f"קובץ התוספתיים: {dup} כרטיסים מופיעים יותר מפעם אחת")
        if cards:
            missing = {c["card_code"] for c in cards} - {e["card_code"] for e in extras}
            if missing:
                warn("extras_missing", f"{len(missing)} כרטיסים בדוח הכרטיסים אינם בקובץ התוספתיים — יופיעו בלי קטגוריות")
    if not (cards or actions or extras or orders or meitar) and not report["errors"]:
        report["errors"].append("לא נמצא אף קובץ לקליטה")

    # נושא מיתר לתקבולים — אחרי שכל הקבצים נקראו (הנושאים המוכרים באים גם מה-ZIP)
    known = known_topics(conn, args.code, meitar)
    card_dirs = {c["card_code"]: ("income" if c["budget_income"] else "expense" if c["budget_expense"] else "")
                 for c in cards}
    card_dirs = {k: v for k, v in card_dirs.items() if v}
    for a in actions:
        if not a["is_opening"] and is_income_card(a["card_code"], card_dirs):
            a["meitar_topic"] = topic_of(a["details"], known)
    if actions:
        report["meitar_topics"] = {"known": len(known),
                                   "tagged": sum(1 for a in actions if a["meitar_topic"])}
        if not known:
            warn("no_meitar", "עוד לא נקלטו קובצי מיתר — התנועות נטענו בלי נושא מיתר. "
                 "קליטת ה-ZIP תשייך אותן.")

    report["counts"] = {"cards": len(cards), "transactions": len(actions), "extras": len(extras), "orders": len(orders),
                        "meitar_rows": sum(len(m["rows"]) for m in meitar),
                        "meitar_invoice": sum(len(m["invoice"]) for m in meitar)}

    def write_report():
        if args.report_json:
            Path(args.report_json).write_text(json.dumps(report, ensure_ascii=False, indent=1, default=str), encoding="utf-8")

    write_report()
    if report["errors"]:
        sys.exit("הקליטה נעצרה לפני כל שינוי במסד: " + " · ".join(report["errors"]))
    if args.dry_run:
        print(json.dumps(report, ensure_ascii=False, indent=1, default=str))
        return

    # ── שלב 3: כתיבה — טרנזקציה אחת ──
    from psycopg2.extras import Json, execute_values
    code, up = args.code, args.upload_id
    try:
        with conn.cursor() as cur:
            if cards:
                b = backup_rows(conn, code, f"cards_{args.year}",
                                "select * from public.budget_cards where authority_code=%s and fiscal_year=%s", (code, args.year))
                if b:
                    report["backups"].append(b)
                cur.execute("delete from public.budget_cards where authority_code=%s and fiscal_year=%s", (code, args.year))
                execute_values(cur, """insert into public.budget_cards
                    (authority_code, fiscal_year, card_code, card_name, budget_expense, budget_income, budget_period,
                     executed, reserved, balance, demand, as_of, upload_id) values %s""",
                    [(code, args.year, c["card_code"], c["card_name"], c["budget_expense"], c["budget_income"],
                      c["budget_period"], c["executed"], c["reserved"], c["balance"], c["demand"], as_of, up)
                     for c in cards],
                    page_size=1000)
            if actions:
                lo, hi = (report.get("date_range") or [None, None])
                sel = """select * from public.budget_transactions where authority_code=%s
                          and (is_opening or (event_date between %s and %s))"""
                b = backup_rows(conn, code, "transactions", sel, (code, lo, hi))
                if b:
                    report["backups"].append(b)
                cur.execute("""delete from public.budget_transactions where authority_code=%s
                               and (is_opening or (event_date between %s and %s))""", (code, lo, hi))
                execute_values(cur, """insert into public.budget_transactions
                    (authority_code, card_code, card_name, year_field, event_date, due_date, is_opening, voucher,
                     counter_account, counter_name, details, debit, credit, balance, ref1, ref2, cost_center,
                     document, meitar_topic, line_no, upload_id) values %s""",
                    [(code, a["card_code"], a["card_name"], a["year_field"], a["event_date"], a["due_date"],
                      a["is_opening"], a["voucher"], a["counter_account"], a["counter_name"], a["details"],
                      a["debit"], a["credit"], a["balance"], a["ref1"], a["ref2"], a["cost_center"],
                      a["document"], a["meitar_topic"], a["line_no"], up) for a in actions],
                    page_size=1000)
            if extras:
                # התוספתיים הם הנתונים של סבא — הקובץ גובר בכרטיסים שבו (גם ערך ריק).
                # כרטיס שאינו בקובץ — שכבת המשתמש שלו לא נגעת.
                for label, sql in (("card_meta", "select * from public.budget_card_meta where authority_code=%s"),
                                   ("card_plans", "select * from public.budget_card_plans where authority_code=%s")):
                    b = backup_rows(conn, code, label, sql, (code,))
                    if b:
                        report["backups"].append(b)
                execute_values(cur, """insert into public.budget_card_meta
                    (authority_code, card_code, card_name, category1, category2, category3, category_note, owner_name,
                     money_source, gefen, in_meitar, is_income, is_expense, active_prev_year) values %s
                    on conflict (authority_code, card_code) do update set
                      card_name = excluded.card_name,
                      category1 = excluded.category1, category2 = excluded.category2, category3 = excluded.category3,
                      category_note = excluded.category_note, owner_name = excluded.owner_name,
                      money_source = excluded.money_source, gefen = excluded.gefen, in_meitar = excluded.in_meitar,
                      is_income = excluded.is_income, is_expense = excluded.is_expense,
                      active_prev_year = excluded.active_prev_year""",
                    [(code, e["card_code"], e["card_name"], e["category1"], e["category2"], e["category3"], e["category_note"],
                      e["owner_name"], e["money_source"], bool(e["gefen"]), bool(e["in_meitar"]),
                      e["is_income"], e["is_expense"], bool(e["active_prev_year"])) for e in extras],
                    page_size=1000)
                execute_values(cur, """insert into public.budget_card_plans
                    (authority_code, card_code, fiscal_year, plan_income, plan_expense, forecast_income,
                     forecast_expense, next_income, next_expense, notes) values %s
                    on conflict (authority_code, card_code, fiscal_year) do update set
                      plan_income = excluded.plan_income, plan_expense = excluded.plan_expense,
                      forecast_income = excluded.forecast_income, forecast_expense = excluded.forecast_expense,
                      next_income = excluded.next_income, next_expense = excluded.next_expense,
                      notes = excluded.notes""",
                    [(code, e["card_code"], args.year, e["plan_income"], e["plan_expense"], e["forecast_income"],
                      e["forecast_expense"], e["next_income"], e["next_expense"], e["notes"]) for e in extras],
                    page_size=1000)
            if orders:
                b = backup_rows(conn, code, "orders", "select * from public.budget_orders where authority_code=%s", (code,))
                if b:
                    report["backups"].append(b)
                cur.execute("delete from public.budget_orders where authority_code=%s", (code,))
                execute_values(cur, """insert into public.budget_orders
                    (authority_code, order_no, order_date, supplier_no, supplier_name, amount, not_supplied, status,
                     next_approver, details, department, card_code, card_name, cost_center1, cost_center2, contract,
                     extra, upload_id) values %s""",
                    [(code, o["order_no"], o["order_date"], o["supplier_no"], o["supplier_name"], o["amount"],
                      o["not_supplied"], o["status"], o["next_approver"], o["details"], o["department"],
                      o["card_code"], o["card_name"], o["cost_center1"], o["cost_center2"], o["contract"],
                      Json(o["extra"]) if o["extra"] else None, up) for o in orders],
                    page_size=1000)
            for m in meitar:
                ent = m["entity"]["code"]
                # הסיכום הרשמי של מוסד — מכל ZIP של בית ספר
                if m["totals"]:
                    execute_values(cur, """insert into public.meitar_institution_totals
                        (authority_code, institution_code, calc_month, beneficiary, institution_name, computed,
                         computed_prev, diff, upload_id) values %s
                        on conflict (authority_code, institution_code, calc_month) do update set
                          beneficiary = excluded.beneficiary, institution_name = excluded.institution_name,
                          computed = excluded.computed, computed_prev = excluded.computed_prev,
                          diff = excluded.diff, upload_id = excluded.upload_id, loaded_at = now()""",
                        [(code, t["institution_code"], m["calc_month"], m["beneficiary"], t["institution_name"],
                          t["computed"], t["computed_prev"], t["diff"], up) for t in m["totals"] if t["institution_code"]])
                if m["entity"]["totals_only"]:
                    continue   # השורות כבר ב-run של המועצה — לא נטענות פעמיים
                # הריצה הקודמת לאותו מקור וחודש מתחלפת (cascade) — אחרי גיבוי
                b = backup_rows(conn, code, f"meitar_{ent}_{m['calc_month']:%Y%m}",
                                """select r.* from public.meitar_rows r join public.meitar_runs u on u.id = r.run_id
                                    where u.authority_code=%s and u.entity_code=%s and u.calc_month=%s""",
                                (code, ent, m["calc_month"]))
                if b:
                    report["backups"].append(b)
                cur.execute("delete from public.meitar_runs where authority_code=%s and entity_code=%s and calc_month=%s",
                            (code, ent, m["calc_month"]))
                cur.execute("""insert into public.meitar_runs
                                 (authority_code, entity_code, calc_month, beneficiary, file_count, upload_id)
                               values (%s, %s, %s, %s, %s, %s) returning id""",
                            (code, ent, m["calc_month"], m["beneficiary"], len(m["files"]), up))
                run_id = cur.fetchone()[0]
                execute_values(cur, """insert into public.meitar_invoice
                    (run_id, authority_code, topic_code, topic_name, chashavut, effect_month, effect_date, prior_year,
                     due, paid, to_pay, debt, month_balance, notes) values %s""",
                    [(run_id, code, r["topic_code"], r["topic_name"], r["chashavut"], r["effect_month"],
                      r["effect_date"], r["prior_year"], r["due"], r["paid"], r["to_pay"], r["debt"],
                      r["month_balance"], r["notes"]) for r in m["invoice"]],
                    page_size=1000)
                execute_values(cur, """insert into public.meitar_rows
                    (run_id, authority_code, source_file, topic_code, topic_name, institution_code, institution_name,
                     settlement_code, settlement_name, effect_month, effect_date, prior_year, units, cost, pct,
                     computed, computed_prev, diff, extra) values %s""",
                    [(run_id, code, r["source_file"], r["topic_code"], r["topic_name"], r["institution_code"],
                      r["institution_name"], r["settlement_code"], r["settlement_name"], r["effect_month"],
                      r["effect_date"], r["prior_year"], r["units"], r["cost"], r["pct"], r["computed"],
                      r["computed_prev"], r["diff"], Json(r["extra"]) if r["extra"] else None) for r in m["rows"]],
                    page_size=1000)
                # הסיכום לכל נושא × מוסד — ממנו ההיסטוריה (meitar_months, מיגרציה 048)
                cur.execute("select public.meitar_refresh_run_topics(%s)", (run_id,))
                # נושא שאינו באינדקס — נוסף ומסומן חדש (אצל איתי נשמט ביישור לתבנית)
                topics = {}
                for r in m["rows"] + m["invoice"]:
                    if r["topic_code"]:
                        topics.setdefault(r["topic_code"], r["topic_name"])
                if topics:
                    new_topics = [r[0] for r in execute_values(
                        cur, """insert into public.meitar_topics (topic_code, name, is_new, first_seen)
                                values %s on conflict (topic_code) do nothing returning topic_code""",
                        [(t, n, True, m["calc_month"]) for t, n in topics.items()], fetch=True)]
                    if new_topics:
                        report.setdefault("meitar_new_topics", []).extend(new_topics)
            # ZIP מיתר שהגיע אחרי התנועות: נושאים חדשים מוכרים עכשיו — משייכים את
            # התקבולים שכבר במסד ועוד בלי נושא (כשהתנועות בקליטה הזו, הן כבר שויכו)
            if meitar and not actions:
                cur.execute("""select id, card_code, details from public.budget_transactions
                                where authority_code = %s and meitar_topic is null and not is_opening""", (code,))
                updates = [(topic_of(d, known), i) for i, c, d in cur.fetchall()
                           if is_income_card(c, {}) and topic_of(d, known)]
                if updates:
                    execute_values(cur, """update public.budget_transactions t set meitar_topic = v.topic
                                           from (values %s) as v(topic, id) where t.id = v.id""", updates)
                report["meitar_topics_backfilled"] = len(updates)
        conn.commit()
    except Exception:
        conn.rollback()
        raise

    # התבנית נשמרת רק אחרי טעינה מוצלחת — כך שמיפוי שגוי לא נזכר
    if args.save_mapping:
        with conn.cursor() as cur:
            for p in files:
                d = described[p.name]
                kind = (approved or {}).get(p.name, {}).get("kind") or d["kind"]
                mapping = (approved or {}).get(p.name, {}).get("mapping") or d["mapping"]
                if kind not in F.KINDS or not mapping:
                    continue
                cur.execute("""insert into public.budget_mappings
                                 (authority_code, kind, headers_hash, headers, mapping, use_count, used_at)
                               values (%s, %s, %s, %s, %s, 1, now())
                               on conflict (authority_code, kind, headers_hash)
                               do update set mapping = excluded.mapping, used_at = now(),
                                             use_count = public.budget_mappings.use_count + 1""",
                            (code, kind, headers_hash(d["headers"]), d["headers"], Json(mapping)))
        conn.commit()

    write_report()
    conn.close()
    print(json.dumps(report["counts"], ensure_ascii=False))


if __name__ == "__main__":
    main()
