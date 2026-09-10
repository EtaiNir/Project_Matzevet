"""
מריץ את כל קבצי ה-SQL מתיקיית supabase/migrations לפי סדר שמם, מול מסד ה-Supabase.
פרטי החיבור נלקחים ממשתני סביבה (לא נשמרים בקוד):
    PGHOST, PGPORT, PGDATABASE, PGUSER, PGPASSWORD
שימוש:
    python run_migrations.py                 # כל המיגרציות, לפי סדר
    python run_migrations.py --only 016      # קובץ אחד בלבד
    python run_migrations.py --dry-run       # רק להציג מה יורץ

--only נדרש כדי להחיל מיגרציה חדשה על מסד חי בלי להריץ מחדש את כל
הקודמות. הן אמנם בנויות להרצה חוזרת, אבל אין סיבה לגעת ב-15 קבצים
כשצריך אחד.
"""
import argparse
import glob
import os
import sys

import psycopg2

MIGRATIONS_DIR = os.path.join(os.path.dirname(__file__), "..", "supabase", "migrations")
ENV_DB_FILE = os.path.join(os.path.dirname(__file__), "..", ".env.db")


def load_env_db():
    """טוען פרטי חיבור מ-.env.db. משתני סביבה קיימים גוברים עליו.

    אותה התנהגות כמו ב-update_from_moe.py. בלי זה צריך להגדיר PGHOST
    ו-PGPASSWORD ידנית בכל הרצה, וזה בדיוק המקום שבו מדביקים סיסמה
    לטרמינל ומשאירים אותה בהיסטוריה.
    """
    if not os.path.exists(ENV_DB_FILE):
        return False
    with open(ENV_DB_FILE, encoding="utf-8") as fh:
        for line in fh:
            line = line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, value = line.partition("=")
            os.environ.setdefault(key.strip(), value.strip())
    return True


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", help="קידומת הקובץ להרצה, למשל 016")
    ap.add_argument("--dry-run", action="store_true", help="להציג מה יורץ בלי להריץ")
    args = ap.parse_args()

    files = sorted(glob.glob(os.path.join(MIGRATIONS_DIR, "*.sql")))
    if args.only:
        files = [f for f in files if os.path.basename(f).startswith(args.only)]
        if not files:
            sys.exit(f"לא נמצאה מיגרציה שמתחילה ב-{args.only}")

    if not files:
        sys.exit("לא נמצאו קבצי מיגרציה")

    if load_env_db():
        print("פרטי חיבור נטענו מ-.env.db")

    print(f"יורצו {len(files)} קבצים:")
    for path in files:
        print(f"  · {os.path.basename(path)}")
    if args.dry_run:
        print()
        print("(--dry-run — המסד לא נגע)")
        return
    print()

    conn = psycopg2.connect(
        host=os.environ["PGHOST"],
        port=int(os.environ.get("PGPORT", "5432")),
        dbname=os.environ.get("PGDATABASE", "postgres"),
        user=os.environ["PGUSER"],
        password=os.environ["PGPASSWORD"],
        sslmode="require",
        connect_timeout=20,
    )
    conn.autocommit = False

    for path in files:
        name = os.path.basename(path)
        sql = open(path, encoding="utf-8").read()
        print(f"מריץ {name} ...", flush=True)
        try:
            with conn.cursor() as cur:
                cur.execute(sql)
            conn.commit()
            print(f"  ✓ {name} הושלם")
        except Exception as e:
            conn.rollback()
            sys.exit(f"  ✗ שגיאה ב-{name}: {e}")

    conn.close()
    print("כל המיגרציות הורצו בהצלחה.")


if __name__ == "__main__":
    main()
