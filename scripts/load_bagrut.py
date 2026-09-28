"""
קליטת סבב בגרות: T1 + T2 + המצפן → טבלאות bagrut_* ב-Supabase
(bagrut_students כולל עמודות T2, bagrut_grades, bagrut_subjects, bagrut_tracking).

    python scripts/load_bagrut.py --accdb <קובץ אקסס> --compass <קובץ אקסל> \
        --authority 800037 --school 800037 --season קיץ --year תשפ"ו [--index] [--dry-run]

--dry-run   מפרק ומדפיס סיכום (ספירות בלבד — בלי שמות, ת"ז או ציונים), לא נוגע במסד.
--index     טוען גם את אינדקס השאלונים הארצי מטבלה 3 באקסס.

מקורות באקסס (מבנה הקובץ של סבא, קיץ תשפ"ו):
    זכאות 1   — פרטי תלמיד + דגלי מעקב
    זכאות 11  — T1 מלל          (קבוצה: חובה)
    זכאות 12  — T1 אנגלית ומתמטיקה
    זכאות 13  — T1 הרחבה, חלק 1 + חלק 2 (פוצל בגלל מגבלת 255 עמודות)
    זכאות 14  — T2 ניתוח AI
    זכאות 3   — אינדקס שאלונים ארצי (עם --index)

פירוק T1 — למה לפי מיקום ולא לפי שם עמודה:
    שמות העמודות נכתבו ביד ואינם עקביים. "MoreshetVeDatziunSofi" (בלי T),
    "Q14375…AravimSofi" (במקום Tziun), "Q8776283…" (ספרה עודפת), ו-
    "Q34211-1/-2/-3" בלי שם בכלל. מה שכן עקבי הוא **הסדר**: כל מקצוע נפתח
    בעמודת ציון סופי ואחריה חמשת מדדיו, ואז שאלונים בשלשות — ציון, משקל,
    משוקלל. לכן הפירוק הולך לפי המיקום, וסמל השאלון של שלשה נקבע ברוב
    קולות בתוכה (כך "8776283" נבלע ב-"776283" של שתי חברותיה).
"""
import argparse
import collections
import glob
import io
import os
import re
import sys

import openpyxl
import pyodbc

if hasattr(sys.stdout, "buffer"):
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8")

HERE = os.path.dirname(os.path.abspath(__file__))
ENV_DB_FILE = os.path.join(HERE, "..", ".env.db")

T_DETAILS = "זכאות 1 - פרטי תתלמידים"
T1_TABLES = [
    ("זכאות 11 - ניתוח רק מקצועות המלל - חדש", "חובה"),
    ("זכאות 12 - ניתוח רק אנגלית ומתמטיקה - חדש", "אנגלית ומתמטיקה"),
    ("זכאות 13 - ניתוח רק מקצועות הרחבה אבו רביע - חלק 1", "מורחב"),
    ("זכאות 13 - ניתוח רק מקצועות הרחבה אבו רביע - חלק 2", "מורחב"),
]
T_T2 = "זכאות 14 - ניתוח AI מהצאט"
T_INDEX = "זכאות 3 - מותאם GPT אינדקס שאלני בגרות של משרד החינוך ללא כפילות"

# מדדי מקצוע ב-T1. הסדר חשוב: "MishkalMitztaber" נבדק לפני "ziunMitztaber".
METRICS = [
    ("final_grade", re.compile(r"(?i)t?ziunsofi$")),
    ("cumulative_weight", re.compile(r"(?i)mishkalmitztaber$")),
    ("cumulative_grade", re.compile(r"(?i)t?ziunmitztaber$")),
    ("units", re.compile(r"(?i)yechidot$")),
    ("questionnaires", re.compile(r"(?i)sheelonim$")),
    ("completion_status", re.compile(r"(?i)statushashlama$")),
]
Q_COL = re.compile(r"^Q(\d+)")
ROLE_BY_SUFFIX = [("weighted", re.compile(r"(?i)meshuklal$")),
                  ("weight", re.compile(r"(?i)mishkal$")),
                  ("grade", re.compile(r"(?i)tziun$"))]
