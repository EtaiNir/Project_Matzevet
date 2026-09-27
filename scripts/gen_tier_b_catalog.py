"""
מייצר את `tier_b_catalog.py` — **כל** שדות היעד שאפשר למפות אליהם קליטת דרג ב'.

    python scripts/gen_tier_b_catalog.py

⚠️ להריץ מחדש בכל פעם ש-`src/config/fields.ts` משתנה.

למה קובץ מיוצר ולא קריאה ישירה של fields.ts בזמן ריצה: הסוכן במחשב של
סבא מקבל את `agent/` ואת `scripts/` בלבד — אין שם את `src/`. קריאה בזמן
ריצה הייתה עובדת כאן ונכשלת שם.

═══════════════════════════════════════════════════════════════════
למה רשימה אחת שטוחה, ולא שתי שכבות
═══════════════════════════════════════════════════════════════════
הגרסה הקודמת חילקה את השדות לשניים: ~25 מרכזיים בקריאה ראשונה, והשאר
רק לעמודות שנשארו בלי התאמה. הרעיון היה שפחות אפשרויות = פחות בלבול.

נמדד, והתוצאה הפוכה: 90/90 לרשימה השטוחה מול 83/90 לשתי השכבות, ועוד
132/133 מול 126/133 על כל הקבצים. הסיבה מבנית — הקריאה הראשונה רואה רק
את המרכזיים, ולכן היא בוחרת "שדה שבערך מתאים" במקום להשאיר null, והעמודה
כבר אינה מגיעה לקריאה השנייה. «טלפון קווי אם» נכנס ל«טלפון בית» של הילד
בכל אחת משלוש ההרצות. כשהמודל רואה את כל השדות יחד — הוא מבחין ביניהם.

השדות המרכזיים עדיין מוגדרים בנפרד ב-tier_b_fields.TARGETS: שם יושבות
ההמרות המיוחדות (ריפוד ת"ז, חיפוש סמל ישוב), ולפיהם נקבע אם הצעה מסומנת
בירוק או בצהוב במסך האישור.
"""
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import tier_b_fields as F  # noqa: E402

FIELDS_TS = HERE.parent / "src" / "config" / "fields.ts"
OUT = HERE / "tier_b_catalog.py"


def kind_of(key: str, ftype: str) -> str:
    """
    סוג ההמרה לפי מהות השדה — כדי שכל שדה יקבל את אותה המרה כמו אחיו
    ברשימת השדות המרכזיים. זהירות בהתאמה: `SUG_ZEHUT` מכיל ZEHUT אבל
    הוא קוד ("סוג זהות"), לא מספר זהות — ריפוד היה הורס אותו.
    """
    k = key.upper()
    if k.startswith("MISPAR_ZEHUT") or k.endswith("_ID"):
        return "id"
    if k.startswith(("SEMEL_YISHUV", "SEMEL_YESHUV")):
        return "locality"
    if "NAYAD" in k or "NAYACH" in k:
        return "phone"
    if "EMAIL" in k:
        return "email"
    if ftype == "date":
        return "date"
    if ftype == "number":
        return "number"
    return "text"


def main() -> None:
    src = FIELDS_TS.read_text(encoding="utf-8")
    entries = re.findall(
        r"\{ key: '([^']+)', label: '([^']*)', type: '(\w+)', group: '([^']+)'(, computed: true)?",
        src)
    rows = []
    for key, label, ftype, group, computed in entries:
        # שדות מחושבים נדרסים בדפדפן בכל טעינה, ושדות שמורים נכתבים ע"י
        # הטעינה עצמה. מיפוי אליהם נראה מוצלח ונעלם.
        if computed or key in F.RESERVED:
            continue
        rows.append((key, label, kind_of(key, ftype), group))

    lines = [
        '"""',
        "נוצר אוטומטית ע\"י gen_tier_b_catalog.py מתוך src/config/fields.ts.",
        "לא לערוך ידנית — להריץ את המחולל מחדש.",
        '"""',
        "",
        "# מפתח DB: (תווית בעברית, סוג המרה, קבוצה)",
        "CATALOG: dict[str, tuple[str, str, str]] = {",
    ]
    for key, label, kind, group in rows:
        lines.append(f"    {key!r}: ({label!r}, {kind!r}, {group!r}),")
    lines.append("}")
    OUT.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(f"נכתב {OUT.name}: {len(rows)} שדות")


if __name__ == "__main__":
    sys.stdout.reconfigure(encoding="utf-8")
    main()
