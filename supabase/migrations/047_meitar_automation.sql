-- ═══════════════════════════════════════════════════════════════
-- 047 — המיתר: מקורות, הורדה אוטומטית, היסטוריה ואינדקס נושאים (החלטה 024)
-- ═══════════════════════════════════════════════════════════════
-- אייל, 22.10: התהליך האוטומטי של איתי (github.com/EtaiNir/mytar-automation)
-- עובר לסוכן שלנו — בלי אקסס. מה שאצלו מונים ("+1 לחודש הקודם") ומחיקות,
-- כאן נגזר מהנתונים: חודש החישוב מהקובץ, החודש בשנה"ל מחושב.
--
--   · meitar_entities — מקורות המיתר של רשות: המועצה (מוטב) ובתי הספר (מוסד)
--   · meitar_runs.entity_code — run אחד למקור ולחודש (היה: לרשות ולחודש)
--   · effect_date / prior_year — חודש התחולה מפוענח, ו"שייך לשנה"ל קודמת".
--     שומרים הכול ומסמנים (אייל) — איתי מוחק את מה שלפני 1 בספטמבר
--   · meitar_institution_totals — הסיכום הרשמי של מוסד (RICUZMOSDOT, מה-ZIP של
--     בית הספר). השורות עצמן כבר ב-ZIP של המועצה — לא נטענות פעמיים
--   · meitar_topics — אינדקס הנושאים של המשרד (382 מהאקסס של סבא); נושא חדש
--     בקובץ נוסף ומסומן is_new — לא נעלם (אצל איתי נשמט ביישור)
--   · meitar_downloads — מצב ההורדה האוטומטית, גלוי באתר; "הורד עכשיו"
--   · meitar_months / meitar_invoice_months — ההיסטוריה לפי חודש, מחושבת
--
-- נבדק מול ZIP אמיתי (22.10): ה-ZIP של בית ספר = שורות המוסד מה-ZIP של המועצה
-- (זהות) + RICUZMOSDOT, וסכום מחושב שבו = Σ שורות המוסד בשנה"ל הנוכחית.

-- ── עזר: חודש מכל הפורמטים שבקבצים ──
-- "01/2026" · "9/2026" · "2025/09" (HASAOT) · "202501" (SHEFI, HASNET) · "2026-09-01"
-- זהה ל-parse_month ב-scripts/load_budget.py (נבדק בבדיקות הסוכן)
create or replace function public.meitar_parse_month(p text)
returns date
language plpgsql immutable
as $$
declare
  s text := btrim(coalesce(p, ''));
  y int; m int;
begin
  if s ~ '^\d{1,2}/\d{4}$' then
    m := split_part(s, '/', 1)::int; y := split_part(s, '/', 2)::int;
  elsif s ~ '^\d{4}/\d{1,2}$' then
    y := split_part(s, '/', 1)::int; m := split_part(s, '/', 2)::int;
  elsif s ~ '^\d{4}-\d{1,2}(-\d{1,2})?' then
    y := split_part(s, '-', 1)::int; m := split_part(s, '-', 2)::int;
  elsif s ~ '^(19|20)\d{4}$' then
    y := substr(s, 1, 4)::int; m := substr(s, 5, 2)::int;
  elsif s ~ '^\d{6}$' then
    m := substr(s, 1, 2)::int; y := substr(s, 3, 4)::int;
  else
    return null;
  end if;
  if m between 1 and 12 and y between 1990 and 2100 then
    return make_date(y, m, 1);
  end if;
  return null;
end;
$$;

-- תחילת שנה"ל של חודש: ספטמבר פותח שנה חדשה
create or replace function public.meitar_school_year_start(p date)
returns date
language sql immutable
as $$
  select make_date(case when extract(month from p) >= 9 then extract(year from p)::int
                        else extract(year from p)::int - 1 end, 9, 1);
$$;

-- ── מקורות המיתר ──
create table if not exists public.meitar_entities (
  authority_code text not null references public.authorities(code) on delete cascade,
  entity_code    text not null check (entity_code ~ '^\d+$'),
  kind           text not null check (kind in ('moteb', 'mosad')),
  name           text not null,
  auto_download  boolean not null default true,
  sort_order     int not null default 100,
  active         boolean not null default true,
  updated_by     uuid references public.users(id) on delete set null,
  updated_at     timestamptz not null default now(),
  primary key (authority_code, entity_code)
);
comment on table public.meitar_entities is
  'מקורות המיתר של רשות: המועצה (moteb, לפי סמל מוטב) ובתי ספר (mosad, לפי סמל מוסד). מהם הסוכן מוריד';

drop trigger if exists meitar_entities_stamp on public.meitar_entities;
create trigger meitar_entities_stamp before insert or update on public.meitar_entities
  for each row execute function public.budget_stamp();

-- מנשה: המועצה ו-8 בתי הספר שאיתי מוריד (אגיאל ורמת זבולון אינם במנשה)
insert into public.meitar_entities (authority_code, entity_code, kind, name, sort_order)
select '1400000', v.code, v.kind, v.name, v.ord
  from (values ('12300141', 'moteb', 'מועצה אזורית מנשה', 0),
               ('360123', 'mosad', 'מקיף גוונים', 10),
               ('313635', 'mosad', 'קציר', 20),
               ('313759', 'mosad', 'מ"מ רעות', 30),
               ('318220', 'mosad', 'מייסר', 40),
               ('320549', 'mosad', 'קשת', 50),
               ('357467', 'mosad', 'ניצני רעות', 60),
               ('384065', 'mosad', 'נטעים', 70),
               ('384313', 'mosad', 'שבילי רעות', 80)) as v(code, kind, name, ord)
 where exists (select 1 from public.authorities where code = '1400000')
on conflict (authority_code, entity_code) do nothing;

-- ── run למקור ולחודש ──
alter table public.meitar_runs add column if not exists entity_code text;
update public.meitar_runs set entity_code = beneficiary where entity_code is null;
update public.meitar_runs set entity_code = '' where entity_code is null;
alter table public.meitar_runs alter column entity_code set not null;
alter table public.meitar_runs drop constraint if exists meitar_runs_authority_code_calc_month_key;
create unique index if not exists meitar_runs_entity_month_key
  on public.meitar_runs (authority_code, entity_code, calc_month);
comment on column public.meitar_runs.entity_code is
  'המקור שה-ZIP שלו נקלט (סמל מוטב / מוסד). קליטה חוזרת של אותו מקור וחודש מחליפה';

-- ── חודש התחולה ושנה"ל קודמת ──
alter table public.meitar_rows    add column if not exists effect_date date;
alter table public.meitar_rows    add column if not exists prior_year  boolean not null default false;
alter table public.meitar_invoice add column if not exists effect_date date;
alter table public.meitar_invoice add column if not exists prior_year  boolean not null default false;

update public.meitar_rows r
   set effect_date = public.meitar_parse_month(r.effect_month),
       prior_year  = coalesce(public.meitar_parse_month(r.effect_month)
                              < public.meitar_school_year_start(u.calc_month), false)
  from public.meitar_runs u
 where u.id = r.run_id and r.effect_date is null and r.effect_month is not null;