POSITIONAL_ROLES = ["grade", "weight", "weighted"]

T2_FIELDS = {
    "סטטוס לזכאות לפ T1": "status",
    "מה כבר בוצע": "done_summary",
    "ריכוז מקצועות וציונים לזכאות": "grades_summary",
    "חסמים לזכאות": "blockers",
    "התערבות מומלצת לזכאות": "intervention",
    "אפשרות לזכאות עם שלילי אחד": "one_negative_option",
    "זוג מקצועות לקומפנסציה": "compensation_pair",
    "האם זכאי לשיפוי": "compensation_eligible",
    "מספר שליליים": "negatives_count",
    "סטטוס בשפת אם - ערבית": "mother_tongue_status",
    "סהכ יחידות לתלמיד במקצועות המלל": "core_units",
    "מקצוע מוגבר": "reinforced_subject",
    "סהכ יחדות זכאות": "total_units",
    "תאור סיבת אי הזכאות": "reason",
}


# ─────────────────────────────── עזרים ───────────────────────────────

def sid(value):
    """ת"ז כמחרוזת בת 9 ספרות. אקסס שומר אותה כ-Double."""
    if value is None or value == "":
        return None
    return str(int(float(value))).zfill(9)


def txt(value):
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def num(value):
    if value is None or value == "":
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def read_table(cur, table, columns=None):
    sel = "*" if columns is None else ", ".join(f"[{c}]" for c in columns)
    cur.execute(f"SELECT {sel} FROM [{table}]")
    names = [d[0] for d in cur.description]
    return names, [dict(zip(names, row)) for row in cur.fetchall()]


# ─────────────────────────────── המצפן ───────────────────────────────

def read_compass(path):
    """גיליון2: שורה לכל מקצוע — סוג (I), קוד (J), שם (K), זוגות שאלון/משקל
    בעמודות X..AK, הערות (AL). שורות בלי שם מקצוע (סיכומים) — מדלגים."""
    wb = openpyxl.load_workbook(path, data_only=True)
    ws = wb["גיליון2"]
    rows = []
    for r in range(4, ws.max_row + 1):
        name = txt(ws.cell(r, 11).value)          # K
        if not name or name == "שם המקצוע":
            continue
        pairs = []
        for col in range(24, 38, 2):              # X=24 … AJ=36
            code = ws.cell(r, col).value
            if isinstance(code, (int, float)) and code >= 1000:
                pairs.append((int(code), num(ws.cell(r, col + 1).value)))
        if not pairs:
            continue
        kind = txt(ws.cell(r, 9).value)           # I: מלל / אנגלית / מתמטיקה / מורחב
        rows.append({
            "row": r,
            "name": name,
            "kind": kind,
            "internal": r >= 35,                  # הטבלה התחתונה: מקצועות פנימיים
            "pairs": pairs,
            "notes": txt(ws.cell(r, 38).value),   # AL
        })
    return rows


# ─────────────────────────────── T1 ───────────────────────────────

