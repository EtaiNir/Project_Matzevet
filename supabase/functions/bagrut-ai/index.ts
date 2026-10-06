// Edge Function: ניתוח AI לתלמיד בבגרות — "מצב התלמיד" או "תוכנית התערבות".
//
// הזרימה: המורה לוחץ כפתור בלשונית המעקב → הדפדפן קורא לפונקציה עם הזהות
// שלו → הפונקציה קוראת את נתוני התלמיד **בהרשאות של המורה** (RLS — רואה רק
// מה שהמורה רואה), מחשבת בקוד את חשבון הציונים, שולחת ל-Claude בלי שם ובלי
// ת"ז, בודקת את התשובה, ושומרת אותה ב-bagrut_ai_analysis (מיגרציה 031).
// docs/bagrut-intervention-design.md · decisions/014.
//
// ⚠️ זכאות נקבעת רק לפי T2 (decisions/014 §8). ה-AI מנסח ומתכנן מתוך מה
// ש-T2 כבר אמר; כל מספר מגיע מהקוד; טענה על זכאות עתידית מסוננת.
//
// פריסה: docs/server-migration.md → "פריסת Edge Functions" (Management API,
// slug=bagrut-ai, verify_jwt=true). סוד נדרש: ANTHROPIC_API_KEY (Supabase secrets).
// SUPABASE_URL ו-SUPABASE_ANON_KEY מוגדרים אוטומטית.

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.45.0'
import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.131.0'

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
const MODEL = 'claude-opus-5-5'
const PASS = 55

const ACTION_TYPES = [
  'תגבור', 'שיפור ציון במועד הבא', 'בחינה חוזרת', 'השלמת שאלון', 'עבודה חלופית',
  'התאמות בבחינה', 'מעבר רמה', 'שיחה עם הורים', 'הפניה ליועצת', 'בדיקה מול בית הספר', 'אחר',
]
const FLAG_LABELS: Record<string, string> = {
  fighting: 'נלחמים על הזכאות', has_blocker: 'יש חסם', suspected: 'קיבל חשד (טוהר בחינות)', zero_chance: 'סיכוי אפסי לזכאות',
}
const LOG_KINDS: Record<string, string> = { student: 'שיחה עם התלמיד', parents: 'שיחה עם ההורים', staff: 'ישיבת צוות', update: 'עדכון' }

// טענה על זכאות עתידית — ה-AI אינו קובע זכאות (014 §8). פריט שמכיל אותה לא נשמר.
const ELIGIBILITY_CLAIM = /יהיה זכאי|תהיה זכאית|יהיו זכאים|יזכה בתעודה|יקבל תעודת בגרות|זכאות מובטחת|מבטיח(?:ה)? זכאות|יגיע ל-?21/

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })
}

// ─────────────────────────────── איסוף הנתונים ───────────────────────────────

interface Ctx {
  round: { id: string; authority_code: string; school_code: string; season: string; school_year: string; graduating_grade: string | null }
  student: Record<string, unknown>
  input: Record<string, unknown>
  subjectNames: Map<string, string>          // subject_key → שם
  subjectCodes: Map<string, Set<number>>     // שם מקצוע → סמלי שאלון
  neededBySubject: Map<string, number | null>
  retakeBySubject: Map<string, { code: number; current: number; needed: number } | null>
}