update public.meitar_invoice r
   set effect_date = public.meitar_parse_month(r.effect_month),
       prior_year  = coalesce(public.meitar_parse_month(r.effect_month)
                              < public.meitar_school_year_start(u.calc_month), false)
  from public.meitar_runs u
 where u.id = r.run_id and r.effect_date is null and r.effect_month is not null;

comment on column public.meitar_rows.prior_year is
  'חודש התחולה לפני 1 בספטמבר של שנה"ל של חודש החישוב — עדכון רטרואקטיבי לשנה הקודמת. נשמר ומסומן';

create index if not exists meitar_rows_inst_idx on public.meitar_rows (authority_code, institution_code);

-- ── הסיכום הרשמי של מוסד (RICUZMOSDOT) ──
create table if not exists public.meitar_institution_totals (
  authority_code   text not null references public.authorities(code) on delete cascade,
  institution_code text not null,
  calc_month       date not null,
  beneficiary      text,
  institution_name text,
  computed         numeric,
  computed_prev    numeric,
  diff             numeric,
  upload_id        uuid,
  loaded_at        timestamptz not null default now(),
  primary key (authority_code, institution_code, calc_month)
);
comment on table public.meitar_institution_totals is
  'RICUZMOSDOT מה-ZIP של בית הספר: סכום מחושב = מצטבר המוסד בשנה"ל. להתאמה מול שורות המוסד ב-ZIP של המועצה';

-- ── אינדקס הנושאים (של המשרד — משותף לכל הרשויות) ──
create table if not exists public.meitar_topics (
  topic_code   text primary key check (topic_code ~ '^\d{3,}$'),
  name         text,
  report_group text,          -- "דו"ח" באינדקס: מוכרים / מוטבים / הסעות / שרתים …
  category     text,          -- "קטגוריה סלמה": שכר / גפן / מינהל …
  is_new       boolean not null default false,
  first_seen   date,
  updated_at   timestamptz not null default now()
);
comment on table public.meitar_topics is
  'אינדקס נושאי המיתר. זרע: טבלה 9 באקסס של סבא (382). נושא שמופיע בקובץ ואינו כאן — נוסף בקליטה עם is_new';

-- ── תכנון לנושא — גם לבית ספר ──
alter table public.meitar_topic_plans add column if not exists entity_code text;
update public.meitar_topic_plans p
   set entity_code = coalesce((select e.entity_code from public.meitar_entities e
                                where e.authority_code = p.authority_code and e.kind = 'moteb'
                                order by e.sort_order limit 1), '')
 where p.entity_code is null;
alter table public.meitar_topic_plans alter column entity_code set not null;
alter table public.meitar_topic_plans drop constraint if exists meitar_topic_plans_pkey;
alter table public.meitar_topic_plans add primary key (authority_code, entity_code, topic_code, school_year);

-- ── מצב ההורדה האוטומטית ──
create table if not exists public.meitar_downloads (
  authority_code   text not null references public.authorities(code) on delete cascade,
  entity_code      text not null,
  calc_month       date not null,
  status           text not null default 'requested'
                   check (status in ('requested', 'waiting', 'downloading', 'done', 'failed', 'gave_up')),
  attempts         int not null default 0,
  first_attempt_at timestamptz,
  last_attempt_at  timestamptz,
  last_error       text,
  upload_id        uuid,
  requested_by     uuid references public.users(id) on delete set null,
  requested_at     timestamptz,
  primary key (authority_code, entity_code, calc_month)
);
comment on table public.meitar_downloads is
  'מצב ההורדה מאתר המשרד לכל מקור וחודש. הסוכן כותב בחיבור ישיר; מנהל תקציב רק מבקש (requested)';

-- ── RLS ──
alter table public.meitar_entities           enable row level security;
alter table public.meitar_institution_totals enable row level security;
alter table public.meitar_topics             enable row level security;
alter table public.meitar_downloads          enable row level security;

drop policy if exists meitar_entities_read   on public.meitar_entities;
drop policy if exists meitar_entities_insert on public.meitar_entities;
drop policy if exists meitar_entities_update on public.meitar_entities;
drop policy if exists meitar_entities_delete on public.meitar_entities;
create policy meitar_entities_read on public.meitar_entities for select to authenticated
  using (authority_code = any((select public.budget_full_codes())::text[]));
create policy meitar_entities_insert on public.meitar_entities for insert to authenticated
  with check ((select public.is_super_admin()));
create policy meitar_entities_update on public.meitar_entities for update to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
create policy meitar_entities_delete on public.meitar_entities for delete to authenticated
  using ((select public.is_super_admin()));

drop policy if exists meitar_inst_totals_read   on public.meitar_institution_totals;
drop policy if exists meitar_inst_totals_insert on public.meitar_institution_totals;
drop policy if exists meitar_inst_totals_update on public.meitar_institution_totals;
drop policy if exists meitar_inst_totals_delete on public.meitar_institution_totals;
create policy meitar_inst_totals_read on public.meitar_institution_totals for select to authenticated
  using (authority_code = any((select public.budget_full_codes())::text[]));
create policy meitar_inst_totals_insert on public.meitar_institution_totals for insert to authenticated with check (false);
create policy meitar_inst_totals_update on public.meitar_institution_totals for update to authenticated using (false) with check (false);
create policy meitar_inst_totals_delete on public.meitar_institution_totals for delete to authenticated using (false);

drop policy if exists meitar_topics_read   on public.meitar_topics;
drop policy if exists meitar_topics_insert on public.meitar_topics;
drop policy if exists meitar_topics_update on public.meitar_topics;
drop policy if exists meitar_topics_delete on public.meitar_topics;
create policy meitar_topics_read on public.meitar_topics for select to authenticated using (true);
create policy meitar_topics_insert on public.meitar_topics for insert to authenticated
  with check ((select public.is_super_admin()));
create policy meitar_topics_update on public.meitar_topics for update to authenticated
  using ((select public.is_super_admin())) with check ((select public.is_super_admin()));
create policy meitar_topics_delete on public.meitar_topics for delete to authenticated
  using ((select public.is_super_admin()));

-- מנהל תקציב מבקש הורדה — רק status='requested'; כל השאר נכתב ע"י הסוכן
drop policy if exists meitar_downloads_read   on public.meitar_downloads;
drop policy if exists meitar_downloads_insert on public.meitar_downloads;
drop policy if exists meitar_downloads_update on public.meitar_downloads;
drop policy if exists meitar_downloads_delete on public.meitar_downloads;
create policy meitar_downloads_read on public.meitar_downloads for select to authenticated
  using (authority_code = any((select public.budget_full_codes())::text[]));
create policy meitar_downloads_insert on public.meitar_downloads for insert to authenticated
  with check (authority_code = any((select public.budget_manage_codes())::text[]) and status = 'requested');
create policy meitar_downloads_update on public.meitar_downloads for update to authenticated
  using (authority_code = any((select public.budget_manage_codes())::text[]))
  with check (authority_code = any((select public.budget_manage_codes())::text[]) and status = 'requested');
create policy meitar_downloads_delete on public.meitar_downloads for delete to authenticated
  using ((select public.is_super_admin()));

-- ── ההיסטוריה: לכל חודש חישוב × נושא ──
-- p_institution — תצוגת בית ספר: שורות המוסד מכל ה-runs של הרשות (בעיקר של המועצה).
-- בלי מוסד — ה-runs של המקור p_entity.
create or replace function public.meitar_months(p_code text, p_entity text, p_school_year int,
                                                p_institution text default null)
