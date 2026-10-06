-- מיגרציה 029: מחזור ההתערבות — תוכנית פעולה ויומן מעקב לתלמיד
--
-- ═══════════════════════════════════════════════════════════════
-- מה ולמה
-- ═══════════════════════════════════════════════════════════════
--
-- לשונית המעקב בכרטיס התלמיד הופכת למחזור: מצב → תוכנית → מעקב
-- (docs/bagrut-intervention-design.md). שלוש תוספות:
--
--   bagrut_tracking  + מעקב הבא, גורמים שאינם בציונים
--   bagrut_actions   פעולה בתוכנית ההתערבות
--   bagrut_log       רשומה ביומן המעקב (שיחה, ישיבת צוות, עדכון)
--
-- כמו bagrut_tracking: לפי רשות + בית ספר + ת"ז, **בלי סבב ובלי מפתח זר
-- לתלמידים** — תוכנית שנבנתה בקיץ ממשיכה לחורף, ומחיקת סבב לא נוגעת בה.
--
-- ⚠️ זכאות נקבעת רק לפי T2 (decisions/014 §8). הפעולות נולדות מפריטי
-- "ההתערבות המומלצת" של T2; אין כאן שום עמודה של "יהיה זכאי".
--
-- הרשאות — זהות ל-bagrut_tracking **כפי שהיא במסד החי**: קריאה למי שרואה
-- את התלמיד, כתיבה ב-may_edit_bagrut_student (צוות בית הספר בהיקף שלו, כולל
-- רכז מקצוע; לא המועצה).
--
-- ⚠️ may_edit_bagrut_student ותפקיד subject_coordinator קיימים במסד אבל
-- **המיגרציה שיצרה אותם אינה בריפו** (נמצא 7.10). 026 בריפו עדיין מגדיר את
-- may_edit_bagrut_tracking הישנה — הרצה חוזרת של 026 תחזיר את המסד אחורה.

-- ── מעקב: מעקב הבא + גורמים שאינם בציונים
alter table public.bagrut_tracking
  add column if not exists next_followup date,
  add column if not exists factors       text[] not null default '{}',
  add column if not exists factors_note  text;

-- ── עזרים למדיניות: האם התלמיד גלוי / ניתן לעריכה, לפי רשות + בית ספר +
-- ת"ז (בלי סבב). security invoker (ברירת המחדל) — ה-RLS של bagrut_students
-- חל בתוכן, בדיוק כמו בתת-השאילתה של bagrut_tracking. (השם bagrut_student_visible
-- תפוס — פונקציה אחרת, לפי סבב.)
create or replace function public.bagrut_cycle_visible(auth text, school text, sid text)
returns boolean
language sql
stable
as $$
  select exists (select 1 from public.bagrut_students s
                 where s.authority_code = auth and s.school_code = school and s.student_id = sid);
$$;

create or replace function public.bagrut_cycle_editable(auth text, school text, sid text)
returns boolean
language sql
stable
as $$
  select exists (select 1 from public.bagrut_students s
                 where s.authority_code = auth and s.school_code = school and s.student_id = sid
                   and public.may_edit_bagrut_student(s.round_id, s.student_id, s.school_code,
                                                      s.grade, s.class_name, s.track));
$$;

-- ── פעולות בתוכנית
create table if not exists public.bagrut_actions (
  id                 uuid primary key default gen_random_uuid(),
  authority_code     text not null references public.authorities(code) on delete cascade,
  school_code        text not null,
  student_id         text not null,
  -- הפריט של T2 שממנו נולדה ההצעה (טקסט מנורמל). null = פעולה ידנית.
  -- הצעה שאושרה או נדחתה לא מוצעת שוב — בזכות המפתח הזה.
  suggest_key        text,
  title              text not null check (length(btrim(title)) > 0),
  detail             text,
  action_type        text,
  subject_key        text,
  questionnaire_code int,
  required_grade     numeric,
  owner              text,
  due_label          text,
  status             text not null default 'active'
                     check (status in ('active', 'done', 'dismissed')),
  outcome            text,
  created_at         timestamptz not null default now(),
  created_by         uuid references public.users(id) on delete set null,
  updated_at         timestamptz not null default now(),
  updated_by         uuid references public.users(id) on delete set null,
  unique (authority_code, school_code, student_id, suggest_key)
);
create index if not exists bagrut_actions_student
  on public.bagrut_actions (authority_code, school_code, student_id);

