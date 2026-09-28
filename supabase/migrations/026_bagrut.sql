-- מיגרציה 026: מודול זכאות לבגרות
--
-- ═══════════════════════════════════════════════════════════════
-- מה נכנס כאן
-- ═══════════════════════════════════════════════════════════════
--
-- המודול הראשון בפורטל אחרי המצבת. מחליף את מערכת הזכאות של סבא
-- באקסס. קלט בכל סבב: T1 (עיבוד ציונים), T2 (ניתוח זכאות) ו"המצפן"
-- (תוכנית הבגרות של בית הספר). ראה docs/decisions/014-bagrut-module.md.
--
-- ייחוס ומבנה הסבב:
--   bagrut_questionnaires   אינדקס השאלונים הארצי
--   bagrut_rounds           סבב = בית ספר × מועד × שנה
--   bagrut_round_subjects   המקצועות של הסבב (בלוקי T1)
--   bagrut_program          המצפן: מקצוע × שאלון × משקל
--
-- נתוני התלמידים — ארבע טבלאות:
--   bagrut_students   תלמיד בסבב: שכבה וכיתה מ-T1, ועמודות T2 (ריקות מחוץ לשכבה המסיימת)
--   bagrut_grades     ציון לכל שאלון — T1 אחרי פירוק לשורות
--   bagrut_subjects   מדדי מקצוע — T1
--   bagrut_tracking   דגלי מעקב והערות — **לא נדרסת בקליטת סבב**
--
-- ═══════════════════════════════════════════════════════════════
-- למה טבלאות משותפות ולא טבלה לכל רשות
-- ═══════════════════════════════════════════════════════════════
--
-- במצבת כל רשות מקבלת טבלה משלה ("רשות = עולם"), כי העדכון החודשי מריץ
-- TRUNCATE על הרשות כולה. כאן אין TRUNCATE — קליטה מוחקת *סבב* אחד לפי
-- round_id. וההגנה בפועל היא ה-RLS, לא ההפרדה הפיזית: has_authority על
-- authority_code מגנה באותה רמה, בלי SQL דינמי, בלי יצירה בעצלתיים,
-- ובלי 4 טבלאות חדשות לכל לקוח. ההחלטה: docs/decisions/014.
--
-- ⚠️ אין מפתח זר ל-students_{code} (המצבת): בית ספר יכול להיכנס לפני
-- שיש לרשות מצבת, והקישור למצבת הוא לפי ת"ז — כמו דרג ב' (מיגרציה 023).
--
-- ═══════════════════════════════════════════════════════════════
-- הרשאות — חמישה תפקידים (לא נוגע בהיקף המצבת)
-- ═══════════════════════════════════════════════════════════════
--
-- scope_level/scope_values של המצבת נשארים כמו שהם. למודול יש תפקיד
-- והיקף משלו, כי מחנך כיתה צריך היקף שאין לו מקבילה במצבת.
--
--   council            כל בתי הספר ברשויות שלו      — צפייה בלבד
--   coordinator        רכז בגרויות — בית ספר         — מעקב + מצפן
--   grade_coordinator  רכז שכבה — בית ספר + שכבה     — מעקב
--   track_coordinator  רכז מגמה — בית ספר + מגמה     — מעקב
--   homeroom           מחנך — בית ספר + כיתה          — מעקב
--
-- תפקיד בלי הערכים שלו (מחנך בלי כיתות) רואה **כלום**, לא את כל בית
-- הספר. מערך ריק אינו "הכול" — זו טעות שמרחיבה גישה בשקט.

-- ═══════════════════════════════════════════════════════════════
-- א. עמודות ההרשאה במודול
-- ═══════════════════════════════════════════════════════════════

alter table public.users
  add column if not exists bagrut_role text
    check (bagrut_role in ('council', 'coordinator', 'grade_coordinator',
                           'track_coordinator', 'homeroom')),
  add column if not exists bagrut_schools text[] not null default '{}',
  add column if not exists bagrut_grades  text[] not null default '{}',
  add column if not exists bagrut_classes text[] not null default '{}',
  add column if not exists bagrut_tracks  text[] not null default '{}';