def parse_t1_table(names, rows, group):
    """מחזיר (בלוקים, ציונים, מדדים). בלוק = מקצוע: key, עמודות מדדים, שלשות."""
    blocks = []
    cur_block = None
    pending_q = []

    def flush_q():
        # שלשות לפי הסדר. שארית שאינה שלשה = תקלה במבנה, לא מנחשים.
        if not pending_q:
            return
        if len(pending_q) % 3:
            raise ValueError(f"שאלונים לא בשלשות בבלוק {cur_block['key']}: {pending_q}")
        for i in range(0, len(pending_q), 3):
            trio = pending_q[i:i + 3]
            codes = collections.Counter(int(Q_COL.match(c).group(1)) for c in trio)
            code = codes.most_common(1)[0][0]
            roles = {}
            for pos, col in enumerate(trio):
                role = next((r for r, rx in ROLE_BY_SUFFIX if rx.search(col)), None)
                roles[role or POSITIONAL_ROLES[pos]] = col
            if len(roles) != 3:            # שני "Tziun" בשלשה — חוזרים למיקום
                roles = dict(zip(POSITIONAL_ROLES, trio))
            cur_block["trios"].append((code, roles))
        pending_q.clear()

    for col in names:
        if Q_COL.match(col):
            if cur_block is None:
                raise ValueError(f"עמודת שאלון לפני מקצוע: {col}")
            pending_q.append(col)
            continue
        metric = next((m for m, rx in METRICS if rx.search(col)), None)
        if metric is None:
            continue                                   # עמודות זיהוי
        if metric == "final_grade":
            flush_q()
            cur_block = {"metrics": {}, "trios": [], "group": group, "key": None}
            blocks.append(cur_block)
        cur_block["metrics"][metric] = col
        if metric == "units":                          # הקידומת העקבית ביותר
            cur_block["key"] = re.sub(r"(?i)yechidot$", "", col)
    flush_q()

    for b in blocks:
        if not b["key"]:
            b["key"] = re.sub(r"(?i)t?ziunsofi$", "", b["metrics"]["final_grade"])

    grades, subjects = [], []
    for row in rows:
        student = sid(row.get("MisparZehutChinuch"))
        if not student:
            continue
        for b in blocks:
            m = {k: row.get(c) for k, c in b["metrics"].items()}
            if any(v not in (None, "") for v in m.values()):
                subjects.append({
                    "student_id": student, "subject_key": b["key"],
                    "final_grade": num(m.get("final_grade")),
                    "cumulative_grade": num(m.get("cumulative_grade")),
                    "units": num(m.get("units")),
                    "questionnaires": txt(m.get("questionnaires")),
                    "cumulative_weight": num(m.get("cumulative_weight")),
                    "completion_status": txt(m.get("completion_status")),
                })
            for code, roles in b["trios"]:
                g, w, wd = (num(row.get(roles[r])) for r in POSITIONAL_ROLES)
                if g is None and wd is None:
                    continue
                grades.append({"student_id": student, "subject_key": b["key"],
                               "questionnaire_code": code, "grade": g,
                               "weight": w, "weighted": wd})
    return blocks, grades, subjects


def name_blocks(blocks, compass, index):
    """שם עברי לכל בלוק: המקצוע במצפן שחולק איתו הכי הרבה שאלונים.
    גיבוי: שם המקצוע באינדקס הארצי. אחרון: הקידומת מ-T1."""
    for b in blocks:
        codes = {c for c, _ in b["trios"]}
        best = max(compass, key=lambda s: len(codes & {c for c, _ in s["pairs"]}), default=None)
        if best and codes & {c for c, _ in best["pairs"]}:
            b["name"], b["compass"] = best["name"], best
            continue
        names = collections.Counter(index[c]["subject_name"] for c in codes if c in index)
        b["name"], b["compass"] = (names.most_common(1)[0][0] if names else b["key"]), None


# ─────────────────────────────── ראשי ───────────────────────────────

