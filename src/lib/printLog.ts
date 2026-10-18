// ייצוא יומן המעקב ל-PDF — רשומה בודדת או היומן כולו (משימה 4, פגישת 14.10).
//
// בלי ספריית PDF: נבנה דף HTML מוכן להדפסה, ונפתח עליו חלון ההדפסה של הדפדפן
// — שם בוחרים "שמירה כ-PDF" או מדפסת. כך העברית ויישור לימין נכונים מעצמם
// (ספריית PDF הייתה דורשת להטמיע גופן עברי ולהפוך כיווני טקסט), ואין תלות חדשה.
//
// 🔒 הדף נבנה בזיכרון ונמחק אחרי ההדפסה — שום דבר לא נשמר בדפדפן. ת"ז אינה
// מודפסת: שם, כיתה ובית ספר מספיקים לזיהוי בתיק, ודף מודפס מסתובב.

import { LOG_KIND_LABELS, type BagrutLogEntry } from '@/lib/bagrut'
import { fmtDate } from '@/lib/bagrutCycle'
import { SITE } from '@/config/site'

export interface PrintLogInput {
  studentName: string
  className: string | null
  school: string
  /** "קיץ תשפ"ו" */
  roundLabel: string
  entries: BagrutLogEntry[]
}

const esc = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

function entryHtml(e: BagrutLogEntry): string {
  const field = (label: string, value: string | null) =>
    value ? `<div class="f"><div class="l">${label}</div><div class="v">${esc(value)}</div></div>` : ''
  const meta = [fmtDate(e.happened_on), e.participants ? `משתתפים: ${esc(e.participants)}` : ''].filter(Boolean).join(' · ')
  return `<section class="entry">
    <h2>${LOG_KIND_LABELS[e.kind]}<span class="meta">${meta}</span></h2>
    ${field('מה עלה', e.summary)}
    ${field('על מה הוסכם', e.agreements)}
    ${field('הצעד הבא', e.next_step)}
    ${field('מעקב הבא', e.next_followup ? fmtDate(e.next_followup) : null)}
  </section>`
}

export function logHtml(p: PrintLogInput): string {
  const single = p.entries.length === 1
  const title = single ? `רשומת מעקב — ${p.studentName}` : `יומן מעקב — ${p.studentName}`
  const sub = [p.className && `כיתה ${p.className}`, p.school, p.roundLabel].filter(Boolean).map((x) => esc(x as string)).join(' · ')
  const made = new Date().toLocaleDateString('he-IL', { day: 'numeric', month: 'long', year: 'numeric' })
  return `<!doctype html><html lang="he" dir="rtl"><head><meta charset="utf-8"><title>${esc(title)}</title>
<style>
  @page { size: A4; margin: 16mm 14mm; }
  * { box-sizing: border-box; }
  body { margin: 0; font-family: "Segoe UI", Arial, "Noto Sans Hebrew", sans-serif; color: #1e293b; font-size: 11.5pt; line-height: 1.55; }
  header { border-bottom: 2px solid #0284c7; padding-bottom: 8px; margin-bottom: 14px; }
  h1 { margin: 0; font-size: 18pt; }
  .sub { color: #475569; font-size: 10.5pt; margin-top: 2px; }
  .count { color: #64748b; font-size: 9.5pt; margin-top: 4px; }
  .entry { border: 1px solid #cbd5e1; border-radius: 8px; padding: 10px 12px; margin-bottom: 10px; break-inside: avoid; }
  h2 { margin: 0 0 6px; font-size: 12.5pt; }
  .meta { font-weight: normal; color: #64748b; font-size: 10pt; margin-right: 8px; }
  .f { margin-top: 6px; }
  .l { font-size: 9pt; font-weight: bold; color: #64748b; }
  .v { white-space: pre-wrap; }
  footer { margin-top: 16px; color: #94a3b8; font-size: 8.5pt; border-top: 1px solid #e2e8f0; padding-top: 6px; }
</style></head><body>
<header>
  <h1>${esc(title)}</h1>
  <div class="sub">${sub}</div>
  ${single ? '' : `<div class="count">${p.entries.length} רשומות, מהחדשה לישנה</div>`}
</header>
${p.entries.map(entryHtml).join('\n')}
<footer>הופק מ${esc(SITE.name)} ב-${made} · זכאות לבגרות · יומן מעקב</footer>
</body></html>`
}

/**
 * פותח את חלון ההדפסה על הדף, בתוך iframe נסתר — לא חלון חדש, שחוסם חלונות
 * קופצים עלול לעצור. ה-iframe נמחק אחרי ההדפסה (או אחרי דקה, אם הדפדפן אינו
 * מודיע על סיומה).
 */
export function printLog(p: PrintLogInput) {
  const frame = document.createElement('iframe')
  frame.setAttribute('aria-hidden', 'true')
  Object.assign(frame.style, { position: 'fixed', width: '0', height: '0', border: '0', left: '-9999px' })
  const cleanup = () => frame.remove()
  frame.onload = () => {
    const w = frame.contentWindow
    if (!w) return cleanup()
    w.addEventListener('afterprint', () => setTimeout(cleanup, 500))
    setTimeout(cleanup, 60_000)
    w.focus()
    w.print()
  }
  frame.srcdoc = logHtml(p)
  document.body.appendChild(frame)
}