async function collect(db: SupabaseClient, roundId: string, sid: string): Promise<Ctx> {
  const one = async <T>(label: string, p: PromiseLike<{ data: T | null; error: { message: string } | null }>) => {
    const { data, error } = await p
    if (error) throw new Error(`${label}: ${error.message}`)
    return data as T
  }
  const round = await one<Ctx['round']>('סבב', db.from('bagrut_rounds')
    .select('id, authority_code, school_code, season, school_year, graduating_grade').eq('id', roundId).maybeSingle())
  if (!round) throw new Error('הסבב אינו גלוי לך')
  // ה-RLS של bagrut_students: אם המורה לא רואה את התלמיד — לא חוזרת שורה
  const student = await one<Record<string, unknown>>('תלמיד', db.from('bagrut_students')
    .select('grade, class_name, in_t2, status, blockers, intervention, grades_summary, done_summary, one_negative_option, compensation_pair, compensation_eligible, negatives_count, mother_tongue_status, core_units, reinforced_subject, total_units, reason')
    .eq('round_id', roundId).eq('student_id', sid).maybeSingle())
  if (!student) throw new Error('התלמיד אינו גלוי לך')

  const key = { authority_code: round.authority_code, school_code: round.school_code, student_id: sid }
  const [subjects, metrics, grades, program, tracking, log, actions] = await Promise.all([
    one<{ subject_key: string; subject_name: string; subject_group: string; units: number | null }[]>('מקצועות',
      db.from('bagrut_round_subjects').select('subject_key, subject_name, subject_group, units').eq('round_id', roundId).order('sort')),
    one<{ subject_key: string; final_grade: number | null; cumulative_grade: number | null; cumulative_weight: number | null; completion_status: string | null; units: number | null }[]>('מדדים',
      db.from('bagrut_subjects').select('subject_key, final_grade, cumulative_grade, cumulative_weight, completion_status, units').eq('round_id', roundId).eq('student_id', sid)),
    one<{ subject_key: string; questionnaire_code: number; grade: number | null; weight: number | null; weighted: number | null }[]>('ציונים',
      db.from('bagrut_grades').select('subject_key, questionnaire_code, grade, weight, weighted').eq('round_id', roundId).eq('student_id', sid)),
    one<{ subject_key: string; questionnaire_code: number; weight: number | null; alt_group: number | null }[]>('מצפן',
      db.from('bagrut_program').select('subject_key, questionnaire_code, weight, alt_group').eq('round_id', roundId).order('sort')),
    one<Record<string, unknown> | null>('מעקב', db.from('bagrut_tracking')
      .select('suspected, has_blocker, fighting, zero_chance, note_short, note_long, factors, factors_note').match(key).maybeSingle()),
    one<Record<string, unknown>[]>('יומן', db.from('bagrut_log')
      .select('kind, happened_on, summary, agreements, next_step').match(key).order('happened_on', { ascending: false }).limit(6)),
    one<Record<string, unknown>[]>('תוכנית', db.from('bagrut_actions')
      .select('title, status, outcome').match(key).neq('status', 'dismissed')),
  ])

  const subjectNames = new Map(subjects.map((s) => [s.subject_key, s.subject_name]))
  const subjectCodes = new Map<string, Set<number>>()
  const neededBySubject = new Map<string, number | null>()
  const retakeBySubject = new Map<string, { code: number; current: number; needed: number } | null>()

  // חשבון ציונים בקוד — אותו חשבון כמו lib/bagrutCycle.ts. לא החלטת זכאות.
  const subjectRows = subjects.filter((s) => s.subject_group !== 'פנימי').flatMap((s) => {
    const m = metrics.find((x) => x.subject_key === s.subject_key)
    const gs = grades.filter((g) => g.subject_key === s.subject_key && g.grade != null)
    if (!m && !gs.length) return []
    const graded = new Set(gs.map((g) => g.questionnaire_code))
    const prog = program.filter((p) => p.subject_key === s.subject_key)
    const doneGroups = new Set(prog.filter((p) => p.alt_group != null && graded.has(p.questionnaire_code)).map((p) => p.alt_group))
    const seen = new Set<number>()
    const remaining: { questionnaires: string; weight_pct: number }[] = []
    for (const p of prog) {
      if (!(p.weight ?? 0) || graded.has(p.questionnaire_code)) continue
      if (p.alt_group != null) {
        if (doneGroups.has(p.alt_group) || seen.has(p.alt_group)) continue
        seen.add(p.alt_group)
        remaining.push({ questionnaires: prog.filter((x) => x.alt_group === p.alt_group).map((x) => x.questionnaire_code).join(' או '), weight_pct: Math.round((p.weight ?? 0) * 100) })
      } else {
        remaining.push({ questionnaires: String(p.questionnaire_code), weight_pct: Math.round((p.weight ?? 0) * 100) })
      }
    }
    const final = m?.final_grade ?? null
    const cum = m?.cumulative_grade ?? null
    const cw = m?.cumulative_weight ?? null
    const rw = cw != null ? Math.max(0, 1 - cw) : remaining.reduce((a, r) => a + r.weight_pct / 100, 0)
    const needed = final == null && cum != null && rw > 0.001 && remaining.length ? Math.ceil((PASS - cum) / rw) : null
    let retake: { code: number; current: number; needed: number } | null = null
    if (final != null && final < PASS) {
      for (const g of gs) {
        if (!(g.weight ?? 0) || (g.grade as number) >= 100) continue
        const n = Math.ceil((g.grade as number) + (PASS - final) / (g.weight as number))
        if (n <= 100 && (!retake || n - (g.grade as number) < retake.needed - retake.current)) retake = { code: g.questionnaire_code, current: g.grade as number, needed: n }
      }
    }
    subjectCodes.set(s.subject_name, new Set([...prog.map((p) => p.questionnaire_code), ...gs.map((g) => g.questionnaire_code)]))
    neededBySubject.set(s.subject_name, needed)
    retakeBySubject.set(s.subject_name, retake)
    return [{
      subject: s.subject_name,
      group: s.subject_group === 'חובה' ? 'מלל' : s.subject_group,
      units: s.units ?? m?.units ?? null,
      final_grade: final,
      cumulative_weighted: cum,
      done_weight_pct: cw != null ? Math.round(cw * 100) : null,
      completion: m?.completion_status ?? null,
      questionnaires: gs.map((g) => ({ code: g.questionnaire_code, grade: g.grade, weight_pct: g.weight != null ? Math.round(g.weight * 100) : null, blocked_grade: (g.grade as number) >= 1 && (g.grade as number) <= 4 })),
      remaining,
      needed_average_in_remaining_to_finish_at_55: needed,
      cheapest_retake_to_reach_55: retake,
    }]
  })

  const t = tracking ?? {}
  const input = {
    round: { season: round.season, school_year: round.school_year, graduating_grade: round.graduating_grade },
    student: {
      grade: student.grade, class: student.class_name,
      in_graduating_analysis: student.in_t2,
      // T2 — מקור האמת לזכאות, כפי שהגיע
      t2: student.in_t2 ? {
        status: student.status, blockers: student.blockers, recommended_intervention: student.intervention,
        grades_summary: student.grades_summary, done_summary: student.done_summary,
        one_negative_option: student.one_negative_option, compensation_pair: student.compensation_pair,
        compensation_eligible: student.compensation_eligible, negatives_count: student.negatives_count,
        mother_tongue_status: student.mother_tongue_status, core_units: student.core_units,
        reinforced_subject: student.reinforced_subject, total_units: student.total_units, reason: student.reason,
      } : null,
    },
    subjects: subjectRows,
    staff: {
      flags: Object.keys(FLAG_LABELS).filter((k) => t[k]).map((k) => FLAG_LABELS[k]),
      non_grade_factors: (t.factors as string[] | undefined) ?? [],
      factors_note: t.factors_note ?? null,
      notes: t.note_long ?? t.note_short ?? null,
      recent_log: log.map((e) => ({ kind: LOG_KINDS[e.kind as string] ?? e.kind, date: e.happened_on, summary: e.summary, agreements: e.agreements, next_step: e.next_step })),
      current_plan: actions.map((a) => ({ title: a.title, status: a.status === 'done' ? 'הושלם' : 'בביצוע', outcome: a.outcome })),
    },
  }
  return { round, student, input, subjectNames, subjectCodes, neededBySubject, retakeBySubject }
}