-- ── יומן מעקב
create table if not exists public.bagrut_log (
  id              uuid primary key default gen_random_uuid(),
  authority_code  text not null references public.authorities(code) on delete cascade,
  school_code     text not null,
  student_id      text not null,
  kind            text not null check (kind in ('student', 'parents', 'staff', 'update')),
  happened_on     date not null default current_date,
  participants    text,
  summary         text,
  agreements      text,
  next_step       text,
  next_followup   date,
  created_at      timestamptz not null default now(),
  created_by      uuid references public.users(id) on delete set null,
  updated_at      timestamptz not null default now(),
  updated_by      uuid references public.users(id) on delete set null,
  -- רשומה ריקה אינה רשומה
  check (coalesce(btrim(summary), btrim(agreements), btrim(next_step), '') <> '')
);
create index if not exists bagrut_log_student
  on public.bagrut_log (authority_code, school_code, student_id, happened_on desc);

-- ── מי ומתי — נקבע במסד, לא בדפדפן (כמו bagrut_tracking_stamp)
create or replace function public.bagrut_row_stamp()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_at := now();
    new.created_by := coalesce(auth.uid(), new.created_by);
  else
    new.created_at := old.created_at;
    new.created_by := old.created_by;
  end if;
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists bagrut_actions_stamp on public.bagrut_actions;
create trigger bagrut_actions_stamp before insert or update on public.bagrut_actions
  for each row execute function public.bagrut_row_stamp();
drop trigger if exists bagrut_log_stamp on public.bagrut_log;
create trigger bagrut_log_stamp before insert or update on public.bagrut_log
  for each row execute function public.bagrut_row_stamp();

-- ── RLS: ארבע מדיניות לכל טבלה; בעדכון גם using וגם with check (מלכודת 28)
alter table public.bagrut_actions enable row level security;
alter table public.bagrut_log     enable row level security;

drop policy if exists bagrut_actions_read   on public.bagrut_actions;
drop policy if exists bagrut_actions_insert on public.bagrut_actions;
drop policy if exists bagrut_actions_update on public.bagrut_actions;
drop policy if exists bagrut_actions_delete on public.bagrut_actions;
create policy bagrut_actions_read on public.bagrut_actions for select to authenticated
  using (public.bagrut_cycle_visible(authority_code, school_code, student_id));
create policy bagrut_actions_insert on public.bagrut_actions for insert to authenticated
  with check (public.bagrut_cycle_editable(authority_code, school_code, student_id));
create policy bagrut_actions_update on public.bagrut_actions for update to authenticated
  using (public.bagrut_cycle_editable(authority_code, school_code, student_id))
  with check (public.bagrut_cycle_editable(authority_code, school_code, student_id));
create policy bagrut_actions_delete on public.bagrut_actions for delete to authenticated
  using (public.bagrut_cycle_editable(authority_code, school_code, student_id));

drop policy if exists bagrut_log_read   on public.bagrut_log;
drop policy if exists bagrut_log_insert on public.bagrut_log;
drop policy if exists bagrut_log_update on public.bagrut_log;
drop policy if exists bagrut_log_delete on public.bagrut_log;
create policy bagrut_log_read on public.bagrut_log for select to authenticated
  using (public.bagrut_cycle_visible(authority_code, school_code, student_id));
create policy bagrut_log_insert on public.bagrut_log for insert to authenticated
  with check (public.bagrut_cycle_editable(authority_code, school_code, student_id));
create policy bagrut_log_update on public.bagrut_log for update to authenticated
  using (public.bagrut_cycle_editable(authority_code, school_code, student_id))
  with check (public.bagrut_cycle_editable(authority_code, school_code, student_id));
create policy bagrut_log_delete on public.bagrut_log for delete to authenticated
  using (public.bagrut_cycle_editable(authority_code, school_code, student_id));
