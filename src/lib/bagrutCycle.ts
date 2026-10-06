// מחזור ההתערבות — עזרי תאריכים למעקב (מעקב הבא, "מעקב השבוע").
//
// "מצב התלמיד" ו"תוכנית התערבות" מיוצרים ב-AI (supabase/functions/bagrut-ai,
// מיגרציה 031) — חשבון הציונים שמוזן ל-AI נעשה שם, בקוד, לא כאן.

// ─────────────────────────────── תאריכים ───────────────────────────────

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return ''
  const [y, m, d] = iso.slice(0, 10).split('-')
  return `${Number(d)}.${Number(m)}.${y}`
}

/** ימים עד התאריך (שלילי = עבר) */
export function daysUntil(iso: string): number {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return Math.round((new Date(y, m - 1, d).getTime() - today.getTime()) / 86400000)
}

export function todayIso(): string {
  const t = new Date()
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}-${String(t.getDate()).padStart(2, '0')}`
}

/** "מעקב השבוע": מעקב שמועדו עבר או שמגיע בשבעת הימים הקרובים */
export function isFollowupDue(iso: string | null | undefined): boolean {
  return Boolean(iso) && daysUntil(iso as string) <= 7
}

/** "בעוד 8 ימים" / "היום" / "באיחור של 3 ימים" */
export function relDays(iso: string): { text: string; tone: 'red' | 'amber' | 'slate' } {
  const n = daysUntil(iso)
  if (n < 0) return { text: `באיחור של ${-n} ימים`, tone: 'red' }
  if (n === 0) return { text: 'היום', tone: 'amber' }
  if (n <= 7) return { text: n === 1 ? 'מחר' : `בעוד ${n} ימים`, tone: 'amber' }
  return { text: `בעוד ${n} ימים`, tone: 'slate' }
}