comment on column public.users.bagrut_role is
  'תפקיד במודול זכאות לבגרות. null = אין גישה למודול (מנהל-על רואה הכול בכל מקרה).';

-- ═══════════════════════════════════════════════════════════════
-- ב. פונקציות ההרשאה
-- ═══════════════════════════════════════════════════════════════
-- כולן security definer + search_path (מלכודת 25): הן נקראות מתוך
-- מדיניות, וקוראות את public.users.

create or replace function public.in_bagrut_scope(
  school text, grade text, class_name text, track text)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce((
    select case
             when u.is_suspended then false
             when u.role = 'super_admin' then true
             when u.bagrut_role = 'council' then true
             when not (school = any(u.bagrut_schools)) then false
             when u.bagrut_role = 'coordinator'       then true
             when u.bagrut_role = 'grade_coordinator' then grade      = any(u.bagrut_grades)
             when u.bagrut_role = 'track_coordinator' then track      = any(u.bagrut_tracks)
             when u.bagrut_role = 'homeroom'          then class_name = any(u.bagrut_classes)
             else false
           end
    from public.users u
    where u.id = auth.uid()), false);
$$;

comment on function public.in_bagrut_scope(text, text, text, text) is
  'האם התלמיד (בית ספר, שכבה, כיתה, מגמה) בהיקף של המשתמש במודול הבגרות.
   לא בודק שיוך לרשות — המדיניות משלבת אותה עם has_authority.';

-- בית ספר גלוי: לסבבים ולמצפן, שאין בהם שכבה או כיתה.
create or replace function public.bagrut_school_visible(school text)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce((
    select case
             when u.is_suspended then false
             when u.role = 'super_admin' then true
             when u.bagrut_role = 'council' then true
             when u.bagrut_role is null then false
             else school = any(u.bagrut_schools)
           end
    from public.users u
    where u.id = auth.uid()), false);
$$;

-- עריכת שדות המעקב: כולם חוץ מהמועצה, ורק בתוך ההיקף.
create or replace function public.may_edit_bagrut_tracking(
  school text, grade text, class_name text, track text)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce((
    select not u.is_suspended
       and (u.role = 'super_admin'
            or (u.bagrut_role in ('coordinator', 'grade_coordinator',
                                  'track_coordinator', 'homeroom')
                and public.in_bagrut_scope(school, grade, class_name, track)))
    from public.users u
    where u.id = auth.uid()), false);
$$;

-- עריכת המצפן: רכז בגרויות של בית הספר, או מנהל-על.
create or replace function public.may_edit_bagrut_program(school text)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select coalesce((
    select not u.is_suspended
       and (u.role = 'super_admin'
            or (u.bagrut_role = 'coordinator' and school = any(u.bagrut_schools)))
    from public.users u
    where u.id = auth.uid()), false);
$$;

-- ═══════════════════════════════════════════════════════════════
-- ג. אינדקס השאלונים הארצי
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.bagrut_questionnaires (
  code                 integer primary key,
  subject_name         text,
  block                text,
  subject_type         text,     -- חובה / מורחב / פנימי
  subject_group        text,     -- מלל / אנגלית / מתמטיקה / מדעים / חברה ורוח ...
  exam_form            text,     -- בחינה חיצונית / הערכה חלופית / תלקיט ...
  exam_kind            text,     -- חיצונית / פנימית
  units                integer,
  weight               numeric,
  in_final_grade       boolean,
  required_count       integer,
  relation             text,     -- חובה / או / וגם / ראשי / ראשי ותת
  notes                text,
  updated_at           timestamptz not null default now()
);

alter table public.bagrut_questionnaires enable row level security;

drop policy if exists bagrut_questionnaires_read   on public.bagrut_questionnaires;
drop policy if exists bagrut_questionnaires_insert on public.bagrut_questionnaires;
drop policy if exists bagrut_questionnaires_update on public.bagrut_questionnaires;
drop policy if exists bagrut_questionnaires_delete on public.bagrut_questionnaires;
create policy bagrut_questionnaires_read on public.bagrut_questionnaires
  for select to authenticated using (true);
