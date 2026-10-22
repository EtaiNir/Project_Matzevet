-- ═══════════════════════════════════════════════════════════════
-- ⚠️ הוחלה על המסד ב-21.10 בשם 047_budget_tracking.sql; מוספרה ל-049 במיזוג עם המיתר
--    של אייל (047–048, גם הן הוחלו). אין צורך להחיל שוב.
-- 049 — תקציב: מעקב ותכנון — תמונות מצב, היסטוריית צפי, חריגות, אישור תכנית,
--        ופרטיות תנועות שכר
-- ═══════════════════════════════════════════════════════════════
-- אייל, 21.10: הרעיונות לשיפור המעקב והתכנון (חוץ מהחיבור למצבת). ההחלטה —
-- decisions/025. **הכול תוספתי ומבודד**: טבלאות חדשות, וטריגרים שאינם חוסמים
-- לעולם את הקליטה — שגיאה בהם נבלעת (warning), והקליטה ממשיכה. החריג היחיד —
-- §5, הפרטיות: היא משנה את מדיניות הקריאה של budget_transactions בכוונה.
--
--   1. תמונת מצב לפני כל דריסה — "מה השתנה מאז העדכון הקודם". הסוכן אינו משתנה:
--      טריגר על המחיקה שבקליטה שומר סיכום חודשי לכל כרטיס של מה שנמחק.
--   2. היסטוריית צפי ותכנית — כל שינוי בצפי / בתכנית לשנה הבאה, מי ומתי.
--   3. חריגות לטיפול — הכללים מחושבים במסך; כאן רק "בדקתי" + הערה.
--   4. אישור תכנית לשנה הבאה — הוגש / אושר / הוחזר. עריכה אחרי אישור מחזירה לעבודה.
--   5. פרטיות: אחראי תקציב אינו רואה **תנועות** בכרטיסי שכר (סוג 100–199), רק
--      סיכומים. budget_monthly עוברת ל-security definer כדי שהסיכומים יישארו.
-- נבדק לפני החלה: scripts/apply_049.py, בטרנזקציה שמגולגלת לאחור.

-- ───────────────────────────────────────────────────────────────
-- 1. תמונות מצב
-- ───────────────────────────────────────────────────────────────
create table if not exists public.budget_snapshots (
  id             bigint generated always as identity primary key,
  authority_code text not null references public.authorities(code) on delete cascade,
  fiscal_year    int,
  -- תאריך הנתונים של מה שנדרס (budget_cards.as_of הקודם)
  as_of          date,
  taken_at       timestamptz not null default now(),
  -- אותה טרנזקציה של קליטה = אותה תמונה (כרטיסים ותנועות נמחקים בנפרד)
  txid           bigint not null default txid_current(),
  -- טווח התנועות שנדרסו — ההשוואה רק בתוכו
  from_date      date,
  to_date        date
);
create index if not exists budget_snapshots_auth_idx on public.budget_snapshots (authority_code, id desc);

create table if not exists public.budget_snapshot_monthly (
  snapshot_id bigint not null references public.budget_snapshots(id) on delete cascade,
  card_code   text not null,
  month       date not null,
  debit       numeric not null default 0,
  credit      numeric not null default 0,
  n           int not null default 0,
  primary key (snapshot_id, card_code, month)
);

create or replace function public.budget_snapshot_cards() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  begin
    insert into budget_snapshots (authority_code, fiscal_year, as_of)
    select o.authority_code, o.fiscal_year, max(o.as_of) from old_rows o group by 1, 2;
  exception when others then
    raise warning 'budget_snapshot_cards: % — הקליטה ממשיכה', sqlerrm;
  end;
  return null;
end $$;

create or replace function public.budget_snapshot_transactions() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r    record;
  v_id bigint;
