-- מיגרציה 031: ניתוח AI לתלמיד — "מצב התלמיד" ו"תוכנית התערבות"
--
-- ═══════════════════════════════════════════════════════════════
-- מה ולמה
-- ═══════════════════════════════════════════════════════════════
--
-- אייל, 7.10: מצב התלמיד ותוכנית ההתערבות חייבים להיות מיוצרים ע"י AI, בכפתור
-- ליד כל אחד — רק לתלמידים שהמורה באמת רוצה, לא לכולם. ה-Edge Function
-- bagrut-ai קוראת את נתוני התלמיד **בהרשאות של המורה** (RLS), שולחת ל-Claude
-- בלי שם ובלי ת"ז, בודקת את התשובה, ושומרת אותה כאן — כדי שלא תיווצר מחדש בכל
-- פתיחה של הכרטיס.
--
-- ⚠️ זכאות נקבעת רק לפי T2 (decisions/014 §8). הניתוח מנסח ומתכנן — הוא אינו
-- קובע ואינו מנבא זכאות, והפונקציה מסננת טענות כאלה.
--
-- לפי בית ספר + ת"ז (כמו המעקב), ועם round_id — כדי לדעת על איזה סבב נוצר
-- ניתוח, ולסמן "לא עדכני" אחרי קליטה חדשה. בלי מפתח זר לסבב: מחיקת סבב לא
-- מוחקת את ההיסטוריה של המורה.

create table if not exists public.bagrut_ai_analysis (
  id              uuid primary key default gen_random_uuid(),
  authority_code  text not null references public.authorities(code) on delete cascade,
  school_code     text not null,
  student_id      text not null,
  round_id        uuid,
  kind            text not null check (kind in ('picture', 'plan')),
  content         jsonb not null,
  model           text,
  input_hash      text,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.users(id) on delete set null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.users(id) on delete set null
);
create index if not exists bagrut_ai_analysis_student
  on public.bagrut_ai_analysis (authority_code, school_code, student_id, kind, created_at desc);

drop trigger if exists bagrut_ai_analysis_stamp on public.bagrut_ai_analysis;
create trigger bagrut_ai_analysis_stamp before insert or update on public.bagrut_ai_analysis
  for each row execute function public.bagrut_row_stamp();

-- הרשאות — כמו התוכנית והיומן (029): קריאה למי שרואה את התלמיד, יצירה למי
-- שעורך את המעקב שלו. אין עדכון: ניתוח חדש = שורה חדשה (ההיסטוריה נשמרת).
alter table public.bagrut_ai_analysis enable row level security;

drop policy if exists bagrut_ai_analysis_read   on public.bagrut_ai_analysis;
drop policy if exists bagrut_ai_analysis_insert on public.bagrut_ai_analysis;
drop policy if exists bagrut_ai_analysis_delete on public.bagrut_ai_analysis;
create policy bagrut_ai_analysis_read on public.bagrut_ai_analysis for select to authenticated
  using (public.bagrut_cycle_visible(authority_code, school_code, student_id));
create policy bagrut_ai_analysis_insert on public.bagrut_ai_analysis for insert to authenticated
  with check (public.bagrut_cycle_editable(authority_code, school_code, student_id));
create policy bagrut_ai_analysis_delete on public.bagrut_ai_analysis for delete to authenticated
  using (public.bagrut_cycle_editable(authority_code, school_code, student_id));
