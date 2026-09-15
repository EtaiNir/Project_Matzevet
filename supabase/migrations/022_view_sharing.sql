-- מיגרציה 022: שיתוף טבלאות ייעודיות ותיקיות לפי אימייל
--
-- מיגרציה 021 עשתה את הרשימות אישיות, וזה היה נכון: סרגל שמציג את
-- הרשימות של חמישה עמיתים הוא רעש. אבל "אישי" ו"אפשר לשתף" אינם
-- סותרים — ההבדל הוא **מי מחליט**. קודם כולם ראו הכול כברירת מחדל;
-- כאן היוצר בוחר עם מי, ומה מותר לו.
--
-- ═══════════════════════════════════════════════════════════════
-- שלוש דרגות, ולא שתיים
-- ═══════════════════════════════════════════════════════════════
--
--   בעלוּת   היוצר. שינוי שם, העברה בין תיקיות, מחיקה, ושיתוף.
--   עריכה    רואה את הרשימה, ומוסיף ומסיר ממנה תלמידים.
--   צפייה    רואה את הרשימה בלבד.
--
-- למה לא רק "משותף/לא משותף": רשימת הסעות שעמית רואה אבל אינו יכול
-- להוסיף אליה היא חצי פיצ'ר, ורשימה שכל מי שקיבל אותה יכול למחוק היא
-- מלכודת. מחיקה נשארת אצל היוצר גם כשניתנה עריכה.
--
-- **מילוי ערכים בעמודות התוספתיות אינו נשלט מכאן.** הוא נקבע ב-
-- `may_edit_extra` לפי ההרשאה ברשות, כי העמודות הן של הרשות ולא של
-- הרשימה (מיגרציה 016). מי שרשאי לסמן "טופל" — רשאי גם בטבלה ששותפה
-- איתו, ומי שאינו רשאי לא יוכל גם ברשימה שהוא עצמו יצר.

create table if not exists public.view_shares (
  id          uuid primary key default gen_random_uuid(),
  -- בדיוק אחד מהשניים. שיתוף תיקייה גורר את כל מה שבתוכה, לעומק.
  view_id     uuid references public.saved_views(id)  on delete cascade,
  folder_id   uuid references public.view_folders(id) on delete cascade,
  shared_with uuid not null references public.users(id) on delete cascade,
  shared_by   uuid          references public.users(id) on delete set null,
  can_edit    boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint view_shares_one_target check (num_nonnulls(view_id, folder_id) = 1)
);

create unique index if not exists view_shares_view_uniq
  on public.view_shares (view_id, shared_with) where view_id is not null;
create unique index if not exists view_shares_folder_uniq
  on public.view_shares (folder_id, shared_with) where folder_id is not null;
create index if not exists view_shares_with_idx
  on public.view_shares (shared_with);

comment on table public.view_shares is
  'מי שותף לאילו טבלאות ייעודיות ותיקיות. שיתוף תיקייה גורר את תוכנה לעומק.';

-- כל הכתיבה עוברת בפונקציות שלמטה, שבודקות בעלות ומאתרות לפי אימייל.
-- אין מדיניות INSERT/UPDATE/DELETE בכוונה: לקוח לא כותב לכאן ישירות.
alter table public.view_shares enable row level security;

drop policy if exists view_shares_read on public.view_shares;
create policy view_shares_read on public.view_shares
  for select to authenticated
  using (shared_with = auth.uid() or shared_by = auth.uid());

-- ═══════════════════════════════════════════════════════════════
-- א. אילו תיקיות הגיעו אליי דרך שיתוף
-- ═══════════════════════════════════════════════════════════════
-- רקורסיה כלפי מטה: תיקייה ששותפה + כל צאצאיה. `security definer`
-- הוא **חובה** כאן, לא נוחות — הפונקציה נקראת מתוך המדיניות על
-- `view_folders`, ובלי עקיפת RLS זו הייתה רקורסיה אינסופית.

