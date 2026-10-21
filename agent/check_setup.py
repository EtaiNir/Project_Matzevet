"""
בדיקת ההתקנה — רץ בסוף setup.bat.

כל הפלט לעברית נעשה כאן ולא בקובץ ה-bat, כי cmd.exe מקלקל את הניתוח של
עצמו כשקובץ bat מכיל עברית ב-UTF-8 (זה מה שהפיל את ההתקנה הראשונה).

בודק לפי הסדר: ספריות, קובצי הגדרות, מיקום ה-pipeline, וחיבור בפועל.
"""
import io
import json
import sys
from pathlib import Path

sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding="utf-8", errors="replace")

AGENT_DIR = Path(__file__).resolve().parent
DASHBOARD_DIR = AGENT_DIR.parent
PIPELINE_DIR = DASHBOARD_DIR.parent / "Itay_Modules" / "python_modules"

OK, BAD, WARN = "  ✓", "  ✗", "  !"
problems = []


def line(char="─", n=60):
    print(char * n)


def check_packages():
    print("\nספריות:")
    for module, label in [("pandas", "pandas"), ("numpy", "numpy"),
                          ("openpyxl", "openpyxl"), ("psycopg2", "psycopg2"),
                          ("requests", "requests"), ("xlrd", "xlrd")]:
        try:
            mod = __import__(module)
            ver = getattr(mod, "__version__", "")
            print(f"{OK} {label} {ver}")
        except ImportError:
            print(f"{BAD} {label} — חסר")
            problems.append(f"הספרייה {label} לא הותקנה")


def check_env_file(name, required_keys):
    path = DASHBOARD_DIR / name
    if not path.exists():
        print(f"{BAD} {name} — הקובץ לא נמצא")
        problems.append(f"{name} חסר")
        return

    values = {}
    for raw in path.read_text(encoding="utf-8").splitlines():
        raw = raw.strip()
        if raw and not raw.startswith("#") and "=" in raw:
            key, _, val = raw.partition("=")
            values[key.strip()] = val.strip()

    missing = [k for k in required_keys if not values.get(k)]
    if missing:
        print(f"{BAD} {name} — חסר ערך ב: {', '.join(missing)}")
        problems.append(f"{name}: יש למלא {', '.join(missing)}")
    else:
        print(f"{OK} {name}")

    # טעות הדבקה נפוצה: מרכאות סביב הערך
    for key in required_keys:
        val = values.get(key, "")
        if val and (val[0] in "\"'" or val[-1] in "\"'"):
            print(f"{WARN} {key} עטוף במרכאות — יש להסיר אותן")
            problems.append(f"{name}: {key} עטוף במרכאות")


def check_watch_folder():
    """התיקייה המקומית אופציונלית — מדווחים על מצבה, לא נכשלים בלעדיה."""
    print("\nתיקיית מצב\"ת מקומית:")
    raw = ""
    path = DASHBOARD_DIR / ".env.agent"
    if path.exists():
        # שם אחר מ-line, כדי לא להסתיר את פונקציית העזר line()
        for row in path.read_text(encoding="utf-8").splitlines():
            if row.strip().startswith("MATZEVET_WATCH_FOLDER="):
                raw = row.split("=", 1)[1].strip()

    if not raw:
        print(f"{WARN} לא הוגדרה — הסוכן יעבוד מול האתר בלבד")
        print("     להפעלה: למלא MATZEVET_WATCH_FOLDER ב-.env.agent")
        return

    folder = Path(raw)
    if not folder.is_dir():
        print(f"{BAD} הנתיב לא נמצא: {folder}")
        problems.append(f"תיקיית המצב\"ת לא קיימת: {folder}")
        return

    csvs = list(folder.glob("*.csv"))
    print(f"{OK} {folder}")
    print(f"     {len(csvs)} קובצי CSV בתיקייה כרגע")

    # מה יקרה לקבצים האלה — השאלה הראשונה כשמחברים תיקייה מלאה
    state = {}
    state_file = AGENT_DIR / "watch-state.json"
    if state_file.exists():
        try:
            state = json.loads(state_file.read_text(encoding="utf-8"))
        except Exception:
            print(f"{WARN} watch-state.json פגום — יירשם מצב פתיחה מחדש")

    if state.get("folder") == str(folder):
        print(f"     מצב פתיחה נרשם ב-{state.get('baseline_at', 'לא ידוע')} — "
              f"{len(state.get('authorities', {}))} רשויות במעקב")
        print("     יעובד רק מה שיתעדכן מכאן ואילך")
    else:
        print("     בהפעלה הראשונה יירשם מצב פתיחה — "
              "הקבצים שכבר בתיקייה לא יעובדו")


