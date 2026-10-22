"""
הורדת קובצי המיתר מאתר משרד החינוך (MtrNet) — בלי אדם ליד המחשב.

פורט של mytar_downloader.py של איתי (github.com/EtaiNir/mytar-automation), עם
אותו מסלול באתר ואותן חלופות לכל לחיצה — האתר הוא ASP.NET איטי, ולכל צעד יש
כמה דרכים שכבר הוכחו אצלו בריצות אמת:

    home.aspx → "מוסד" (בית ספר, לפי סמל מוסד) או "מוטב" (מועצה) → "לפי סמל"
    → הקלדת הקוד (עד 3 ניסיונות — השדה "מאבד" ספרות בהשהיית השרת) → חפש
    → השורה של הקוד בתוצאות → "הורדות" → horadatkv.aspx?slct=zip
    → בחירת "Horada.aspx?date=M_YYYY" ברשימת החודשים → הקובץ יורד.

האתר ציבורי — אין התחברות. חודש שעוד לא פורסם אינו ברשימה: זו לא תקלה,
MonthNotYetPublished — הסוכן מנסה שוב מאוחר יותר.

ההבדלים מאיתי: sync (הסוכן אינו async), Chromium של Playwright ולא Chrome
מותקן, תמיד headless (השירות רץ בלי מסך — כך נפל אצלו ב-3.8), והחודש מגיע
מהקורא ולא ממונה ב-codes.json (שזז ונתקע אצלו פעמיים).

התקנה: pip install playwright ; python -m playwright install chromium
⚠️ נתיב ה-venv חייב להיות קצר — ראה מלכודת 44 ב-agent/CLAUDE.md.
"""
from __future__ import annotations

import logging
import re
from datetime import date, datetime
from pathlib import Path

log = logging.getLogger("meitar")

BASE_URL = "https://apps.education.gov.il"
SEL_CODE_INPUT = "#ctl00_Main_inpSml"
SEL_MONTH_DDL = "#ctl00_Main_ddlZipList"
SEARCH_BUTTONS = [
    "input[type='submit'][value='חפש']",
    "input[type='button'][value='חפש']",
    "button:has-text('חפש')",
    "#ctl00_Main_btnSearch",
    "#ctl00_Main_btnHefes",
]
KIND_LABEL = {"mosad": "מוסד", "moteb": "מוטב"}
MONTH_VALUE = re.compile(r"date=(\d{1,2})_(\d{4})")


class MonthNotYetPublished(Exception):
    """החודש עוד אינו ברשימת ההורדות של הקוד — לנסות שוב מאוחר יותר."""


class PortalError(RuntimeError):
    """כל כשל אחר באתר. ההודעה בעברית, ומצורף צילום מסך אם נשמר."""


def month_value(calc_month: date) -> str:
    """חודש החישוב → הערך ברשימה: 9/2026 → 'Horada.aspx?date=9_2026' (בלי אפס מוביל)."""
    return f"Horada.aspx?date={calc_month.month}_{calc_month.year}"


def parse_month_value(value: str | None) -> date | None:
    m = MONTH_VALUE.search(value or "")
    return date(int(m.group(2)), int(m.group(1)), 1) if m else None