create or replace function public.shared_folder_ids(require_edit boolean default false)
returns setof uuid
language sql
stable
security definer set search_path = public
as $$
  with recursive roots as (
    select s.folder_id as id
      from public.view_shares s
     where s.shared_with = auth.uid()
       and s.folder_id is not null
       and (not require_edit or s.can_edit)
  ),
  tree as (
    select id from roots
    union
    select f.id from public.view_folders f join tree t on f.parent_id = t.id
  )
  select id from tree;
$$;

grant execute on function public.shared_folder_ids(boolean) to authenticated;

/** האם מותר לי לראות את הרשימה — כיוצר, בשיתוף ישיר, או דרך תיקייה. */
create or replace function public.may_see_view(view_uuid uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.saved_views v
     where v.id = view_uuid
       and (
         v.created_by = auth.uid()
         or exists (select 1 from public.view_shares s
                     where s.view_id = v.id and s.shared_with = auth.uid())
         or v.folder_id in (select public.shared_folder_ids(false))
       )
  );
$$;

/** האם מותר לי לשנות את הרכב הרשימה. מחיקת הרשימה עצמה נשארת ליוצר. */
create or replace function public.may_edit_view(view_uuid uuid)
returns boolean
language sql
stable
security definer set search_path = public
as $$
  select exists (
    select 1 from public.saved_views v
     where v.id = view_uuid
       and (
         v.created_by = auth.uid()
         or exists (select 1 from public.view_shares s
                     where s.view_id = v.id and s.shared_with = auth.uid() and s.can_edit)
         or v.folder_id in (select public.shared_folder_ids(true))
       )
  );
$$;

