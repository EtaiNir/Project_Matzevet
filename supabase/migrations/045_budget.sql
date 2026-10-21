-- ═══════════════════════════════════════════════════════════════
-- 045 — מודול התקציב: תקציב ומעקב, מיתר ורכש (החלטה 023)
-- ⚠️ הוחלה על המסד החי ב-20.10 בשם 040_budget.sql. המספרים 040–043 התבררו כתפוסים
-- בענף bagrut-engine (חשיפת ת"ז, מנוע הזכאות, ביטולו, שינוי סטטוס) — הקובץ שונה ל-044,
-- ושוב ל-045 כשמתן דחף 044_status_override_role (21.10).
-- הוא idempotent, אבל אין צורך להחיל אותו שוב.
-- ═══════════════════════════════════════════════════════════════
-- מוצר שלישי בפורטל, לצד המצבת והבגרות. כמו הבגרות (014 §2, 016):
-- טבלאות משותפות לכל הרשויות עם authority_code, ולא טבלה לכל רשות —
-- המבנה קבוע בכל רשות.
--
-- שתי שכבות, כמו באקסס של סבא:
--   שכבת הקבצים   — נדרסת בכל קליטה. כותב אותה רק הסוכן (חיבור ישיר, עוקף RLS).
--   שכבת המשתמש  — לא נדרסת לעולם: קטגוריות, צפי, תכנית לשנה הבאה, הערות,
--                    קבצים. המקבילה לטבלה "תוספיים" באקסס.
--
-- שלושה תפקידים (אייל, 20.10), בעמודה users.budget_role:
--   manager — רואה ועורך הכול ברשויות שלו, ומעלה קבצים
--   owner   — "אחראי תקציב": רואה ועורך צפי והערות רק בכרטיסים שקטגוריה 1
--             שלהם ב-users.budget_categories (הביזור לדרגי הביניים מהשיחה)
--   viewer  — רואה הכול, לא עורך
-- מנהל־על נחשב manager בכל רשות.
--
-- ⚡ ביצועים (מלכודת 34): פונקציות ההרשאה מחזירות **מערך** ומופעלות בתוך
-- `(select …)` במדיניות — Postgres מחשב אותן פעם אחת לבקשה (initplan), ולא
-- שאילתה ל-users לכל שורה מ-10,000 התנועות.
-- ⚠️ ה-`::text[]` חובה: `any((select f()))` בלעדיו נקרא כתת-שאילתה של שורות,
-- ו-Postgres נכשל ב-"operator does not exist: text = text[]" (נתפס בהחלה, 20.10).
--
-- ⚠️ ההשערה "תכנית שנה נוכחית = התקציב המאושר" (023 §4): התקציב נקלט
-- מקובץ הכרטיסים (budget_cards.budget_*) ואינו נערך באתר. אם סבא יגיד
-- אחרת — עמודה בשכבת המשתמש, לא שינוי בשכבת הקבצים.

-- ───────────────────────────────────────────────────────────────
-- א. התפקיד במשתמש
-- ───────────────────────────────────────────────────────────────
alter table public.users add column if not exists budget_role text;
alter table public.users add column if not exists budget_categories text[] not null default '{}';

alter table public.users drop constraint if exists users_budget_role_check;
alter table public.users add constraint users_budget_role_check
  check (budget_role is null or budget_role in ('manager', 'owner', 'viewer'));

comment on column public.users.budget_role is
  'תפקיד בניהול התקציב (045). null = אין גישה. manager / owner (לפי budget_categories) / viewer';
comment on column public.users.budget_categories is
  'לאחראי תקציב (owner): ערכי "קטגוריה 1" של הכרטיסים שבאחריותו. מערך ריק = אף כרטיס';

-- ───────────────────────────────────────────────────────────────
-- ב. פונקציות ההרשאה — כולן security definer + search_path (מלכודת 25)
-- ───────────────────────────────────────────────────────────────

-- רשויות שבהן המשתמש רואה **הכול** בתקציב (מנהל וצופה; מנהל־על — כולן)
create or replace function public.budget_full_codes()
returns text[]
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select case
             when u.is_suspended then '{}'::text[]
             when u.role = 'super_admin' then (select coalesce(array_agg(a.code), '{}') from public.authorities a)
             when u.budget_role in ('manager', 'viewer') then u.authority_codes
             else '{}'::text[]
           end
      from public.users u
     where u.id = auth.uid()
  ), '{}'::text[]);
$$;

