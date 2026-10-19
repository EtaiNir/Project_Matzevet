"""
בחירת הקובץ מתוך תיקייה שנצברים בה עדכונים, ושיוך לפי קוד רשות.

השאלה שמאחורי הבדיקה: קבצים של חודש שעבר עדיין בתיקייה, ומגיעים חדשים.
מה ייבחר — ולפי מה.
"""
import os
import time

from _harness import Checks, Sandbox, put_moe_files, worker

MOE = {"1400000": "1400000", "800000": "800000", "5108": "120"}

check = Checks("בחירת קבצים ושיוך למועצה")

# ── 1. הישן נשאר, החדש נבחר ─────────────────────────────────────────
with Sandbox() as folder:
    put_moe_files(folder, "1400000", "2026-06-18")
    put_moe_files(folder, "1400000", "2026-08-15")
    files = worker.group_files_by_authority(folder, MOE)["1400000"]
    check("נבחר העדכון החדש מכל סוג",
          {p for p, f in files.items() if "2026-08-15" in f.name},
          set(worker.MOE_PREFIXES))

# ── 2. תאריך הדיסק לא קובע ──────────────────────────────────────────
# העתקה ששימרה את תאריך המקור (robocopy /COPY:DAT, ZIP, סנכרון) יכולה
# לתת לקבצים החדשים mtime ישן יותר מאלה שהועתקו בחודש שעבר.
with Sandbox() as folder:
    put_moe_files(folder, "1400000", "2026-06-18")
    for f in folder.glob("*.csv"):                    # יוני = "נגעו בו אתמול"
        recent = time.time() - 86400
        os.utime(f, (recent, recent))
    put_moe_files(folder, "1400000", "2026-08-15")
    for f in folder.glob("*2026-08-15*.csv"):         # אוגוסט = תאריך ישן
        ancient = time.time() - 90 * 86400
        os.utime(f, (ancient, ancient))

    files = worker.group_files_by_authority(folder, MOE)["1400000"]
    check("החותמת שבשם גוברת על תאריך השינוי בדיסק",
          {p for p, f in files.items() if "2026-08-15" in f.name},
          set(worker.MOE_PREFIXES))

# ── 3. הפרדה בין מועצות ─────────────────────────────────────────────
with Sandbox() as folder:
    for moe in MOE:
        put_moe_files(folder, moe, "2026-08-15")
    groups = worker.group_files_by_authority(folder, MOE)
    check("שלוש מועצות זוהו בנפרד", sorted(groups), ["1400000", "5108", "800000"])

    leaks = [f.name for moe, files in groups.items() for f in files.values()
             if moe not in set(f.stem.split("_"))]
    check("אף קובץ לא שויך למועצה זרה", leaks, [])

    check("קוד שאינו במערכת נזרק",
          worker.group_files_by_authority(folder, {"9999999": "9999999"}), {})

    # ההתאמה על מילה שלמה: 120 לא אמור להיתפס בתוך 1400000 או בתוך תאריך
    check("קוד קצר לא נתפס בתוך מחרוזת אחרת",
          worker.group_files_by_authority(folder, {"120": "120"}), {})

# ── 4. קובץ שעדיין בהעתקה ───────────────────────────────────────────
with Sandbox() as folder:
    put_moe_files(folder, "1400000", "2026-08-15", settled=False)
    files = worker.group_files_by_authority(folder, MOE)["1400000"]
    check("קובץ טרי — ממתינים שההעתקה תסתיים",
          worker.files_settled(files), False)

# ── 5. קובץ "ישן" שעדיין מועתק (robocopy משמר את תאריך המקור, 18.10) ──
with Sandbox() as folder:
    worker._seen_sizes.clear()
    put_moe_files(folder, "1400000", "2026-08-15", settled=True)
    files = worker.group_files_by_authority(folder, MOE)["1400000"]
    check("mtime ישן אבל נראה לראשונה — עוד לא (צריך גודל יציב)",
          worker.files_settled(files), False)

    # עברו FILE_SETTLE_SECONDS והגודל לא השתנה — מוכן
    for k, (size, _) in list(worker._seen_sizes.items()):
        worker._seen_sizes[k] = (size, time.time() - worker.FILE_SETTLE_SECONDS - 5)
    check("גודל יציב מעבר לזמן ההמתנה — מוכן",
          worker.files_settled(files), True)

    # הקובץ גדל (ההעתקה עוד רצה) — חוזרים להמתנה
    grown = next(iter(files.values()))
    with open(grown, "ab") as fh:
        fh.write(b"x" * 10)
    old = time.time() - 3600
    os.utime(grown, (old, old))      # התאריך נשאר "ישן", כמו ב-robocopy
    check("קובץ שגדל בין סריקות — שוב ממתינים",
          worker.files_settled(files), False)

# ── 5ב. ששת הקבצים מאותו משלוח? (משלוח שעדיין מגיע — לא לטעון סט מעורב) ──
with Sandbox() as folder:
    put_moe_files(folder, "1400000", "2026-10-15")
    files = worker.group_files_by_authority(folder, MOE)["1400000"]
    spread = worker.delivery_spread_hours(files)
    check("משלוח אחד — פער של שניות", spread is not None and spread < worker.DELIVERY_WINDOW_HOURS, True)

    # שבוע קודם מלא, ומהמשלוח החדש הגיע רק קובץ התלמידים
    put_moe_files(folder, "1400000", "2026-10-08")
    for f in list(folder.glob("*2026-10-15*")):
        if not f.name.startswith(worker.MOE_PREFIXES[0]):
            f.unlink()
    files = worker.group_files_by_authority(folder, MOE)["1400000"]
    spread = worker.delivery_spread_hours(files)
    check("קובץ חדש לצד קבצים מהשבוע שעבר — פער גדול, ממתינים",
          spread is not None and spread > worker.DELIVERY_WINDOW_HOURS, True)

    # קובץ בלי חותמת בשם — לא חוסמים (None)
    odd = {"A": folder / "TALMIDIM_AM_no_stamp.csv"}
    odd["A"].write_text("x", encoding="utf-8")
    check("בלי חותמת בשם — לא חוסם", worker.delivery_spread_hours(odd), None)

# ── 6. הרצה חד־פעמית: אחרי ההמתנה של scan_watch_folder — מוכן בסריקה השנייה ──
with Sandbox() as folder:
    worker._seen_sizes.clear()
    put_moe_files(folder, "1400000", "2026-08-15", settled=True)
    files = worker.group_files_by_authority(folder, MOE)["1400000"]
    worker.files_settled(files)                     # הסריקה הראשונה רושמת את הגדלים
    for k, (size, _) in list(worker._seen_sizes.items()):
        worker._seen_sizes[k] = (size, time.time() - worker.FILE_SETTLE_SECONDS - 1)
    check("--process-existing: הבדיקה השנייה אחרי ההמתנה עוברת",
          worker.files_settled(files), True)

check.done()