// ─────────────────────────────── הפרומפט והסכמות ───────────────────────────────

const SYSTEM = `אתה עוזר לצוות פדגוגי בבית ספר תיכון בישראל, במערכת מעקב אחר זכאות לתעודת בגרות. אתה כותב למורה — לא לתלמיד — בעברית, בשפה פשוטה וענינית.

כללים מחייבים:
1. הזכאות נקבעת רק לפי ניתוח הזכאות (השדה t2). אל תקבע, תנבא או תתקן זכאות, ואל תכתוב שתלמיד "יהיה זכאי" אם יעשה משהו. מותר לתאר מה t2 אומר ואיזה חסם פעולה מטפלת בו.
2. השתמש רק במספרים שמופיעים בקלט. אל תחשב ציון נדרש בעצמך — הוא כבר מחושב (needed_average_in_remaining_to_finish_at_55, cheapest_retake_to_reach_55).
3. ציון 1–4 בשאלון (blocked_grade) הוא ציון חסם: אינו נספר ומחייב בחינה חוזרת.
4. אל תמציא שמות, אנשים או פרטים שאינם בקלט. שמות מקצועות — בדיוק כפי שהם בקלט.
5. בלי הקדמות ובלי סיכומים כלליים. כל משפט צריך לעזור למורה לפעול או לנהל שיחה.`