begin
  begin
    for r in select o.authority_code, min(o.event_date) as lo, max(o.event_date) as hi from old_rows o group by 1 loop
      select id into v_id from budget_snapshots
       where authority_code = r.authority_code and txid = txid_current() order by id desc limit 1;
      if v_id is null then
        insert into budget_snapshots (authority_code, as_of)
        values (r.authority_code, (select max(as_of) from budget_cards where authority_code = r.authority_code))
        returning id into v_id;
      end if;
      update budget_snapshots set from_date = least(coalesce(from_date, r.lo), r.lo), to_date = greatest(coalesce(to_date, r.hi), r.hi)
       where id = v_id;
      insert into budget_snapshot_monthly as m (snapshot_id, card_code, month, debit, credit, n)
      select v_id, o.card_code, date_trunc('month', o.event_date)::date,
             coalesce(sum(o.debit), 0), coalesce(sum(o.credit), 0), count(*)
        from old_rows o
       where o.authority_code = r.authority_code and not o.is_opening and o.event_date is not null
       group by 2, 3
      on conflict (snapshot_id, card_code, month) do update
        set debit = m.debit + excluded.debit, credit = m.credit + excluded.credit, n = m.n + excluded.n;
      -- שומרים 24 תמונות לרשות
      delete from budget_snapshots s where s.authority_code = r.authority_code
         and s.id not in (select id from budget_snapshots where authority_code = r.authority_code order by id desc limit 24);
    end loop;
  exception when others then
    raise warning 'budget_snapshot_transactions: % — הקליטה ממשיכה', sqlerrm;
  end;
  return null;
end $$;

drop trigger if exists budget_cards_snapshot on public.budget_cards;
create trigger budget_cards_snapshot after delete on public.budget_cards
  referencing old table as old_rows for each statement execute function public.budget_snapshot_cards();
drop trigger if exists budget_transactions_snapshot on public.budget_transactions;
create trigger budget_transactions_snapshot after delete on public.budget_transactions
  referencing old table as old_rows for each statement execute function public.budget_snapshot_transactions();

alter table public.budget_snapshots enable row level security;
alter table public.budget_snapshot_monthly enable row level security;
-- מי שרואה את הרשות כולה, או אחראי שיש לו בה כרטיס; השורות — כמו התנועות
drop policy if exists budget_snapshots_read on public.budget_snapshots;
create policy budget_snapshots_read on public.budget_snapshots for select to authenticated
  using (authority_code = any((select public.budget_full_codes())::text[])
         or exists (select 1 from unnest((select public.budget_owner_cards())::text[]) c where c like authority_code || ':%'));
drop policy if exists budget_snapshot_monthly_read on public.budget_snapshot_monthly;
create policy budget_snapshot_monthly_read on public.budget_snapshot_monthly for select to authenticated
  using (exists (select 1 from public.budget_snapshots s where s.id = snapshot_id
                  and (s.authority_code = any((select public.budget_full_codes())::text[])
                       or (s.authority_code || ':' || card_code) = any((select public.budget_owner_cards())::text[]))));

-- ───────────────────────────────────────────────────────────────
-- 2. היסטוריית הצפי והתכנית
-- ───────────────────────────────────────────────────────────────
create table if not exists public.budget_plan_history (
  id             bigint generated always as identity primary key,
  authority_code text not null references public.authorities(code) on delete cascade,
  card_code      text not null,
  fiscal_year    int not null,
  field          text not null check (field in ('forecast_income', 'forecast_expense', 'next_income', 'next_expense')),
  old_value      numeric,
  new_value      numeric,
  -- ריק = מהקובץ (התוספתיים) או מסקריפט. מנהל־על — בלי מייל (כמו 044)
  changed_by     uuid references public.users(id) on delete set null,
  changed_email  text,
  changed_at     timestamptz not null default now()
);
create index if not exists budget_plan_history_idx on public.budget_plan_history (authority_code, fiscal_year, changed_at desc);

