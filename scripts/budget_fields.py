"""
השדות הקנוניים של קליטת התקציב, ומילון הכותרות שמציע את המיפוי.

כל דוח EPR מגיע עם כותרות בעברית. מנשה מייצאת תבנית קבועה, אבל מועצה אחרת
(או גרסה אחרת של EPR) עשויה לקרוא לאותה עמודה אחרת — ולכן ההתאמה אינה
מקודדת, אלא מוצעת כאן ומאושרת במסך (החלטה 023 §5). ההצעה דטרמיניסטית: אין
כאן AI, ואותן כותרות מקבלות תמיד אותה הצעה.

⚠️ שמות השדות והתוויות חייבים להיות זהים ל-BUDGET_FIELDS ב-src/lib/budget.ts.
"""
from __future__ import annotations

import re

# ── הסוגים ─────────────────────────────────────────────────────────
# cards   — "ברמת הכרטיס הבודד": שורה לכל כרטיס, תקציב וביצוע
# actions — "ברמת הפעולה הבודדת": כל תנועה בכרטסת
# orders  — הזמנות הרכש (שריון)
# meitar  — ZIP של המיתר; מבנה קבוע, בלי מיפוי

KINDS = ("cards", "actions", "extras", "orders")

KIND_LABELS = {
    "cards": "דוח ברמת הכרטיס",
    "actions": "דוח ברמת הפעולה",
    "extras": "קובץ התוספתיים",
    "orders": "דוח הזמנות רכש",
    "meitar": "קובצי מיתר",
}

# שדה: (תווית, חובה, [כותרות מוכרות])
# הכותרות מנורמלות לפני ההשוואה (רווחים, קו תחתון, גרשיים) — ראה norm().
#
# ⚠️ הפורמט הקבוע (אייל, 21.10): בדוחות EPR נקלטות רק העמודות **שאינן אפורות**.
#   כרטיסים — אפורות: תקציב תקופתי, שריון, יתרה תקופתית, יתרה, דרישה, יתרה אחרי דרישה
#   פעולות  — אפורות: יתרה, תמחיר1, תמחיר2, מסמך, התאמה
# לכן אין להן שדה כאן: במסך ההתאמה הן מוצעות כ"לא לייבא".
FIELDS: dict[str, dict[str, tuple[str, bool, list[str]]]] = {
    "cards": {
        "card_code":      ("מספר כרטיס", True, ["כרטיס", "מספר כרטיס", "קוד כרטיס", "סעיף"]),
        "card_name":      ("שם הכרטיס", False, ["שם כרטיס", "שם", "תאור סעיף", "תיאור סעיף", "שם סעיף"]),
        "budget_expense": ("תקציב הוצאות", True, ["תקציב הוצאות"]),
        "budget_income":  ("תקציב הכנסות", True, ["תקציב הכנסות"]),
        "executed":       ("ביצוע", True, ["ביצוע", "ביצוע בפועל"]),
    },
    "actions": {
        "card_code":       ("מספר כרטיס", True, ["כרטיס", "מספר כרטיס", "קוד כרטיס"]),
        "card_name":       ("שם הכרטיס", False, ["שם", "שם כרטיס"]),
        "year_field":      ("שנה", False, ["שנה"]),
        "event_date":      ("תאריך אירוע", True, ["תאריך ארוע", "תאריך אירוע"]),
        "due_date":        ("תאריך פירעון", False, ["תאריך פרעון", "תאריך פירעון"]),
        "voucher":         ("מספר פקודה", False, ["מספר פקודה"]),
        "counter_account": ("חשבון נגדי", False, ["חשבון נגדי"]),
        "counter_name":    ("שם חשבון נגדי", False, ["שם חשבון נגדי"]),
        "details":         ("פרטים", False, ["פרטים"]),
        "debit":           ("חובה", True, ["חובה"]),
        "credit":          ("זכות", True, ["זכות"]),
        "ref1":            ("אסמכתא 1", False, ["אסמכתא1", "אסמכתא 1"]),
        "ref2":            ("אסמכתא 2", False, ["אסמכתא2", "אסמכתא 2"]),
    },
    # ייצוא הטבלה "תקציב כרטסת - ראשי ברמת הכרטיס הבודד - תוספיים" מהאקסס.
    # זו שכבת המשתמש של סבא: קטגוריות, דגלים, תכנון, צפי, הערות ואחראי.
    "extras": {
        "card_code":        ("קוד כרטיס", True, ["קוד כרטיס", "כרטיס", "סעיף"]),
        "card_name":        ("תאור סעיף", False, ["תאור סעיף", "תיאור סעיף", "שם כרטיס"]),
        "plan_income":      ("תכנית שנה נוכחית הכנסות", False, ["תכנית שנה נוכחית הכנסות"]),
        "plan_expense":     ("תכנית שנה נוכחית הוצאות", False, ["תכנית שנה נוכחית הוצאות"]),
        "forecast_income":  ("צפי הכנסות לסוף שנה", False, ["צפי הכנסות לסוף שנה"]),
        "forecast_expense": ("צפי הוצאות לסוף שנה", False, ["צפי הוצאות לסוף שנה"]),
        "next_income":      ("תכנית הכנסות לשנה הבאה", False, ["תכנית תקציב הכנסות לשנה הבאה"]),
        "next_expense":     ("תכנית הוצאות לשנה הבאה", False, ["תכנית תקציב הוצאות לשנה הבאה"]),
        "in_meitar":        ("במיתר", False, ["במיתר"]),
        "is_income":        ("הכנסה", False, ["הכנסה"]),
        "is_expense":       ("הוצאה", False, ["הוצאה"]),
        "category1":        ("קטגוריה 1", False, ["קטגוריה 1", "תחום 1"]),
        "category2":        ("קטגוריה 2", False, ["קטגוריה 2", "תחום 2"]),
        "category3":        ("קטגוריה 3", False, ["קטגוריה 3", "תחום 3"]),
        "category_note":    ("הערות קטגוריה", False, ["הערות קטגוריה"]),
        "notes":            ("הערות לתכנון תקציב", False, ["הערות לתכנון תקציב"]),
        "gefen":            ("קשור לגפ\"ן", False, ["האם קשור לגפן"]),
        "active_prev_year": ("פעיל בשנה הקודמת", False, ["האם היה פעיל בשנה הקודמת"]),
        "owner_name":       ("באחריות", False, ["באחריות - ממילי", "באחריות"]),
        "money_source":     ("מקור כספי", False, ["מקור כספי"]),
    },
    # לפי "רכש – טבלת הבסיס מאז מנשה" באקסס. הדוח עצמו עוד לא התקבל, ולכן
    # המילון רחב — ומה שלא הותאם לא נזרק אלא נשמר ב-extra.
    "orders": {
        "order_no":      ("מספר הזמנה", True, ["מספר הזמנה epr", "מספר הזמנה", "הזמנה", "מס הזמנה"]),
        "order_date":    ("תאריך", False, ["תאריך מילוי הטופס", "תאריך הזמנה", "תאריך"]),
        "supplier_no":   ("מספר ספק", False, ["מספר ספק", "מס ספק"]),
        "supplier_name": ("שם ספק", False, ["שם ספק", "ספק"]),
        "amount":        ("סכום כולל מע\"מ", True, ["סהכ עלות הרכש כולל מעמ", "סכום הזמנה", "סכום", "סהכ"]),
        "not_supplied":  ("לא סופק", False, ["לא סופק", "יתרה לאספקה"]),
        "status":        ("מצב נוכחי", False, ["מצב נוכחי", "סטטוס", "מצב"]),
        "next_approver": ("מאשר הבא", False, ["מאשר הבא"]),
        "details":       ("פרטים", False, ["פרטים", "תאור", "תיאור"]),
        "department":    ("מחלקה", False, ["מחלקה"]),
        "card_code":     ("סעיף תקציבי", False, ["סעיפים תקציביים", "סעיף תקציבי", "כרטיס"]),
        "card_name":     ("שם סעיף", False, ["שם סעיף תקציבי", "שם סעיף"]),
        "cost_center1":  ("תמחיר 1", False, ["תמחיר 1", "תמחיר1"]),
        "cost_center2":  ("תמחיר 2", False, ["תמחיר 2", "תמחיר2"]),
        "contract":      ("חוזה", False, ["חוזה"]),
    },
}