const PICTURE_TASK = `כתוב "מצב התלמיד" למורה שעומד לנהל שיחה או מעקב:
- headline: משפט אחד — איפה התלמיד עומד (לפי t2, או לפי התקדמות המקצועות אם אין t2).
- story: 2–4 משפטים שמחברים את התמונה: מה המצב, מה מפריד, ועל מה אפשר לבנות. אם יש מידע מהצוות (הערות, גורמים, יומן) — שלב אותו.
- gaps: מה מפריד בינו לבין זכאות — כל פריט עם הגודל שלו (מתוך t2 ומהמקצועות).
- closest: מה הכי קרוב לתיקון — עד 3, עם הציון הנדרש מהקלט.
- risks: מקצועות בתהליך שעלולים להפוך לחסם.
- strengths: על מה אפשר לבנות — מקצועות שהושלמו בציון גבוה.
- conversation_tips: 2–3 נקודות קצרות לשיחה עם התלמיד, לפי מה שידוע עליו.
רשימה ריקה כשאין מה לכתוב.`

const PLAN_TASK = `בנה "תוכנית התערבות" שתביא את התלמיד הכי רחוק במאמץ הקטן ביותר. בסיס התוכנית: recommended_intervention ו-blockers של t2 — כל פעולה מטפלת באחד מהם. אם אין t2 — לפי התקדמות המקצועות.
- סדר את הפעולות לפי עדיפות (החשובה והקרובה ביותר ראשונה).
- אל תחזור על פעולה שכבר בתוכנית הנוכחית (staff.current_plan), אלא אם יש מה להוסיף לה.
- לכל פעולה: title (מה לעשות, קצר), why (איזה חסם של t2 היא מטפלת בו), how (איך בפועל — בשפה של מורה), action_type מהרשימה, subject (שם מקצוע מדויק מהקלט, או מחרוזת ריקה לפעולה כללית), questionnaire_code (סמל שאלון של אותו מקצוע מהקלט, או null), owner (מי מבצע: מורה המקצוע / מחנך / רכז הבגרויות / יועצת / התלמיד).
- note: הערה אחת למורה על התוכנית כולה, או מחרוזת ריקה.`

