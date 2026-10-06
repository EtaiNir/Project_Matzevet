"""
סוכן העיבוד — רץ ברקע על המחשב של סבא ומטפל בהעלאות מהאתר.

שני מקורות עבודה:

  א. העלאה מהאתר — כל 5 שניות בודק אם יש רשומה 'pending' ב-moe_uploads,
     מוריד את הקבצים מ-Storage ומעבד.

  ב. תיקיית מצב"ת מקומית — כל דקה סורק תיקייה שאליה מגיעים אוטומטית
     קובצי משרד החינוך של כל המועצות, מקבץ אותם לפי קוד הרשות, ומעבד כל
     מועצה שהקבצים שלה השתנו. נדרש MATZEVET_WATCH_FOLDER ב-.env.agent.

ועוד שני תורים מהאתר, באותה לולאה:

  ג. דרג ב' (גנים) — tier_b_uploads: זיהוי שדות, אישור באתר, טעינה.
  ד. סבב בגרות — bagrut_uploads: T1 + T2 + מצפן, בדיקה וטעינה בריצה
     אחת (מבנה קבוע — בלי שלב אישור). ראה process_bagrut.

בשני המקרים אותה ליבה: pipeline -> גיבוי הטבלה הקיימת -> טעינה ל-Supabase,
והסטטוס מתועד ב-moe_uploads כך שנראה גם באתר.

הכל עטוף כך שתקלה בעדכון אחד לא מפילה את הסוכן.
"""
from __future__ import annotations

import argparse
import io
import json
import logging
import os
import shutil
import subprocess
import sys
import tempfile
import time
import traceback
from logging.handlers import RotatingFileHandler
from pathlib import Path

import pandas as pd
import psycopg2
import requests
import urllib3

# יירוט SSL ברשתות מסוימות (נטספארק וכד') — החיבור עדיין ל-Supabase
urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)

# הלוג לקונסולה חייב להיות UTF-8. בברירת המחדל של Windows (cp1255) כל
# שורה עם ═ / → / ✓ זרקה UnicodeEncodeError, ו-logging הדפיס עליה traceback
# שלם — לוג של 189 שורות שרובן רעש, בדיוק כשהיה צריך לקרוא אותו. תחת
# pythonw (המשימה המתוזמנת) אין stdout כלל, ולכן השגיאה נבלעת.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding="utf-8", errors="replace")
    except (AttributeError, ValueError):
        pass

AGENT_DIR = Path(__file__).resolve().parent
DASHBOARD_DIR = AGENT_DIR.parent
PROJECT_ROOT = DASHBOARD_DIR.parent            # ...\ממשק אינטרנטי
PIPELINE_DIR = PROJECT_ROOT / "Itay_Modules" / "python_modules"
LOAD_SCRIPT = DASHBOARD_DIR / "scripts" / "load_main.py"
TIER_B_SCRIPT = DASHBOARD_DIR / "scripts" / "load_tier_b.py"

BACKUP_DIR = AGENT_DIR / "backups"
BACKUP_KEEP = 12           # תקרת גיבויים לרשות, מגן מפני עדכונים תכופים
BACKUP_MAX_AGE_DAYS = 90   # גיבוי ישן מזה נמחק (חוץ מהאחרון, שתמיד נשמר)

WATCH_STATE = AGENT_DIR / "watch-state.json"
WATCH_EVERY = 60          # כל כמה שניות לסרוק את תיקיית המצב"ת המקומית
FILE_SETTLE_SECONDS = 30  # קובץ שנגעו בו לאחרונה - ממתינים שהעתקתו תסתיים

# ששת הקבצים שמשרד החינוך מפיץ, לפי הקידומת בשם
MOE_PREFIXES = ("TALMIDIM", "PIRTEY_KESHER", "GORMEY_KESHER",
                "MEGAMOT", "MOSDOT", "KITOT")

UPLOADS_BUCKET = "moe-uploads"
MAIN_FILE_SUFFIX = "_Talmidim_gormey_kesher_pirtey_kesher_mosdot_megamot_kitot.xlsx"
TEMPLATE_TABLE = "students_1400000"   # התבנית שממנה משכפלים טבלה לרשות חדשה

log = logging.getLogger("agent")


# ═══════════════════════════ הגדרות ═══════════════════════════

def load_env_files() -> None:
    """טוען .env.db (חיבור ל-DB) ו-.env.agent (פרטי חשבון הסוכן)."""
    for name in (".env.db", ".env.agent"):
        path = DASHBOARD_DIR / name
        if not path.exists():
            continue
        for line in path.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                key, _, value = line.partition("=")
                os.environ.setdefault(key.strip(), value.strip())