grant execute on function public.may_see_view(uuid) to authenticated;
grant execute on function public.may_edit_view(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- ב. הקריאה נפתחת למשותפים. הבעלוּת לא זזה.
-- ═══════════════════════════════════════════════════════════════

drop policy if exists view_folders_read on public.view_folders;
create policy view_folders_read on public.view_folders
  for select to authenticated
  using (
    public.has_authority(authority_code)
    and (created_by = auth.uid() or id in (select public.shared_folder_ids(false)))
  );

drop policy if exists saved_views_read on public.saved_views;
create policy saved_views_read on public.saved_views
  for select to authenticated
  using (
    public.has_authority(authority_code)
    and (
      created_by = auth.uid()
      or exists (select 1 from public.view_shares s
                  where s.view_id = saved_views.id and s.shared_with = auth.uid())
      or folder_id in (select public.shared_folder_ids(false))
    )
  );

-- UPDATE ו-DELETE נשארים כפי שהיו: יוצר בלבד. מי שקיבל עריכה משנה
-- את **הרכב** הרשימה, לא את הרשימה עצמה — שם, תיקייה או קיום.

-- ═══════════════════════════════════════════════════════════════
-- ג. החברוּת — מי מוסיף ומסיר תלמידים
-- ═══════════════════════════════════════════════════════════════
-- המדיניות עוברת ל-`may_edit_view`, כדי ששינוי עתידי בכללי השיתוף
-- לא יחייב לבנות מחדש מדיניות בכל רשות.
--
-- `may_edit_extra` יצא מכאן: הוא ההרשאה למלא **ערכים בעמודות**, ולא
-- לשנות הרכב של רשימה של מישהו אחר. הוא נכנס לשם ב-017 כשהרשימות היו
-- של הרשות; מאז 021 הן אישיות, וזה הפך להרשאה על משהו שאינו נראה.

create or replace function public._ensure_extra_table(target_code text)
returns text
language plpgsql
security definer set search_path = public
as $$
declare
  tbl     text;
  main    text;
  members text;
  scope   text;
begin
  tbl     := 'students_' || target_code || '_extra';
  main    := 'students_' || target_code;
  members := 'students_' || target_code || '_view_members';

  if to_regclass('public.' || quote_ident(main)) is null then
    raise exception 'הטבלה הראשית של רשות % אינה קיימת', target_code;
  end if;

  -- ── הטבלה התוספתית ──
  if to_regclass('public.' || quote_ident(tbl)) is null then
    execute format($f$
      create table public.%I (
        "MISPAR_ZEHUT" text primary key,
        data           jsonb not null default '{}'::jsonb,
        updated_at     timestamptz not null default now(),
        updated_by     uuid references public.users(id) on delete set null
      )$f$, tbl);

    execute format('alter table public.%I enable row level security', tbl);

    scope := format(
      'public.has_authority(%L) and exists (
         select 1 from public.%I s
          where s."MISPAR_ZEHUT" = public.%I."MISPAR_ZEHUT"
            and public.in_user_scope(s."SEMEL_YISHUV1", s."SEMEL_MOSAD"))',
      target_code, main, tbl);

    execute format(
      'create policy %I on public.%I for select to authenticated using (%s)',
      tbl || '_read', tbl, scope);
    execute format(
      'create policy %I on public.%I for insert to authenticated
         with check (%s and public.may_edit_extra(%L))',
      tbl || '_insert', tbl, scope, target_code);
    execute format(
      'create policy %I on public.%I for update to authenticated
         using (%s and public.may_edit_extra(%L)) with check (%s)',
      tbl || '_update', tbl, scope, target_code, scope);
    execute format(
      'create policy %I on public.%I for delete to authenticated
         using (%s and public.may_edit_extra(%L))',
      tbl || '_delete', tbl, scope, target_code);
  end if;

  -- ── טבלת החברוּת ──
  if to_regclass('public.' || quote_ident(members)) is null then
    execute format($f$
      create table public.%I (
        view_id        uuid not null references public.saved_views(id) on delete cascade,
        "MISPAR_ZEHUT" text not null,
        added_at       timestamptz not null default now(),
        added_by       uuid references public.users(id) on delete set null,
        primary key (view_id, "MISPAR_ZEHUT")
      )$f$, members);

    execute format(
      'create index if not exists %I on public.%I (view_id)',
      members || '_view_idx', members);

    execute format('alter table public.%I enable row level security', members);
  end if;

  -- המדיניות נבנית בכל קריאה, לא רק ביצירה: כך שינוי בכללי השיתוף
  -- מגיע גם לרשויות שהטבלה שלהן כבר קיימת.
  scope := format(
    'public.has_authority(%L) and exists (
       select 1 from public.%I s
        where s."MISPAR_ZEHUT" = public.%I."MISPAR_ZEHUT"
          and public.in_user_scope(s."SEMEL_YISHUV1", s."SEMEL_MOSAD"))',
    target_code, main, members);

  execute format('drop policy if exists %I on public.%I', members || '_read', members);
  execute format(
    'create policy %I on public.%I for select to authenticated
       using (%s and exists (select 1 from public.saved_views v where v.id = view_id))',
    members || '_read', members, scope);

  execute format('drop policy if exists %I on public.%I', members || '_insert', members);
  execute format(
    'create policy %I on public.%I for insert to authenticated
       with check (%s and public.may_edit_view(view_id))',
    members || '_insert', members, scope);

  execute format('drop policy if exists %I on public.%I', members || '_delete', members);
  execute format(
    'create policy %I on public.%I for delete to authenticated
       using (%s and public.may_edit_view(view_id))',
    members || '_delete', members, scope);

  return tbl;
end;
$$;

comment on function public._ensure_extra_table(text) is
  'יוצרת בעצלתיים את הטבלה התוספתית ואת טבלת החברוּת של רשות, ומרעננת את מדיניות החברוּת.';

-- החלת המדיניות החדשה על הרשויות שכבר קיימות
do $$
declare
  a record;