create or replace function public.budget_plan_history_log() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_email text;
begin
  begin
    select case when role = 'super_admin' then null else email end into v_email from users where id = auth.uid();
    if tg_op = 'INSERT' then
      insert into budget_plan_history (authority_code, card_code, fiscal_year, field, old_value, new_value, changed_by, changed_email)
      select new.authority_code, new.card_code, new.fiscal_year, x.f, null, x.n, auth.uid(), v_email
        from (values ('forecast_income', new.forecast_income), ('forecast_expense', new.forecast_expense),
                     ('next_income', new.next_income), ('next_expense', new.next_expense)) x(f, n)
       where x.n is not null;
    else
      insert into budget_plan_history (authority_code, card_code, fiscal_year, field, old_value, new_value, changed_by, changed_email)
      select new.authority_code, new.card_code, new.fiscal_year, x.f, x.o, x.n, auth.uid(), v_email
        from (values ('forecast_income', old.forecast_income, new.forecast_income),
                     ('forecast_expense', old.forecast_expense, new.forecast_expense),
                     ('next_income', old.next_income, new.next_income),
                     ('next_expense', old.next_expense, new.next_expense)) x(f, o, n)
       where x.o is distinct from x.n;
    end if;
    -- תכנית שאושרה ונערכה — חוזרת לעבודה (§4)
    if tg_op = 'UPDATE' and (old.next_income is distinct from new.next_income or old.next_expense is distinct from new.next_expense) then
      delete from budget_plan_reviews
       where authority_code = new.authority_code and card_code = new.card_code and fiscal_year = new.fiscal_year and status = 'approved';
    end if;
  exception when others then
    raise warning 'budget_plan_history_log: % — השמירה ממשיכה', sqlerrm;
  end;
  return null;
end $$;

alter table public.budget_plan_history enable row level security;
drop policy if exists budget_plan_history_read on public.budget_plan_history;
create policy budget_plan_history_read on public.budget_plan_history for select to authenticated
  using (authority_code = any((select public.budget_full_codes())::text[])
         or (authority_code || ':' || card_code) = any((select public.budget_owner_cards())::text[]));

-- ───────────────────────────────────────────────────────────────
-- 3. חריגות לטיפול — "בדקתי" והערה
-- ───────────────────────────────────────────────────────────────
create table if not exists public.budget_exception_reviews (
  authority_code  text not null references public.authorities(code) on delete cascade,
  fiscal_year     int not null,
  period          text not null check (period in ('calendar', 'school')),
  -- כרטיס, או 'topic:<קוד>' לנושא מיתר
  card_code       text not null,
  kind            text not null,
  -- הערך שנבדק — השתנה ביותר מ-5% → החריגה חוזרת לטיפול (במסך)
  value_at_review numeric,
  note            text,
  reviewed_by     uuid references public.users(id) on delete set null,
  reviewed_email  text,
  reviewed_at     timestamptz not null default now(),
  primary key (authority_code, fiscal_year, period, card_code, kind)
);

-- מי ומתי — בטריגר, לא מהדפדפן
create or replace function public.budget_exception_stamp() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.reviewed_by := auth.uid();
  new.reviewed_email := (select case when role = 'super_admin' then null else email end from users where id = auth.uid());
  new.reviewed_at := now();
  return new;
end $$;
drop trigger if exists budget_exception_reviews_stamp on public.budget_exception_reviews;
create trigger budget_exception_reviews_stamp before insert or update on public.budget_exception_reviews
  for each row execute function public.budget_exception_stamp();

alter table public.budget_exception_reviews enable row level security;
drop policy if exists budget_exception_reviews_read on public.budget_exception_reviews;
create policy budget_exception_reviews_read on public.budget_exception_reviews for select to authenticated
  using (authority_code = any((select public.budget_full_codes())::text[])
         or (authority_code || ':' || card_code) = any((select public.budget_owner_cards())::text[]));
