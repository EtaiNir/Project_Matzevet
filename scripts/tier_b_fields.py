"""
שדות היעד של קליטת דרג ב', וההמרות שכל אחד מהם דורש.

הקובץ הזה הוא **מקור האמת היחיד** לשאלה "לאיזה שדה אפשר למפות עמודה":
ממנו נבנית רשימת האפשרויות שנשלחת ל-AI, ממנו נגזרות ההמרות בטעינה,
וממנו מוצגות התוויות בעברית במסך אישור המיפוי.

⚠️ העיקרון שמפריד בין השניים:
    ה-AI מחליט **איזו עמודה היא מה**.
    ההמרה עצמה — ריפוד ת"ז, ספרת ביקורת של סמל ישוב, תאריכים — נעשית
    **כאן בקוד**, דטרמיניסטית. מודל אינו אמור לנסח כלל כזה, ובוודאי לא
    לנסח אותו אחרת בכל הרצה.
"""

# ──────────────────────────────────────────────────────────────
# סוגי השדות. ה-kind קובע את ההמרה, לא את התצוגה.
# ──────────────────────────────────────────────────────────────
#   id            תעודת זהות — מרופדת ל-9 ספרות
#   locality      סמל ישוב — מומר ממקוצר לארוך (ספרת ביקורת)
#   mosad         סמל מוסד — 6 ספרות, מרופד
#   date          תאריך — כולל סריאל של אקסל
#   phone         טלפון — טקסט, אפס מוביל נשמר
#   email         דוא"ל
#   gender        זכר/נקבה
#   house_no      מספר בית — 0 נחשב "אין", לא ערך
#   year          שנת לימודים
#   text          טקסט חופשי

TARGETS: dict[str, tuple[str, str]] = {
    # מפתח DB                        תווית בעברית              סוג
    "MISPAR_ZEHUT":              ("תעודת זהות של הילד",        "id"),
    "SHEM_MISHPACHA":            ("שם משפחה",                  "text"),
    "SHEM_PRATI":                ("שם פרטי",                   "text"),
    "CODE_MIN":                  ("מין",                       "gender"),
    "TAARICH_LEDA":              ("תאריך לידה",                "date"),

    "SEMEL_YISHUV1":             ("סמל ישוב מגורים",           "locality"),
    "TEUR_YISHUV1":              ("שם ישוב מגורים",            "text"),
    "SHEM_RECHOV1":              ("רחוב",                      "text"),
    "MISPAR_BAYIT1":             ("מספר בית",                  "house_no"),
    "TEUR_YESHUV2":              ("שם ישוב נוסף / מרשם",       "text"),

    "SEMEL_MOSAD":               ("סמל הגן / המסגרת",          "mosad"),
    "SHEM_MOSAD":                ("שם הגן / המסגרת",           "text"),
    "KTOVET_MOSAD":              ("כתובת המוסד",               "text"),
    "SHICHVA":                   ("שכבה",                      "text"),
    "SHNAT_LIMUDIM":             ("שנת לימודים",               "year"),

    "GOREM_KESHER_1_ID":         ("ת.ז. הורה 1",               "id"),
    "GOREM_KESHER_1_FULL_NAME":  ("שם הורה 1",                 "text"),
    "NAYAD_1_parent1":           ("נייד הורה 1",               "phone"),
    "EMAIL_parent1":             ("מייל הורה 1",               "email"),

    "GOREM_KESHER_2_ID":         ("ת.ז. הורה 2",               "id"),
    "GOREM_KESHER_2_FULL_NAME":  ("שם הורה 2",                 "text"),
    "NAYAD_1_parent2":           ("נייד הורה 2",               "phone"),
    "EMAIL_parent2":             ("מייל הורה 2",               "email"),

    "NAYACH_1_talmid":           ("טלפון בית",                 "phone"),
    "HEARA2":                    ("הערות",                     "text"),
}

#: שדות שבלעדיהם אי אפשר לקלוט שורה.
REQUIRED = ["MISPAR_ZEHUT", "SHEM_MISHPACHA", "SHEM_PRATI"]

#: שדות שערכיהם אישיים ולכן **לעולם** לא נשלחים החוצה כדוגמה.
#: ראה build_profiles ב-load_tier_b.py — נשלחת צורה, לא ערך.
SENSITIVE_KINDS = {"id", "phone", "email"}

