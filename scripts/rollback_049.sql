-- ביטול מיגרציה 049 (תקציב: מעקב ותכנון) — אם הוחלט לוותר על הרעיונות.
-- להריץ בעורך ה-SQL של Supabase, או: psql -f scripts/rollback_049.sql
-- מחזיר את מדיניות הקריאה של התנועות ואת budget_monthly בדיוק כמו ב-045,
-- ומוחק את כל מה ש-049 יצר. שום נתון של 045/046 אינו נוגע.
begin;

drop trigger if exists budget_cards_snapshot on public.budget_cards;
drop trigger if exists budget_transactions_snapshot on public.budget_transactions;
drop trigger if exists budget_card_plans_history on public.budget_card_plans;

drop function if exists public.budget_plan_submit(text, text, int, text);
drop function if exists public.budget_plan_decide(text, text, int, boolean, text);
drop function if exists public.budget_snapshot_cards();
drop function if exists public.budget_snapshot_transactions();
drop function if exists public.budget_plan_history_log();

drop table if exists public.budget_snapshot_monthly;
drop table if exists public.budget_snapshots;
drop table if exists public.budget_plan_history;
drop table if exists public.budget_exception_reviews;
drop function if exists public.budget_exception_stamp();
drop table if exists public.budget_plan_reviews;

-- 045, כמו שהיה
drop policy if exists budget_transactions_read on public.budget_transactions;
create policy budget_transactions_read on public.budget_transactions for select to authenticated
  using (authority_code = any((select public.budget_full_codes())::text[])
         or (authority_code || ':' || card_code) = any((select public.budget_owner_cards())::text[]));

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

drop function if exists public.budget_is_salary(text);

commit;