def load_env_db():
    if not os.path.exists(ENV_DB_FILE):
        return
    for line in open(ENV_DB_FILE, encoding="utf-8"):
        line = line.strip()
        if line and not line.startswith("#") and "=" in line:
            k, _, v = line.partition("=")
            os.environ.setdefault(k.strip(), v.strip())


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--accdb", required=True)
    ap.add_argument("--compass", required=True)
    ap.add_argument("--authority", required=True)
    ap.add_argument("--school", required=True)
    ap.add_argument("--season", required=True, choices=["קיץ", "חורף"])
    ap.add_argument("--year", required=True)
    ap.add_argument("--index", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    accdb = glob.glob(a.accdb)[0] if any(ch in a.accdb for ch in "*?") else a.accdb
    compass_path = glob.glob(a.compass)[0] if any(ch in a.compass for ch in "*?") else a.compass

    con = pyodbc.connect(r"DRIVER={Microsoft Access Driver (*.mdb, *.accdb)};DBQ="
                         + accdb + ";ReadOnly=1")
    cur = con.cursor()

    # אינדקס ארצי — תמיד נקרא (לשמות גיבוי), נטען רק עם --index.
    _, idx_rows = read_table(cur, T_INDEX)
    index = {}
    for r in idx_rows:
        code = r.get("סמל שאלון מערכת 1")
        if code is None:
            continue
        index[int(code)] = {
            "code": int(code),
            "subject_name": txt(r.get("שם מקצוע מערכת 2")),
            "block": txt(r.get("בלוק 3")),
            "subject_type": txt(r.get("סוג מקצוע 4")),
            "subject_group": txt(r.get("קבוצת המקצוע 5")),
            "exam_form": txt(r.get("צורת היבחנות שאלון 6")),
            "exam_kind": txt(r.get("סוג היבחנות שאלון 7")),
            "units": int(r["יחידות מקצוע 13"]) if r.get("יחידות מקצוע 13") is not None else None,
            "weight": num(r.get("משקל יחסי של השאלון 14")),
            "in_final_grade": r.get("משתתף בציון הסופי של המקצוע 15"),
            "required_count": int(r["מספר שאלונים נידרש במקצוע 18"]) if r.get("מספר שאלונים נידרש במקצוע 18") is not None else None,
            "relation": txt(r.get("שאלון ראשי או ראשי ותת  תנאי לראשי 19")),
            "notes": txt(r.get("הערות לשאלון")),
        }

    compass = read_compass(compass_path)

    # פרטי תלמיד — בלי עמודת הקבצים המצורפים (Attachment, pyodbc לא קורא).
    detail_cols = ["MisparZehutChinuch", "SemelMosad", "SchoolName", "ShemTalmidChinuch",
                   "Prati", "Mishpacha", "Shichva", "KitatEmChinuch", "HaImChaserChinuch",
                   "Hashad", "Ikuv", "MaatgerimBemyuhad", "ZeroChanceZakaut",
                   "HearotTalmidShort", "HearotTalmidLong"]
    _, detail_rows = read_table(cur, T_DETAILS, detail_cols)
    students, tracking = [], []
    school_name = None
    for r in detail_rows:
        s = sid(r["MisparZehutChinuch"])
        if not s:
            continue
        school_name = school_name or txt(r["SchoolName"])
        students.append({
            "student_id": s, "school_code": a.school,
            "first_name": txt(r["Prati"]), "last_name": txt(r["Mishpacha"]),
            "full_name": txt(r["ShemTalmidChinuch"]),
            "grade": txt(r["Shichva"]), "class_name": txt(r["KitatEmChinuch"]),
            "track": None, "missing_status": txt(r["HaImChaserChinuch"]),
        })
        flags = dict(suspected=bool(r["Hashad"]), has_blocker=bool(r["Ikuv"]),
                     fighting=bool(r["MaatgerimBemyuhad"]), zero_chance=bool(r["ZeroChanceZakaut"]),
                     note_short=txt(r["HearotTalmidShort"]), note_long=txt(r["HearotTalmidLong"]))
        if any(flags.values()):
            tracking.append({"school_code": a.school, "student_id": s, **flags})

    all_blocks, grades, subjects = [], [], []
    for table, group in T1_TABLES:
        names, rows = read_table(cur, table)
        b, g, sb = parse_t1_table(names, rows, group)
        all_blocks += b
        grades += g
        subjects += sb

    name_blocks(all_blocks, compass, index)

    # מפתח כפול = אותו מקצוע פוצל בין שתי טבלאות — שגיאה במבנה, לא ממזגים בשקט.
    dup = [k for k, n in collections.Counter(b["key"] for b in all_blocks).items() if n > 1]
    if dup:
        sys.exit(f"מקצוע מופיע ביותר מבלוק אחד: {dup}")

    _, t2_rows = read_table(cur, T_T2)
    eligibility = []
    for r in t2_rows:
        s = sid(r.get("MsparZehutTalmid"))
        if not s:
            continue
        rec = {"student_id": s}
        for src, dst in T2_FIELDS.items():
            v = r.get(src)
            rec[dst] = (int(v) if v is not None else None) if dst == "negatives_count" else \
                       (num(v) if dst == "core_units" else txt(v))
        eligibility.append(rec)
    con.close()

    # ── המצפן → מקצועות הסבב ותוכנית. מקצוע במצפן שאין לו בלוק ב-T1
    # (למשל הפנימיים) נכנס עם מפתח משלו, כדי שהתוכנית תהיה שלמה.
    by_compass_row = {id(b["compass"]): b for b in all_blocks if b["compass"]}
    round_subjects, program = [], []
    for i, b in enumerate(all_blocks):
        units = collections.Counter(index[c]["units"] for c, _ in b["trios"]
                                    if c in index and index[c]["units"]).most_common(1)
        lvl = re.search(r"(\d)$", b["key"])
        round_subjects.append({"subject_key": b["key"], "subject_name": b["name"],
                               "subject_group": b["group"],
                               "units": int(lvl.group(1)) if lvl else (units[0][0] if units else None),
                               "sort": i})
    for j, s in enumerate(compass):
        b = by_compass_row.get(id(s))
        key = b["key"] if b else f"P{s['row']}"
        if not b:
            round_subjects.append({"subject_key": key, "subject_name": s["name"],
                                   "subject_group": "פנימי" if s["internal"] else "מורחב",
                                   "units": None, "sort": 1000 + j})
        for k, (code, weight) in enumerate(s["pairs"]):
            program.append({"subject_key": key, "questionnaire_code": code, "weight": weight,
                            "sort": k, "notes": s["notes"] if k == 0 else None})

    # ── סיכום (ספירות בלבד)
    grade_by = collections.Counter(s["grade"] for s in students)
    graduating = collections.Counter(
        next((s["grade"] for s in students if s["student_id"] == e["student_id"]), None)
        for e in eligibility).most_common(1)
    graduating = graduating[0][0] if graduating else None
    t1_codes = {g["questionnaire_code"] for g in grades}
    prog_codes = {p["questionnaire_code"] for p in program}
    consistent = sum(1 for g in grades if None not in (g["grade"], g["weight"], g["weighted"])
                     and abs(g["grade"] * g["weight"] - g["weighted"]) <= 0.51)
    checkable = sum(1 for g in grades if None not in (g["grade"], g["weight"], g["weighted"]))
    bad_grades = sum(1 for g in grades if g["grade"] is not None and g["grade"] > 100)
    known_ids = {s["student_id"] for s in students}

    print(f"בית ספר: {school_name} ({a.school}) · {a.season} {a.year} · רשות {a.authority}")
    print(f"תלמידים: {len(students)} · לפי שכבה: {dict(grade_by)} · שכבה מסיימת (T2): {graduating}")
    print(f"מקצועות ב-T1: {len(all_blocks)} · ציוני שאלון: {len(grades)} · שורות מדדים: {len(subjects)}")
    for b in all_blocks:
        print(f"   {b['group']:<16} {b['key']:<34} → {b['name']:<28} שאלונים: {len(b['trios'])}")
    print(f"בדיקת שלשות: ציון×משקל=משוקלל ב-{consistent}/{checkable}")
    print(f"ציון מעל 100: {bad_grades}")
    print(f"T2: {len(eligibility)} · מתוכם בלי פרטי תלמיד: {sum(1 for e in eligibility if e['student_id'] not in known_ids)}")
    print(f"מצפן: {len(compass)} מקצועות, {len(program)} שאלונים")
    print(f"   שאלונים ב-T1 שאינם במצפן: {len(t1_codes - prog_codes)} · במצפן ואין להם ציון: {len(prog_codes - t1_codes)}")
    print(f"מעקב — תלמידים עם דגל או הערה: {len(tracking)}")
    print(f"אינדקס ארצי: {len(index)} שאלונים")

    if a.dry_run:
        print("\n(--dry-run — המסד לא נגע)")
        return

    # מלכודת 30: טעינה שמוחקת ואז מכניסה מסרבת על קלט ריק *לפני* המחיקה.
    if not students or not grades or not subjects:
        sys.exit("קלט ריק — לא טוען (ולא מוחק את הסבב הקיים)")

    import psycopg2
    from psycopg2.extras import execute_values, Json
    load_env_db()
    pg = psycopg2.connect(host=os.environ["PGHOST"], port=int(os.environ.get("PGPORT", "5432")),
                          dbname=os.environ.get("PGDATABASE", "postgres"),
                          user=os.environ["PGUSER"], password=os.environ["PGPASSWORD"],
                          sslmode="require", connect_timeout=20)
    pg.autocommit = False
    code = a.authority
    try:
        with pg.cursor() as c:
            c.execute("select 1 from public.authorities where code = %s", (code,))
            if not c.fetchone():
                sys.exit(f"הרשות {code} אינה קיימת — יש ליצור אותה במסך הניהול קודם")
            if a.index:
                cols = list(next(iter(index.values())).keys())
                execute_values(c, f"""
                    insert into public.bagrut_questionnaires ({', '.join(cols)}) values %s
                    on conflict (code) do update set
                    {', '.join(f'{k} = excluded.{k}' for k in cols if k != 'code')}, updated_at = now()""",
                    [tuple(q[k] for k in cols) for q in index.values()])

            # סבב קיים עם אותו מפתח נמחק על כל שורותיו (cascade). המעקב נשאר —
            # הוא לפי בית ספר + ת"ז, לא לפי סבב.
            c.execute("""delete from public.bagrut_rounds
                         where authority_code=%s and school_code=%s and season=%s and school_year=%s""",
                      (code, a.school, a.season, a.year))
            stats = {"students": len(students), "grades": len(grades), "subjects": len(subjects),
                     "eligibility": len(eligibility), "program": len(program),
                     "orphans_t1": len(t1_codes - prog_codes), "grades_over_100": bad_grades}
            c.execute("""insert into public.bagrut_rounds
                           (authority_code, school_code, school_name, season, school_year,
                            graduating_grade, source, stats)
                         values (%s,%s,%s,%s,%s,%s,%s,%s) returning id""",
                      (code, a.school, school_name, a.season, a.year, graduating,
                       os.path.basename(accdb), Json(stats)))
            rid = c.fetchone()[0]

            def put(table, rows, cols):
                execute_values(c, f"insert into public.{table} (round_id, {', '.join(cols)}) values %s",
                               [(rid, *[r[k] for k in cols]) for r in rows], page_size=1000)

            put("bagrut_round_subjects", round_subjects,
                ["subject_key", "subject_name", "subject_group", "units", "sort"])
            put("bagrut_program", program,
                ["subject_key", "questionnaire_code", "weight", "sort", "notes"])
            # T2 נכנס לשורת התלמיד. תלמיד בלי T2 מקבל עמודות ריקות ו-in_t2=false.
            t2_by_id = {e["student_id"]: e for e in eligibility}
            t2_cols = list(T2_FIELDS.values())
            for s in students:
                e = t2_by_id.get(s["student_id"])
                s["authority_code"] = code
                s["in_t2"] = e is not None
                for k in t2_cols:
                    s[k] = e[k] if e else None
            put("bagrut_students", students,
                ["student_id", "authority_code", "school_code", "first_name", "last_name",
                 "full_name", "grade", "class_name", "track", "missing_status", "in_t2"] + t2_cols)
            put("bagrut_grades", grades,
                ["student_id", "subject_key", "questionnaire_code", "grade", "weight", "weighted"])
            put("bagrut_subjects", subjects,
                ["student_id", "subject_key", "final_grade", "cumulative_grade", "units",
                 "questionnaires", "cumulative_weight", "completion_status"])

            # מעקב: רק מה שעוד לא קיים. עריכה שנעשתה באתר גוברת על אקסס.
            if tracking:
                tcols = ["authority_code", "school_code", "student_id", "suspected", "has_blocker",
                         "fighting", "zero_chance", "note_short", "note_long"]
                execute_values(c, f"""insert into public.bagrut_tracking ({', '.join(tcols)})
                                      values %s on conflict (authority_code, school_code, student_id)
                                      do nothing""",
                               [tuple({**t, "authority_code": code}[k] for k in tcols) for t in tracking])
        pg.commit()
        print(f"\n✓ נטען. סבב {rid}")
    except Exception:
        pg.rollback()
        raise
    finally:
        pg.close()


if __name__ == "__main__":
    main()