#: כותרות שמכילות אחד מאלה נחשבות אישיות גם אם ה-kind שלהן טקסט
#: (שם פרטי ושם משפחה של קטין הם מידע מזהה לכל דבר).
SENSITIVE_HEADER_HINTS = ("שם", "זהות", "תז", "ת.ז", "טלפון", "נייד",
                          "מייל", "אימייל", "דוא")

#: ...אבל "שם" לבדו רחב מדי: "שם ישוב" ו"שם מוסד" אינם מידע על אדם,
#: ודווקא הם הדוגמאות שהכי עוזרות ל-AI לזהות את העמודה. כותרת שמכילה
#: אחד מאלה חוזרת להיות נייטרלית, גם אם נתפסה ברשימה שלמעלה.
NEUTRAL_HEADER_HINTS = ("ישוב", "יישוב", "מוסד", "רחוב", "גן", "מסגרת",
                        "בית ספר", "רשות", "מועצה", "שכבה", "כיתה")


#: שדות שאסור למפות אליהם: הטעינה כותבת אותם בעצמה, או שהדפדפן מחשב
#: אותם מחדש בכל טעינה. מיפוי אליהם היה "מצליח" ונעלם. זהה לסינון
#: ב-UpdateGanim.tsx ול-BROWSER_COMPUTED_FIELDS ב-lib/computed.ts.
RESERVED = {
    "source_group", "MATZAV_RISHUM_TEUR", "tier_b_uploaded_at", "tier_b_upload_id",
    "STATUS_CHINUCH_MEYUCHAD", "STATUS_TALMID_BARASHUT", "SEMEL_MASLUL", "KFILUT_DRAG_B",
}

# כל שדות היעד שאפשר למפות אליהם — 137. נוצר ע"י gen_tier_b_catalog.py
# מתוך fields.ts; לא לערוך ידנית. TARGETS שלמעלה הוא תת-קבוצה שלו: השדות
# שיש להם המרה מיוחדת, ושלפיהם נקבע הסימון הירוק/צהוב במסך האישור.
try:
    from tier_b_catalog import CATALOG
except ImportError:          # המחולל טרם הורץ — נשארים עם המרכזיים בלבד
    CATALOG: dict[str, tuple[str, str, str]] = {
        k: (v[0], v[1], "") for k, v in TARGETS.items()
    }

_NUMERIC_TYPES = {"numeric", "integer", "bigint", "smallint", "real", "double precision"}


def kind_for(key: str, db_type: str | None = None) -> str:
    """
    סוג ההמרה לשדה יעד.

    לשדות המוכרים (TARGETS) — הסוג המיוחד שהוגדר להם (ת"ז, סמל ישוב...).
    לכל עמודה אחרת שהמשתמש בחר במסך האישור — לפי סוג העמודה במסד, כדי
    שתאריך ייכתב כתאריך ומספר כמספר, ולא יפיל את כל הטעינה.
    """
    if key in TARGETS:
        return TARGETS[key][1]
    if key in CATALOG:
        return CATALOG[key][1]
    if db_type == "date":
        return "date"
    if db_type in _NUMERIC_TYPES:
        return "number"
    return "text"


def label(key: str) -> str:
    """התווית בעברית של שדה יעד, לתצוגה במסך האישור ובדוחות."""
    if key in TARGETS:
        return TARGETS[key][0]
    if key in CATALOG:
        return CATALOG[key][0]
    return key


def kind(key: str) -> str:
    """סוג השדה — קובע איזו המרה תופעל עליו."""
    return kind_for(key)


def all_targets_for_prompt() -> list[dict]:
    """
    כל שדות היעד כפי שהם נשלחים ל-AI. הקבוצה נכללת כי היא מה שמבדיל בין
    "נייד 2 תלמיד" ל"נייד 2 הורה 1" — שתי תוויות כמעט זהות.

    אין כאן שום נתון של תלמיד — רק סכימה.
    """
    return [{"שדה": k, "תיאור": v[0], "סוג": v[1], "קבוצה": v[2]}
            for k, v in CATALOG.items()]


def targets_for_prompt() -> list[dict]:
    """
    רשימת שדות היעד כפי שהיא נשלחת ל-AI: מפתח, תווית וסוג.
    אין כאן שום נתון של תלמיד — רק סכימה.
    """
    return [{"שדה": k, "תיאור": v[0], "סוג": v[1]} for k, v in TARGETS.items()]