returns table (calc_month date, topic_code text, computed numeric, computed_prev numeric,
               diff numeric, prior_diff numeric, row_count bigint)
language sql stable security invoker set search_path = public
as $$
  select u.calc_month, r.topic_code,
         coalesce(sum(r.computed)      filter (where not r.prior_year), 0),
         coalesce(sum(r.computed_prev) filter (where not r.prior_year), 0),
         coalesce(sum(r.diff)          filter (where not r.prior_year), 0),
         coalesce(sum(r.diff)          filter (where r.prior_year), 0),
         count(*)
    from public.meitar_rows r
    join public.meitar_runs u on u.id = r.run_id
   where u.authority_code = p_code
     and u.calc_month >= make_date(p_school_year - 1, 9, 1)
     and u.calc_month <  make_date(p_school_year, 9, 1)
     and r.source_file not in ('MISROT', 'MISROTGY', 'ICHLUSKITOT', 'HASNET', 'HASMASLULIM', 'RICUZMOSDOT')
     and r.topic_code is not null
     and (case when p_institution is null then u.entity_code = p_entity
               else r.institution_code = p_institution end)
   group by 1, 2;
$$;
grant execute on function public.meitar_months(text, text, int, text) to authenticated;

-- החשבונית לפי חודש: לתשלום, מתוכו רטרו (תחולה ≠ חודש החישוב), מתוכו לשנה"ל קודמת
create or replace function public.meitar_invoice_months(p_code text, p_entity text, p_school_year int)
returns table (calc_month date, topic_code text, to_pay numeric, retro numeric, prior numeric)
language sql stable security invoker set search_path = public
as $$
  select u.calc_month, i.topic_code,
         coalesce(sum(i.to_pay), 0),
         coalesce(sum(i.to_pay) filter (where i.effect_date is distinct from u.calc_month), 0),
         coalesce(sum(i.to_pay) filter (where i.prior_year), 0)
    from public.meitar_invoice i
    join public.meitar_runs u on u.id = i.run_id
   where u.authority_code = p_code and u.entity_code = p_entity
     and u.calc_month >= make_date(p_school_year - 1, 9, 1)
     and u.calc_month <  make_date(p_school_year, 9, 1)
   group by 1, 2;
$$;
grant execute on function public.meitar_invoice_months(text, text, int) to authenticated;

