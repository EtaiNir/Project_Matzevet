"""
הורדת המיתר האוטומטית (024) — בלי האתר ובלי המסד.

הדפדפן מוחלף בדפדפן מדומה, והמסד בפונקציות מדומות: בודקים מה הסוכן מחליט
— מה מסומן done / waiting / failed / gave_up, ומה נפתח כקליטה.
"""
import sys
import types
from datetime import date, datetime, timedelta

from _harness import Checks

import meitar_download as MD
import worker as W

check = Checks("הורדת המיתר — החלטות הסוכן")

# ── ערך החודש ברשימה של האתר ──
check("חודש החישוב ← הערך ברשימה, בלי אפס מוביל", MD.month_value(date(2026, 9, 1)), "Horada.aspx?date=9_2026")
check("ובחזרה", MD.parse_month_value("Horada.aspx?date=12_2025"), date(2025, 12, 1))
check("ערך זר — None", MD.parse_month_value("home.aspx"), None)

# ── הסבב: דפדפן מדומה ──
marks, enqueued = [], []


class FakePortal:
    def __init__(self, shots_dir=None, headless=True):
        pass

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def download(self, code, kind, month, dest):
        if code == "111":
            raise MD.MonthNotYetPublished("עוד לא פורסם")
        if code == "222":
            raise MD.PortalError("האתר לא ענה")
        dest.mkdir(parents=True, exist_ok=True)
        path = dest / f"{code}.zip"
        path.write_bytes(b"PK")
        return path


TARGETS = [
    {"code": "1400000", "entity": "12300141", "kind": "moteb", "month": date(2026, 9, 1), "status": None, "first": None},
    {"code": "1400000", "entity": "111", "kind": "mosad", "month": date(2026, 9, 1), "status": None, "first": None},
    {"code": "1400000", "entity": "222", "kind": "mosad", "month": date(2026, 9, 1), "status": None, "first": None},
]

real = {n: getattr(W, n) for n in ("meitar_targets", "meitar_mark", "enqueue_meitar_zip", "meitar_retry_status")}
W.meitar_targets = lambda conn, today: list(TARGETS)
W.meitar_mark = lambda conn, t, status, error=None, upload_id=None: marks.append((t["entity"], status, upload_id))
W.enqueue_meitar_zip = lambda conn, code, entity, month, path: enqueued.append((code, entity, month)) or "up-1"
W.meitar_retry_status = lambda conn, t, status: status
sys.modules["meitar_download"] = types.SimpleNamespace(Portal=FakePortal, MonthNotYetPublished=MD.MonthNotYetPublished,
                                                       PortalError=MD.PortalError)
try:
    n = W.run_meitar_downloads(conn=None, today=datetime(2026, 10, 4))
finally:
    sys.modules["meitar_download"] = MD

check("ZIP אחד הורד ונפתחה עליו קליטה", (n, enqueued), (1, [("1400000", "12300141", date(2026, 9, 1))]))
check("כל מקור מסומן 'מוריד' לפני הניסיון", [m for m in marks if m[1] == "downloading"],
      [("12300141", "downloading", None), ("111", "downloading", None), ("222", "downloading", None)])
check("הצליח — done עם הקליטה", ("12300141", "done", "up-1") in marks, True)
check("לא פורסם — waiting (ינסה שוב)", ("111", "waiting", None) in marks, True)
check("תקלה באתר — failed (ינסה שוב, לא עד החודש הבא כמו אצל איתי)", ("222", "failed", None) in marks, True)

# ── בלי playwright: הסוכן ממשיך, לא קורס ──
marks.clear()
sys.modules["meitar_download"] = None   # import ייכשל
try:
    n = W.run_meitar_downloads(conn=None, today=datetime(2026, 10, 4))
finally:
    sys.modules["meitar_download"] = MD
check("בלי playwright — אין הורדה ואין קריסה", (n, marks), (0, []))

# ── 5 ימים ← gave_up ──
for name, fn in real.items():
    setattr(W, name, fn)


class Cur:
    def __init__(self, first):
        self.first = first

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False

    def execute(self, *a):
        pass

    def fetchone(self):
        return (self.first,)


class Conn:
    def __init__(self, first):
        self.first = first

    def cursor(self):
        return Cur(self.first)


t = TARGETS[1]
check("ניסיון ראשון לפני יום — עדיין waiting",
      W.meitar_retry_status(Conn(datetime.now() - timedelta(days=1)), t, "waiting"), "waiting")
check("ניסיון ראשון לפני 6 ימים — gave_up",
      W.meitar_retry_status(Conn(datetime.now() - timedelta(days=6)), t, "waiting"), "gave_up")

check.done()