create policy bagrut_questionnaires_insert on public.bagrut_questionnaires
  for insert to authenticated with check (public.is_super_admin());
create policy bagrut_questionnaires_update on public.bagrut_questionnaires
  for update to authenticated using (public.is_super_admin()) with check (public.is_super_admin());
create policy bagrut_questionnaires_delete on public.bagrut_questionnaires
  for delete to authenticated using (public.is_super_admin());

-- ═══════════════════════════════════════════════════════════════
-- ד. סבבים, מקצועות הסבב והמצפן
-- ═══════════════════════════════════════════════════════════════

create table if not exists public.bagrut_rounds (
  id               uuid primary key default gen_random_uuid(),
  authority_code   text not null,
  school_code      text not null,
  school_name      text,
  season           text not null check (season in ('קיץ', 'חורף')),
  school_year      text not null,          -- למשל תשפ"ו
  graduating_grade text,                   -- השכבה שעליה רץ T2 (יב / יג)
  status           text not null default 'loaded',
  source           text,                   -- מאיפה נטען (שם קובץ)
  stats            jsonb not null default '{}',
  created_at       timestamptz not null default now(),
  created_by       uuid references public.users(id) on delete set null,  -- מלכודת 24
  unique (authority_code, school_code, season, school_year)
);

create table if not exists public.bagrut_round_subjects (
  round_id      uuid not null references public.bagrut_rounds(id) on delete cascade,
  subject_key   text not null,           -- מזהה יציב מ-T1, למשל Matematika3
  subject_name  text not null,
  subject_group text not null check (subject_group in ('חובה', 'אנגלית ומתמטיקה', 'מורחב', 'פנימי')),
  units         integer,
  sort          integer not null default 0,
  primary key (round_id, subject_key)
);

create table if not exists public.bagrut_program (
  round_id            uuid not null references public.bagrut_rounds(id) on delete cascade,
  subject_key         text not null,
  questionnaire_code  integer not null,
  weight              numeric,
  sort                integer not null default 0,
  notes               text,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references public.users(id) on delete set null,
  primary key (round_id, subject_key, questionnaire_code)
);

alter table public.bagrut_rounds         enable row level security;
alter table public.bagrut_round_subjects enable row level security;
alter table public.bagrut_program        enable row level security;

-- סבב: קריאה לפי רשות + בית ספר. כתיבה — מנהל-על בלבד (קליטה).
drop policy if exists bagrut_rounds_read   on public.bagrut_rounds;
drop policy if exists bagrut_rounds_insert on public.bagrut_rounds;
drop policy if exists bagrut_rounds_update on public.bagrut_rounds;
drop policy if exists bagrut_rounds_delete on public.bagrut_rounds;
create policy bagrut_rounds_read on public.bagrut_rounds for select to authenticated
  using (public.has_authority(authority_code) and public.bagrut_school_visible(school_code));
create policy bagrut_rounds_insert on public.bagrut_rounds for insert to authenticated
  with check (public.is_super_admin());
create policy bagrut_rounds_update on public.bagrut_rounds for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy bagrut_rounds_delete on public.bagrut_rounds for delete to authenticated
  using (public.is_super_admin());

-- מקצועות הסבב: גלויים למי שרואה את הסבב (ה-RLS של bagrut_rounds חל
-- גם בתת-השאילתה). כתיבה — מנהל-על.
drop policy if exists bagrut_round_subjects_read   on public.bagrut_round_subjects;
drop policy if exists bagrut_round_subjects_insert on public.bagrut_round_subjects;
drop policy if exists bagrut_round_subjects_update on public.bagrut_round_subjects;
drop policy if exists bagrut_round_subjects_delete on public.bagrut_round_subjects;
create policy bagrut_round_subjects_read on public.bagrut_round_subjects for select to authenticated
  using (exists (select 1 from public.bagrut_rounds r where r.id = round_id));
create policy bagrut_round_subjects_insert on public.bagrut_round_subjects for insert to authenticated
  with check (public.is_super_admin());
create policy bagrut_round_subjects_update on public.bagrut_round_subjects for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy bagrut_round_subjects_delete on public.bagrut_round_subjects for delete to authenticated
  using (public.is_super_admin());