begin
  for a in select code from public.authorities loop
    if to_regclass('public.' || quote_ident('students_' || a.code)) is not null then
      perform public._ensure_extra_table(a.code);
    end if;
  end loop;
end;
$$;

-- ═══════════════════════════════════════════════════════════════
-- ד. הוספת תלמידים — עוברת לאותו כלל
-- ═══════════════════════════════════════════════════════════════

create or replace function public.add_students_to_view(
  view_uuid uuid,
  ids       text[]
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  v       public.saved_views%rowtype;
  members text;
  main    text;
  added   int := 0;
  total   int := 0;
begin
  select * into v from public.saved_views where id = view_uuid;
  if not found then
    raise exception 'הטבלה הייעודית אינה קיימת';
  end if;
  if not public.has_authority(v.authority_code) then
    raise exception 'אין לך גישה לרשות הזו';
  end if;
  if not public.may_edit_view(view_uuid) then
    raise exception 'הטבלה הייעודית אינה שלך, ולא שותפה איתך להרשאת עריכה';
  end if;

  members := 'students_' || v.authority_code || '_view_members';
  main    := 'students_' || v.authority_code;
  if to_regclass('public.' || quote_ident(members)) is null then
    perform public._ensure_extra_table(v.authority_code);
  end if;

  execute format(
    'insert into public.%I (view_id, "MISPAR_ZEHUT", added_by)
     select $1, s."MISPAR_ZEHUT", $2
       from public.%I s
      where s."MISPAR_ZEHUT" = any($3)
     on conflict do nothing',
    members, main)
  using view_uuid, auth.uid(), ids;
  get diagnostics added = row_count;

  execute format('select count(*) from public.%I where view_id = $1', members)
    into total using view_uuid;

  return jsonb_build_object('added', added, 'total', total);
end;
$$;

grant execute on function public.add_students_to_view(uuid, text[]) to authenticated;

-- ═══════════════════════════════════════════════════════════════
-- ה. הפעולות שהממשק קורא להן
-- ═══════════════════════════════════════════════════════════════
-- הכתיבה עוברת בפונקציות ולא במדיניות, משתי סיבות: `public.users`
-- סגורה לקריאה (משתמש רואה רק את עצמו), ולכן איתור לפי אימייל חייב
-- `security definer`; והבדיקה שהנמען בכלל שייך לרשות אינה משהו שכדאי
-- לסמוך עליו שהלקוח יעשה.

/** בעלוּת: רק היוצר משתף, מבטל שיתוף ורואה את רשימת השותפים. */
create or replace function public._assert_share_owner(p_view uuid, p_folder uuid)
returns text
language plpgsql
stable
security definer set search_path = public
as $$
declare
  code text;
begin
  if num_nonnulls(p_view, p_folder) <> 1 then
    raise exception 'יש לציין טבלה ייעודית או תיקייה — אחת מהן בדיוק';
  end if;

  if p_view is not null then
    select authority_code into code from public.saved_views
     where id = p_view and created_by = auth.uid();
  else
    select authority_code into code from public.view_folders
     where id = p_folder and created_by = auth.uid();
  end if;

  if code is null then
    raise exception 'רק מי שיצר את הפריט יכול לשתף אותו';
  end if;
  return code;
end;
$$;

create or replace function public.list_shares(
  p_view   uuid default null,
  p_folder uuid default null
)
returns table (
  id           uuid,
  email        text,
  display_name text,
  can_edit     boolean,
  created_at   timestamptz
)
language plpgsql
stable
security definer set search_path = public
as $$
begin
  perform public._assert_share_owner(p_view, p_folder);
  return query
    select s.id, u.email, u.display_name, s.can_edit, s.created_at
      from public.view_shares s
      join public.users u on u.id = s.shared_with
     where (p_view   is not null and s.view_id   = p_view)
        or (p_folder is not null and s.folder_id = p_folder)
     order by u.email;
end;
$$;

create or replace function public.share_item(
  p_email    text,
  p_view     uuid    default null,
  p_folder   uuid    default null,
  p_can_edit boolean default false
)
returns jsonb
language plpgsql
security definer set search_path = public
as $$
declare
  code   text;
  target public.users%rowtype;
begin
  code := public._assert_share_owner(p_view, p_folder);

  select * into target from public.users
   where lower(email) = lower(btrim(p_email));
  if not found then
    raise exception 'לא נמצא משתמש עם האימייל %', btrim(p_email);
  end if;
  if target.id = auth.uid() then
    raise exception 'הפריט כבר שלך';
  end if;
  -- הנמען חייב גישה לאותה רשות. בלי זה היינו משתפים רשימת תעודות
  -- זהות של מועצה עם מי שאינו רשאי לראות אותה בכלל.
  if target.role <> 'super_admin' and not (code = any(target.authority_codes)) then
    raise exception 'המשתמש % אינו משויך לרשות הזו', btrim(p_email);
  end if;

  -- שני ענפים ולא אחד: לטבלה ולתיקייה יש אינדקס ייחודי **חלקי** נפרד,
  -- ו-on conflict חייב להצביע על האינדקס הנכון. שיתוף חוזר לאותו אדם
  -- מעדכן את ההרשאה במקום להיכשל — זו הדרך לשנות צפייה לעריכה.
  if p_view is not null then
    insert into public.view_shares (view_id, shared_with, shared_by, can_edit)
    values (p_view, target.id, auth.uid(), coalesce(p_can_edit, false))
    on conflict (view_id, shared_with) where view_id is not null
      do update set can_edit = excluded.can_edit;
  else
    insert into public.view_shares (folder_id, shared_with, shared_by, can_edit)
    values (p_folder, target.id, auth.uid(), coalesce(p_can_edit, false))
    on conflict (folder_id, shared_with) where folder_id is not null
      do update set can_edit = excluded.can_edit;
  end if;

  return jsonb_build_object(
    'email', target.email,
    'display_name', target.display_name,
    'can_edit', coalesce(p_can_edit, false)
  );
end;
$$;

create or replace function public.unshare_item(p_share_id uuid)
returns void
language plpgsql
security definer set search_path = public
as $$
declare
  sh public.view_shares%rowtype;
begin
  select * into sh from public.view_shares where id = p_share_id;
  if not found then
    return;
  end if;
  perform public._assert_share_owner(sh.view_id, sh.folder_id);
  delete from public.view_shares where id = p_share_id;
end;
$$;

/**
 * מה שותף **איתי**, ועל ידי מי.
 *
 * הסרגל צריך את זה כדי לסמן פריט ששייך למישהו אחר ולהסתיר ממנו את
 * פעולות הבעלוּת. בלי הפונקציה הזו הלקוח היה רואה `created_by` של
 * משתמש שהוא אינו רשאי לקרוא מ-`users`, ולא היה יודע לתרגם אותו לשם.
 */
create or replace function public.shared_with_me(p_code text)
returns table (
  kind        text,
  item_id     uuid,
  owner_email text,
  owner_name  text,
  can_edit    boolean
)
language sql
stable
security definer set search_path = public
as $$
  select
    case when s.view_id is not null then 'view' else 'folder' end,
    coalesce(s.view_id, s.folder_id),
    u.email,
    u.display_name,
    s.can_edit
  from public.view_shares s
  join public.users u on u.id = s.shared_by
  left join public.saved_views  v on v.id = s.view_id
  left join public.view_folders f on f.id = s.folder_id
  where s.shared_with = auth.uid()
    and coalesce(v.authority_code, f.authority_code) = p_code;
$$;

grant execute on function public.list_shares(uuid, uuid)               to authenticated;
grant execute on function public.share_item(text, uuid, uuid, boolean) to authenticated;
grant execute on function public.unshare_item(uuid)                    to authenticated;
grant execute on function public.shared_with_me(text)                  to authenticated;