def check_pipeline():
    print("\nתהליך העיבוד:")
    entry = PIPELINE_DIR / "Main_Module_6_files_using_JSON.py"
    if entry.exists():
        print(f"{OK} נמצא ב-{PIPELINE_DIR}")
    else:
        print(f"{BAD} לא נמצא ב-{PIPELINE_DIR}")
        problems.append("תיקיית Itay_Modules אינה במקום הנכון ביחס לסוכן")


def check_connections():
    """
    בדיקה אמיתית מול Supabase — לא רק שהקבצים קיימים.
    נדלגת אם כבר ידוע שההגדרות חסרות, כדי לא להציף בשגיאות נגררות.
    """
    print("\nחיבורים:")
    if problems:
        print(f"{WARN} מדולג — יש להשלים קודם את ההגדרות שלמעלה")
        return

    sys.path.insert(0, str(AGENT_DIR))
    try:
        import worker
    except Exception as exc:
        print(f"{BAD} טעינת הסוכן נכשלה: {exc}")
        problems.append("worker.py לא נטען")
        return

    worker.load_env_files()

    # worker.require קורא ל-sys.exit כשחסר ערך; כאן רוצים לדווח ולהמשיך
    try:
        conn = worker.connect()
        with conn.cursor() as cur:
            cur.execute("select count(*) from public.moe_uploads")
            total = cur.fetchone()[0]
        conn.close()
        print(f"{OK} מסד הנתונים — מחובר ({total} העלאות רשומות)")
    except (Exception, SystemExit) as exc:
        print(f"{BAD} מסד הנתונים: {str(exc).strip().splitlines()[0][:90]}")
        problems.append("החיבור למסד נכשל — בדוק את הסיסמה ב-.env.db")

    try:
        worker.agent_token()
        print(f"{OK} חשבון הסוכן — התחברות הצליחה")
    except (Exception, SystemExit) as exc:
        print(f"{BAD} חשבון הסוכן: {str(exc).strip().splitlines()[0][:90]}")
        problems.append("התחברות הסוכן נכשלה — בדוק את הסיסמה ב-.env.agent")


def main():
    line("=")
    print("  בדיקת ההתקנה")
    line("=")
    print(f"\nפייתון {sys.version.split()[0]}")

    check_packages()
    print("\nקובצי הגדרות:")
    check_env_file(".env.db", ["PGHOST", "PGUSER", "PGPASSWORD"])
    check_env_file(".env.agent", ["SUPABASE_URL", "SUPABASE_ANON_KEY",
                                  "AGENT_EMAIL", "AGENT_PASSWORD"])
    check_pipeline()
    check_watch_folder()
    check_connections()

    print()
    line("=")
    if problems:
        print(f"  נמצאו {len(problems)} בעיות:\n")
        for p in problems:
            print(f"    • {p}")
        print("\n  יש לתקן ולהריץ שוב את setup.bat")
        line("=")
        sys.exit(1)

    print("  ההתקנה תקינה. הכול מחובר ומוכן.")
    line("=")
    print("\n  הצעד הבא:")
    print("    בדיקה חד-פעמית:     run-once.bat")
    print("    הפעלה קבועה 24/7:   לחיצה ימנית על install-service.ps1")
    print("                        ואז Run with PowerShell\n")


if __name__ == "__main__":
    main()