drop policy if exists budget_exception_reviews_insert on public.budget_exception_reviews;
create policy budget_exception_reviews_insert on public.budget_exception_reviews for insert to authenticated
  with check (authority_code = any((select public.budget_manage_codes())::text[])
              or (authority_code || ':' || card_code) = any((select public.budget_owner_cards())::text[]));
drop policy if exists budget_exception_reviews_update on public.budget_exception_reviews;
create policy budget_exception_reviews_update on public.budget_exception_reviews for update to authenticated
  using (authority_code = any((select public.budget_manage_codes())::text[])
         or (authority_code || ':' || card_code) = any((select public.budget_owner_cards())::text[]))
  with check (authority_code = any((select public.budget_manage_codes())::text[])
              or (authority_code || ':' || card_code) = any((select public.budget_owner_cards())::text[]));
drop policy if exists budget_exception_reviews_delete on public.budget_exception_reviews;
create policy budget_exception_reviews_delete on public.budget_exception_reviews for delete to authenticated
  using (authority_code = any((select public.budget_manage_codes())::text[])
         or (authority_code || ':' || card_code) = any((select public.budget_owner_cards())::text[]));

-- ───────────────────────────────────────────────────────────────
-- 4. אישור התכנית לשנה הבאה
-- ───────────────────────────────────────────────────────────────
-- אין שורה = בעבודה. כתיבה רק בפונקציות: אחראי מגיש, רק מנהל מאשר / מחזיר.
create table if not exists public.budget_plan_reviews (
  authority_code   text not null references public.authorities(code) on delete cascade,
  card_code        text not null,
  fiscal_year      int not null,
  status           text not null check (status in ('submitted', 'approved', 'returned')),
  comment          text,
  submitted_by     uuid references public.users(id) on delete set null,
  submitted_email  text,
  submitted_at     timestamptz,
  decided_by       uuid references public.users(id) on delete set null,
  decided_email    text,
  decided_at       timestamptz,
  primary key (authority_code, card_code, fiscal_year)
);

alter table public.budget_plan_reviews enable row level security;
drop policy if exists budget_plan_reviews_read on public.budget_plan_reviews;
create policy budget_plan_reviews_read on public.budget_plan_reviews for select to authenticated
  using (authority_code = any((select public.budget_full_codes())::text[])
         or (authority_code || ':' || card_code) = any((select public.budget_owner_cards())::text[]));