-- המצפן: קריאה כמו הסבב. כתיבה — רכז הבגרויות של בית הספר או מנהל-על.
drop policy if exists bagrut_program_read   on public.bagrut_program;
drop policy if exists bagrut_program_insert on public.bagrut_program;
drop policy if exists bagrut_program_update on public.bagrut_program;
drop policy if exists bagrut_program_delete on public.bagrut_program;
create policy bagrut_program_read on public.bagrut_program for select to authenticated
  using (exists (select 1 from public.bagrut_rounds r where r.id = round_id));
create policy bagrut_program_insert on public.bagrut_program for insert to authenticated
  with check (exists (select 1 from public.bagrut_rounds r
                      where r.id = round_id and public.may_edit_bagrut_program(r.school_code)));
create policy bagrut_program_update on public.bagrut_program for update to authenticated
  using (exists (select 1 from public.bagrut_rounds r
                 where r.id = round_id and public.may_edit_bagrut_program(r.school_code)))
  with check (exists (select 1 from public.bagrut_rounds r
                      where r.id = round_id and public.may_edit_bagrut_program(r.school_code)));
create policy bagrut_program_delete on public.bagrut_program for delete to authenticated
  using (exists (select 1 from public.bagrut_rounds r
                 where r.id = round_id and public.may_edit_bagrut_program(r.school_code)));

-- ═══════════════════════════════════════════════════════════════
-- ה. נתוני התלמידים — ארבע טבלאות משותפות
-- ═══════════════════════════════════════════════════════════════

-- טיוטה קודמת של המיגרציה הזו יצרה פונקציות לטבלה-לכל-רשות. הן הוחלו
-- על המסד לפני שהוחלט לעבור לטבלאות משותפות, ולא נקראו מעולם.
drop function if exists public.ensure_bagrut_tables(text);
drop function if exists public._ensure_bagrut_tables(text);

-- ── תלמיד בסבב + T2.
-- authority_code ו-school_code משוכפלים מהסבב כדי שהמדיניות תבדוק את
-- השורה עצמה, בלי join לכל שורה. הקליטה היא הכותב היחיד.
create table if not exists public.bagrut_students (
  round_id               uuid not null references public.bagrut_rounds(id) on delete cascade,
  student_id             text not null,
  authority_code         text not null,
  school_code            text not null,
  first_name             text,
  last_name              text,
  full_name              text,
  grade                  text,        -- שכבה (יא / יב / יג) — מ-T1
  class_name             text,        -- כיתת אם, למשל יג-5 — מ-T1
  track                  text,        -- מגמה — מהמצבת כשיש, אחרת ריק
  missing_status         text,        -- חסר / לא חסר (טופס החוסרים)
  -- T2 — ריק לתלמיד שאינו בשכבה המסיימת
  in_t2                  boolean not null default false,
  status                 text,        -- סטטוס לזכאות לפי T1
  done_summary           text,        -- מה כבר בוצע
  grades_summary         text,        -- ריכוז מקצועות וציונים לזכאות
  blockers               text,        -- חסמים לזכאות
  intervention           text,        -- התערבות מומלצת
  one_negative_option    text,        -- אפשרות לזכאות עם שלילי אחד
  compensation_pair      text,        -- זוג מקצועות לקומפנסציה
  compensation_eligible  text,        -- האם זכאי לשיפוי (ריק = לא נבדק)
  negatives_count        integer,
  mother_tongue_status   text,
  core_units             numeric,     -- סה"כ יחידות במקצועות המלל
  reinforced_subject     text,        -- מקצוע מוגבר — טקסט חופשי מ-T2
  total_units            text,
  reason                 text,        -- תאור סיבת אי הזכאות
  primary key (round_id, student_id)
);

create index if not exists bagrut_students_scope_idx
  on public.bagrut_students (authority_code, school_code);