const strList = { type: 'array', items: { type: 'string' } }
const PICTURE_SCHEMA = {
  type: 'object', additionalProperties: false,
  required: ['headline', 'story', 'gaps', 'closest', 'risks', 'strengths', 'conversation_tips'],
  properties: { headline: { type: 'string' }, story: { type: 'string' }, gaps: strList, closest: strList, risks: strList, strengths: strList, conversation_tips: strList },
}
const PLAN_SCHEMA = {
  type: 'object', additionalProperties: false, required: ['actions', 'note'],
  properties: {
    note: { type: 'string' },
    actions: {
      type: 'array',
      items: {
        type: 'object', additionalProperties: false,
        required: ['title', 'why', 'how', 'action_type', 'subject', 'questionnaire_code', 'owner'],
        properties: {
          title: { type: 'string' }, why: { type: 'string' }, how: { type: 'string' },
          action_type: { type: 'string', enum: ACTION_TYPES },
          subject: { type: 'string' },
          questionnaire_code: { anyOf: [{ type: 'integer' }, { type: 'null' }] },
          owner: { type: 'string' },
        },
      },
    },
  },
}

// ─────────────────────────────── בדיקת התשובה ───────────────────────────────

function cleanList(xs: unknown): string[] {
  return Array.isArray(xs) ? xs.filter((x): x is string => typeof x === 'string' && x.trim() !== '' && !ELIGIBILITY_CLAIM.test(x)) : []
}

function validatePicture(raw: Record<string, unknown>) {
  const s = (v: unknown) => (typeof v === 'string' && !ELIGIBILITY_CLAIM.test(v) ? v : '')
  return {
    headline: s(raw.headline), story: s(raw.story),
    gaps: cleanList(raw.gaps), closest: cleanList(raw.closest), risks: cleanList(raw.risks),
    strengths: cleanList(raw.strengths), conversation_tips: cleanList(raw.conversation_tips),
  }
}

/** כל פעולה נבדקת: מקצוע קיים אצל התלמיד, שאלון של אותו מקצוע, בלי טענת זכאות.
 *  הציון הנדרש מוצמד מהקוד — לא מה-AI. */
function validatePlan(raw: Record<string, unknown>, ctx: Ctx) {
  const dropped: string[] = []
  const actions = (Array.isArray(raw.actions) ? raw.actions : []).flatMap((a: Record<string, unknown>) => {
    const text = [a.title, a.why, a.how].join(' ')
    if (typeof a.title !== 'string' || !a.title.trim()) return []
    if (ELIGIBILITY_CLAIM.test(text)) { dropped.push(`${a.title} — טענה על זכאות`); return [] }
    let subject = typeof a.subject === 'string' ? a.subject.trim() : ''
    if (subject && !ctx.subjectCodes.has(subject)) { dropped.push(`${a.title} — מקצוע לא מוכר: ${subject}`); subject = '' }
    let code = typeof a.questionnaire_code === 'number' ? a.questionnaire_code : null
    if (code != null && !(subject && ctx.subjectCodes.get(subject)?.has(code))) code = null
    const retake = subject ? ctx.retakeBySubject.get(subject) : null
    const needed = subject ? ctx.neededBySubject.get(subject) : null
    const required_grade = retake && (code == null || code === retake.code) ? retake.needed
      : needed != null && needed >= 1 && needed <= 100 ? needed : null
    return [{
      title: a.title.trim(), why: String(a.why ?? ''), how: String(a.how ?? ''),
      action_type: ACTION_TYPES.includes(a.action_type as string) ? a.action_type : 'אחר',
      subject: subject || null, questionnaire_code: code ?? (retake && required_grade === retake.needed ? retake.code : null),
      required_grade, owner: String(a.owner ?? ''),
    }]
  })
  return { actions, note: typeof raw.note === 'string' && !ELIGIBILITY_CLAIM.test(raw.note) ? raw.note : '', dropped }
}

async function sha256(s: string) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