class Portal:
    """
    דפדפן אחד לכל ההורדות של סבב. שימוש:
        with Portal(shots_dir) as p:
            path = p.download(code, "mosad", date(2026, 9, 1), dest_dir)
    """

    def __init__(self, shots_dir: Path | None = None, headless: bool = True):
        self.shots_dir = shots_dir
        self.headless = headless
        self._pw = self._browser = self._ctx = self.page = None

    def __enter__(self) -> "Portal":
        from playwright.sync_api import sync_playwright  # טעינה עצלה — הסוכן עולה גם בלי playwright
        self._pw = sync_playwright().start()
        self._browser = self._pw.chromium.launch(headless=self.headless)
        self._ctx = self._browser.new_context(accept_downloads=True, locale="he-IL")
        self.page = self._ctx.new_page()
        self.page.set_default_timeout(30000)
        return self

    def __exit__(self, *exc) -> None:
        for closer in (self._ctx, self._browser):
            try:
                closer and closer.close()
            except Exception:  # noqa: BLE001 — סגירה בכל מחיר
                pass
        if self._pw:
            self._pw.stop()

    # ── עזרים ──
    def _snap(self, tag: str) -> str | None:
        if not self.shots_dir:
            return None
        try:
            self.shots_dir.mkdir(parents=True, exist_ok=True)
            path = self.shots_dir / f"{tag}_{datetime.now():%Y%m%d-%H%M%S}.png"
            self.page.screenshot(path=str(path), full_page=True)
            return str(path)
        except Exception:  # noqa: BLE001
            return None

    def _fail(self, tag: str, code: str, msg: str) -> PortalError:
        shot = self._snap(f"{tag}_{code}")
        return PortalError(f"{msg}" + (f" (צילום מסך: {shot})" if shot else ""))

    def _radio(self, label: str) -> bool:
        page = self.page
        try:
            radio = page.get_by_role("radio", name=label, exact=True)
            radio.check(timeout=2000)
            if radio.is_checked():
                return True
        except Exception:  # noqa: BLE001
            pass
        checked = page.evaluate("""
            (wanted) => {
              const radios = Array.from(document.querySelectorAll('input[type=radio]'));
              let target = null;
              for (const r of radios) {
                const lbl = document.querySelector(`label[for="${r.id}"]`);
                if ((lbl?.textContent || '').trim() === wanted) { target = r; break; }
              }
              if (!target) return null;
              target.scrollIntoView({ block: 'center' });
              target.click();
              target.dispatchEvent(new Event('change', { bubbles: true }));
              return target.checked ? wanted : null;
            }
        """, label)
        return checked == label

    def _click_search(self) -> None:
        page = self.page
        try:
            page.get_by_role("button", name="חפש", exact=True).click(timeout=2000)
            return
        except Exception:  # noqa: BLE001
            pass
        for css in SEARCH_BUTTONS:
            try:
                page.locator(css).first.click(timeout=1500)
                return
            except Exception:  # noqa: BLE001
                continue
        try:
            page.get_by_text("חפש", exact=True).first.click(timeout=1500)
            return
        except Exception:  # noqa: BLE001
            pass
        page.locator(SEL_CODE_INPUT).press("Enter")

    # ── המסלול ──
    def _search(self, code: str, kind: str) -> None:
        from playwright.sync_api import expect
        page = self.page
        page.goto(f"{BASE_URL}/MtrNet/home.aspx", wait_until="domcontentloaded")
        page.wait_for_timeout(200)
        if not self._radio(KIND_LABEL[kind]):
            raise self._fail("radio_kind", code, f"לא הצלחתי לבחור '{KIND_LABEL[kind]}' באתר המשרד")
        if not self._radio("לפי סמל"):
            raise self._fail("radio_by_code", code, "לא הצלחתי לבחור 'לפי סמל' באתר המשרד")
        page.wait_for_selector(SEL_CODE_INPUT, state="visible", timeout=8000)
        inp = page.locator(SEL_CODE_INPUT)
        seen = ""
        for _ in range(3):   # השדה מאבד ספרות בהשהיית השרת (אצל איתי: 729012 ב-3.9)
            inp.click()
            inp.fill("")
            inp.type(code, delay=40)
            page.keyboard.press("Tab")
            try:
                expect(inp).to_have_value(code, timeout=5000)
                break
            except Exception:  # noqa: BLE001
                seen = inp.input_value()
                page.wait_for_timeout(600)
        else:
            raise self._fail("code_input", code, f"שדה הסמל לא קיבל את הקוד (נראה '{seen}')")
        self._click_search()
        try:
            page.locator(f"//tr[td[normalize-space()='{code}']]").first.wait_for(timeout=12000)
        except Exception:  # noqa: BLE001
            try:
                page.locator(f"//td[normalize-space()='{code}']").first.wait_for(timeout=8000)
            except Exception:  # noqa: BLE001
                raise self._fail("no_results", code, f"הקוד {code} לא נמצא בתוצאות החיפוש") from None

    def _open_zip_page(self, code: str) -> None:
        from playwright.sync_api import expect
        page = self.page
        scope = page
        try:
            if not page.get_by_text(code, exact=True).first.is_visible(timeout=1000):
                raise LookupError
        except Exception:  # noqa: BLE001
            scope = next((f for f in page.frames if f.get_by_text(code, exact=True).count()), None)
            if scope is None:
                raise self._fail("row_missing", code, f"לא מצאתי את השורה של {code}") from None
        page.wait_for_timeout(300)
        row = scope.locator(f"//tr[td[normalize-space()='{code}']]").first
        try:
            link = row.locator("a, button").first
            expect(link).to_be_visible(timeout=2500)
            link.click()
        except Exception:  # noqa: BLE001
            try:
                row.click(timeout=2500)
            except Exception:  # noqa: BLE001
                raise self._fail("row_click", code, "לא הצלחתי לבחור את השורה בתוצאות") from None
        for attempt in (
            lambda: page.get_by_role("link", name="הורדות", exact=True).click(timeout=5000),
            lambda: page.get_by_text("הורדות", exact=True).first.click(timeout=5000),
            lambda: page.locator("a:has-text('הורדות')").first.click(timeout=5000),
        ):
            try:
                attempt()
                break
            except Exception:  # noqa: BLE001
                continue
        else:
            raise self._fail("downloads_link", code, "לא הצלחתי ללחוץ על 'הורדות'")
        page.goto(f"{BASE_URL}/MtrNet/horadatkv.aspx?slct=zip", wait_until="networkidle")
        if "horadatkv.aspx" not in page.url:
            raise self._fail("zip_page", code, "דף ההורדות לא נפתח")
        page.wait_for_selector(SEL_MONTH_DDL, timeout=15000)

    def _options(self) -> list[str]:
        opts = self.page.locator(SEL_MONTH_DDL).locator("option")
        return [opts.nth(i).get_attribute("value") or "" for i in range(opts.count())]

    # ── ממשק ──
    def available_months(self, code: str, kind: str) -> list[date]:
        """החודשים שאפשר להוריד לקוד — למילוי ההיסטוריה."""
        self._search(code, kind)
        self._open_zip_page(code)
        return sorted({d for d in map(parse_month_value, self._options()) if d})

    def download(self, code: str, kind: str, calc_month: date, dest_dir: Path) -> Path:
        """מוריד את ה-ZIP של חודש החישוב. MonthNotYetPublished — אם עוד אינו ברשימה."""
        if kind not in KIND_LABEL:
            raise ValueError(f"סוג מקור לא מוכר: {kind}")
        self._search(code, kind)
        self._open_zip_page(code)
        wanted = month_value(calc_month)
        if wanted not in self._options():
            raise MonthNotYetPublished(f"{code}: {calc_month:%m/%Y} עוד לא פורסם במיתר")
        with self.page.expect_download(timeout=120000) as info:
            self.page.select_option(SEL_MONTH_DDL, value=wanted)
        dl = info.value
        dest_dir.mkdir(parents=True, exist_ok=True)
        target = dest_dir / f"{code}_{calc_month.month}_{calc_month.year}_{dl.suggested_filename}"
        dl.save_as(str(target))
        log.info("   ירד %s (%.1f KB)", target.name, target.stat().st_size / 1024)
        return target
