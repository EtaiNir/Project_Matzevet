-- ═══════════════════════════════════════════════════════════════
-- 040 — חשיפת תעודות זהות לפי רמת הרשאה (20.10)
-- ═══════════════════════════════════════════════════════════════
-- מנהל־על בוחר, לכל רמת הרשאה, אם היא רואה תעודות זהות — של התלמיד ושל
-- ההורים. במצבת וגם בבגרות.
--
-- ⚠️ **זו הסתרה במסך ובייצוא, לא הרשאה במסד** (בחירת המפתח, 20.10: "במסך
-- ובייצוא — עכשיו"). ה-API עדיין מחזיר את ת"ז לכל מי שרואה את השורה, כי ת"ז
-- היא המפתח של כל טבלאות הרשות (העמודות התוספתיות, הטבלאות הייעודיות, זיהוי
-- אחים) — הסתרה במסד דורשת להחליף אותה במזהה פנימי. מלכודת 16 חלה: מי שיודע
-- לפנות ל-API ישירות יקבל אותה. האכיפה במסד — שלב נפרד, בתכנון מול אייל.
--
-- ברירת המחדל: הכול גלוי — כמו עד היום. שום דבר לא משתנה עד שמנהל־על מכבה.
-- מנהל־על עצמו רואה תמיד (אינו ברשימה).

create table if not exists public.id_visibility (
  level       text primary key check (level in (
                'm_admin', 'm_council', 'm_locality', 'm_school',
                'b_council', 'b_coordinator', 'b_principal', 'b_grade', 'b_subject', 'b_homeroom')),
  visible     boolean not null default true,
  updated_at  timestamptz not null default now(),
  -- מלכודת 24: on delete set null
  updated_by  uuid references public.users(id) on delete set null
);

insert into public.id_visibility (level)
values ('m_admin'), ('m_council'), ('m_locality'), ('m_school'),
       ('b_council'), ('b_coordinator'), ('b_principal'), ('b_grade'), ('b_subject'), ('b_homeroom')
on conflict (level) do nothing;

alter table public.id_visibility enable row level security;

-- קריאה: כל משתמש מאומת — המסכים שלו צריכים לדעת מה להציג. אין בה נתון אישי.
drop policy if exists id_visibility_read on public.id_visibility;
create policy id_visibility_read on public.id_visibility for select to authenticated
  using (true);

-- עדכון: מנהל־על בלבד. אין insert/delete — הרשימה קבועה (מלכודת 28: using + with check).
drop policy if exists id_visibility_update on public.id_visibility;
create policy id_visibility_update on public.id_visibility for update to authenticated
  using (public.is_super_admin()) with check (public.is_super_admin());

-- מי ומתי — בטריגר, לא מהדפדפן
create or replace function public.id_visibility_stamp()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists id_visibility_stamp on public.id_visibility;
create trigger id_visibility_stamp before update on public.id_visibility
  for each row execute function public.id_visibility_stamp();

-- ═══════════════════════════════════════════════════════════════
-- בדיקה לפני החלה (בטרנזקציה שמגולגלת לאחור, כמשתמש מאומת):
--   1. משתמש רגיל: select מחזיר 10 שורות; update → 0 שורות (מלכודת 21)
--   2. מנהל־על: update visible=false ל-m_school → שורה אחת, updated_by = הוא
--   3. insert/delete דרך ה-API → נחסם
-- ═══════════════════════════════════════════════════════════════
