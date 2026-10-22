-- ═══════════════════════════════════════════════════════════════
-- 048 — המיתר: סיכום לכל run × נושא × מוסד — ההיסטוריה מהירה (החלטה 024)
-- ═══════════════════════════════════════════════════════════════
-- אחרי מילוי ההיסטוריה (22.10): 112,040 שורות מיתר לשנה אחת, ו-meitar_months
-- של המועצה לקח 4.7 שניות כ-postgres — ותחת RLS, עם statement_timeout של 8 שניות
-- ל-authenticated, הוא היה נכשל בשנה השנייה. כל שנה מוסיפה ~100 אלף שורות.
--
-- meitar_run_topics: שורה לכל run × נושא × מוסד × שנה"ל קודמת — מאות שורות לחודש
-- במקום אלפים. הטוען ממלא אותה אחרי כל קליטה (load_budget.py), והיא נמחקת עם
-- ה-run (cascade). meitar_months קורא ממנה.

create table if not exists public.meitar_run_topics (
  run_id           uuid not null references public.meitar_runs(id) on delete cascade,
  authority_code   text not null references public.authorities(code) on delete cascade,
  topic_code       text not null,
  institution_code text not null default '',     -- '' = שורות בלי מוסד (יישוב / רשות)
  prior_year       boolean not null,
  computed         numeric not null default 0,
  computed_prev    numeric not null default 0,
  diff             numeric not null default 0,
  row_count        int not null default 0,
  primary key (run_id, topic_code, institution_code, prior_year)
);
create index if not exists meitar_run_topics_inst_idx
  on public.meitar_run_topics (authority_code, institution_code);
comment on table public.meitar_run_topics is
  'סיכום meitar_rows לכל run × נושא × מוסד × שנה"ל קודמת — בלי קבצי המשרות והפירוט הכפול. נכתב ע"י הטוען';

-- מה נספר: בלי קבצים בלי סכומים ובלי פירוט כפול (זהה ל-NO_MONEY בטוען)
create or replace function public.meitar_refresh_run_topics(p_run uuid)
returns void
language sql
as $$
  delete from public.meitar_run_topics where run_id = p_run;
  insert into public.meitar_run_topics (run_id, authority_code, topic_code, institution_code, prior_year,
                                        computed, computed_prev, diff, row_count)
  select r.run_id, r.authority_code, r.topic_code, coalesce(r.institution_code, ''), r.prior_year,
         coalesce(sum(r.computed), 0), coalesce(sum(r.computed_prev), 0), coalesce(sum(r.diff), 0), count(*)
    from public.meitar_rows r
   where r.run_id = p_run
     and r.topic_code is not null
     and r.source_file not in ('MISROT', 'MISROTGY', 'ICHLUSKITOT', 'HASNET', 'HASMASLULIM', 'RICUZMOSDOT')
   group by 1, 2, 3, 4, 5;
$$;
-- רק הטוען (חיבור ישיר) — לא דרך ה-API
revoke all on function public.meitar_refresh_run_topics(uuid) from public, anon, authenticated;

-- מילוי לכל ה-runs הקיימים
do $$
declare r record;
begin
  for r in select u.id from public.meitar_runs u
            where not exists (select 1 from public.meitar_run_topics t where t.run_id = u.id) loop
    perform public.meitar_refresh_run_topics(r.id);
  end loop;
end $$;

alter table public.meitar_run_topics enable row level security;
drop policy if exists meitar_run_topics_read   on public.meitar_run_topics;
drop policy if exists meitar_run_topics_insert on public.meitar_run_topics;
drop policy if exists meitar_run_topics_update on public.meitar_run_topics;
drop policy if exists meitar_run_topics_delete on public.meitar_run_topics;
create policy meitar_run_topics_read on public.meitar_run_topics for select to authenticated
  using (authority_code = any((select public.budget_full_codes())::text[]));
create policy meitar_run_topics_insert on public.meitar_run_topics for insert to authenticated with check (false);
create policy meitar_run_topics_update on public.meitar_run_topics for update to authenticated using (false) with check (false);
create policy meitar_run_topics_delete on public.meitar_run_topics for delete to authenticated using (false);

-- ההיסטוריה — מהסיכום. מועצה: ה-runs של המקור; בית ספר: שורות המוסד מכל runs הרשות
create or replace function public.meitar_months(p_code text, p_entity text, p_school_year int,
                                                p_institution text default null)
returns table (calc_month date, topic_code text, computed numeric, computed_prev numeric,
               diff numeric, prior_diff numeric, row_count bigint)
language sql stable security invoker set search_path = public
as $$
  select u.calc_month, t.topic_code,
         coalesce(sum(t.computed)      filter (where not t.prior_year), 0),
         coalesce(sum(t.computed_prev) filter (where not t.prior_year), 0),
         coalesce(sum(t.diff)          filter (where not t.prior_year), 0),
         coalesce(sum(t.diff)          filter (where t.prior_year), 0),
         sum(t.row_count)::bigint
    from public.meitar_run_topics t
    join public.meitar_runs u on u.id = t.run_id
   where u.authority_code = p_code
     and u.calc_month >= make_date(p_school_year - 1, 9, 1)
     and u.calc_month <  make_date(p_school_year, 9, 1)
     and p_institution is null and u.entity_code = p_entity
   group by 1, 2
  union all
  select u.calc_month, t.topic_code,
         coalesce(sum(t.computed)      filter (where not t.prior_year), 0),
         coalesce(sum(t.computed_prev) filter (where not t.prior_year), 0),
         coalesce(sum(t.diff)          filter (where not t.prior_year), 0),
         coalesce(sum(t.diff)          filter (where t.prior_year), 0),
         sum(t.row_count)::bigint
    from public.meitar_run_topics t
    join public.meitar_runs u on u.id = t.run_id
   where t.authority_code = p_code and t.institution_code = p_institution
     and u.calc_month >= make_date(p_school_year - 1, 9, 1)
     and u.calc_month <  make_date(p_school_year, 9, 1)
   group by 1, 2;
$$;
grant execute on function public.meitar_months(text, text, int, text) to authenticated;