// ─────────────────────────────── הבקשה ───────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return json({ error: 'POST בלבד' }, 405)

  const auth = req.headers.get('Authorization')
  if (!auth) return json({ error: 'לא מחובר' }, 401)
  const apiKey = Deno.env.get('ANTHROPIC_API_KEY')
  if (!apiKey) return json({ error: 'מפתח ה-AI לא הוגדר בשרת (ANTHROPIC_API_KEY)' }, 500)

  let body: { round_id?: string; student_id?: string; kind?: string }
  try { body = await req.json() } catch { return json({ error: 'גוף הבקשה אינו JSON' }, 400) }
  const { round_id, student_id, kind } = body
  if (!round_id || !student_id || (kind !== 'picture' && kind !== 'plan')) return json({ error: 'חסרים round_id, student_id או kind' }, 400)

  // לקוח בזהות המורה — כל קריאה עוברת RLS
  const db = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })

  let ctx: Ctx
  try { ctx = await collect(db, round_id, student_id) } catch (e) { return json({ error: (e as Error).message }, 403) }

  // רק מי שעורך את המעקב של התלמיד מפעיל AI (עולה כסף); המועצה צופה בתוצאה
  const { data: canEdit, error: permErr } = await db.rpc('bagrut_cycle_editable', {
    auth: ctx.round.authority_code, school: ctx.round.school_code, sid: student_id,
  })
  if (permErr) return json({ error: `בדיקת הרשאה: ${permErr.message}` }, 500)
  if (!canEdit) return json({ error: 'יצירת ניתוח פתוחה לצוות בית הספר בלבד' }, 403)

  const inputText = JSON.stringify(ctx.input)
  const client = new Anthropic({ apiKey })
  let response
  try {
    response = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM,
      messages: [{ role: 'user', content: `${kind === 'picture' ? PICTURE_TASK : PLAN_TASK}\n\nנתוני התלמיד (בלי שם ובלי ת"ז):\n${inputText}` }],
      output_config: { effort: 'medium', format: { type: 'json_schema', schema: kind === 'picture' ? PICTURE_SCHEMA : PLAN_SCHEMA } },
      // סירוב של מסווגי הבטיחות — מנותב אוטומטית למודל חלופי
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    } as never)
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return json({ error: 'יותר מדי בקשות ל-AI כרגע — לנסות שוב בעוד דקה' }, 429)
    if (e instanceof Anthropic.AuthenticationError) return json({ error: 'מפתח ה-AI בשרת אינו תקף' }, 500)
    if (e instanceof Anthropic.APIError) return json({ error: `שגיאת AI (${e.status}): ${e.message}` }, 502)
    return json({ error: `שגיאה בקריאה ל-AI: ${(e as Error).message}` }, 502)
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const r = response as any
  if (r.stop_reason === 'refusal') return json({ error: 'ה-AI סירב לבקשה. אפשר לנסות שוב.' }, 502)
  if (r.stop_reason === 'max_tokens') return json({ error: 'תשובת ה-AI נחתכה — לנסות שוב' }, 502)
  const text = (r.content ?? []).filter((b: { type: string }) => b.type === 'text').map((b: { text: string }) => b.text).join('')
  let parsed: Record<string, unknown>
  try { parsed = JSON.parse(text) } catch { return json({ error: 'תשובת ה-AI אינה במבנה הצפוי — לנסות שוב' }, 502) }

  const content = kind === 'picture' ? validatePicture(parsed) : validatePlan(parsed, ctx)

  const { data: saved, error: saveErr } = await db.from('bagrut_ai_analysis').insert({
    authority_code: ctx.round.authority_code, school_code: ctx.round.school_code, student_id,
    round_id, kind, content, model: r.model ?? MODEL, input_hash: await sha256(inputText),
  }).select('id, kind, content, model, round_id, created_at').single()
  if (saveErr) return json({ error: `שמירת הניתוח: ${saveErr.message}` }, 500)
  // usage — למעקב עלות (לא נשמר); dropped — פעולות שהבדיקה סיננה
  return json({ ...saved, usage: r.usage ?? null })
})