-- ── ציון לכל שאלון.
create table if not exists public.bagrut_grades (
  round_id           uuid not null references public.bagrut_rounds(id) on delete cascade,
  student_id         text not null,
  subject_key        text not null,
  questionnaire_code integer not null,
  grade              numeric,
  weight             numeric,
  weighted           numeric,
  primary key (round_id, student_id, subject_key, questionnaire_code),
  foreign key (round_id, student_id)
    references public.bagrut_students(round_id, student_id) on delete cascade
);

create index if not exists bagrut_grades_subject_idx
  on public.bagrut_grades (round_id, subject_key);

-- ── מדדי מקצוע.
create table if not exists public.bagrut_subjects (
  round_id          uuid not null references public.bagrut_rounds(id) on delete cascade,
  student_id        text not null,
  subject_key       text not null,
  final_grade       numeric,
  cumulative_grade  numeric,
  units             numeric,
  questionnaires    text,             -- "2 מתוך 3" כפי שמגיע מ-T1
  cumulative_weight numeric,
  completion_status text,             -- הושלם / בתהליך / טרם החל
  primary key (round_id, student_id, subject_key),
  foreign key (round_id, student_id)
    references public.bagrut_students(round_id, student_id) on delete cascade
);

create index if not exists bagrut_subjects_subject_idx
  on public.bagrut_subjects (round_id, subject_key);

-- ── מעקב: לפי רשות + בית ספר + ת"ז, **לא לפי סבב** — כך הוא שורד את
-- הקליטה הבאה. בלי מפתח זר לתלמידים מאותה סיבה: מחיקת סבב לא נוגעת בו.
create table if not exists public.bagrut_tracking (
  authority_code text not null,
  school_code    text not null,
  student_id     text not null,
  suspected      boolean not null default false,   -- קיבל חשד (טוהר בחינות)
  has_blocker    boolean not null default false,   -- יש חסם
  fighting       boolean not null default false,   -- נלחמים על הזכאות
  zero_chance    boolean not null default false,   -- סיכוי אפסי לזכאות
  note_short     text,
  note_long      text,
  updated_at     timestamptz not null default now(),
  updated_by     uuid references public.users(id) on delete set null,  -- מלכודת 24
  primary key (authority_code, school_code, student_id)
);

alter table public.bagrut_students enable row level security;
alter table public.bagrut_grades   enable row level security;
alter table public.bagrut_subjects enable row level security;
alter table public.bagrut_tracking enable row level security;

-- ── תלמידים: היקף מלא — רשות + בית ספר/שכבה/כיתה/מגמה.
drop policy if exists bagrut_students_read   on public.bagrut_students;
drop policy if exists bagrut_students_insert on public.bagrut_students;
drop policy if exists bagrut_students_update on public.bagrut_students;
drop policy if exists bagrut_students_delete on public.bagrut_students;
create policy bagrut_students_read on public.bagrut_students for select to authenticated
  using (public.has_authority(authority_code)
         and public.in_bagrut_scope(school_code, grade, class_name, track));
-- כתיבה לנתוני הסבב: מנהל-על בלבד. הקליטה רצה בחיבור ישיר שעוקף RLS;
-- המדיניות סוגרת את הדלת לכל מי שמגיע מהדפדפן.
create policy bagrut_students_insert on public.bagrut_students for insert to authenticated
  with check (public.is_super_admin());
create policy bagrut_students_update on public.bagrut_students for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy bagrut_students_delete on public.bagrut_students for delete to authenticated
  using (public.is_super_admin());

-- ── ציונים ומדדי מקצוע: גלויים אם התלמיד גלוי. ה-RLS של bagrut_students
-- חל בתוך תת-השאילתה, כך שההיקף נאכף פעם אחת, במקום אחד.
drop policy if exists bagrut_grades_read   on public.bagrut_grades;
drop policy if exists bagrut_grades_insert on public.bagrut_grades;
drop policy if exists bagrut_grades_update on public.bagrut_grades;
drop policy if exists bagrut_grades_delete on public.bagrut_grades;
create policy bagrut_grades_read on public.bagrut_grades for select to authenticated
  using (exists (select 1 from public.bagrut_students s
                 where s.round_id = bagrut_grades.round_id
                   and s.student_id = bagrut_grades.student_id));
create policy bagrut_grades_insert on public.bagrut_grades for insert to authenticated
  with check (public.is_super_admin());