-- רשויות שבהן המשתמש **מנהל** את התקציב — עורך ומעלה קבצים
create or replace function public.budget_manage_codes()
returns text[]
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select case
             when u.is_suspended then '{}'::text[]
             when u.role = 'super_admin' then (select coalesce(array_agg(a.code), '{}') from public.authorities a)
             when u.budget_role = 'manager' then u.authority_codes
             else '{}'::text[]
           end
      from public.users u
     where u.id = auth.uid()
  ), '{}'::text[]);
$$;

-- לנוחות הממשק ולבדיקות: האם המשתמש מנהל את התקציב ברשות
create or replace function public.may_manage_budget(code text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select code = any(public.budget_manage_codes());
$$;

-- ───────────────────────────────────────────────────────────────
-- ג. שכבת המשתמש — הכרטיס (נוצרת קודם: budget_owner_cards קוראת ממנה)
-- ───────────────────────────────────────────────────────────────

create table if not exists public.budget_card_meta (
  authority_code text not null references public.authorities(code) on delete cascade,
  card_code      text not null check (card_code ~ '^\d+$'),
  category1      text,
  category2      text,
  category3      text,
  category_note  text,
  owner_name     text,          -- "באחריות" באקסס — שם, לא משתמש במערכת
  money_source   text,          -- "מקור כספי"
  meitar_topic   text,          -- קוד נושא במיתר שהכרטיס מתוקצב ממנו
  gefen          boolean not null default false,
  updated_by     uuid references public.users(id) on delete set null,  -- מלכודת 24
  updated_at     timestamptz not null default now(),
  primary key (authority_code, card_code)
);

comment on table public.budget_card_meta is
  'שכבת המשתמש לכרטיס — לא נדרסת בקליטה. קטגוריות 1/2/3, אחראי, מקור כספי, נושא מיתר.
   קטגוריה 1 קובעת אילו כרטיסים רואה אחראי תקציב (budget_owner_cards).';

create table if not exists public.budget_card_plans (
  authority_code   text not null references public.authorities(code) on delete cascade,
  card_code        text not null check (card_code ~ '^\d+$'),
  fiscal_year      int  not null check (fiscal_year between 2000 and 2100),
  forecast_income  numeric,
  forecast_expense numeric,
  next_income      numeric,     -- תכנית תקציב הכנסות לשנה הבאה
  next_expense     numeric,
  notes            text,        -- "הערות לתכנון תקציב"
  updated_by       uuid references public.users(id) on delete set null,
  updated_at       timestamptz not null default now(),
  primary key (authority_code, card_code, fiscal_year)
);

comment on table public.budget_card_plans is
  'שכבת המשתמש לכרטיס בשנה — צפי לסוף השנה ותכנית לשנה הבאה. מוזנים ביד (כמו באקסס);
   הממשק רק מציע צפי לפי הקצב.';

create table if not exists public.budget_card_files (
  id             uuid primary key default gen_random_uuid(),
  authority_code text not null references public.authorities(code) on delete cascade,
  card_code      text not null check (card_code ~ '^\d+$'),
  storage_path   text not null,
  file_name      text not null,   -- השם המקורי; בנתיב — שם בטוח (מלכודת 31)
  size_bytes     bigint,
  mime_type      text,
  uploaded_by    uuid references public.users(id) on delete set null,
  uploaded_at    timestamptz not null default now()
);
create index if not exists budget_card_files_card_idx on public.budget_card_files (authority_code, card_code);

-- (מוגדרת כאן ולא בסעיף ב: פונקציית sql נבדקת ביצירה, והיא קוראת מ-budget_card_meta)
-- לאחראי תקציב: הכרטיסים שלו, כ-'קוד_רשות:כרטיס'. נקבע לפי קטגוריה 1 בשכבת
-- המשתמש — כרטיס שעוד לא סווג אינו נראה לאחראי (ונראה למנהל).
create or replace function public.budget_owner_cards()
returns text[]
language sql stable security definer set search_path = public
as $$
  select coalesce((
    select array_agg(m.authority_code || ':' || m.card_code)
      from public.users u
      join public.budget_card_meta m
        on m.authority_code = any(u.authority_codes)
       and m.category1 = any(u.budget_categories)
     where u.id = auth.uid()
       and not u.is_suspended
       and u.role <> 'super_admin'
       and u.budget_role = 'owner'
  ), '{}'::text[]);
$$;

-- מי ומתי — בטריגר במסד, לא בדפדפן (כמו 029, 033)
create or replace function public.budget_stamp()
returns trigger
language plpgsql
as $$
begin
  new.updated_by := coalesce(auth.uid(), new.updated_by);
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists budget_card_meta_stamp on public.budget_card_meta;
create trigger budget_card_meta_stamp before insert or update on public.budget_card_meta
  for each row execute function public.budget_stamp();
drop trigger if exists budget_card_plans_stamp on public.budget_card_plans;
create trigger budget_card_plans_stamp before insert or update on public.budget_card_plans
  for each row execute function public.budget_stamp();

create or replace function public.budget_files_stamp()
returns trigger
language plpgsql
as $$
begin
  new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  new.uploaded_at := now();
  return new;
end;
$$;
drop trigger if exists budget_card_files_stamp on public.budget_card_files;
create trigger budget_card_files_stamp before insert on public.budget_card_files
  for each row execute function public.budget_files_stamp();

-- ───────────────────────────────────────────────────────────────
-- ד. שכבת הקבצים — EPR
-- ───────────────────────────────────────────────────────────────

-- דוח "ברמת הכרטיס הבודד": שורה לכל כרטיס בשנת התקציב (קלנדרית).
-- הסימנים כמו בקובץ: הוצאות שליליות. התצוגה הופכת, האחסון לא.
create table if not exists public.budget_cards (
  authority_code text not null references public.authorities(code) on delete cascade,
  fiscal_year    int  not null check (fiscal_year between 2000 and 2100),
  card_code      text not null check (card_code ~ '^\d+$'),
  card_name      text,
  budget_expense numeric,   -- "תקציב הוצאות" — התקציב המאושר (023 §4, השערה)
  budget_income  numeric,   -- "תקציב הכנסות"
  budget_period  numeric,   -- "תקציב תקופתי"
  executed       numeric,   -- "ביצוע" = Σ(זכות − חובה) של תנועות השנה
  reserved       numeric,   -- "שריון" — הזמנות מאושרות
  balance        numeric,   -- "יתרה"
  demand         numeric,   -- "דרישה"
  upload_id      uuid,
  loaded_at      timestamptz not null default now(),
  primary key (authority_code, fiscal_year, card_code)
);

-- דוח "ברמת הפעולה הבודדת": כל תנועה, עד האסמכתא
create table if not exists public.budget_transactions (
  id              bigserial primary key,
  authority_code  text not null references public.authorities(code) on delete cascade,
  card_code       text not null,
  card_name       text,
  year_field      int,          -- "שנה" בקובץ; 0 ביתרת פתיחה
  event_date      date,         -- "תאריך ארוע" (טקסט dd/mm/yy בקובץ); null ביתרת פתיחה
  due_date        date,
  is_opening      boolean not null default false,
  voucher         text,         -- "מספר פקודה"
  counter_account text,
  counter_name    text,
  details         text,
  debit           numeric,      -- חובה
  credit          numeric,      -- זכות
  balance         numeric,      -- יתרה רצה
  ref1            text,
  ref2            text,
  cost_center     text,         -- תמחיר1
  document        text,
  -- נושא המיתר של תקבול ממשרד החינוך. נגזר בקליטה מהמספר האחרון בטקסט "פרטים"
  -- שהוא נושא מוכר ("סייעת 2 והעשרה -רשמי 614 גן זית" → 614) — הכלל שהאקסס של
  -- סבא מקיים: 5,030 תנועות זהות, אף אחת שגויה. null = לא מהמיתר ("999" באקסס).
  meitar_topic    text,
  line_no         int,
  upload_id       uuid
);
create index if not exists budget_transactions_card_idx
  on public.budget_transactions (authority_code, card_code, event_date);
create index if not exists budget_transactions_date_idx
  on public.budget_transactions (authority_code, event_date);
create index if not exists budget_transactions_topic_idx
  on public.budget_transactions (authority_code, meitar_topic) where meitar_topic is not null;

-- דוח הזמנות הרכש מ-EPR (המקבילה ל"רכש – טבלת הבסיס מאז מנשה")
create table if not exists public.budget_orders (
  authority_code  text not null references public.authorities(code) on delete cascade,
  order_no        text not null,
  order_date      date,
  supplier_no     text,
  supplier_name   text,
  amount          numeric,      -- סה"כ עלות הרכש כולל מע"מ
  not_supplied    numeric,      -- "לא סופק"
  status          text,         -- "מצב נוכחי"
  next_approver   text,         -- "מאשר הבא"
  details         text,
  department      text,
  card_code       text,         -- "סעיפים תקציביים"
  card_name       text,
  cost_center1    text,
  cost_center2    text,
  contract        text,
  extra           jsonb,        -- כל עמודה שלא מופתה — לא נזרקת
  upload_id       uuid,
  loaded_at       timestamptz not null default now(),
  primary key (authority_code, order_no)
);
create index if not exists budget_orders_card_idx on public.budget_orders (authority_code, card_code);

-- שכבת המשתמש של ההזמנה — חשבונית, גפן, תב"ר, הערות פנימיות
create table if not exists public.budget_order_notes (
  authority_code   text not null references public.authorities(code) on delete cascade,
  order_no         text not null,
  invoice_received boolean not null default false,
  invoice_no       text,
  invoice_amount   numeric,
  in_gefen         boolean not null default false,
  in_tabar         boolean not null default false,
  notes            text,
  updated_by       uuid references public.users(id) on delete set null,
  updated_at       timestamptz not null default now(),
  primary key (authority_code, order_no)
);
drop trigger if exists budget_order_notes_stamp on public.budget_order_notes;
create trigger budget_order_notes_stamp before insert or update on public.budget_order_notes
  for each row execute function public.budget_stamp();

-- ───────────────────────────────────────────────────────────────
-- ה. שכבת הקבצים — מיתר
-- ───────────────────────────────────────────────────────────────
-- ZIP חודשי אחד = ריצה אחת (רשות × חודש חישוב). קליטה חוזרת של אותו חודש
-- מחליפה אותו. באקסס יש טבלה לכל סוג קובץ; כאן טבלה אחת עם עמודות הליבה
-- המשותפות לכולם, וכל השאר ב-extra — כמו "טבלה מרכזת 0" של סבא.

create table if not exists public.meitar_runs (
  id             uuid primary key default gen_random_uuid(),
  authority_code text not null references public.authorities(code) on delete cascade,
  calc_month     date not null,     -- היום הראשון של "חודש חישוב"
  beneficiary    text,              -- "סמל מוטב"
  file_count     int,
  upload_id      uuid,
  loaded_at      timestamptz not null default now(),
  unique (authority_code, calc_month)
);

-- CHESHBONIT — הסיכום החודשי לנושא
create table if not exists public.meitar_invoice (
  id             bigserial primary key,
  run_id         uuid not null references public.meitar_runs(id) on delete cascade,
  authority_code text not null references public.authorities(code) on delete cascade,
  topic_code     text not null,
  topic_name     text,
  chashavut      text,              -- "חשבות": מטה / התישבות
  effect_month   text,
  due            numeric,           -- "סך הכל מגיע"
  paid           numeric,           -- "שולם"
  to_pay         numeric,           -- "הפרש לתשלום"
  debt           numeric,           -- "יתרת חוב"
  month_balance  numeric,           -- "יתרת ביצוע החודש"
  notes          text
);
create index if not exists meitar_invoice_run_idx on public.meitar_invoice (run_id, topic_code);

-- 15 קובצי הפירוט — שורה לכל שורה בקובץ
create table if not exists public.meitar_rows (
  id               bigserial primary key,
  run_id           uuid not null references public.meitar_runs(id) on delete cascade,
  authority_code   text not null references public.authorities(code) on delete cascade,
  source_file      text not null,   -- MUCARIM, SACAL, HASNET, …
  topic_code       text,
  topic_name       text,
  institution_code text,
  institution_name text,
  settlement_code  text,
  settlement_name  text,
  effect_month     text,            -- "חודש תחולה" כפי שבקובץ
  units            numeric,
  cost             numeric,
  pct              numeric,
  computed         numeric,         -- "סכום מחושב" — מצטבר
  computed_prev    numeric,         -- "סכום מחושב קודם"
  diff             numeric,         -- "הפרש מחושב" — מה שהשתנה החודש
  extra            jsonb
);
create index if not exists meitar_rows_run_idx on public.meitar_rows (run_id, topic_code);

-- שכבת המשתמש לנושא מיתר: תקציב, צפי, שנה הבאה (טבלת "99" באקסס)
create table if not exists public.meitar_topic_plans (
  authority_code text not null references public.authorities(code) on delete cascade,
  topic_code     text not null,
  school_year    int  not null check (school_year between 2000 and 2100),  -- שנת הסיום: תשפ"ז = 2027
  budget         numeric,
  forecast       numeric,
  next_year      numeric,
  category       text,
  notes          text,
  updated_by     uuid references public.users(id) on delete set null,
  updated_at     timestamptz not null default now(),
  primary key (authority_code, topic_code, school_year)
);
drop trigger if exists meitar_topic_plans_stamp on public.meitar_topic_plans;
create trigger meitar_topic_plans_stamp before insert or update on public.meitar_topic_plans
  for each row execute function public.budget_stamp();

-- ───────────────────────────────────────────────────────────────
-- ו. תור הקליטה והתבניות — בדפוס דרג ב' (023)
-- ───────────────────────────────────────────────────────────────
-- קליטה = סט קבצים (שני דוחות EPR, הזמנות, ZIP מיתר — כל צירוף).
-- ההצעה למיפוי דטרמיניסטית (מילון כותרות ב-scripts/budget_fields.py), בלי AI.

create table if not exists public.budget_uploads (
  id               uuid primary key default gen_random_uuid(),
  authority_code   text not null references public.authorities(code) on delete cascade,
  fiscal_year      int  not null check (fiscal_year between 2000 and 2100),
  status           text not null default 'pending'
                   check (status in ('pending', 'awaiting_approval', 'processing', 'done', 'failed')),
  storage_prefix   text not null,
  files            jsonb not null default '[]',   -- [{path, name}] — השם המקורי בעברית
  proposed_mapping jsonb,                          -- {path: {kind, headers, mapping, meta}}
  approved_mapping jsonb,                          -- {path: {kind, mapping}}
  mapping_source   text check (mapping_source in ('dictionary', 'saved', 'manual')),
  report           jsonb,
  rows_loaded      int,
  error_message    text,
  uploaded_by      uuid references public.users(id) on delete set null,
  uploaded_at      timestamptz not null default now(),
  processed_at     timestamptz
);
create index if not exists budget_uploads_pending_idx
  on public.budget_uploads (status, uploaded_at);
create index if not exists budget_uploads_authority_idx
  on public.budget_uploads (authority_code, uploaded_at desc);

create table if not exists public.budget_mappings (
  id             uuid primary key default gen_random_uuid(),
  authority_code text not null references public.authorities(code) on delete cascade,
  kind           text not null,
  headers_hash   text not null,
  headers        text[] not null,
  mapping        jsonb not null,
  created_by     uuid references public.users(id) on delete set null,
  created_at     timestamptz not null default now(),
  used_at        timestamptz,
  use_count      int not null default 0,
  unique (authority_code, kind, headers_hash)
);

create or replace function public.budget_uploads_stamp()
returns trigger
language plpgsql
as $$
begin
  new.uploaded_by := coalesce(auth.uid(), new.uploaded_by);
  return new;
end;
$$;
drop trigger if exists budget_uploads_stamp on public.budget_uploads;
create trigger budget_uploads_stamp before insert on public.budget_uploads
  for each row execute function public.budget_uploads_stamp();

-- מחיקת רשות בזמן קליטת תקציב פעילה — מסרבים (כמו המצב"ת ודרג ב' ב-023).
-- טריגר נפרד ולא עוד גרסה של delete_authority: לא מעתיקים פונקציה קריטית
-- כדי להוסיף לה בדיקה אחת. שאר הנתונים נגררים ב-on delete cascade.
create or replace function public.budget_block_authority_delete()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  if exists (select 1 from public.budget_uploads
              where authority_code = old.code
                and status in ('pending', 'awaiting_approval', 'processing')) then
    raise exception 'יש קליטת תקציב בעיבוד עבור %. יש להמתין לסיומה לפני המחיקה', old.name;
  end if;
  return old;
end;
$$;
drop trigger if exists authorities_budget_busy on public.authorities;
create trigger authorities_budget_busy before delete on public.authorities
  for each row execute function public.budget_block_authority_delete();

-- ───────────────────────────────────────────────────────────────
-- ז. RLS — ארבע מדיניות לכל טבלה (מלכודת 28)
-- ───────────────────────────────────────────────────────────────
-- הנוסחה החוזרת לכרטיס:
--   authority_code = any((select budget_full_codes()))
--   or (authority_code || ':' || card_code) = any((select budget_owner_cards()))

do $$
declare
  t text;
begin
  foreach t in array array[
    'budget_card_meta', 'budget_card_plans', 'budget_card_files', 'budget_cards',
    'budget_transactions', 'budget_orders', 'budget_order_notes', 'meitar_runs',
    'meitar_invoice', 'meitar_rows', 'meitar_topic_plans', 'budget_uploads', 'budget_mappings'
  ] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert', t);
    execute format('drop policy if exists %I on public.%I', t || '_update', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;

-- ── כרטיסים ותנועות: קריאה בלבד מהממשק; הסוכן כותב בחיבור ישיר
create policy budget_cards_read on public.budget_cards for select to authenticated
  using (authority_code = any((select public.budget_full_codes())::text[])
         or (authority_code || ':' || card_code) = any((select public.budget_owner_cards())::text[]));
create policy budget_cards_insert on public.budget_cards for insert to authenticated with check (false);
create policy budget_cards_update on public.budget_cards for update to authenticated using (false) with check (false);
create policy budget_cards_delete on public.budget_cards for delete to authenticated using (false);

create policy budget_transactions_read on public.budget_transactions for select to authenticated
  using (authority_code = any((select public.budget_full_codes())::text[])
         or (authority_code || ':' || card_code) = any((select public.budget_owner_cards())::text[]));
create policy budget_transactions_insert on public.budget_transactions for insert to authenticated with check (false);
create policy budget_transactions_update on public.budget_transactions for update to authenticated using (false) with check (false);
create policy budget_transactions_delete on public.budget_transactions for delete to authenticated using (false);

create policy budget_orders_read on public.budget_orders for select to authenticated
  using (authority_code = any((select public.budget_full_codes())::text[])
         or (authority_code || ':' || card_code) = any((select public.budget_owner_cards())::text[]));
create policy budget_orders_insert on public.budget_orders for insert to authenticated with check (false);
create policy budget_orders_update on public.budget_orders for update to authenticated using (false) with check (false);
create policy budget_orders_delete on public.budget_orders for delete to authenticated using (false);

-- ── שכבת המשתמש של הכרטיס
-- קטגוריות: רק מנהל. אחראי שהיה משנה את קטגוריה 1 היה משנה את מה שהוא רואה.
create policy budget_card_meta_read on public.budget_card_meta for select to authenticated
  using (authority_code = any((select public.budget_full_codes())::text[])
         or (authority_code || ':' || card_code) = any((select public.budget_owner_cards())::text[]));
create policy budget_card_meta_insert on public.budget_card_meta for insert to authenticated
  with check (authority_code = any((select public.budget_manage_codes())::text[]));
create policy budget_card_meta_update on public.budget_card_meta for update to authenticated
  using (authority_code = any((select public.budget_manage_codes())::text[]))
  with check (authority_code = any((select public.budget_manage_codes())::text[]));
create policy budget_card_meta_delete on public.budget_card_meta for delete to authenticated
  using (authority_code = any((select public.budget_manage_codes())::text[]));

-- צפי, תכנית והערות: מנהל, או אחראי בכרטיסים שלו
create policy budget_card_plans_read on public.budget_card_plans for select to authenticated
  using (authority_code = any((select public.budget_full_codes())::text[])
         or (authority_code || ':' || card_code) = any((select public.budget_owner_cards())::text[]));
create policy budget_card_plans_insert on public.budget_card_plans for insert to authenticated
  with check (authority_code = any((select public.budget_manage_codes())::text[])
              or (authority_code || ':' || card_code) = any((select public.budget_owner_cards())::text[]));
create policy budget_card_plans_update on public.budget_card_plans for update to authenticated
  using (authority_code = any((select public.budget_manage_codes())::text[])
         or (authority_code || ':' || card_code) = any((select public.budget_owner_cards())::text[]))
  with check (authority_code = any((select public.budget_manage_codes())::text[])
              or (authority_code || ':' || card_code) = any((select public.budget_owner_cards())::text[]));
create policy budget_card_plans_delete on public.budget_card_plans for delete to authenticated
  using (authority_code = any((select public.budget_manage_codes())::text[]));

create policy budget_card_files_read on public.budget_card_files for select to authenticated
  using (authority_code = any((select public.budget_full_codes())::text[])
         or (authority_code || ':' || card_code) = any((select public.budget_owner_cards())::text[]));
create policy budget_card_files_insert on public.budget_card_files for insert to authenticated
  with check (authority_code = any((select public.budget_manage_codes())::text[])
              or (authority_code || ':' || card_code) = any((select public.budget_owner_cards())::text[]));
create policy budget_card_files_update on public.budget_card_files for update to authenticated
  using (false) with check (false);
create policy budget_card_files_delete on public.budget_card_files for delete to authenticated
  using (authority_code = any((select public.budget_manage_codes())::text[])
         or (authority_code || ':' || card_code) = any((select public.budget_owner_cards())::text[]));

-- ── הערות להזמנה: קריאה למי שרואה את ההזמנה (ה-RLS של budget_orders חל בתוך ה-exists); כתיבה — מנהל
create policy budget_order_notes_read on public.budget_order_notes for select to authenticated
  using (exists (select 1 from public.budget_orders o
                  where o.authority_code = budget_order_notes.authority_code
                    and o.order_no = budget_order_notes.order_no));
create policy budget_order_notes_insert on public.budget_order_notes for insert to authenticated
  with check (authority_code = any((select public.budget_manage_codes())::text[]));
create policy budget_order_notes_update on public.budget_order_notes for update to authenticated
  using (authority_code = any((select public.budget_manage_codes())::text[]))
  with check (authority_code = any((select public.budget_manage_codes())::text[]));
create policy budget_order_notes_delete on public.budget_order_notes for delete to authenticated
  using (authority_code = any((select public.budget_manage_codes())::text[]));

-- ── מיתר: הכנסות ברמת הרשות — מנהל וצופה בלבד, לא אחראי כרטיסים
create policy meitar_runs_read on public.meitar_runs for select to authenticated
  using (authority_code = any((select public.budget_full_codes())::text[]));
create policy meitar_runs_insert on public.meitar_runs for insert to authenticated with check (false);
create policy meitar_runs_update on public.meitar_runs for update to authenticated using (false) with check (false);
create policy meitar_runs_delete on public.meitar_runs for delete to authenticated using (false);

create policy meitar_invoice_read on public.meitar_invoice for select to authenticated
  using (authority_code = any((select public.budget_full_codes())::text[]));
create policy meitar_invoice_insert on public.meitar_invoice for insert to authenticated with check (false);
create policy meitar_invoice_update on public.meitar_invoice for update to authenticated using (false) with check (false);
create policy meitar_invoice_delete on public.meitar_invoice for delete to authenticated using (false);

create policy meitar_rows_read on public.meitar_rows for select to authenticated
  using (authority_code = any((select public.budget_full_codes())::text[]));
create policy meitar_rows_insert on public.meitar_rows for insert to authenticated with check (false);
create policy meitar_rows_update on public.meitar_rows for update to authenticated using (false) with check (false);
create policy meitar_rows_delete on public.meitar_rows for delete to authenticated using (false);

create policy meitar_topic_plans_read on public.meitar_topic_plans for select to authenticated
  using (authority_code = any((select public.budget_full_codes())::text[]));
create policy meitar_topic_plans_insert on public.meitar_topic_plans for insert to authenticated
  with check (authority_code = any((select public.budget_manage_codes())::text[]));
create policy meitar_topic_plans_update on public.meitar_topic_plans for update to authenticated
  using (authority_code = any((select public.budget_manage_codes())::text[]))
  with check (authority_code = any((select public.budget_manage_codes())::text[]));
create policy meitar_topic_plans_delete on public.meitar_topic_plans for delete to authenticated
  using (authority_code = any((select public.budget_manage_codes())::text[]));

-- ── תור הקליטה והתבניות: מנהל התקציב (הסוכן מעדכן בחיבור ישיר)
create policy budget_uploads_read on public.budget_uploads for select to authenticated
  using (authority_code = any((select public.budget_manage_codes())::text[]));
create policy budget_uploads_insert on public.budget_uploads for insert to authenticated
  with check (authority_code = any((select public.budget_manage_codes())::text[]) and status = 'pending');
-- העדכון נדרש לאישור המיפוי מהממשק
create policy budget_uploads_update on public.budget_uploads for update to authenticated
  using (authority_code = any((select public.budget_manage_codes())::text[]))
  with check (authority_code = any((select public.budget_manage_codes())::text[]));
create policy budget_uploads_delete on public.budget_uploads for delete to authenticated
  using (public.is_super_admin());

create policy budget_mappings_read on public.budget_mappings for select to authenticated
  using (authority_code = any((select public.budget_manage_codes())::text[]));
create policy budget_mappings_insert on public.budget_mappings for insert to authenticated
  with check (authority_code = any((select public.budget_manage_codes())::text[]));
create policy budget_mappings_update on public.budget_mappings for update to authenticated
  using (authority_code = any((select public.budget_manage_codes())::text[]))
  with check (authority_code = any((select public.budget_manage_codes())::text[]));
create policy budget_mappings_delete on public.budget_mappings for delete to authenticated
  using (authority_code = any((select public.budget_manage_codes())::text[]));

-- ───────────────────────────────────────────────────────────────
-- ח. ביצוע חודשי — סיכום במסד במקום 10,000 שורות לדפדפן
-- ───────────────────────────────────────────────────────────────
-- security invoker: ה-RLS של budget_transactions חל — אחראי מקבל רק את
-- הכרטיסים שלו. יתרות פתיחה אינן ביצוע ולכן לא נספרות.
create or replace function public.budget_monthly(p_code text, p_from date, p_to date)
returns table (card_code text, month date, debit numeric, credit numeric)
language sql stable security invoker set search_path = public
as $$
  select t.card_code,
         date_trunc('month', t.event_date)::date,
         coalesce(sum(t.debit), 0),
         coalesce(sum(t.credit), 0)
    from public.budget_transactions t
   where t.authority_code = p_code
     and not t.is_opening
     and t.event_date >= p_from
     and t.event_date <  p_to
   group by 1, 2;
$$;
grant execute on function public.budget_monthly(text, date, date) to authenticated;

-- הגשר בין המיתר להנהלת החשבונות: כמה נרשם בכרטסת לכל נושא מיתר בתקופה
-- (זכות − חובה). המיתר מקדים את הנהלת החשבונות בחודשיים-שלושה — הפער צפוי.
create or replace function public.budget_topic_totals(p_code text, p_from date, p_to date)
returns table (meitar_topic text, booked numeric, tx_count bigint)
language sql stable security invoker set search_path = public
as $$
  select t.meitar_topic,
         coalesce(sum(t.credit), 0) - coalesce(sum(t.debit), 0),
         count(*)
    from public.budget_transactions t
   where t.authority_code = p_code
     and t.meitar_topic is not null
     and not t.is_opening
     and t.event_date >= p_from
     and t.event_date <  p_to
   group by 1;
$$;
grant execute on function public.budget_topic_totals(text, date, date) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- ט. Storage — שני דליים פרטיים
-- ───────────────────────────────────────────────────────────────
-- budget-uploads  {code}/{stamp}/{safe-name}   קובצי המקור — מנהל התקציב
-- budget-files    {code}/{card}/{stamp}-{safe} קבצים שמצורפים לכרטיס
-- נפרדים מ-moe-uploads: מדיניות הכתיבה שם היא may_update_moe (מנהל רשות
-- במצבת), ומנהל תקציב אינו בהכרח כזה.

insert into storage.buckets (id, name, public) values ('budget-uploads', 'budget-uploads', false)
on conflict (id) do nothing;
insert into storage.buckets (id, name, public) values ('budget-files', 'budget-files', false)
on conflict (id) do nothing;

drop policy if exists budget_uploads_obj_read   on storage.objects;
drop policy if exists budget_uploads_obj_write  on storage.objects;
drop policy if exists budget_uploads_obj_delete on storage.objects;
drop policy if exists budget_files_obj_read     on storage.objects;
drop policy if exists budget_files_obj_write    on storage.objects;
drop policy if exists budget_files_obj_delete   on storage.objects;

create policy budget_uploads_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'budget-uploads'
         and (storage.foldername(name))[1] = any((select public.budget_manage_codes())::text[]));
create policy budget_uploads_obj_write on storage.objects for insert to authenticated
  with check (bucket_id = 'budget-uploads'
              and (storage.foldername(name))[1] = any((select public.budget_manage_codes())::text[]));
create policy budget_uploads_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'budget-uploads' and public.is_super_admin());

create policy budget_files_obj_read on storage.objects for select to authenticated
  using (bucket_id = 'budget-files'
         and ((storage.foldername(name))[1] = any((select public.budget_full_codes())::text[])
              or ((storage.foldername(name))[1] || ':' || (storage.foldername(name))[2])
                 = any((select public.budget_owner_cards())::text[])));
create policy budget_files_obj_write on storage.objects for insert to authenticated
  with check (bucket_id = 'budget-files'
              and ((storage.foldername(name))[1] = any((select public.budget_manage_codes())::text[])
                   or ((storage.foldername(name))[1] || ':' || (storage.foldername(name))[2])
                      = any((select public.budget_owner_cards())::text[])));
create policy budget_files_obj_delete on storage.objects for delete to authenticated
  using (bucket_id = 'budget-files'
         and ((storage.foldername(name))[1] = any((select public.budget_manage_codes())::text[])
              or ((storage.foldername(name))[1] || ':' || (storage.foldername(name))[2])
                 = any((select public.budget_owner_cards())::text[])));

-- ───────────────────────────────────────────────────────────────
-- י. הרשאות ריצה לפונקציות
-- ───────────────────────────────────────────────────────────────
revoke all on function public.budget_full_codes()     from public, anon;
revoke all on function public.budget_manage_codes()   from public, anon;
revoke all on function public.budget_owner_cards()    from public, anon;
revoke all on function public.may_manage_budget(text) from public, anon;
grant execute on function public.budget_full_codes()     to authenticated;
grant execute on function public.budget_manage_codes()   to authenticated;
grant execute on function public.budget_owner_cards()    to authenticated;
grant execute on function public.may_manage_budget(text) to authenticated;
