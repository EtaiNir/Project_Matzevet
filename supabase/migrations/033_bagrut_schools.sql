-- ═══════════════════════════════════════════════════════════════
-- 033 — רשימת בתי הספר בבגרות: סמל ושם
-- ═══════════════════════════════════════════════════════════════
-- עד עכשיו בית ספר "נוצר" מהסבב הראשון שלו, והשם נלקח מהקבצים (SchoolName
-- בפרטי התלמידים, או הכותרת של T1 המאוחד). לכן לא היה איפה לקבוע שם כשמוסיפים
-- בית ספר, ושם שהגיע מהקובץ ("אגיאל") לא היה אפשר לתקן.
--
-- עכשיו: בית ספר נרשם עם סמל ושם כבר כשמוסיפים אותו (אייל, 11.10). השם כאן
-- גובר על השם שבקבצים — בכל המסכים, וגם בסבבים שהסוכן טוען מעכשיו.
-- ראה docs/decisions/016.
--
-- טבלה משותפת לכל הרשויות, כמו שאר טבלאות הבגרות (014 §2).

create table if not exists public.bagrut_schools (
  authority_code  text not null references public.authorities(code) on delete cascade,
  school_code     text not null check (school_code ~ '^\d+$'),
  school_name     text not null check (length(btrim(school_name)) > 0),
  created_at      timestamptz not null default now(),
  created_by      uuid references public.users(id) on delete set null,   -- מלכודת 24
  updated_at      timestamptz not null default now(),
  primary key (authority_code, school_code)
);

-- מי ומתי — בטריגר במסד, לא בדפדפן (כמו בטבלאות המעקב, 029)
create or replace function public.bagrut_schools_stamp()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.created_by := coalesce(auth.uid(), new.created_by);
    new.created_at := now();
  end if;
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists bagrut_schools_stamp on public.bagrut_schools;
create trigger bagrut_schools_stamp before insert or update on public.bagrut_schools
  for each row execute function public.bagrut_schools_stamp();

-- ── RLS: קריאה — מי שרואה את בית הספר; כתיבה — מנהל־על (כמו הסבבים, 026)
alter table public.bagrut_schools enable row level security;

drop policy if exists bagrut_schools_read   on public.bagrut_schools;
drop policy if exists bagrut_schools_insert on public.bagrut_schools;
drop policy if exists bagrut_schools_update on public.bagrut_schools;
drop policy if exists bagrut_schools_delete on public.bagrut_schools;

create policy bagrut_schools_read on public.bagrut_schools for select to authenticated
  using (public.has_authority(authority_code) and public.bagrut_school_visible(school_code));
create policy bagrut_schools_insert on public.bagrut_schools for insert to authenticated
  with check (public.is_super_admin());
create policy bagrut_schools_update on public.bagrut_schools for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());
create policy bagrut_schools_delete on public.bagrut_schools for delete to authenticated
  using (public.is_super_admin());

grant select, insert, update, delete on public.bagrut_schools to authenticated;

-- ── מילוי ראשוני: כל בית ספר שכבר יש לו סבב, עם השם מהסבב האחרון שלו
insert into public.bagrut_schools (authority_code, school_code, school_name)
select distinct on (authority_code, school_code)
       authority_code, school_code, coalesce(nullif(btrim(school_name), ''), 'מוסד ' || school_code)
  from public.bagrut_rounds
 order by authority_code, school_code, created_at desc
on conflict (authority_code, school_code) do nothing;