create policy bagrut_grades_update on public.bagrut_grades for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy bagrut_grades_delete on public.bagrut_grades for delete to authenticated
  using (public.is_super_admin());

drop policy if exists bagrut_subjects_read   on public.bagrut_subjects;
drop policy if exists bagrut_subjects_insert on public.bagrut_subjects;
drop policy if exists bagrut_subjects_update on public.bagrut_subjects;
drop policy if exists bagrut_subjects_delete on public.bagrut_subjects;
create policy bagrut_subjects_read on public.bagrut_subjects for select to authenticated
  using (exists (select 1 from public.bagrut_students s
                 where s.round_id = bagrut_subjects.round_id
                   and s.student_id = bagrut_subjects.student_id));
create policy bagrut_subjects_insert on public.bagrut_subjects for insert to authenticated
  with check (public.is_super_admin());
create policy bagrut_subjects_update on public.bagrut_subjects for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy bagrut_subjects_delete on public.bagrut_subjects for delete to authenticated
  using (public.is_super_admin());

-- ── מעקב: קריאה אם התלמיד גלוי בסבב כלשהו של בית הספר. כתיבה אם מותר
-- לערוך את *התלמיד הזה* — כולם חוץ מהמועצה, בתוך ההיקף. ארבע המדיניות
-- יחד (מלכודת 28), וגם using וגם with check בעדכון.
drop policy if exists bagrut_tracking_read   on public.bagrut_tracking;
drop policy if exists bagrut_tracking_insert on public.bagrut_tracking;
drop policy if exists bagrut_tracking_update on public.bagrut_tracking;
drop policy if exists bagrut_tracking_delete on public.bagrut_tracking;
create policy bagrut_tracking_read on public.bagrut_tracking for select to authenticated
  using (exists (select 1 from public.bagrut_students s
                 where s.authority_code = bagrut_tracking.authority_code
                   and s.school_code    = bagrut_tracking.school_code
                   and s.student_id     = bagrut_tracking.student_id));
create policy bagrut_tracking_insert on public.bagrut_tracking for insert to authenticated
  with check (exists (select 1 from public.bagrut_students s
                      where s.authority_code = bagrut_tracking.authority_code
                        and s.school_code    = bagrut_tracking.school_code
                        and s.student_id     = bagrut_tracking.student_id
                        and public.may_edit_bagrut_tracking(s.school_code, s.grade,
                                                            s.class_name, s.track)));
create policy bagrut_tracking_update on public.bagrut_tracking for update to authenticated
  using (exists (select 1 from public.bagrut_students s
                 where s.authority_code = bagrut_tracking.authority_code
                   and s.school_code    = bagrut_tracking.school_code
                   and s.student_id     = bagrut_tracking.student_id
                   and public.may_edit_bagrut_tracking(s.school_code, s.grade,
                                                       s.class_name, s.track)))
  with check (exists (select 1 from public.bagrut_students s
                      where s.authority_code = bagrut_tracking.authority_code
                        and s.school_code    = bagrut_tracking.school_code
                        and s.student_id     = bagrut_tracking.student_id
                        and public.may_edit_bagrut_tracking(s.school_code, s.grade,
                                                            s.class_name, s.track)));
create policy bagrut_tracking_delete on public.bagrut_tracking for delete to authenticated
  using (exists (select 1 from public.bagrut_students s
                 where s.authority_code = bagrut_tracking.authority_code
                   and s.school_code    = bagrut_tracking.school_code
                   and s.student_id     = bagrut_tracking.student_id
                   and public.may_edit_bagrut_tracking(s.school_code, s.grade,
                                                       s.class_name, s.track)));

-- מי עדכן ומתי — נקבע במסד, לא בדפדפן, כדי שאי אפשר יהיה לזייף.
create or replace function public.bagrut_tracking_stamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  return new;
end;
$$;

drop trigger if exists bagrut_tracking_stamp on public.bagrut_tracking;
create trigger bagrut_tracking_stamp
  before insert or update on public.bagrut_tracking
  for each row execute function public.bagrut_tracking_stamp();