create or replace function public.budget_plan_submit(p_code text, p_card text, p_year int, p_comment text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_row budget_plan_reviews;
begin
  if not (p_code = any(budget_manage_codes()) or (p_code || ':' || p_card) = any(budget_owner_cards())) then
    raise exception 'אין לך הרשאה להגיש את התכנית של הכרטיס הזה';
  end if;
  select case when role = 'super_admin' then null else email end into v_email from users where id = auth.uid();
  insert into budget_plan_reviews (authority_code, card_code, fiscal_year, status, comment, submitted_by, submitted_email, submitted_at)
  values (p_code, p_card, p_year, 'submitted', nullif(btrim(coalesce(p_comment, '')), ''), auth.uid(), v_email, now())
  on conflict (authority_code, card_code, fiscal_year) do update
    set status = 'submitted', comment = excluded.comment, submitted_by = excluded.submitted_by,
        submitted_email = excluded.submitted_email, submitted_at = excluded.submitted_at,
        decided_by = null, decided_email = null, decided_at = null
  returning * into v_row;
  return to_jsonb(v_row) - 'submitted_by' - 'decided_by';
end $$;

create or replace function public.budget_plan_decide(p_code text, p_card text, p_year int, p_approve boolean, p_comment text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_email text;
  v_row budget_plan_reviews;
begin
  if not may_manage_budget(p_code) then
    raise exception 'רק מנהל התקציב מאשר או מחזיר תכנית';
  end if;
  if not p_approve and nullif(btrim(coalesce(p_comment, '')), '') is null then
    raise exception 'כדי להחזיר תכנית — יש לכתוב למה';
  end if;
  select case when role = 'super_admin' then null else email end into v_email from users where id = auth.uid();
  insert into budget_plan_reviews (authority_code, card_code, fiscal_year, status, comment, decided_by, decided_email, decided_at)
  values (p_code, p_card, p_year, case when p_approve then 'approved' else 'returned' end,
          nullif(btrim(coalesce(p_comment, '')), ''), auth.uid(), v_email, now())
  on conflict (authority_code, card_code, fiscal_year) do update
    set status = excluded.status,
        comment = coalesce(excluded.comment, budget_plan_reviews.comment),
        decided_by = excluded.decided_by, decided_email = excluded.decided_email, decided_at = excluded.decided_at
  returning * into v_row;
  return to_jsonb(v_row) - 'submitted_by' - 'decided_by';
end $$;

-- הטריגר של §2 (היסטוריה + ביטול אישור אחרי עריכה) — אחרי ש-budget_plan_reviews קיימת
drop trigger if exists budget_card_plans_history on public.budget_card_plans;
create trigger budget_card_plans_history after insert or update on public.budget_card_plans
  for each row execute function public.budget_plan_history_log();

revoke all on function public.budget_plan_submit(text, text, int, text) from public, anon;
grant execute on function public.budget_plan_submit(text, text, int, text) to authenticated;
revoke all on function public.budget_plan_decide(text, text, int, boolean, text) from public, anon;
grant execute on function public.budget_plan_decide(text, text, int, boolean, text) to authenticated;

-- ───────────────────────────────────────────────────────────────
-- 5. פרטיות: תנועות בכרטיסי שכר — לא לאחראי תקציב
-- ───────────────────────────────────────────────────────────────
-- כרטיס הוצאה (הספרה השנייה 6–9, כמו incomeByCode ב-budgetCalc) שסוג ההוצאה
-- שלו — שלוש הספרות האחרונות — 100–199: שכר ונלוות, במבנה האחיד של התקציב
-- ברשויות. במנשה 110–116 הם כולם "שכר…"/"משכורות" (נבדק 21.10).
create or replace function public.budget_is_salary(card text) returns boolean
language sql immutable as $$
  select card ~ '^\d{10}$' and substr(card, 2, 1)::int > 5 and right(card, 3) between '100' and '199'
$$;

drop policy if exists budget_transactions_read on public.budget_transactions;
create policy budget_transactions_read on public.budget_transactions for select to authenticated
  using (authority_code = any((select public.budget_full_codes())::text[])
         or ((authority_code || ':' || card_code) = any((select public.budget_owner_cards())::text[])
             and not public.budget_is_salary(card_code)));

-- הסיכומים החודשיים נשארים לאחראי גם בכרטיסי שכר: definer, וההרשאה כאן במפורש
-- — אותו תנאי כמו קריאת הכרטיסים (045), בלי ההגבלה של התנועות
create or replace function public.budget_monthly(p_code text, p_from date, p_to date)
returns table (card_code text, month date, debit numeric, credit numeric)
language sql stable security definer set search_path = public
as $$
  select t.card_code,
         date_trunc('month', t.event_date)::date,
         coalesce(sum(t.debit), 0),
         coalesce(sum(t.credit), 0)
    from public.budget_transactions t
   where t.authority_code = p_code
     -- auth.uid() ריק = חיבור ישיר / service_role (סקריפטים) — כמו לפני 049. anon חסום
     -- מהפונקציה (revoke), כך שזה לא פותח אותה לאורח
     and (auth.uid() is null
          or p_code = any(public.budget_full_codes())
          or (p_code || ':' || t.card_code) = any(public.budget_owner_cards()))
     and not t.is_opening
     and t.event_date >= p_from
     and t.event_date <  p_to
   group by 1, 2;
$$;
revoke all on function public.budget_monthly(text, date, date) from public, anon;
grant execute on function public.budget_monthly(text, date, date) to authenticated;