-- ── זרע: אינדקס הנושאים מהאקסס של סבא (טבלה 9) ──
insert into public.meitar_topics (topic_code, name, report_group, category) values
  ('001', 'שכ"ל על-יסודי', 'שכר לימוד - מת"מ מטה', 'שכר'),
  ('002', 'שרתים', 'שרתים - מת"מ מטה', 'שכר'),
  ('003', 'שכל"ם גנ"י קדם חובה', 'גני ילדים - מת"מ מטה', 'שכר'),
  ('004', 'הוראת הספרות וההבעה', 'מוכרים - מת"מ מטה', null),
  ('005', 'הוראת הערבית', 'מוכרים - מת"מ מטה', 'שכר'),
  ('006', 'הוראת הצרפתית', 'מוכרים - מת"מ מטה', null),
  ('007', 'מב"ר אתגר', 'מוכרים - מת"מ מטה', null),
  ('008', 'תל. עם צרכים מיוחדים', 'מוכרים - מת"מ מטה', 'השתלבות'),
  ('009', 'שעורי עזר לעולים', 'שעורי עזר לעולים - מת"מ מטה', 'שכר'),
  ('015', 'השאלת מורים (איחוד)', 'מוכרים - מת"מ מטה', 'שכר'),
  ('016', 'מענקי השתלמות', 'מוכרים - מת"מ מטה', null),
  ('019', 'עוזרות לגננות', 'גני ילדים - מת"מ מטה', 'נלוות גן'),
  ('027', 'מתי"א - שרתים', 'שרתים - מת"מ מטה', null),
  ('028', 'מתי"א - מזכירים', 'שרתים - מת"מ מטה', null),
  ('029', 'מתי"א - אגרת שיכפול', 'שרתים - מת"מ מטה', null),
  ('031', 'ה.נלוות ח.מיוחד-גנ"י', 'מוכרים - מת"מ מטה', 'נילוות גן'),
  ('032', 'העשרה ח.מיוחד-גני', 'מוכרים - מת"מ מטה', 'נילוות גן'),
  ('033', 'גננות עובדות מדינה', 'גני ילדים - מת"מ מטה', 'שכר'),
  ('035', 'קרן השתלמות לשכ"ל', 'מוכרים - מת"מ מטה', 'שכר'),
  ('037', 'מסלול 7 משופר חרש/עו', 'מוכרים - מת"מ מטה', 'שכר'),
  ('039', 'חינוך מוכר אחר -חרדי', 'מוכרים - מת"מ מטה', null),
  ('040', 'שאילת מורים (איחוד)', 'מוכרים - מת"מ מטה', 'שכר'),
  ('041', 'ניכוי שעות מרכזי נער', 'מוכרים - מת"מ מטה', null),
  ('042', 'שרתים יום חינוך ארוך', 'שרתים - מת"מ מטה', null),
  ('043', 'מזכירים יום חינוך אר', 'שרתים - מת"מ מטה', null),
  ('044', 'אגרת שיכפול - יוח"א', 'שרתים - מת"מ מטה', null),
  ('045', 'קבסי"ם', 'מוטבים - מת"מ מטה', 'שכר'),
  ('046', 'קבטי"ם', 'מוטבים - מת"מ מטה', 'שכר'),
  ('047', 'פסיכולוגים חינוכיים', 'שפ"י - מת"מ מטה', 'שכר'),
  ('050', 'הסעות ח.רגיל י-ם', 'הסעות - מת"מ מטה', null),
  ('051', 'הסעות ח.רגיל ת"א', 'הסעות - מת"מ מטה', null),
  ('052', 'הסעות ח.רגיל חיפה', 'הסעות - מת"מ מטה', 'הסעות'),
  ('053', 'הסעות ח.רגיל צפון', 'הסעות - מת"מ מטה', null),
  ('054', 'הסעות ח.רגיל דרום', 'הסעות - מת"מ מטה', null),
  ('055', 'הסעות ח.רגיל מרכז', 'הסעות - מת"מ מטה', null),
  ('061', 'ספרנים', 'שרתים - מת"מ מטה', null),
  ('071', 'החזר שכ"ל למורים', 'מוכרים - מת"מ מטה', 'החזר שכ״ל למורים (מלא) תשפ״א'),
  ('076', 'שרתים אילת', 'מוטבים - מת"מ מטה', null),
  ('077', 'מזכירים אילת', 'מוטבים - מת"מ מטה', null),
  ('078', 'עוזרות גננות אילת', 'מוטבים - מת"מ מטה', null),
  ('079', 'ש. היקף חט"ב אילת', 'מוטבים - מת"מ מטה', null),
  ('080', 'סייעות אילת', 'מוטבים - מת"מ מטה', null),
  ('081', 'פס'' מתמחים ברשויות', 'שפ"י - מת"מ מטה', null),
  ('084', 'שכ"ל אילת', 'מוטבים - מת"מ מטה', null),
  ('085', 'אשכול פיס - לבורנטים', 'שרתים - מת"מ מטה', null),
  ('086', 'אשכול פיס - שרתים', 'שרתים - מת"מ מטה', null),
  ('087', 'אשכול פיס - מזכירים', 'שרתים - מת"מ מטה', null),
  ('088', 'דמי שתיה', 'מוכרים - מת"מ מטה', 'חדר מורים'),
  ('089', 'מחוננים ב ע"י', 'מוכרים - מת"מ מטה', null),
  ('091', 'שפ"י (שעות הדרכה)', 'שפ"י - מת"מ מטה', 'הדרכה'),
  ('092', 'רכב מנהלים בתי''ס ע''י', 'מוכרים - מת"מ מטה', 'שכר'),
  ('093', 'ימי מחלה שלא נוצלו', null, 'שכר'),
  ('095', 'טיסות לאילת', 'מוטבים - מת"מ מטה', null),
  ('101', 'רכב סגני מנהלים', 'מוכרים - מת"מ מטה', 'שכר'),
  ('103', 'השפה האידיש', 'מוכרים - מת"מ מטה', null),
  ('104', null, null, null),
  ('105', 'שרתים - חוות ומרכזים', 'שרתים - מת"מ מטה', 'שכר'),
  ('107', 'מזכירים', 'שרתים - מת"מ מטה', 'שכר'),
  ('109', 'מזכירים-חוות ומרכזים', 'שרתים - מת"מ מטה', 'שכר'),
  ('111', 'הפעלת מרכזי נוער', 'מוכרים - מת"מ מטה', null),
  ('114', 'מקצ.המורשת בח.ממלכתי', 'מוכרים - מת"מ מטה', null),
  ('117', 'בי"ס קהילתיים עי"ס', 'מוכרים - מת"מ מטה', null),
  ('134', 'לבורנטים', 'שרתים - מת"מ מטה', null),
  ('138', 'הסעות ח.מיוחד י-ם', 'הסעות - מת"מ מטה', null),
  ('139', 'הסעות ח.מיוחד ת"א', 'הסעות - מת"מ מטה', null),
  ('140', 'הסעות ח.מיוחד חיפה', 'הסעות - מת"מ מטה', 'הסעות'),
  ('141', 'הסעות ח.מיוחד צפון', 'הסעות - מת"מ מטה', null),
  ('142', 'הסעות ח.מיוחד דרום', 'הסעות - מת"מ מטה', null),
  ('143', 'הסעות ח.מיוחד מרכז', 'הסעות - מת"מ מטה', null),
  ('146', 'תגמול עו"ה-חוזה אישי', 'מוכרים - מת"מ מטה', null),
  ('151', 'גמול ריכוז ב"ס קטנים', 'מוכרים - מת"מ מטה', null),
  ('152', 'שעות פרופסיונליות עי', 'מוכרים - מת"מ מטה', null),
  ('157', 'ציוד ראשוני - יוח"א', 'מוכרים - מת"מ מטה', null),
  ('158', 'עוזרות- יוח"א ומיל"ת', 'מוכרים - מת"מ מטה', null),
  ('160', 'הזנת יוח"א', 'מוכרים - מת"מ מטה', 'הזנת יוח"א'),
  ('164', 'מרכזי חינוך', 'מוכרים - מת"מ מטה', null),
  ('165', 'סל תלמיד לעולה-יסודי', 'מוכרים - מת"מ מטה', 'שכר'),
  ('166', 'סל תלמיד לעולה-חט"ב', 'מוכרים - מת"מ מטה', 'שכר'),
  ('167', 'סל תלמיד לעולה-עי"ס', 'מוכרים - מת"מ מטה', null),
  ('170', 'סיעות כית.ב"ס חריגות', 'מוטבים - מת"מ מטה', 'שכר'),
  ('171', 'סייעות כיתתיות', 'מוכרים - מת"מ מטה', 'שכר'),
  ('172', 'שרותי היקף - ח.מיוחד', 'מוכרים - מת"מ מטה', 'חינוך מיוחד'),
  ('173', 'גמול בגרות אחוזי', 'מוכרים - מת"מ מטה', 'שכר'),
  ('177', 'גמול טיולים -חוץ בית', 'מוכרים - מת"מ מטה', 'שכר'),
  ('185', 'תשלומי הורים חומרים', 'מוכרים - מת"מ מטה', 'ציוד משרדי'),
  ('192', 'מוכרים סגורים - חרדי', 'מוכרים - מת"מ מטה', null),
  ('195', 'הסעות מורים צפון', 'הסעות - מת"מ מטה', null),
  ('196', 'הסעות מורים מרכז', 'הסעות - מת"מ מטה', null),
  ('197', 'הסעות מורים ירושלים', 'הסעות - מת"מ מטה', null),
  ('198', 'הסעות מורים דרום', 'הסעות - מת"מ מטה', null),
  ('200', 'הסעות מורים חיפה', 'הסעות - מת"מ מטה', null),
  ('205', 'בחינות בגרות אחה"צ', 'מוכרים - מת"מ מטה', 'שכר'),
  ('209', 'מורים עולים חדשים', 'מוכרים - מת"מ מטה', null),
  ('214', 'סל תל'' לחט"ב', 'שרתים - מת"מ מטה', 'שכר'),
  ('215', 'ש.היקף - מנח"י א-ו', 'שרתים - מת"מ מטה', null),
  ('216', 'ש. היקף מנח"י ז-ח', 'שרתים - מת"מ מטה', null),
  ('222', 'קרן קרב', 'מוכרים - מת"מ מטה', 'קרן קרב'),
  ('223', 'חיוב בגין תלמידי חוץ', 'מוטבים - מת"מ מטה', 'אגרות חוץ'),
  ('224', 'זכוי בגין תלמידי חוץ', 'מוטבים - מת"מ מטה', 'אגרות חוץ'),
  ('225', 'חיוב בגין תלמידי חוץ', 'מוטבים - מת"מ מטה', null),
  ('226', 'זכוי בגין תלמידי חוץ', 'מוטבים - מת"מ מטה', null),
  ('227', 'ג.רכוז בטיחות בדרכים', 'מוכרים - מת"מ מטה', 'שכר'),
  ('228', 'קרן קרב ישובים', 'מוטבים - מת"מ מטה', null),
  ('232', 'אגרת שכפול יסודי', 'מוכרים - מת"מ מטה', 'רכש'),
  ('233', 'אגרת שכפול פר תלמיד', 'מוכרים - מת"מ מטה', 'ציוד משרדי'),
  ('234', 'דמי שכפול על יסודי', 'מוכרים - מת"מ מטה', 'ציוד משרדי'),
  ('237', 'מענק יובל על יסודי', 'מוכרים - מת"מ מטה', 'שכר'),
  ('238', 'אגרת שכפול מוכרים', 'מוכרים - מת"מ מטה', null),
  ('240', 'אמ"ץ ותל"ם', 'מוכרים - מת"מ מטה', 'שכר'),
  ('242', 'מועדוניות ברשויות', 'מועדוניות - מת"מ מטה', 'מועדוניות'),
  ('243', 'מענק יובל מוכר -חרדי', 'מוכרים - מת"מ מטה', null),
  ('245', 'מ.יובל מ. סגור-חרדי', 'מוכרים - מת"מ מטה', null),
  ('246', 'מענק יובל גנ"י', 'מוטבים - מת"מ מטה', null),
  ('249', 'ה.נלוות ח.מיוחד-מוסד', 'מוכרים - מת"מ מטה', 'נילוות ח"מ'),
  ('250', 'העשרה ח.מיוחד-מוסד', 'מוכרים - מת"מ מטה', 'נילוות ח"מ'),
  ('251', 'ע.סוצ''פרא רפואי-חרדי', 'מוכרים - מת"מ מטה', null),
  ('252', 'אחות פרא רפואי-חרדי', 'מוכרים - מת"מ מטה', null),
  ('253', 'רופא פרא רפואי-חרדי', 'מוכרים - מת"מ מטה', null),
  ('254', 'הפרא רפואי - חרדי', 'מוכרים - מת"מ מטה', null),
  ('255', 'תלמידי חוץ - בדואים', 'מוכרים - מת"מ מטה', null),
  ('256', 'ל. הסעות ח"מ - י"ם', 'מוטבים - מת"מ מטה', null),
  ('257', 'ל. הסעות ח"מ - ת"א', 'מוטבים - מת"מ מטה', null),
  ('258', 'ל. הסעות ח"מ - חיפה', 'מוטבים - מת"מ מטה', 'הסעות'),
  ('259', 'ל. הסעות ח"מ - צפון', 'מוטבים - מת"מ מטה', null),
  ('260', 'ל. הסעות ח"מ - דרום', 'מוטבים - מת"מ מטה', null),
  ('261', 'ל. הסעות ח"מ - מרכז', 'מוטבים - מת"מ מטה', null),
  ('262', 'מוכר.-גמ.טיולים-חרדי', 'מוכרים - מת"מ מטה', null),
  ('263', 'מוכרים חט"ב - ג.טיול', 'מוכרים - מת"מ מטה', null),
  ('264', 'מוכר.סגור-ג.טיול-חרד', 'מוכרים - מת"מ מטה', null),
  ('277', 'חופשות לאוטיסטים', 'מוכרים - מת"מ מטה', 'אוטיסטים'),
  ('281', 'ניהול עצמי- אילת', 'מוטבים - מת"מ מטה', null),
  ('284', 'ניכוי שכ"ל י"ג י"ד', 'מוכרים - מת"מ מטה', null),
  ('285', 'הבראה וביגוד - שכ"ל', 'מוכרים - מת"מ מטה', 'שכר'),
  ('287', 'אחזקת ילדי צד"ל', 'מוכרים - מת"מ מטה', null),
  ('288', 'מכינה קדם צבאי-אחזקה', 'מוכרים - מת"מ מטה', null),
  ('311', 'סל תלמ.לעולי אתיופיה', 'מוכרים - מת"מ מטה', null),
  ('316', 'חינוך תעבורתי', 'מוכרים - מת"מ מטה', 'שכר'),
  ('319', 'שרתים אשכול גן', 'שרתים - מת"מ מטה', null),
  ('320', 'מזכיר אשכול גן', 'שרתים - מת"מ מטה', null),
  ('323', 'קיזוז - על יסודי', 'מוכרים - מת"מ מטה', null),
  ('324', 'חופש.מוכר.חנ"מ-חרדי', 'מוכרים - מת"מ מטה', null),
  ('326', 'תגבור למדעי היהדות', 'מוכרים - מת"מ מטה', null),
  ('330', 'שעות ליוזמות מוכרים', 'מוכרים - מת"מ מטה', null),
  ('332', 'אזרחות', 'מוכרים - מת"מ מטה', null),
  ('334', 'חותם', 'מוכרים - מת"מ מטה', 'מינהל'),
  ('335', 'ש.מרכזים טיפול-חרדי', 'מוכרים - מת"מ מטה', null),
  ('336', 'כ.חנ"מ-מוכר אחר-חרדי', 'מוכרים - מת"מ מטה', null),
  ('337', 'שע.שילוב-מוכר-חרדי', 'מוכרים - מת"מ מטה', null),
  ('338', 'מוביל ב"ס מניעת סמים', 'מוכרים - מת"מ מטה', 'שכר'),
  ('343', 'סל שילוב לגנ"י-חרדי', 'מוכרים - מת"מ מטה', null),
  ('345', 'חוק שילוב - סייעות', 'מוטבים - מת"מ מטה', 'שכר'),
  ('348', 'הזנת תלמידים', 'מוכרים - מת"מ מטה', null),
  ('349', 'שומרים', 'מוטבים - מת"מ מטה', 'שכר'),
  ('350', 'ש.קיץ - מפגעי בטיחות', 'מוכרים - מת"מ מטה', 'מינהל'),
  ('351', 'ש.קיץ-מ.בטיחות-השלמה', 'מוטבים - מת"מ מטה', null),
  ('352', 'שפ"י - חינוכיים', 'שפ"י - מת"מ מטה', null),
  ('361', 'סייעות על יסודי', 'מוכרים - מת"מ מטה', null),
  ('370', 'התיצ יומית ח.ר. י-ם', 'הסעות - מת"מ מטה', null),
  ('374', 'התיצ יומית ח.ר דרום', 'הסעות - מת"מ מטה', null),
  ('375', 'התיצ יומית ח.ר מרכז', 'הסעות - מת"מ מטה', null),
  ('376', 'התיצ יומי מורים י-ם', 'הסעות - מת"מ מטה', null),
  ('378', 'גביית ערך גרט-מ.אוטו', 'הסעות - מת"מ מטה', null),
  ('381', 'התיצ יומי מורים מרכז', 'הסעות - מת"מ מטה', null),
  ('382', 'התיצ יומית ח.מ י"ם', 'הסעות - מת"מ מטה', null),
  ('386', 'התיצ יומית ח.מ דרום', 'הסעות - מת"מ מטה', null),
  ('387', 'התיצ יומית ח.מ מרכז', 'הסעות - מת"מ מטה', null),
  ('388', 'ש.בודדת חופש חנמ חטע', 'מוכרים - מת"מ מטה', null),
  ('389', 'חופש אחה"צ חטע אוטיס', 'מוכרים - מת"מ מטה', null),
  ('390', 'מענקי השתלמות - גנ"י', 'מוכרים - מת"מ מטה', null),
  ('391', 'החזר שכ"ל גננות', 'מוכרים - מת"מ מטה', null),
  ('394', 'של"פ', 'מוכרים - מת"מ מטה', null),
  ('400', 'מקצועות המדעים', 'מוכרים - מת"מ מטה', null),
  ('401', 'ה.נלוות-ח"מ-גני-ערבי', 'מוכרים - מת"מ מטה', null),
  ('402', 'העשרה חנ"מ-גנ"י-ערבי', 'מוכרים - מת"מ מטה', null),
  ('403', 'ה.נלוות ח.מיוחד-ערבי', 'מוכרים - מת"מ מטה', null),
  ('404', 'העשרה ח.מיוחד-ערבי', 'מוכרים - מת"מ מטה', null),
  ('405', 'ה.נלוות-ח"מ-גני-דרוז', 'מוכרים - מת"מ מטה', null),
  ('406', 'העשרה חנ"מ-גנ"י-דרוז', 'מוכרים - מת"מ מטה', null),
  ('407', 'ה.נלוות ח.מיוחד-דרוז', 'מוכרים - מת"מ מטה', null),
  ('408', 'העשרה ח.מיוחד-דרוזי', 'מוכרים - מת"מ מטה', null),
  ('411', 'שעות הוראה - סמינרים', 'סמינרים שעות הוראה - מת"מ מטה', null),
  ('412', 'תוספת שעות הוראה', 'סמינרים נושאים - מת"מ מטה', null),
  ('413', 'נכוי שע'' עובדי מדינה', 'סמינרים נושאים - מת"מ מטה', null),
  ('414', 'משרות אקדמאיות', 'סמינרים נושאים - מת"מ מטה', null),
  ('415', 'מענקי השתלמות-סמינר', 'סמינרים נושאים - מת"מ מטה', null),
  ('416', 'ש"ש פרו'' אגף הכשרה', 'סמינרים נושאים - מת"מ מטה', null),
  ('417', 'פרוייקטים אגף הכשרה', 'סמינרים נושאים - מת"מ מטה', null),
  ('419', 'גמול מורה מאמן', 'סמינרים נושאים - מת"מ מטה', null),
  ('420', 'גמול אימון P.D.S', 'סמינרים נושאים - מת"מ מטה', null),
  ('421', 'גמול חונכות', 'סמינרים נושאים - מת"מ מטה', null),
  ('422', 'הפעלת התמחות', 'סמינרים נושאים - מת"מ מטה', null),
  ('423', 'לימודי תואר שני', 'סמינרים נושאים - מת"מ מטה', null),
  ('424', 'שיפוי שכר לימוד', 'סמינרים נושאים - מת"מ מטה', null),
  ('425', 'מענקי שכ"ל-מור.סמינר', 'סמינרים נושאים - מת"מ מטה', null),
  ('429', 'נסע'' מדריכים פדגוגים', 'סמינרים נושאים - מת"מ מטה', null),
  ('430', 'דרגות קידום', 'סמינרים נושאים - מת"מ מטה', null),
  ('431', 'מענק יובל סמינרים', 'סמינרים נושאים - מת"מ מטה', null),
  ('436', 'תכנית למניעת נשירה', 'מוכרים - מת"מ מטה', null),
  ('437', 'הוצאות מינהליות', 'סמינרים נושאים - מת"מ מטה', null),
  ('439', 'פנימיות יום - מיל"ת', 'מוכרים - מת"מ מטה', null),
  ('442', 'שירותי מנב"ס', null, 'מינהל'),
  ('446', 'מוחזקות חדש -פריראלי', 'מוכרים - מת"מ מטה', 'שכר'),
  ('447', 'מוחזקות-עיר מעורב', 'מוכרים - מת"מ מטה', null),
  ('448', 'מוחזקות-איום בטחן', 'מוכרים - מת"מ מטה', null),
  ('450', 'שכ"ל תרבות יחודי חטע', 'מוכרים - מת"מ מטה', null),
  ('452', 'השלמת כיתת עולים', 'מוכרים - מת"מ מטה', null),
  ('456', 'שעות שילוב חט"ע', 'מוכרים - מת"מ מטה', 'שכר'),
  ('458', 'פרוייקט טו"ב-כיתה ט''', 'מוכרים - מת"מ מטה', null),
  ('463', 'קיזוז הזנת גני ילדים', 'מוכרים - מת"מ מטה', null),
  ('464', 'פס. שדרות ועוטף עזה', 'שפ"י - מת"מ מטה', null),
  ('465', null, null, null),
  ('467', 'סל חיזוקים - מענקים', 'סמינרים נושאים - מת"מ מטה', null),
  ('469', 'הסעות תלמידי הילה', 'ידניים', null),
  ('470', 'הסעות נט - ירושלים', 'הסעות נט - מת"מ מטה', null),
  ('471', 'הסעות נט - תל אביב', 'הסעות נט - מת"מ מטה', null),
  ('472', 'הסעות נט - חיפה', 'הסעות נט - מת"מ מטה', 'שכר'),
  ('473', 'הסעות נט - צפון', 'הסעות נט - מת"מ מטה', null),
  ('474', 'הסעות נט - דרום', 'הסעות נט - מת"מ מטה', null),
  ('475', 'הסעות נט - מרכז', 'הסעות נט - מת"מ מטה', null),
  ('477', null, null, null),
  ('479', 'לימוד זה"ב למוכרים', 'מוכרים - מת"מ מטה', null),
  ('488', 'גמול הל"ל', 'מוכרים - מת"מ מטה', null),
  ('489', 'מיל"ת ישובי', 'מוטבים - מת"מ מטה', null),
  ('494', 'קיזוז - מוכרים -חרדי', 'מוכרים - מת"מ מטה', null),
  ('496', 'ליווי שנה א אחר סטאז', 'סמינרים נושאים - מת"מ מטה', null),
  ('502', 'סייעות רפואיות', 'מוכרים - מת"מ מטה', 'שכר'),
  ('504', 'עתודה מדעית טכנלוגית', 'מוכרים - מת"מ מטה', 'שכר'),
  ('505', 'שעות תגבור טו"ב', 'מוכרים - מת"מ מטה', 'שכר'),
  ('506', 'תגבור בגרות יהדות', 'מוכרים - מת"מ מטה', null),
  ('507', 'M_TEACH', 'סמינרים נושאים - מת"מ מטה', null),
  ('512', 'חינוך מוכר אחר - ל.ח', 'מוכרים - מת"מ מטה', null),
  ('513', 'מוכרים סגורים - ל.ח.', 'מוכרים - מת"מ מטה', null),
  ('514', 'מענק יובל מוכר- ל.ח.', 'מוכרים - מת"מ מטה', null),
  ('515', 'מ.יובל מוכר סגור-ל.ח', 'מוכרים - מת"מ מטה', null),
  ('516', 'ע.סוצ'' פרא רפואי-ל.ח', 'מוכרים - מת"מ מטה', null),
  ('517', 'אחות פרא רפואי- ל.ח.', 'מוכרים - מת"מ מטה', null),
  ('518', 'רופא פרא רפואי- ל.ח.', 'מוכרים - מת"מ מטה', null),
  ('519', 'הפרא רפואי - לא חרדי', 'מוכרים - מת"מ מטה', null),
  ('520', 'מוכרים-ג.טיולים- ל.ח', 'מוכרים - מת"מ מטה', null),
  ('521', 'מ. סגור-ג.טיול -ל.ח.', 'מוכרים - מת"מ מטה', null),
  ('522', 'חופש מוכרים חנ"מ-ל.ח', 'מוכרים - מת"מ מטה', null),
  ('524', 'כ.חנ"מ במוכר אחר-ל.ח', 'מוכרים - מת"מ מטה', null),
  ('525', 'ש.שילוב במ. אחר- ל.ח', 'מוכרים - מת"מ מטה', null),
  ('526', 'סל שילוב לגנ"י - ל.ח', 'מוכרים - מת"מ מטה', null),
  ('527', 'ניהול אשכול גנים-ל.ח', 'מוכרים - מת"מ מטה', null),
  ('529', 'קיזוז - מוכרים -ל.ח', 'מוכרים - מת"מ מטה', null),
  ('531', 'חינוך פיננסי', 'מוכרים - מת"מ מטה', null),
  ('532', 'גיאוגרפיה', 'מוכרים - מת"מ מטה', null),
  ('534', 'שגרירי מפתח הל"ב', null, 'מפתח הלב'),
  ('535', 'בתי ספר מקדמי בריאות', null, 'נילוות ב"ס'),
  ('553', 'מילוי מקום - מוסדות', 'מוכרים - מת"מ מטה', 'שכר'),
  ('554', 'מילוי מקום - מוטבים', 'מוטבים - מת"מ מטה', null),
  ('556', 'ש.פרטניות-עוז לתמורה', 'מוכרים - מת"מ מטה', 'שכר'),
  ('557', 'ש.תומכות -עוז לתמורה', 'מוכרים - מת"מ מטה', 'שכר'),
  ('558', 'מנהל/מנהל עוז לתמורה', 'מוכרים - מת"מ מטה', 'שכר'),
  ('559', 'סל שע.לתפקיד עוז תמ.', 'מוכרים - מת"מ מטה', 'שכר'),
  ('561', 'אוריינות מדעית-כ. י''', 'מוכרים - מת"מ מטה', 'שכר'),
  ('562', 'מרכזי חרום - חרדי', 'מוכרים - מת"מ מטה', null),
  ('567', 'ש.פרטניות נוספות-עוז', 'מוכרים - מת"מ מטה', 'שכר'),
  ('568', 'ש.תומכות נוספות-עוז', 'מוכרים - מת"מ מטה', 'שכר'),
  ('571', 'ניהול עצמי משופר א-ו', 'שרתים - מת"מ מטה', 'ניהול עצמי'),
  ('572', 'ניהול עצמי משופר ז-ח', 'שרתים - מת"מ מטה', 'ניהול עצמי'),
  ('573', 'עובד סיוע משופר א-ח', 'שרתים - מת"מ מטה', null),
  ('574', 'תוס'' דפנציאלי-נ.עצמי', 'שרתים - מת"מ מטה', null),
  ('575', 'מוחזקות עוז לתמורה', 'מוכרים - מת"מ מטה', 'שכר'),
  ('581', 'מלגה תל.היוצא לפולין', null, 'פולין'),
  ('582', 'אקדמיה בתיכון', 'מוכרים - מת"מ מטה', 'גפן'),
  ('583', 'מענק הישגים חט"ע', 'מוכרים - מת"מ מטה', null),
  ('585', 'מענק יובל - חט''''ב', 'מוכרים - מת"מ מטה', null),
  ('588', 'מוכרים לא חרדי- חט"ב', 'מוכרים - מת"מ מטה', null),
  ('589', 'שעות ליוזמות - ל.ח.', 'מוכרים - מת"מ מטה', null),
  ('590', 'מרכזי חרום - לא חרדי', 'מוכרים - מת"מ מטה', null),
  ('592', 'היסטור''ומדינה יהודית', 'מוכרים - מת"מ מטה', null),
  ('593', 'ספרות', 'מוכרים - מת"מ מטה', null),
  ('594', 'תוספת סייעת יוח"א', 'מוכרים - מת"מ מטה', null),
  ('595', 'גמול מנהליות-נ. עצמי', 'שרתים - מת"מ מטה', 'שכר'),
  ('596', 'שעות יעוץ והכוון', 'מוכרים - מת"מ מטה', null),
  ('597', 'שעות רב', 'מוכרים - מת"מ מטה', null),
  ('598', 'מסג.קיץ תלמיד-ח.רגיל', 'מוטבים - מת"מ מטה', 'מסגרת קיץ'),
  ('599', 'מסגרת קיץ-תלמיד חנ"מ', 'מוטבים - מת"מ מטה', 'מסגרת קיץ'),
  ('600', 'מסגרת קיץ פר מוסד', 'מוטבים - מת"מ מטה', 'מסגרת קיץ'),
  ('601', 'הסעות מסג.קיץ לתלמיד', 'מוטבים - מת"מ מטה', null),
  ('602', 'הסעות מסג.קיץ למסלול', 'מוטבים - מת"מ מטה', null),
  ('603', 'מסג.חינוכיות בחופשות', null, null),
  ('604', 'רכז מעורבות חברתית', 'מוכרים - מת"מ מטה', 'שכר'),
  ('605', 'מנהל תחום התנדבותי', 'מוטבים - מת"מ מטה', null),
  ('606', 'משרות דרגות קידום', 'מוכרים - מת"מ מטה', 'שכר'),
  ('607', 'ת.תקשוב-קיזוז רשויות', 'מוכרים - מת"מ מטה', 'מינהל'),
  ('608', 'מתמטיקה תחילה', 'מוכרים - מת"מ מטה', null),
  ('611', 'גמול רכז הל"ל', 'מוכרים - מת"מ מטה', 'שכר'),
  ('612', 'נ. אשכול גנים - חרדי', 'מוכרים - מת"מ מטה', null),
  ('614', 'סייעת 2 והעשרה -רשמי', 'מוכרים - מת"מ מטה', 'שכר'),
  ('615', 'סייעת שנייה - מוכר', 'מוכרים - מת"מ מטה', null),
  ('617', 'רבנים במוסד ח. עי"ס', 'מוכרים - מת"מ מטה', null),
  ('619', 'מודל בן-תחומי בחט"ע', 'מוכרים - מת"מ מטה', null),
  ('621', 'אחות מלוה-הסעות חנ"מ', 'מוטבים - מת"מ מטה', null),
  ('622', 'תוכנית סולמות אנגלית', 'מוכרים - מת"מ מטה', 'שכר'),
  ('624', 'ציוד ומכשירים חנ"ג', 'מוכרים - מת"מ מטה', null),
  ('625', 'ארכיאולוגיה', 'מוכרים - מת"מ מטה', null),
  ('630', 'ב.ספר כנסייתים בחט"ע', 'מוכרים - מת"מ מטה', null),
  ('631', 'תכנית ניצנים - גנ"י', 'מוכרים - מת"מ מטה', 'ניצנים'),
  ('632', 'תכנית ניצנים - בי"ס', 'מוכרים - מת"מ מטה', 'ניצנים'),
  ('633', 'תכנית ניצנים - הזנה', 'מוכרים - מת"מ מטה', null),
  ('634', 'מילוי מקום-פרטנ.+תומ', 'מוטבים - מת"מ מטה', null),
  ('635', 'תמרוץ ותגמול מיוחד', 'מוכרים - מת"מ מטה', null),
  ('636', 'פע'' חוויתית ת.יהודית', 'מוכרים - מת"מ מטה', null),
  ('637', 'הצ.מדעית טכ. במעבדות', 'מוכרים - מת"מ מטה', null),
  ('639', 'ת.לאומית-קידם אנגלית', 'מוכרים - מת"מ מטה', null),
  ('642', 'דרך חדשה לק.האתיופית', 'מוכרים - מת"מ מטה', null),
  ('643', 'מסג.חינוכיות בחופשות', 'מוכרים - מת"מ מטה', 'מסגרת קיץ'),
  ('645', 'בגרות אחוזי חנ"מ-חרד', 'מוכרים - מת"מ מטה', null),
  ('646', 'בגרות אחוזי חנ"מ-ל.ח', 'מוכרים - מת"מ מטה', null),
  ('648', 'חימום צינון בבתי ספר', 'מוכרים - מת"מ מטה', null),
  ('652', 'מכשירי החייאה', 'מוכרים - מת"מ מטה', null),
  ('653', 'התנסות מדעית טכנולוג', 'מוטבים - מת"מ מטה', null),
  ('654', 'גמול חנ"מ חט"ע', 'מוכרים - מת"מ מטה', 'שכר'),
  ('655', 'ק. מצוינות בפריפריה', 'מוכרים - מת"מ מטה', null),
  ('657', 'חיזוק הכלה וההשתלבות', 'מוכרים - מת"מ מטה', 'גפן'),
  ('658', 'מקדמי ת.אומניות-יסוד', 'מוכרים - מת"מ מטה', null),
  ('659', 'אנגלית-מב"ר+אתגר+מ"נ', 'מוכרים - מת"מ מטה', null),
  ('660', 'גמול חונך בחט"ע', 'מוכרים - מת"מ מטה', 'שכר'),
  ('662', 'מוקד ק.עולים-מ.תחום', 'מוטבים - מת"מ מטה', null),
  ('663', 'מוקד ק.עולים-ר.נוער', 'מוטבים - מת"מ מטה', null),
  ('664', 'מוקד ק.עולים-ר.תחום', 'מוטבים - מת"מ מטה', null),
  ('667', 'תוספת פדגוגית בחט"ב', 'מוכרים - מת"מ מטה', null),
  ('668', 'הזנה בכשרות נוספת', 'מוטבים - מת"מ מטה', null),
  ('669', 'מסיבות כיתתיות', 'מוכרים - מת"מ מטה', 'מסיבות כיתתיות'),
  ('670', 'ציוד מיגון חנ"מ', 'מוכרים - מת"מ מטה', null),
  ('671', 'מסג.קיץ-גנ"י -ח.רגיל', 'מוטבים - מת"מ מטה', 'מסגרת קיץ'),
  ('672', 'מסגרת קיץ- חנ"מ 5 י''', 'מוטבים - מת"מ מטה', null),
  ('673', 'הגיינה חופש הגדול', 'מוטבים - מת"מ מטה', null),
  ('674', 'מיגון והגיינה', 'מוכרים - מת"מ מטה', 'מינהל'),
  ('675', 'ע.חינוך ג-ד קורונה', 'מוכרים - מת"מ מטה', null),
  ('676', 'קיזוז ס. שילוב חט"ע', 'מוכרים - מת"מ מטה', null),
  ('677', 'ניצני קיץ -גני ילדים', 'מוכרים - מת"מ מטה', null),
  ('678', 'ניצני קיץ -מוסדות', 'מוכרים - מת"מ מטה', null),
  ('679', 'ניצני קיץ - כשרות', 'מוטבים - מת"מ מטה', null),
  ('681', 'רכזת גנים-חופש הגדול', 'מוטבים - מת"מ מטה', null),
  ('682', 'מודל דוקאטוס', 'מוכרים - מת"מ מטה', null),
  ('683', 'ע.הוראה יוצא אתיופיה', 'מוכרים - מת"מ מטה', null),
  ('684', 'ע.חינוך הכשרה קורונה', 'מוטבים - מת"מ מטה', null),
  ('685', 'ליווי הסעות גנ"י (מסלולים)', 'הסעות', 'ליווי הסעות'),
  ('686', 'למידה דיגיטלית/מרחוק', 'מוכרים - מת"מ מטה', null),
  ('687', 'תכנית ממ"ש', 'מוכרים - מת"מ מטה', null),
  ('689', 'הפעלת מכינות קיץ (מלא) תשפ״א', 'מוכרים - מת"מ מטה', 'מינהל'),
  ('690', 'סייעת לילד חולה בבית', 'מוטבים - מת"מ מטה', null),
  ('691', 'צמצום פערים', null, 'גפן'),
  ('692', 'פיילוט הסעות רגיל', 'מוטבים - מת"מ מטה', null),
  ('693', 'פיילוט הסעות חנ"מ קל', 'מוטבים - מת"מ מטה', null),
  ('694', 'פיילוט הסעות חנמ קשה', 'מוטבים - מת"מ מטה', null),
  ('695', 'פיילוט הסעות מלווים', 'מוטבים - מת"מ מטה', null),
  ('696', 'תוכן דיגיטלי', null, 'גפן'),
  ('697', 'באים בטוב', 'ידניים', 'גפן'),
  ('698', 'הסעות מח"טים', 'מוטבים - מת"מ מטה', null),
  ('699', 'מטהרי אויר', 'מוטבים - מת"מ מטה', null),
  ('700', 'תכנית אתגרים', 'מוכרים - מת"מ מטה', null),
  ('701', 'מענק יובל- גנ"י חנ"מ', 'מוכרים - מת"מ מטה', null),
  ('702', 'ת.אנגלית-רשמי-גן+א+ב', 'מוטבים - מת"מ מטה', null),
  ('703', 'גפן - תקצוב לרשמיים', 'מוכרים - מת"מ מטה', null),
  ('704', 'גפן-קיזוז השתתפ.רשות', null, 'גפן'),
  ('705', 'גפן מוכש"ר', null, null),
  ('706', 'גפן- קיזוז שעות המרה', 'מוכרים - מת"מ מטה', null),
  ('707', 'גפן -ק.השת.רשות חט"ע', null, 'גפן'),
  ('708', 'גפן - סל רשותי', 'מוטבים - מת"מ מטה', 'גפן'),
  ('709', 'גפן - קיזוז התישבותי', 'מוטבים - מת"מ מטה', 'גפן'),
  ('710', 'שכר המנל מחלקת נוער', 'מוטבים - מת"מ מטה', 'שכר'),
  ('711', 'כיתות מצויינות', 'מוכרים - מת"מ מטה', null),
  ('712', 'אתגרים לפי מוטב', 'מוטבים - מת"מ מטה', null),
  ('713', 'תכנית עמ"ט טק', 'מוכרים - מת"מ מטה', null),
  ('714', 'מ.מקום גננות וסייעות', 'מוטבים - מת"מ מטה', null),
  ('715', 'הארכת פ.בכיתת תקשורת', 'מוכרים - מת"מ מטה', null),
  ('716', 'מעונות יום - ממונה', null, 'מעונות'),
  ('717', 'מעונות יום -הד.פדגוג', 'מוטבים - מת"מ מטה', 'מעונות'),
  ('718', 'סל קליטה - בני מנשה', 'מוכרים - מת"מ מטה', null),
  ('719', 'תשלום חרבות ברזל', null, 'חרבות ברזל'),
  ('724', 'תקומה - גפן - מוכש"ר', null, null),
  ('727', 'תנופה - גפן - מוכש"ר', 'מוכרים - מת"מ מטה', null),
  ('729', 'רכז מיומנות-עוז לתמו', null, null),
  ('731', 'גפן - גיל הרך', 'מוטבים - מת"מ מטה', null),
  ('734', 'חינוך לסובלנות', null, null),
  ('736', 'גמול רכז שכבה', null, null),
  ('999', 'ידניים', 'ידניים', null)
on conflict (topic_code) do nothing;