def require(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        sys.exit(
            f"חסר משתנה סביבה {name}.\n"
            f"הגדר אותו ב-{DASHBOARD_DIR / '.env.db'} או ב-{DASHBOARD_DIR / '.env.agent'}"
        )
    return value


def setup_logging(verbose: bool) -> None:
    log_file = AGENT_DIR / "agent.log"
    fmt = logging.Formatter("%(asctime)s  %(levelname)-7s  %(message)s", "%Y-%m-%d %H:%M:%S")

    # קובץ מתגלגל — לא מתנפח לאורך חודשים של ריצה
    file_handler = RotatingFileHandler(log_file, maxBytes=2_000_000, backupCount=5,
                                       encoding="utf-8")
    file_handler.setFormatter(fmt)

    console = logging.StreamHandler(sys.stdout)
    console.setFormatter(fmt)

    log.setLevel(logging.DEBUG if verbose else logging.INFO)
    log.addHandler(file_handler)
    log.addHandler(console)


# ═══════════════════════════ מסד הנתונים ═══════════════════════════

def connect():
    """
    autocommit=True בכוונה: כל פעולה כאן היא הצהרה בודדת, ו-SELECT שנשאר
    בטרנזקציה פתוחה מחזיק ACCESS SHARE על הטבלה — מה שחוסם את ה-TRUNCATE
    של הטעינה עד שפג לה הזמן. זה הפיל את העיבוד פעמיים לפני שאותר.
    """
    conn = psycopg2.connect(
        host=require("PGHOST"),
        port=int(os.environ.get("PGPORT", "5432")),
        dbname=os.environ.get("PGDATABASE", "postgres"),
        user=require("PGUSER"),
        password=require("PGPASSWORD"),
        sslmode="require",
        connect_timeout=20,
    )
    conn.autocommit = True
    return conn


def claim_next_upload(conn):
    """
    תופס העלאה ממתינה. ה-UPDATE ... WHERE status='pending' אטומי, ולכן שני
    סוכנים שירוצו במקביל לא יעבדו על אותה שורה.
    """
    with conn.cursor() as cur:
        cur.execute("""
            update public.moe_uploads
               set status = 'processing'
             where id = (
                   select id from public.moe_uploads
                    where status = 'pending'
                    order by uploaded_at
                    limit 1
                    for update skip locked)
            returning id, authority_code, storage_prefix, file_count
        """)
        row = cur.fetchone()
    if not row:
        return None
    return {"id": row[0], "code": row[1], "prefix": row[2], "files": row[3]}


def finish_upload(conn, upload_id, status, rows=None, error=None):
    with conn.cursor() as cur:
        cur.execute("""
            update public.moe_uploads
               set status = %s, processed_at = now(), rows_loaded = %s,
                   error_message = %s
             where id = %s
        """, (status, rows, (error or "")[:500] or None, upload_id))


# ═══════════════ קליטת דרג ב' (גנים) ═══════════════
#
# מסלול נפרד לגמרי מהמצב"ת, ובכוונה:
#   • הנתונים נכתבים ל-students_{code}_tier_b ואינם נוגעים בטבלה הראשית.
#   • **אין כאן מקור אוטומטי.** רק מה שהועלה דרך הכפתור באתר. סורק
#     התיקייה אינו יכול להגיע לכאן — הוא קורא .csv בלבד ודורש את ששת
#     קידומות המצב"ת.
#   • שני שלבים, עם אדם באמצע: קודם זיהוי השדות, ואז — אחרי אישור
#     במסך — הטעינה עצמה.


def claim_next_tier_b(conn):
    """
    תופס קליטת דרג ב' ממתינה. אותו `for update skip locked` כמו במצב"ת:
    בלעדיו שני סוכנים היו מעבדים את אותה שורה.
    """
    with conn.cursor() as cur:
        cur.execute("""
            update public.tier_b_uploads
               set status = 'processing'
             where id = (
                   select id from public.tier_b_uploads
                    where status = 'pending'
                    order by uploaded_at
                    limit 1
                    for update skip locked)
            returning id, authority_code, source_group, storage_path,
                      file_name, approved_mapping
        """)
        row = cur.fetchone()
    if not row:
        return None
    return {"id": row[0], "code": row[1], "group": row[2], "path": row[3],
            "file": row[4], "approved": row[5]}


def finish_tier_b(conn, upload_id, status, mapping=None, source=None,
                  rows=None, rejected=None, error=None, meta=None):
    with conn.cursor() as cur:
        cur.execute("""
            update public.tier_b_uploads
               set status           = %s,
                   proposed_mapping = coalesce(%s::jsonb, proposed_mapping),
                   mapping_meta     = coalesce(%s::jsonb, mapping_meta),
                   mapping_source   = coalesce(%s, mapping_source),
                   rows_loaded      = coalesce(%s, rows_loaded),
                   rows_rejected    = coalesce(%s, rows_rejected),
                   error_message    = %s,
                   processed_at     = case when %s in ('done','failed')
                                           then now() else processed_at end
             where id = %s
        """, (status,
              json.dumps(mapping, ensure_ascii=False) if mapping else None,
              json.dumps(meta, ensure_ascii=False) if meta else None,
              source, rows, rejected, (error or "")[:500] or None,
              status, upload_id))


def download_one(storage_path: str, target: Path) -> Path:
    """מוריד קובץ בודד מהבאקט. הנתיב כולל את קוד הרשות כחלק ראשון."""
    url = require("SUPABASE_URL").rstrip("/")
    resp = requests.get(f"{url}/storage/v1/object/{UPLOADS_BUCKET}/{storage_path}",
                        headers=storage_headers(), verify=False, timeout=300)
    resp.raise_for_status()
    target.mkdir(parents=True, exist_ok=True)
    path = target / Path(storage_path).name
    path.write_bytes(resp.content)
    log.info("   הורד %s (%.1fMB)", path.name, len(resp.content) / 1024 / 1024)
    return path


def run_tier_b(args_list: list) -> str:
    proc = subprocess.run(
        [sys.executable, str(TIER_B_SCRIPT), *args_list],
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "")[-800:]
        raise RuntimeError(f"קליטת דרג ב' נכשלה (קוד {proc.returncode}):\n{tail}")
    log.debug("פלט דרג ב':\n%s", (proc.stderr or "")[-1200:])
    return proc.stdout


def process_tier_b(conn, job) -> None:
    """
    שני שלבים, לפי מה שכבר אושר:

      אין approved_mapping  →  מזהה שדות, שומר הצעה, ועוצר ב-awaiting_approval.
      יש approved_mapping   →  טוען בפועל.

    ההפרדה הזו היא הגנה ולא נוחות: מיפוי שגוי בשקט על אלפי קטינים הוא
    בדיוק סוג התקלה שאין דרך לגלות בדיעבד.
    """
    code = job["code"]
    log.info("═" * 60)
    log.info("קליטת דרג ב' — רשות %s · %s · %s", code, job["group"], job["file"])

    work_dir = Path(tempfile.mkdtemp(prefix=f"tierb-{code}-"))
    try:
        log.info("1/3 מוריד את הקובץ…")
        local = download_one(job["path"], work_dir)

        # `is None` ולא `not`: מיפוי ריק `{}` הוא ערך שאושר, לא היעדר אישור.
        # עם `not` הוא נקרא כ"טרם אושר", והסוכן זיהה שדות מחדש בלולאה
        # אחרי כל לחיצה על אישור. מיפוי ריק שאושר צריך להיכשל ברעש בטעינה
        # (load_tier_b מסרב) — לא להסתובב בשקט.
        if job["approved"] is None:
            log.info("2/3 מזהה שדות…")
            out = run_tier_b(["--file", str(local), "--code", code,
                              "--group", job["group"], "--emit-mapping"])
            result = json.loads(out)
            finish_tier_b(conn, job["id"], "awaiting_approval",
                          mapping=result["mapping"], source=result["source"],
                          meta=result.get("meta"))
            log.info("✓ זוהו %s עמודות (%s) — ממתין לאישור באתר",
                     sum(1 for v in result["mapping"].values() if v), result["source"])
            return

        log.info("2/3 טוען לפי המיפוי שאושר…")
        mapping_file = work_dir / "mapping.json"
        mapping_file.write_text(json.dumps(job["approved"], ensure_ascii=False),
                                encoding="utf-8")
        run_tier_b(["--file", str(local), "--code", code, "--group", job["group"],
                    "--mapping", str(mapping_file), "--save-mapping"])

        log.info("3/3 סופר…")
        with conn.cursor() as cur:
            cur.execute(
                f'select count(*) from public.students_{code}_tier_b '
                'where source_group = %s', (job["group"],))
            rows = cur.fetchone()[0]
        finish_tier_b(conn, job["id"], "done", rows=rows)
        log.info("✓ הושלם — %s שורות בקבוצה '%s'", f"{rows:,}", job["group"])

    except Exception as exc:
        log.error("✗ נכשל: %s", exc)
        log.debug(traceback.format_exc())
        try:
            finish_tier_b(conn, job["id"], "failed", error=str(exc))
        except Exception:
            log.exception("לא הצלחתי לעדכן את סטטוס הכישלון")
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


# ═══════════════════════════ סבב בגרות ═══════════════════════════
#
# בדפוס של המצב"ת ולא של דרג ב': המבנה קבוע וידוע מראש (T1, T2, מצפן),
# ולכן אין מיפוי ואין אישור אדם באמצע. pending → processing → done/failed.
#
# הבדיקה והטעינה הן ריצה אחת של load_bagrut.py. שגיאות (סמל מוסד שאינו
# תואם, קובץ חסר, קלט ריק) עוצרות *לפני* כל שינוי במסד; אזהרות (משקלים
# שאינם 100%, שאלונים יתומים) נשמרות ב-report ומוצגות בהיסטוריה באתר.
#
# שמות הקבצים בבאקט הם לפי תפקיד (Storage פוסל עברית — מלכודת 31), אבל
# load_bagrut מזהה את הקבצים לפי תחילת השם העברי ("זכאות 11 …"). לכן
# לפני ההרצה כל קובץ מקבל שוב שם עברי לפי התפקיד שלו.

BAGRUT_SCRIPT = DASHBOARD_DIR / "scripts" / "load_bagrut.py"

# תפקיד בבאקט → השם שתחתיו load_bagrut מחפש אותו
BAGRUT_ROLE_NAMES = {
    "details": "זכאות 1 - פרטי תלמידים.xlsx",
    "t1_11": "זכאות 11 - מקצועות המלל.xlsx",
    "t1_12": "זכאות 12 - אנגלית ומתמטיקה.xlsx",
    "t2": "זכאות 14 - ניתוח זכאות.xlsx",
    # המבנה המאוחד (אגיאל): קובץ T1 אחד במקום 1/11/12/13. load_bagrut מזהה
    # אותו לפי "T1" בשם, ואת ה-T2 לפי "זכאות 14" — אותו שם כמו למעלה.
    "t1": "T1 - נתוני זכאות.xlsx",
}
# t1_13_1, t1_13_2 … → "זכאות 13 - חלק N.xlsx"  ·  compass → נפרד  ·  accdb → נפרד


def claim_next_bagrut(conn):
    with conn.cursor() as cur:
        cur.execute("""
            update public.bagrut_uploads
               set status = 'processing'
             where id = (
                   select id from public.bagrut_uploads
                    where status = 'pending'
                    order by uploaded_at
                    limit 1
                    for update skip locked)
            returning id, authority_code, school_code, season, school_year,
                      storage_prefix, files
        """)
        row = cur.fetchone()
    if not row:
        return None
    return {"id": row[0], "code": row[1], "school": row[2], "season": row[3],
            "year": row[4], "prefix": row[5], "files": row[6] or {}}


def finish_bagrut(conn, upload_id, status, report=None, error=None):
    report = report or {}
    with conn.cursor() as cur:
        cur.execute("""
            update public.bagrut_uploads
               set status        = %s,
                   report        = %s::jsonb,
                   round_id      = %s,
                   rows_loaded   = %s,
                   error_message = %s,
                   processed_at  = now()
             where id = %s
        """, (status, json.dumps(report, ensure_ascii=False) if report else None,
              report.get("round_id"),
              # בכישלון הדוח עדיין סופר תלמידים בקובץ — אבל אף אחד לא נטען
              (report.get("counts") or {}).get("students") if status == "done" else None,
              (error or "")[:800] or None, upload_id))


def process_bagrut(conn, job) -> None:
    code = job["code"]
    log.info("═" * 60)
    log.info("סבב בגרות — רשות %s · מוסד %s · %s %s", code, job["school"], job["season"], job["year"])

    work_dir = Path(tempfile.mkdtemp(prefix=f"bagrut-{code}-"))
    raw, src = work_dir / "raw", work_dir / "src"
    src.mkdir(parents=True)
    report_path = work_dir / "report.json"
    try:
        log.info("1/3 מוריד את הקבצים…")
        names = download_files(job["prefix"], raw)

        compass = accdb = None
        for name in names:
            role = Path(name).stem
            path = raw / name
            if role == "compass":
                compass = path
            elif role == "accdb":
                accdb = path
            elif role in BAGRUT_ROLE_NAMES:
                shutil.move(path, src / BAGRUT_ROLE_NAMES[role])
            elif role.startswith("t1_13"):
                part = role.rsplit("_", 1)[-1]
                shutil.move(path, src / f"זכאות 13 - מקצועות הרחבה - חלק {part}.xlsx")
            else:
                log.warning("   קובץ בתפקיד לא מוכר — מדלג: %s", name)

        args = (["--accdb", str(accdb), "--index"] if accdb else ["--xlsx-dir", str(src)])
        if compass:
            args += ["--compass", str(compass)]
        args += ["--authority", code, "--school", job["school"], "--season", job["season"],
                 "--year", job["year"], "--report-json", str(report_path)]

        log.info("2/3 בודק וטוען…")
        proc = subprocess.run(
            [sys.executable, str(BAGRUT_SCRIPT), *args],
            env={**os.environ, "PYTHONIOENCODING": "utf-8"},
            capture_output=True, text=True, encoding="utf-8", errors="replace",
        )
        report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else {}
        for w in report.get("warnings", []):
            log.warning("   ⚠ %s", w.get("text"))

        if proc.returncode != 0:
            # שגיאה שהבדיקה זיהתה — הודעה קריאה; אחרת קריסה — זנב הפלט (מלכודת 15)
            msg = " · ".join(report.get("errors") or []) or (proc.stderr or proc.stdout or "")[-800:]
            raise RuntimeError(msg)

        log.info("3/3 מעדכן סטטוס…")
        finish_bagrut(conn, job["id"], "done", report=report)
        counts = report.get("counts", {})
        log.info("✓ הושלם — %s תלמידים, %s ציונים, %s אזהרות",
                 counts.get("students"), counts.get("grades"), len(report.get("warnings", [])))

    except Exception as exc:
        log.error("✗ סבב הבגרות נכשל: %s", exc)
        log.debug(traceback.format_exc())
        try:
            report = json.loads(report_path.read_text(encoding="utf-8")) if report_path.exists() else None
            finish_bagrut(conn, job["id"], "failed", report=report, error=str(exc))
        except Exception:
            log.exception("לא הצלחתי לעדכן את סטטוס הכישלון")
    finally:
        # הקבצים מכילים ת"ז וציונים של תלמידים — לא נשארים בדיסק
        shutil.rmtree(work_dir, ignore_errors=True)


def ensure_table(conn, code: str) -> bool:
    """
    מוודא שקיימת טבלת students_{code}. אם לא — משכפל את מבנה טבלת התבנית
    ומגדיר RLS זהה. מחזיר True אם נוצרה טבלה חדשה.
    """
    table = f"students_{code}"
    if not code.isdigit():
        raise ValueError(f"קוד רשות לא חוקי: {code}")

    with conn.cursor() as cur:
        cur.execute("select to_regclass(%s)", (f"public.{table}",))
        if cur.fetchone()[0]:
            return False

        log.info("טבלה %s אינה קיימת — יוצר אותה מהתבנית", table)
        cur.execute(
            f'create table public.{table} (like public.{TEMPLATE_TABLE} including all)')
        cur.execute(f'alter table public.{table} enable row level security')
        cur.execute(f"""
            create policy {table}_read on public.{table}
              for select to authenticated
              using (public.has_authority('{code}')
                     and public.in_user_scope("SEMEL_YISHUV1", "SEMEL_MOSAD"))
        """)
        cur.execute("""
            insert into public.authorities (code, name) values (%s, %s)
            on conflict (code) do nothing
        """, (code, f"רשות {code}"))
        cur.execute("""
            insert into public.clients (authority_code) values (%s)
            on conflict (authority_code) do nothing
        """, (code,))
    return True


def check_moe_code(conn, code: str, file_code: str) -> None:
    """
    מוודא שקובצי המצב"ת שייכים לרשות שאליה נרשמה ההעלאה.

    קוד הרשות אצלנו אינו בהכרח זה של משרד החינוך, ולכן ההשוואה היא מול
    `authorities.moe_code`. בעדכון הראשון השדה ריק — אז לומדים אותו.
    מכאן ואילך אי-התאמה עוצרת את העיבוד: היא מסמנת שהועלו קבצים של
    מועצה אחרת, וטעינה כזו הייתה דורסת רשות שלמה בנתונים זרים.
    """
    with conn.cursor() as cur:
        cur.execute("select moe_code from public.authorities where code = %s", (code,))
        row = cur.fetchone()
        known = row[0] if row else None

        if known is None:
            cur.execute("update public.authorities set moe_code = %s where code = %s",
                        (file_code, code))
            log.info("    קוד משרד החינוך לרשות %s נלמד: %s", code, file_code)
            return

    if known != file_code:
        raise RuntimeError(
            f"הקבצים אינם שייכים לרשות הזו. ההעלאה נרשמה לרשות {code} "
            f"(קוד משרד החינוך {known}), אך הקבצים הם של רשות {file_code}. "
            "יש להעלות אותם תחת המועצה הנכונה."
        )


def backup_table(conn, code: str) -> Path | None:
    """
    שומר עותק של הטבלה לפני שהיא נדרסת.

    הטעינה עושה TRUNCATE, ולכן בלי גיבוי אין דרך לחזור לנתונים הקודמים —
    למשל אם התברר שקובץ מצב"ת שהועלה היה שגוי.

    הקובץ נשמר כאקסל כדי שאפשר יהיה לפתוח אותו בלחיצה כפולה ולהשוות מול
    המצב הנוכחי. השליפה עצמה נעשית ב-COPY לקובץ זמני — הרבה יותר מהיר
    מקריאה שורה-שורה — ורק אז ממירים.

    מחזיר את נתיב הגיבוי, או None אם אין מה לגבות (טבלה ריקה/חדשה).
    """
    rows = table_count(conn, code)
    if rows == 0:
        return None

    folder = BACKUP_DIR / f"students_{code}"
    folder.mkdir(parents=True, exist_ok=True)
    path = folder / f"students_{code}_{time.strftime('%Y-%m-%d_%H%M')}.xlsx"

    # mkstemp מחזיר מתאר קובץ *פתוח*. בלי לסגור אותו הקובץ נשאר נעול
    # בווינדוס, וגם הכתיבה וגם המחיקה בסוף נכשלות.
    fd, tmp_name = tempfile.mkstemp(suffix=".csv", prefix="backup-")
    os.close(fd)
    tmp_csv = Path(tmp_name)
    try:
        with io.open(tmp_csv, "w", encoding="utf-8", newline="") as fh:
            with conn.cursor() as cur:
                cur.copy_expert(
                    f"copy public.students_{code} to stdout with csv header", fh)

        # dtype=str כדי שתעודות זהות וסמלי מוסד לא יומרו למספרים ויאבדו
        # אפסים מובילים, ולא יוצגו בכתיב מדעי.
        df = pd.read_csv(tmp_csv, dtype=str, keep_default_na=False, low_memory=False)
        with pd.ExcelWriter(path, engine="openpyxl") as writer:
            df.to_excel(writer, index=False, sheet_name="תלמידים")
            # RTL מוגדר על תצוגת הגיליון, לא על החוברת
            writer.sheets["תלמידים"].sheet_view.rightToLeft = True
    finally:
        tmp_csv.unlink(missing_ok=True)

    size_mb = path.stat().st_size / 1024 / 1024
    log.info("    גובו %s שורות -> %s (%.1fMB)", f"{rows:,}", path.name, size_mb)

    prune_backups(folder)
    return path


def prune_backups(folder: Path) -> None:
    """
    מוחק גיבויים ישנים לפי שני כללים:
      * מעל BACKUP_MAX_AGE_DAYS ימים
      * מעבר ל-BACKUP_KEEP הגיבויים האחרונים (מגן מפני עדכונים תכופים)

    **הגיבוי האחרון לעולם אינו נמחק**, גם אם עבר את הגיל. אחרת מערכת
    שלא עודכנה חצי שנה הייתה נשארת בלי שום גיבוי, והעדכון הבא היה דורס
    את הטבלה בלי רשת ביטחון.
    """
    files = sorted(folder.glob("*.xlsx"), key=lambda p: p.stat().st_mtime,
                   reverse=True)
    if not files:
        return

    cutoff = time.time() - BACKUP_MAX_AGE_DAYS * 24 * 3600
    removed = 0
    for index, path in enumerate(files):
        if index == 0:
            continue                      # האחרון תמיד נשמר
        too_old = path.stat().st_mtime < cutoff
        beyond_limit = index >= BACKUP_KEEP
        if too_old or beyond_limit:
            path.unlink(missing_ok=True)
            removed += 1
            log.debug("    נמחק גיבוי %s (%s)", path.name,
                      "מעל 90 יום" if too_old else "מעבר למכסה")
    if removed:
        log.info("    נמחקו %s גיבויים ישנים", removed)


def table_count(conn, code: str) -> int:
    with conn.cursor() as cur:
        cur.execute(f"select count(*) from public.students_{code}")
        return cur.fetchone()[0]


# ═══════════════════════════ Storage ═══════════════════════════
#
# הסוכן מזדהה כמשתמש רגיל (מייל+סיסמה) ולא עם מפתח service_role.
# הסיבה: service_role עוקף כל הגנה, ואם המחשב של סבא ייפרץ — הכל חשוף.
# חשבון ייעודי אפשר להשהות בלחיצה אחת ממסך ניהול ההרשאות.

_token_cache = {"value": None, "expires": 0.0}


def agent_token() -> str:
    """מחזיר טוקן תקף, ומתחבר מחדש כשהוא עומד לפוג."""
    if _token_cache["value"] and time.time() < _token_cache["expires"] - 60:
        return _token_cache["value"]

    url = require("SUPABASE_URL").rstrip("/")
    resp = requests.post(
        f"{url}/auth/v1/token?grant_type=password",
        headers={"apikey": require("SUPABASE_ANON_KEY"),
                 "Content-Type": "application/json"},
        json={"email": require("AGENT_EMAIL"), "password": require("AGENT_PASSWORD")},
        verify=False, timeout=60,
    )
    if resp.status_code >= 300:
        raise RuntimeError(
            "התחברות הסוכן נכשלה — בדוק את AGENT_EMAIL / AGENT_PASSWORD, "
            f"ושהחשבון אינו מושהה. ({resp.status_code})"
        )
    body = resp.json()
    _token_cache["value"] = body["access_token"]
    _token_cache["expires"] = time.time() + body.get("expires_in", 3600)
    log.debug("טוקן חדש התקבל")
    return _token_cache["value"]


def storage_headers() -> dict:
    return {"apikey": require("SUPABASE_ANON_KEY"),
            "Authorization": f"Bearer {agent_token()}"}


def download_files(prefix: str, target: Path) -> list:
    """מוריד את כל הקבצים שתחת ה-prefix בבאקט אל תיקייה מקומית."""
    url = require("SUPABASE_URL").rstrip("/")
    headers = storage_headers()

    resp = requests.post(
        f"{url}/storage/v1/object/list/{UPLOADS_BUCKET}",
        headers={**headers, "Content-Type": "application/json"},
        json={"prefix": prefix, "limit": 100,
              "sortBy": {"column": "name", "order": "asc"}},
        verify=False, timeout=60,
    )
    resp.raise_for_status()
    names = [item["name"] for item in resp.json() if item.get("name")]
    if not names:
        raise RuntimeError(f"לא נמצאו קבצים תחת {prefix}")

    target.mkdir(parents=True, exist_ok=True)
    downloaded = []
    for name in names:
        r = requests.get(f"{url}/storage/v1/object/{UPLOADS_BUCKET}/{prefix}/{name}",
                         headers=headers, verify=False, timeout=300)
        r.raise_for_status()
        (target / name).write_bytes(r.content)
        downloaded.append(name)
        log.info("   הורד %s (%.1fMB)", name, len(r.content) / 1024 / 1024)
    return downloaded


# ═══════════════════════════ עיבוד ═══════════════════════════

def run_pipeline(data_folder: Path) -> None:
    """מריץ את ה-pipeline של איתי על תיקיית הקבצים שהורדנו."""
    env = {
        **os.environ,
        "PYTHONIOENCODING": "utf-8",
        "MATZEVET_DATA_FOLDER": str(data_folder),
        "MATZEVET_OUTPUT_FOLDER": str(data_folder),
    }
    proc = subprocess.run(
        [sys.executable, "Main_Module_6_files_using_JSON.py"],
        cwd=str(PIPELINE_DIR), env=env,
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "")[-800:]
        raise RuntimeError(f"ה-pipeline נכשל (קוד {proc.returncode}):\n{tail}")
    log.debug("פלט ה-pipeline:\n%s", (proc.stdout or "")[-1500:])


def load_to_db(main_file: Path, code: str) -> None:
    proc = subprocess.run(
        [sys.executable, str(LOAD_SCRIPT), "--file", str(main_file), "--code", code],
        env={**os.environ, "PYTHONIOENCODING": "utf-8"},
        capture_output=True, text=True, encoding="utf-8", errors="replace",
    )
    if proc.returncode != 0:
        tail = (proc.stderr or proc.stdout or "")[-800:]
        raise RuntimeError(f"הטעינה נכשלה (קוד {proc.returncode}):\n{tail}")
    log.debug("פלט הטעינה:\n%s", (proc.stdout or "")[-800:])


def process_files(conn, code: str, work_dir: Path) -> int:
    """
    הליבה המשותפת: מקבלת תיקייה עם 6 קבצי מצב"ת של רשות אחת, מריצה את
    ה-pipeline, מגבה את הטבלה הקיימת וטוענת. מחזירה את מספר השורות.

    שני מקורות מגיעים לכאן — העלאה מהאתר וסריקת התיקייה המקומית.
    """
    log.info("2/5 מריץ את ה-pipeline…")
    started = time.time()
    run_pipeline(work_dir)
    log.info("    הסתיים ב-%.0f שניות", time.time() - started)

    matches = sorted(work_dir.glob(f"*{MAIN_FILE_SUFFIX}"),
                     key=lambda p: p.stat().st_mtime, reverse=True)
    if not matches:
        raise RuntimeError("ה-pipeline לא יצר קובץ ראשי")
    main_file = matches[0]

    # ה-pipeline גוזר את קוד הרשות משם קובץ המצב"ת, והוא לא בהכרח הקוד
    # שלנו (כפר = 120 אצלנו, 5108 במשרד החינוך). לכן ההשוואה היא מול
    # moe_code שנלמד בעדכון הראשון — כדי לתפוס את המקרה המסוכן: קבצים
    # של מועצה אחת שהועלו תחת מועצה אחרת.
    file_code = main_file.name[: -len(MAIN_FILE_SUFFIX)]
    check_moe_code(conn, code, file_code)
    log.info("    קובץ ראשי: %s (%.1fMB)",
             main_file.name, main_file.stat().st_size / 1024 / 1024)

    log.info("3/5 מוודא שהטבלה קיימת…")
    is_new = ensure_table(conn, code)
    if is_new:
        log.info("    נוצרה טבלה חדשה לרשות %s", code)

    # טבלה שזה עתה נוצרה ריקה — אין מה לגבות
    if is_new:
        log.info("4/5 גיבוי — מדולג (טבלה חדשה)")
    else:
        log.info("4/5 מגבה את הטבלה הנוכחית…")
        backup_table(conn, code)

    log.info("5/5 טוען ל-Supabase…")
    load_to_db(main_file, code)
    return table_count(conn, code)


def process(conn, job) -> None:
    """העלאה שהגיעה מהאתר: מוריד מ-Storage ומעביר לליבה."""
    code = job["code"]
    log.info("═" * 60)
    log.info("העלאה מהאתר — רשות %s (%s קבצים)", code, job["files"])

    work_dir = Path(tempfile.mkdtemp(prefix=f"matzevet-{code}-"))
    try:
        log.info("1/5 מוריד קבצים…")
        download_files(job["prefix"], work_dir)
        rows = process_files(conn, code, work_dir)
        finish_upload(conn, job["id"], "done", rows=rows)
        log.info("✓ הושלם — %s שורות בטבלה students_%s", f"{rows:,}", code)
    except Exception as exc:
        log.error("✗ נכשל: %s", exc)
        log.debug(traceback.format_exc())
        try:
            finish_upload(conn, job["id"], "failed", error=str(exc))
        except Exception:
            log.exception("לא הצלחתי לעדכן את סטטוס הכישלון")
    finally:
        shutil.rmtree(work_dir, ignore_errors=True)


# ═══════════════ סריקת תיקיית המצב"ת המקומית ═══════════════
#
# על המחשב של סבא יש תיקייה שאליה מגיעים קובצי המצב"ת של כל המועצות.
# הסוכן סורק אותה, מקבץ את הקבצים לפי קוד הרשות, ומעבד כל מועצה
# שהקבצים שלה השתנו מאז הפעם הקודמת.


def load_watch_state() -> dict:
    """
    מבנה הקובץ:

        {"version": 2,
         "folder": "D:\\מצבת\\נכנס",
         "baseline_at": "2026-08-17T09:12:03",
         "authorities": {"1400000": "טביעת אצבע", ...}}

    גרסה 1 הייתה מילון שטוח של קוד -> טביעת אצבע, בלי רישום מצב פתיחה.
    """
    empty = {"version": 2, "folder": "", "baseline_at": "", "authorities": {}}
    if not WATCH_STATE.exists():
        return empty
    try:
        raw = json.loads(WATCH_STATE.read_text(encoding="utf-8"))
    except Exception:
        log.warning("קובץ המצב פגום — מתחילים מחדש")
        return empty

    if raw.get("version") == 2:
        raw.setdefault("authorities", {})
        return raw

    # שדרוג מגרסה 1: מה שכבר עובד נשמר, והתיקייה נחשבת מוכרת — אחרת
    # שדרוג גרסה היה מריץ מחדש את כל מה שכבר עלה.
    return {"version": 2, "folder": "", "baseline_at": "(שודרג מגרסה קודמת)",
            "authorities": {k: v for k, v in raw.items() if isinstance(v, str)}}


def save_watch_state(state: dict) -> None:
    tmp = WATCH_STATE.with_suffix(".tmp")
    tmp.write_text(json.dumps(state, ensure_ascii=False, indent=2),
                   encoding="utf-8")
    tmp.replace(WATCH_STATE)     # החלפה אטומית: הפסקת חשמל לא משאירה קובץ חצי


def authority_moe_codes(conn) -> dict:
    """מיפוי קוד משרד החינוך -> קוד הרשות אצלנו."""
    with conn.cursor() as cur:
        cur.execute("""select code, moe_code from public.authorities
                        where moe_code is not null and is_active""")
        return {moe: code for code, moe in cur.fetchall()}


def file_version(path: Path) -> tuple:
    """
    כמה "חדש" הקובץ, לצורך בחירה בין גרסאות שנצברו בתיקייה.

    מסתמך על חותמת הזמן ש**משרד החינוך** שם בשם הקובץ:

        TALMIDIM_AM_2026_1400000_2026-08-15-06-30-11_from_moe.csv
                                 └──────┬──────────┘

    ולא על תאריך השינוי בדיסק. הסיבה: כלים כמו robocopy /COPY:DAT,
    חילוץ מ-ZIP או סנכרון מרשת משמרים את תאריך המקור — ואז לקבצים
    שהגיעו היום יכול להיות תאריך ישן יותר מאלה שהועתקו לפני חודשיים.
    במקרה כזה בחירה לפי mtime הייתה טוענת נתונים ישנים ודורסת בהם את
    העדכניים, בלי שאיש ישים לב.

    אם אין חותמת בשם — נופלים לתאריך השינוי.
    """
    for token in path.stem.split("_"):
        # חותמת מהצורה 2026-08-15-06-30-11
        if len(token) == 19 and token[:4].isdigit() and token.count("-") == 5:
            # שובר שוויון בשם ולא ב-mtime: בתיקייה של שבע שנים זה חוסך
            # קריאת stat מכל קובץ, וגם דטרמיניסטי בין ריצות.
            return (1, token, path.name)
    return (0, "", path.stat().st_mtime)


def group_files_by_authority(folder: Path, moe_codes: dict) -> dict:
    """
    מקבץ את קובצי ה-CSV בתיקייה לפי רשות.

    ההתאמה היא על *מילה שלמה* בשם הקובץ ולא על הכלה, כדי שקוד קצר
    כמו 120 לא ייתפס בטעות בתוך חותמת תאריך.

    כשנצברו בתיקייה כמה גרסאות של אותו קובץ (החודש הקודם והנוכחי),
    נבחרת העדכנית לפי file_version.
    """
    groups: dict = {}
    best: dict = {}          # (moe, prefix) -> הגרסה של הקובץ שנבחר עד כה
    for path in folder.glob("*.csv"):
        prefix = next((p for p in MOE_PREFIXES if path.name.upper().startswith(p)), None)
        if not prefix:
            continue
        tokens = set(path.stem.split("_"))
        moe = next((m for m in moe_codes if m in tokens), None)
        if not moe:
            continue
        version = file_version(path)
        if best.get((moe, prefix), ()) < version:
            best[(moe, prefix)] = version
            groups.setdefault(moe, {})[prefix] = path
    return groups


def fingerprint(files: dict) -> str:
    """
    טביעת אצבע של קבוצת קבצים — משתנה רק כשהתוכן באמת התחלף.

    שם + גודל בלבד, בלי mtime: שם הקובץ נושא את חותמת משרד החינוך ולכן
    הוא ייחודי לכל עדכון. mtime לעומת זאת משתנה בכל העתקה מחדש — וסנכרון
    שמעתיק את התיקייה כולה מדי חודש היה נראה כמו עדכון של כל המועצות,
    וגורר טעינה מחדש של אותם נתונים בדיוק.
    """
    return "|".join(f"{files[p].name}:{files[p].stat().st_size}"
                    for p in sorted(files))


def files_settled(files: dict) -> bool:
    """קובץ שעדיין מועתק לתיקייה — לא נוגעים בו עד שיירגע."""
    now = time.time()
    return all(now - f.stat().st_mtime > FILE_SETTLE_SECONDS for f in files.values())


def record_local_run(conn, code: str, folder: Path):
    """רושם את הריצה ב-moe_uploads כדי שתופיע בהיסטוריה באתר."""
    with conn.cursor() as cur:
        cur.execute("""
            insert into public.moe_uploads
                   (authority_code, storage_prefix, file_count, status)
            values (%s, %s, 6, 'processing') returning id
        """, (code, f"מהתיקייה המקומית: {folder}"))
        return cur.fetchone()[0]


def take_baseline(state: dict, folder: Path, groups: dict, moe_codes: dict) -> None:
    """
    רושם את מה שכבר נמצא בתיקייה כ"מוכר", בלי לעבד שום דבר.

    התיקייה אצל סבא מתעדכנת כל חודש כבר שבע שנים. בלי זה, הסבב הראשון
    היה טוען לכל מועצה את מערכת הקבצים העדכנית שנמצאה שם — עדכון המוני
    שאיש לא ביקש, ברגע שמחברים את הסוכן. מכאן ואילך מטופל רק מה שמגיע
    *אחרי* החיבור.
    """
    for moe, files in groups.items():
        if all(p in files for p in MOE_PREFIXES):
            state["authorities"][moe_codes[moe]] = fingerprint(files)

    state["folder"] = str(folder)
    state["baseline_at"] = time.strftime("%Y-%m-%dT%H:%M:%S")
    save_watch_state(state)

    log.info("═" * 60)
    log.info('חיבור ראשון לתיקיית המצב"ת: %s', folder)
    log.info("נרשם מצב פתיחה — %s רשויות. הקבצים הקיימים *לא* יעובדו.",
             len(state["authorities"]))
    log.info("מכאן ואילך יעובד רק מה שיתעדכן בתיקייה.")
    log.info("═" * 60)


def scan_watch_folder(conn, folder: Path, process_existing: bool = False) -> None:
    if not folder.is_dir():
        log.warning("תיקיית המצב\"ת לא נמצאה: %s", folder)
        return

    state = load_watch_state()
    moe_codes = authority_moe_codes(conn)
    if not moe_codes:
        return

    groups = group_files_by_authority(folder, moe_codes)

    if process_existing:
        # "תעבד עכשיו את מה שיש" — מתעלמים ממה שכבר נרשם, אחרת מצב
        # הפתיחה שנרשם קודם היה חוסם בדיוק את מה שביקשו להריץ.
        state["authorities"] = {}
    else:
        # תיקייה שלא נראתה קודם — רק רושמים מה יש בה ויוצאים.
        # גם החלפת תיקייה נחשבת חיבור חדש, ולא סיבה לטעון מחדש הכל.
        known = state.get("folder", "")
        if known != str(folder):
            if known:
                log.info('תיקיית המצב"ת השתנתה: %s ← %s', folder, known)
            take_baseline(state, folder, groups, moe_codes)
            return

    for moe, files in sorted(groups.items()):
        code = moe_codes[moe]
        missing = [p for p in MOE_PREFIXES if p not in files]
        if missing:
            log.debug("רשות %s — חסרים %s, מדלג", code, ", ".join(missing))
            continue

        fp = fingerprint(files)
        if state["authorities"].get(code) == fp:
            continue                      # כבר עובד, שום דבר לא השתנה

        # רשות שנוספה למערכת אחרי רישום מצב הפתיחה: הקבצים שלה ישבו
        # בתיקייה מלכתחילה, ולכן זו טעינה ראשונה ולא עדכון.
        if not process_existing and code not in state["authorities"]:
            log.info("רשות %s נוספה למערכת — טעינה ראשונה מהתיקייה", code)

        if not files_settled(files):
            log.info("רשות %s — הקבצים עדיין בהעתקה, ממתין", code)
            continue

        log.info("═" * 60)
        log.info("קבצים חדשים בתיקייה — רשות %s (קוד מש\"ח %s)", code, moe)

        # מעתיקים רק את ששת הקבצים של הרשות הזו: ה-pipeline בוחר קובץ לפי
        # קידומת מתוך התיקייה, ואם יש בה כמה מועצות הוא היה מערבב ביניהן.
        work_dir = Path(tempfile.mkdtemp(prefix=f"matzevet-local-{code}-"))
        upload_id = None
        try:
            for path in files.values():
                shutil.copy2(path, work_dir / path.name)
            log.info("1/5 הועתקו 6 קבצים לעיבוד")

            upload_id = record_local_run(conn, code, folder)
            rows = process_files(conn, code, work_dir)

            finish_upload(conn, upload_id, "done", rows=rows)
            state["authorities"][code] = fp
            state["folder"] = str(folder)
            save_watch_state(state)
            log.info("✓ הושלם — %s שורות בטבלה students_%s", f"{rows:,}", code)

        except Exception as exc:
            log.error("✗ נכשל: %s", exc)
            log.debug(traceback.format_exc())
            if upload_id:
                try:
                    finish_upload(conn, upload_id, "failed", error=str(exc))
                except Exception:
                    pass
            # לא שומרים את טביעת האצבע — כך ננסה שוב בסבב הבא
        finally:
            shutil.rmtree(work_dir, ignore_errors=True)


# ═══════════════════════════ הלולאה ═══════════════════════════

def main() -> None:
    ap = argparse.ArgumentParser(description="סוכן עיבוד קבצי מצב\"ת")
    ap.add_argument("--interval", type=int, default=5, help="כל כמה שניות לבדוק (ברירת מחדל 5)")
    ap.add_argument("--once", action="store_true", help="לעבד העלאה אחת ולצאת")
    ap.add_argument("--verbose", action="store_true", help="לוג מפורט")
    ap.add_argument("--watch-folder",
                    help='תיקיית קובצי מצב"ת מקומית (ברירת מחדל: MATZEVET_WATCH_FOLDER)')
    ap.add_argument("--no-watch", action="store_true",
                    help="לא לסרוק את התיקייה המקומית")
    ap.add_argument("--tier-b-only", action="store_true",
                    help="לטפל רק בקליטות דרג ב', ולא לגעת בתור המצב\"ת. "
                         "נדרש כשמריצים סוכן שני לצד זה שבייצור: שניהם "
                         "מתשאלים את אותו moe_uploads, ו-`for update skip "
                         "locked` נותן את העבודה למי שהגיע ראשון — כלומר "
                         "סוכן פיתוח היה עלול לחטוף עדכון מצב\"ת אמיתי, "
                         "להריץ אותו על המחשב הלא נכון, ולכתוב את גיבוי "
                         "הבטיחות לדיסק שאיש לא יחפש בו.")
    ap.add_argument("--process-existing", action="store_true",
                    help="לעבד עכשיו את מה שכבר בתיקייה (ברירת המחדל: לדלג "
                         "על הקיים ולעקוב רק אחרי מה שמתעדכן מכאן)")
    args = ap.parse_args()

    load_env_files()
    setup_logging(args.verbose)

    log.info("סוכן העיבוד עלה. בודק כל %s שניות.", args.interval)
    log.info("pipeline: %s", PIPELINE_DIR)
    if not PIPELINE_DIR.exists():
        sys.exit(f"לא נמצאה תיקיית ה-pipeline: {PIPELINE_DIR}")

    # תיקיית מצב"ת מקומית — אופציונלית. בלעדיה הסוכן עובד רק מול האתר.
    watch_folder = None
    if not args.no_watch:
        raw = args.watch_folder or os.environ.get("MATZEVET_WATCH_FOLDER", "").strip()
        if raw:
            watch_folder = Path(raw)
            log.info('תיקיית מצב"ת מקומית: %s (סריקה כל %s שניות)',
                     watch_folder, WATCH_EVERY)
            seen = load_watch_state()
            if args.process_existing:
                log.warning("--process-existing: הקבצים שכבר בתיקייה יעובדו עכשיו")
            elif seen.get("folder") == str(watch_folder):
                log.info("מצב פתיחה נרשם ב-%s — %s רשויות במעקב",
                         seen.get("baseline_at") or "לא ידוע",
                         len(seen.get("authorities", {})))
            else:
                log.info("חיבור ראשון לתיקייה — ייסרק מצב הפתיחה בלי לעבד")
        else:
            log.info('לא הוגדרה תיקיית מצב"ת מקומית — עובד מול האתר בלבד')

    last_scan = 0.0

    # ריצה שנקטעה משאירה תיקיית עבודה זמנית. מנקים בעלייה כדי שלא
    # יצטברו עשרות תיקיות של 10MB לאורך חודשים.
    stale = 0
    for leftover in Path(tempfile.gettempdir()).glob("matzevet-*"):
        if leftover.is_dir() and time.time() - leftover.stat().st_mtime > 3600:
            shutil.rmtree(leftover, ignore_errors=True)
            stale += 1
    if stale:
        log.info("נוקו %s תיקיות עבודה שנשארו מריצות קודמות", stale)

    conn = None
    idle_logged = False

    while True:
        try:
            if conn is None or conn.closed:
                conn = connect()
                log.info("מחובר ל-Supabase")

            # מצב בדיקה: סבב אחד של כל מקורות העבודה, ואז יציאה.
            # (התנאי הקודם בדק רק אם הייתה העלאה מהאתר, ולכן כשהעבודה הגיעה
            #  מהתיקייה המקומית הלולאה לא הסתיימה לעולם.)
            if args.once:
                if watch_folder:
                    scan_watch_folder(conn, watch_folder, args.process_existing)
                job = None if args.tier_b_only else claim_next_upload(conn)
                if job:
                    process(conn, job)
                elif not args.tier_b_only:
                    log.info("אין העלאות ממתינות באתר")
                tier_b = claim_next_tier_b(conn)
                if tier_b:
                    process_tier_b(conn, tier_b)
                else:
                    log.info("אין קליטות דרג ב' ממתינות")
                bagrut = claim_next_bagrut(conn)
                if bagrut:
                    process_bagrut(conn, bagrut)
                else:
                    log.info("אין סבבי בגרות ממתינים")
                log.info("סבב בדיקה הסתיים")
                break

            tier_b = claim_next_tier_b(conn)
            if tier_b:
                idle_logged = False
                process_tier_b(conn, tier_b)

            # סבב בגרות — תור נפרד; רץ גם ב---tier-b-only, שמשמעותו "לא לגעת
            # בתור המצב"ת", לא "רק גנים".
            bagrut = claim_next_bagrut(conn)
            if bagrut:
                idle_logged = False
                process_bagrut(conn, bagrut)

            job = None if args.tier_b_only else claim_next_upload(conn)
            if job:
                idle_logged = False
                process(conn, job)
            else:
                if not idle_logged:
                    log.info("אין העלאות ממתינות — ממתין…")
                    idle_logged = True

            # סריקת התיקייה המקומית — בקצב נפרד, איטי יותר מהתשאול
            if watch_folder and time.time() - last_scan > WATCH_EVERY:
                last_scan = time.time()
                scan_watch_folder(conn, watch_folder, args.process_existing)

        except KeyboardInterrupt:
            log.info("הופסק ידנית")
            break
        except Exception:
            # תקלת רשת או ניתוק DB — סוגרים, ישנים, ומתחברים מחדש בסבב הבא
            log.exception("שגיאה בלולאה — מנסה שוב בעוד %s שניות", args.interval)
            try:
                if conn:
                    conn.close()
            except Exception:
                pass
            conn = None

        time.sleep(args.interval)

    if conn:
        conn.close()


if __name__ == "__main__":
    main()