# כותרות שמזהות את סוג הדוח — מספיקה אחת מכל קבוצה
SIGNATURES = {
    "actions": [{"חובה"}, {"זכות"}, {"תאריך ארוע", "תאריך אירוע"}],
    "extras":  [{"קוד כרטיס"}, {"קטגוריה 1"}, {"תכנית שנה נוכחית הכנסות", "תכנית שנה נוכחית הוצאות"}],
    "cards":   [{"תקציב הוצאות"}, {"תקציב הכנסות"}],
    "orders":  [{"מספר הזמנה epr", "מספר הזמנה", "הזמנה"}, {"ספק", "שם ספק"}],
}

# עמודות שמעבירים במכוון בלי שדה (האפורות) — אינן נכנסות ל-extra של ההזמנות
IGNORED = {"התאמה", "תמחיר2"}


def norm(header: object) -> str:
    """כותרת להשוואה: בלי גרשיים, קווים תחתונים ורווחים כפולים; אותיות קטנות."""
    s = str(header or "").replace("_", " ").replace('"', "").replace("״", "").replace("'", "").replace("׳", "")
    return re.sub(r"\s+", " ", s).strip().lower()


def detect_kind(headers: list[str]) -> str | None:
    have = {norm(h) for h in headers}
    for kind in ("actions", "extras", "cards", "orders"):
        if all(have & {norm(x) for x in group} for group in SIGNATURES[kind]):
            return kind
    return None


def propose(kind: str, headers: list[str]) -> tuple[dict[str, str | None], dict[str, dict]]:
    """
    מציע לכל כותרת שדה (או None). כל שדה ניתן לכותרת אחת לכל היותר —
    הראשונה שמתאימה בסדר הכותרות המוכרות, כדי ש"שם" לא ידרוס "שם כרטיס".
    """
    fields = FIELDS[kind]
    mapping: dict[str, str | None] = {h: None for h in headers}
    meta: dict[str, dict] = {}
    taken: set[str] = set()
    normed = {h: norm(h) for h in headers}
    for field, (_label, _req, aliases) in fields.items():
        for alias in aliases:
            hit = next((h for h in headers if normed[h] == norm(alias) and mapping[h] is None), None)
            if hit and field not in taken:
                mapping[hit] = field
                taken.add(field)
                meta[hit] = {"confidence": "high"}
                break
    return mapping, meta


def missing_required(kind: str, mapping: dict[str, str | None]) -> list[str]:
    mapped = {v for v in mapping.values() if v}
    return [label for f, (label, req, _a) in FIELDS[kind].items() if req and f not in mapped]
