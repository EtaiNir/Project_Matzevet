-- ═══════════════════════════════════════════════════════════════
-- 041 — מנוע הזכאות לבגרות: עדכון ציון מחשב מחדש את כל מה שנגזר ממנו
-- ═══════════════════════════════════════════════════════════════
-- אייל, 20.10: מנהל־על ורכז/ת בגרויות (כולל מנהל/ת בית ספר) מעדכנים ציון של
-- תלמיד, וכל מה שנשען עליו מחושב מחדש — לפי הציון החדש, חוקת הזכאות, השאלונים
-- ומבנה הבגרות של בית הספר. ההחלטה: decisions/021. מחליף את "זכאות רק לפי T2"
-- (014 §8): המנוע קובע, וניתוח הזכאות של סבא נשמר להשוואה.
--
-- ═══════════════════════════════════════════════════════════════
-- איך
-- ═══════════════════════════════════════════════════════════════
--   · **הערכים המחושבים נכתבים לעמודות הקיימות** (status, blockers, total_units,
--     final_grade…). כך כל מי שקורא אותן — המסכים, הייצוא, תמונת המצב, פונקציית
--     ה-AI — מקבל את המחושב בלי שינוי. המקור נשמר פעם אחת, לפני החישוב הראשון:
--     ניתוח הזכאות ב-bagrut_students.t2_original, עיבוד הציונים ב-
--     bagrut_subjects.t1_original. קליטת סבב חדשה מוחקת ויוצרת — והתמונה מתחדשת.
--   · שלוש שכבות, כל אחת מהקודמת:
--       1. מקצוע — מציוני השאלונים: ציון מצטבר, משקל מצטבר, ציון סופי, מצב השלמה
--       2. זכאות — מהציונים הסופיים: יח"ל, מלל, מוגבר, חובה, שליליים, שלילי אחד
--          ושיפוי → סטטוס, חסמים, התערבות, הסיכומים
--       3. מצטיינת וטק — מהזכאות ומהמקצועות
--     אחוזי השכבה ובית הספר נספרים מהתלמידים בכל טעינה — אין להם עותק שמתיישן.
--   · הכללים — docs/bagrut-eligibility-rules.md, ומה שנלמד מהניתוח של סבא (סף
--     "מלל" = סכום יח"ל מקצועות החובה; מורחב מחליף את מקצוע החובה שבו; מורחב בלי
--     יח"ל = 5). נבדק מול שלושת בתי הספר: סטטוס 100%, ציון סופי 100%.
--   · **דגלים אדומים** (bagrut_flags): כל מקום שבו המנוע אינו מסכים עם הקבצים —
--     **רק בנתון שלא נערך באתר**. תלמיד שציון שלו עודכן — צפוי שיהיה שונה.
--   · עדכון ציון: bagrut_edit_field בלבד (038), עכשיו רק למנהל־על ולרכז/ת
--     בגרויות. ציון שאלון, משקל, יח"ל — ובאותה טרנזקציה החישוב מחדש. ציון סופי
--     ידני — רק במקצוע בלי שאלונים. שדות מחושבים אינם ניתנים לעריכה.
--
-- ⚠️ הטעינה (scripts/load_bagrut.py) קוראת ל-bagrut_recompute_round בסוף. סבב
-- שנטען בגרסה ישנה — מסומן במסך, ומנהל־על מריץ את החישוב בלחיצה.

-- ── 1. עמודות
alter table public.bagrut_students
  add column if not exists t2_original            jsonb,
  add column if not exists calc_at                timestamptz,
  add column if not exists calc_kind              text,
  add column if not exists core_required          numeric,
  add column if not exists honors_english         numeric,
  add column if not exists honors_math            numeric,
  add column if not exists honors_sci_tech        text,
  add column if not exists honors_average         numeric,
  add column if not exists honors_average_units   numeric,
  add column if not exists honors_excellence      boolean,
  add column if not exists honors_tech            boolean,
  add column if not exists honors_tech_no_english boolean;

alter table public.bagrut_subjects
  add column if not exists t1_original     jsonb,
  -- מה המנוע עצמו אומר על השלמת המקצוע — להשוואה (הסטטוס שבשימוש: completion_status)
  add column if not exists calc_completion text;

-- ── 2. דגלים אדומים
create table if not exists public.bagrut_flags (
  id                uuid primary key default gen_random_uuid(),
  round_id          uuid not null references public.bagrut_rounds(id) on delete cascade,
  student_id        text not null,
  -- null = שדה של התלמיד (ניתוח הזכאות); אחרת — מקצוע (עיבוד הציונים)
  subject_key       text,
  field             text not null,
  source            text not null check (source in ('t1', 't2')),
  source_value      text,
  calc_value        text,
  status            text not null default 'open' check (status in ('open', 'reviewed')),
  note              text,
  -- מלכודת 24
  reviewed_by       uuid references public.users(id) on delete set null,
  reviewed_by_email text,
  reviewed_at       timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique nulls not distinct (round_id, student_id, subject_key, field)
);

alter table public.bagrut_flags enable row level security;

-- קריאה: מי שרואה את התלמיד (כמו bagrut_manual_edits). כתיבה — רק בפונקציות.
drop policy if exists bagrut_flags_read on public.bagrut_flags;
create policy bagrut_flags_read on public.bagrut_flags for select to authenticated
  using (exists (select 1 from public.bagrut_students s
                 where s.round_id = bagrut_flags.round_id
                   and s.student_id = bagrut_flags.student_id));

-- ── 3. עזרים
create or replace function public.bagrut_norm(p text) returns text
language sql immutable as $$
  select btrim(regexp_replace(regexp_replace(coalesce(p, ''), '["״׳'']', '', 'g'), '\s+', ' ', 'g'))
$$;

-- "אנגלית 4 יח"ל" → "אנגלית": משפחת רמות של אותו מקצוע
create or replace function public.bagrut_family(p text) returns text
language sql immutable as $$
  select case when n like 'אנגלית%' then 'אנגלית'
              when n like 'מתמטיקה%' then 'מתמטיקה'
              else btrim(regexp_replace(n, '\s*\d\s*(יחל)?$', '')) end
  from (select public.bagrut_norm(p) as n) x
$$;

-- "עברית מורחב לערבים" → "עברית לערבים"
create or replace function public.bagrut_base_of_extended(p text) returns text
language sql immutable as $$
  select btrim(regexp_replace(replace(public.bagrut_norm(p), 'מורחב', ''), '\s+', ' ', 'g'))
$$;

-- מספר לטקסט בלי אפסים מיותרים: 96.0 → "96"
create or replace function public.bagrut_num(p numeric) returns text
language sql immutable as $$ select trim_scale(p)::text $$;

create or replace function public.bagrut_try_num(p text) returns numeric
language plpgsql immutable as $$
begin
  return nullif(btrim(p), '')::numeric;
exception when others then
  return null;
end $$;

-- סטטוס טקסט → אחד משלושה (כמו eligibilityKind ב-lib/bagrut.ts)
create or replace function public.bagrut_kind_of(p text) returns text
language sql immutable as $$
  select case when p is null then null
              when p like '%אין זכאות%' then 'not_eligible'
              when p like '%שלילי אחד%' then 'one_negative'
              when p like '%זכאי%' then 'eligible'
              else 'not_eligible' end
$$;

-- סוגי החסמים בטקסט (כמו parseBlockers ב-lib/bagrut.ts) — להשוואה
create or replace function public.bagrut_blocker_kinds(p text) returns text[]
language sql immutable as $$
  select coalesce(array_agg(distinct k order by k), '{}') from (
    select case
             when x like 'חסרים מקצועות חובה%' then 'missing_required'
             when x like '%יח"ל מלל%' then 'core_units'
             when x ~ '^חסרות [0-9.]+ יח"ל' then 'units'
             when x like '%מוגבר%' then 'no_reinforced'
             when x like '%שליל%' then 'negatives'
             else 'other' end as k
    from (select btrim(t) as x from unnest(string_to_array(coalesce(p, ''), ';')) t) y
    where x <> '' and x not like 'לא אותרו חסמים%') z
$$;

-- Z-11 — סף השיפוי לפי רמות שני המקצועות
create or replace function public.bagrut_comp_threshold(a numeric, b numeric) returns numeric
language sql immutable as $$
  select case when lo = 5 and hi = 5 then 140 when lo = 4 and hi = 5 then 144
              when lo = 3 and hi = 5 then 146 when lo = 4 and hi = 4 then 146
              when lo = 3 and hi = 4 then 148 when lo = 3 and hi = 3 then 150 end
  from (select least(a, b) as lo, greatest(a, b) as hi) x
$$;

-- ── 4. שכבה 1: מקצוע מציוני השאלונים
--   · מקצוע בלי שאלונים — הציון מעיבוד הציונים (או מתיקון ידני) נשאר כמו שהוא.
--   · המשקלים של התלמיד עצמו גוברים על המצפן (המצפן מסמן שקולים אחרת בכל בית ספר,
--     ובחלקו שגוי). מעל 100% (נבחן בשתי חלופות) — נבחרת קבוצה אחת: הכי קרובה ל-100%
--     בלי לעבור אותו, אחר כך יותר שאלונים, אחר כך הציון הגבוה. שקולים במצפן — לכל
--     היותר אחד מכל קבוצה. ציון 1–4 נספר כמספר.
--   · בלי משקלים — לפי המצפן: קבוצת שקולים = יחידה אחת, הציון הטוב בה נספר.
create or replace function public.bagrut_calc_subject(p_round uuid, p_student text, p_subject text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_rows   integer;
  v_codes  integer[];
  v_gr     numeric[];
  v_w      numeric[];
  v_n      integer;
  v_own    boolean;
  v_prog   integer;
  v_fg     numeric[] := '{}';
  v_fw     numeric[] := '{}';
  v_fa     text[] := '{}';
  v_m      integer;
  v_mask   integer;
  v_i      integer;
  v_sw     numeric;
  v_cnt    integer;
  v_ss     numeric;
  v_clash  boolean;
  v_seen   text[];
  v_bw     numeric := 0;
  v_bn     integer := 0;
  v_bs     numeric := 0;
  v_wt     numeric := 0;
  v_wd     numeric := 0;
  v_sum    numeric := 0;
  v_final  numeric;
  v_cum    numeric;
  v_cw     numeric;
  v_comp   text;
  v_engine text;
  v_t1     jsonb;
  r        record;
begin
  select count(*) into v_rows from bagrut_grades
   where round_id = p_round and student_id = p_student and subject_key = p_subject;
  if v_rows = 0 then return; end if;

  select array_agg(questionnaire_code order by questionnaire_code),
         array_agg(grade order by questionnaire_code),
         array_agg(weight order by questionnaire_code)
    into v_codes, v_gr, v_w
    from bagrut_grades
   where round_id = p_round and student_id = p_student and subject_key = p_subject and grade is not null;
  v_n := coalesce(array_length(v_codes, 1), 0);
  v_own := v_n > 0 and coalesce((select bool_and(x is not null) from unnest(v_w) x), false);
  select count(*) into v_prog from bagrut_program where round_id = p_round and subject_key = p_subject;

  if v_own or v_prog = 0 then
    if v_n = 0 then
      v_final := null; v_cum := null; v_cw := null; v_comp := 'טרם החל';
    else
      for v_i in 1 .. v_n loop
        if coalesce(v_w[v_i], 0) > 0 and coalesce(array_length(v_fg, 1), 0) < 16 then
          v_fg := v_fg || v_gr[v_i];
          v_fw := v_fw || v_w[v_i];
          v_fa := v_fa || (select alt_group::text from bagrut_program
                            where round_id = p_round and subject_key = p_subject
                              and questionnaire_code = v_codes[v_i] and alt_group is not null limit 1);
        end if;
      end loop;
      v_m := coalesce(array_length(v_fg, 1), 0);
      if v_m > 0 then
        for v_mask in 1 .. (1 << v_m) - 1 loop
          v_sw := 0; v_cnt := 0; v_ss := 0; v_clash := false; v_seen := '{}';
          for v_i in 1 .. v_m loop
            if ((v_mask >> (v_i - 1)) & 1) = 1 then
              if v_fa[v_i] is not null then
                if v_fa[v_i] = any (v_seen) then v_clash := true; exit; end if;
                v_seen := v_seen || v_fa[v_i];
              end if;
              v_sw := v_sw + v_fw[v_i];
              v_cnt := v_cnt + 1;
              v_ss := v_ss + v_fg[v_i] * v_fw[v_i];
            end if;
          end loop;
          continue when v_clash or v_sw > 1.000001;
          if v_sw > v_bw + 0.000001
             or (abs(v_sw - v_bw) <= 0.000001 and (v_cnt > v_bn or (v_cnt = v_bn and v_ss > v_bs))) then
            v_bw := v_sw; v_bn := v_cnt; v_bs := v_ss;
          end if;
        end loop;
      end if;
      if v_bn = 0 then
        -- נבחן רק בשאלונים במשקל 0 — כך בעיבוד הציונים: מצטבר 0, בתהליך
        v_final := null; v_cum := 0; v_cw := 0; v_comp := 'בתהליך';
      else
        v_cum := round(v_bs, 2); v_cw := round(v_bw, 4);
        if v_bw >= 0.99 then v_final := round(v_bs); v_comp := 'הושלם';
        else v_final := null; v_comp := 'בתהליך'; end if;
      end if;
    end if;
  else
    for r in
      select coalesce('g' || p.alt_group::text, 'q' || p.questionnaire_code::text) as unit_key,
             (array_agg(p.weight order by p.sort))[1] as unit_w,
             max(g.grade) as unit_best
        from bagrut_program p
        left join bagrut_grades g
          on g.round_id = p_round and g.student_id = p_student and g.subject_key = p_subject
         and g.questionnaire_code = p.questionnaire_code and g.grade is not null
       where p.round_id = p_round and p.subject_key = p_subject
       group by 1
    loop
      v_wt := v_wt + coalesce(r.unit_w, 0);
      if r.unit_best is not null then
        v_wd := v_wd + coalesce(r.unit_w, 0);
        v_sum := v_sum + r.unit_best * coalesce(r.unit_w, 0);
      end if;
    end loop;
    if v_wd = 0 then
      v_final := null; v_cum := null; v_cw := null; v_comp := 'טרם החל';
    else
      v_cum := round(v_sum, 2); v_cw := round(v_wd, 4);
      if v_wt > 0 and v_wd >= v_wt - 0.000001 then v_final := round(v_sum); v_comp := 'הושלם';
      else v_final := null; v_comp := 'בתהליך'; end if;
    end if;
  end if;

  -- האם המקצוע הושלם — תלוי באילו שאלונים נבחן, לא בציון. כל עוד קבוצת השאלונים
  -- שיש להם ציון לא השתנתה, הקביעה של עיבוד הציונים עומדת: הוא מכיר את כל דרישות
  -- המקצוע, והמצפן לא תמיד (באגיאל — מדעי הסביבה ומדעי המחשב "בתהליך" במשקל 100%).
  -- עדכון ציון משנה את הערך; הוספת ציון לשאלון שלא היה — משנה גם את ההשלמה.
  -- כשהמנוע חושב אחרת — דגל אדום (completion_status).
  v_engine := v_comp;
  select t1_original into v_t1 from bagrut_subjects
   where round_id = p_round and student_id = p_student and subject_key = p_subject;
  if v_t1->>'completion_status' in ('הושלם', 'בתהליך', 'טרם החל', 'ללא חישוב')
     and (v_t1->'graded') = coalesce(to_jsonb(v_codes), '[]'::jsonb) then
    v_comp := v_t1->>'completion_status';
    if v_comp = 'הושלם' then
      v_final := case when v_cum is not null then round(v_cum) end;
    elsif v_comp = 'ללא חישוב' then
      v_final := null; v_cum := null; v_cw := null;
    else
      v_final := null;
    end if;
  end if;

  update bagrut_subjects
     set final_grade = v_final, cumulative_grade = v_cum, cumulative_weight = v_cw,
         completion_status = v_comp, calc_completion = v_engine
   where round_id = p_round and student_id = p_student and subject_key = p_subject;
end $$;

-- ── 5. שכבה 2: זכאות מהציונים הסופיים (Z-1…Z-18). המקצועות הפנימיים — מחוץ לחישוב
create or replace function public.bagrut_calc_eligibility(p_round uuid, p_student text)
returns void language plpgsql security definer set search_path = public as $$
declare
  k text[]; nm text[]; grp text[]; bu numeric[]; un numeric[]; fin numeric[];
  fam text[] := '{}'; uf numeric[] := '{}'; pas boolean[] := '{}'; exm boolean[] := '{}';
  ext integer[] := '{}'; isext boolean[] := '{}';
  v_n integer; i integer; j integer; v_f text; v_pos integer;
  v_neg integer[] := '{}';
  v_fk text[] := '{}'; v_fv numeric[] := '{}';
  v_total numeric := 0; v_core numeric := 0; v_core_req numeric := 0;
  v_reinf text[] := '{}'; v_missing text[] := '{}'; v_still text[] := '{}';
  v_mother integer; v_arab boolean := false;
  v_one text := 'אין ציון שלילי'; v_pair text; v_allowed boolean := false; v_label text;
  v_a integer; v_b integer; v_ba integer; v_bb integer; v_bsum numeric; v_bneed numeric; v_need numeric;
  v_blk text[] := '{}'; v_int text[] := '{}';
  v_kind text; v_req_total integer := 0; v_req_passed integer := 0;
  v_internal text; v_grades text; v_done text; v_mt text;
begin
  select array_agg(rs.subject_key order by rs.sort, rs.subject_key),
         array_agg(rs.subject_name order by rs.sort, rs.subject_key),
         array_agg(rs.subject_group order by rs.sort, rs.subject_key),
         array_agg(rs.units order by rs.sort, rs.subject_key),
         array_agg(coalesce(sr.units, rs.units) order by rs.sort, rs.subject_key),
         array_agg(sr.final_grade order by rs.sort, rs.subject_key)
    into k, nm, grp, bu, un, fin
    from bagrut_round_subjects rs
    left join bagrut_subjects sr
      on sr.round_id = rs.round_id and sr.subject_key = rs.subject_key and sr.student_id = p_student
   where rs.round_id = p_round and rs.subject_group <> 'פנימי';
  v_n := coalesce(array_length(k, 1), 0);
  if v_n = 0 then return; end if;

  for i in 1 .. v_n loop
    fam[i] := bagrut_family(nm[i]);
    -- מורחב בלי יח"ל ידועות — 5 (מהניתוח של סבא)
    uf[i] := coalesce(un[i], case when grp[i] = 'מורחב' then 5 else 0 end);
    pas[i] := fin[i] is not null and fin[i] >= 55;
    exm[i] := fin[i] is not null;
    ext[i] := null;
    isext[i] := false;
  end loop;

  -- המורחב של מקצוע חובה: לפי השם או המפתח, אחרי הסרת "מורחב"
  for i in 1 .. v_n loop
    if grp[i] = 'מורחב' and (nm[i] || k[i]) like '%מורחב%' then
      for j in 1 .. v_n loop
        if grp[j] = 'חובה'
           and (bagrut_norm(nm[j]) in (bagrut_base_of_extended(nm[i]), bagrut_base_of_extended(k[i]))
                or bagrut_norm(k[j]) in (bagrut_base_of_extended(nm[i]), bagrut_base_of_extended(k[i]))) then
          if ext[j] is not null then isext[ext[j]] := false; end if;
          ext[j] := i;
          isext[i] := true;
          exit;
        end if;
      end loop;
    end if;
  end loop;

  -- שפת אם: ערבית במגזר הערבי, אחרת עברית
  for i in 1 .. v_n loop
    if bagrut_norm(nm[i]) = 'ערבית לערבים' then v_arab := true; v_mother := i; exit; end if;
  end loop;
  if not v_arab then
    for i in 1 .. v_n loop
      if grp[i] = 'חובה' and bagrut_norm(nm[i]) = 'עברית' then v_mother := i; exit; end if;
    end loop;
  end if;

  -- שליליים: ציון סופי מתחת ל-55 (גם 1–4). מקצוע חובה שהמורחב שלו עבר — לא שלילי
  for i in 1 .. v_n loop
    if fin[i] is not null and fin[i] < 55 and not (ext[i] is not null and pas[ext[i]]) then
      v_neg := v_neg || i;
    end if;
  end loop;

  -- יח"ל: מקצוע שעבר; משפחת רמות — הגבוהה; מורחב מחליף את מקצוע החובה שבו
  for i in 1 .. v_n loop
    continue when not pas[i];
    continue when ext[i] is not null and pas[ext[i]];
    v_f := case when isext[i] then k[i] else fam[i] end;
    v_pos := array_position(v_fk, v_f);
    if v_pos is null then v_fk := v_fk || v_f; v_fv := v_fv || uf[i];
    else v_fv[v_pos] := greatest(v_fv[v_pos], uf[i]); end if;
  end loop;
  select coalesce(sum(x), 0) into v_total from unnest(v_fv) x;

  -- מלל: הסף = סכום יח"ל מקצועות החובה; מורחב שעבר נספר ביח"ל שלו
  for i in 1 .. v_n loop
    continue when grp[i] <> 'חובה';
    v_core_req := v_core_req + coalesce(bu[i], 0);
    v_req_total := v_req_total + 1;
    if ext[i] is not null and pas[ext[i]] then
      v_core := v_core + uf[ext[i]];
      v_req_passed := v_req_passed + 1;
    elsif pas[i] then
      v_core := v_core + coalesce(bu[i], 0);
      v_req_passed := v_req_passed + 1;
    end if;
  end loop;

  -- מוגבר (Z-2): 5 יח"ל שעבר, לא אנגלית (Z-5)
  for i in 1 .. v_n loop
    if pas[i] and uf[i] >= 5 and fam[i] <> 'אנגלית' then
      v_reinf := v_reinf || (nm[i] || ' ' || bagrut_num(fin[i]));
    end if;
  end loop;

  -- חובה (Z-1): "חסר" = לא נבחן בכלל. מי שנבחן ונכשל — בשליליים
  for i in 1 .. v_n loop
    if grp[i] = 'חובה' and not exm[i] and not (ext[i] is not null and exm[ext[i]]) then
      v_missing := v_missing || nm[i];
    end if;
  end loop;
  foreach v_f in array array['אנגלית', 'מתמטיקה'] loop
    if v_f = any (fam) then
      v_req_total := v_req_total + 1;
      if not exists (select 1 from generate_subscripts(fam, 1) s where fam[s] = v_f and exm[s]) then
        v_missing := v_missing || v_f;
      end if;
      if exists (select 1 from generate_subscripts(fam, 1) s where fam[s] = v_f and pas[s]) then
        v_req_passed := v_req_passed + 1;
      end if;
    end if;
  end loop;

  -- שלילי אחד (Z-7) או שיפוי (Z-9…Z-11)
  if cardinality(v_neg) = 1 then
    i := v_neg[1];
    v_label := nm[i] || ' ' || bagrut_num(fin[i]);
    if i = v_mother then
      v_one := 'לא — ' || v_label || ', שפת אם אינה יכולה להיות שלילית';
    elsif fin[i] >= 45 then
      v_allowed := true;
      v_one := 'כן — ' || v_label || ', שלילי יחיד בטווח 45–54';
    elsif fin[i] >= 5 then
      for v_a in 1 .. v_n loop
        continue when v_a = i or not pas[v_a] or uf[v_a] < 3;
        for v_b in v_a + 1 .. v_n loop
          continue when v_b = i or not pas[v_b] or uf[v_b] < 3;
          v_need := bagrut_comp_threshold(least(5, uf[v_a]), least(5, uf[v_b]));
          continue when v_need is null or fin[v_a] + fin[v_b] < v_need;
          if v_ba is null or fin[v_a] + fin[v_b] - v_need > v_bsum - v_bneed then
            v_ba := v_a; v_bb := v_b; v_bsum := fin[v_a] + fin[v_b]; v_bneed := v_need;
          end if;
        end loop;
      end loop;
      if v_ba is not null then
        v_allowed := true;
        v_pair := nm[v_ba] || ' (' || bagrut_num(fin[v_ba]) || ') + ' || nm[v_bb] || ' (' || bagrut_num(fin[v_bb]) || ')';
        v_one := 'כן — ' || v_label || ', קומפנסציה ' || bagrut_num(v_bsum) || '/' || bagrut_num(v_bneed);
      else
        v_one := 'לא — ' || v_label || ', חסרות נקודות קומפנסציה';
      end if;
    else
      v_one := 'לא — ' || v_label || ', הציון נמוך מטווח השלילי המותר';
    end if;
  elsif cardinality(v_neg) > 1 then
    v_one := 'לא עומד בתנאי שלילי אחד';
  end if;

  -- שלילי מותר: מקצוע החובה שבו נחשב "נבחן"
  foreach v_f in array v_missing loop
    if not (v_allowed and (v_f = nm[v_neg[1]] or v_f = fam[v_neg[1]])) then v_still := v_still || v_f; end if;
  end loop;

  -- חסמים — באותה תבנית של ניתוח הזכאות, ומהם ההתערבות
  if cardinality(v_still) > 0 then
    v_blk := v_blk || ('חסרים מקצועות חובה: ' || array_to_string(v_still, ', '));
    v_int := v_int || ('להשלים: ' || array_to_string(v_still, ', '));
  end if;
  if cardinality(v_neg) > 1 or (cardinality(v_neg) = 1 and not v_allowed) then
    v_int := v_int || ('לשפר שלילי: ' || (select string_agg(nm[x], ', ' order by o) from unnest(v_neg) with ordinality u(x, o)));
  end if;
  if v_total < 21 then
    v_blk := v_blk || ('חסרות ' || bagrut_num(21 - v_total) || ' יח"ל לסף 21');
    v_int := v_int || ('להוסיף ' || bagrut_num(21 - v_total) || ' יח"ל עוברות');
  end if;
  if v_core < v_core_req
     and not (v_allowed and grp[v_neg[1]] = 'חובה' and v_core + coalesce(un[v_neg[1]], 0) >= v_core_req) then
    v_blk := v_blk || ('חסרות ' || bagrut_num(v_core_req - v_core) || ' יח"ל מלל לסף ' || bagrut_num(v_core_req));
    v_int := v_int || ('להשלים ' || bagrut_num(v_core_req - v_core) || ' יח"ל מלל');
  end if;
  if cardinality(v_reinf) = 0 then
    v_blk := v_blk || 'לא אותר מקצוע מוגבר שעבר'::text;
    v_int := v_int || 'להשלים מקצוע מוגבר בן 5 יח"ל'::text;
  end if;
  if cardinality(v_neg) > 1 or (cardinality(v_neg) = 1 and not v_allowed) then
    v_blk := v_blk || ('ציונים שליליים: ' ||
      (select string_agg(nm[x] || ' ' || bagrut_num(fin[x]), ', ' order by o) from unnest(v_neg) with ordinality u(x, o)));
  end if;

  v_kind := case when cardinality(v_blk) > 0 then 'not_eligible' when v_allowed then 'one_negative' else 'eligible' end;

  -- הסיכומים — כמו בניתוח הזכאות
  select string_agg(rs.subject_name, ', ' order by rs.sort) into v_internal
    from bagrut_round_subjects rs
    join bagrut_subjects sr on sr.round_id = rs.round_id and sr.subject_key = rs.subject_key and sr.student_id = p_student
   where rs.round_id = p_round and rs.subject_group = 'פנימי' and sr.final_grade >= 55;
  select string_agg(rs.subject_name || ' (' || bagrut_num(sr.final_grade) || ')', ' ; ' order by rs.sort) into v_grades
    from bagrut_round_subjects rs
    join bagrut_subjects sr on sr.round_id = rs.round_id and sr.subject_key = rs.subject_key and sr.student_id = p_student
   where rs.round_id = p_round and sr.final_grade is not null;
  v_done := v_req_passed || '/' || v_req_total || ' מקצועות חובה עברו; ' || bagrut_num(v_total) || ' יח"ל'
         || case when cardinality(v_reinf) > 0 then '; מוגבר: ' || array_to_string(v_reinf, ', ') else '' end
         || case when v_internal is not null then '; פנימיים: ' || v_internal else '' end;
  v_mt := case when v_mother is null then null
               when fin[v_mother] is null then 'חסר ציון סופי'
               when pas[v_mother] then 'עבר (' || bagrut_num(fin[v_mother]) || ')'
               else 'לא עבר (' || bagrut_num(fin[v_mother]) || ')' end;

  update bagrut_students set
    calc_kind = v_kind,
    status = case v_kind when 'eligible' then 'זכאי — בכפוף לדרישות פנימיות'
                         when 'one_negative' then 'זכאי במסלול שלילי אחד — בכפוף לדרישות פנימיות'
                         else 'אין זכאות' end,
    total_units = bagrut_num(v_total),
    core_units = v_core,
    core_required = v_core_req,
    negatives_count = cardinality(v_neg),
    blockers = case when cardinality(v_blk) = 0 then 'לא אותרו חסמים' else array_to_string(v_blk, '; ') end,
    intervention = case when cardinality(v_int) = 0 then 'בדיקת מעורבות חברתית ודרישות פנימיות' else array_to_string(v_int, '; ') end,
    one_negative_option = v_one,
    compensation_pair = v_pair,
    mother_tongue_status = v_mt,
    reinforced_subject = case when cardinality(v_reinf) = 0 then 'לא אותר' else array_to_string(v_reinf, ', ') end,
    done_summary = v_done,
    grades_summary = v_grades
  where round_id = p_round and student_id = p_student;
end $$;

-- ── 6. שכבה 3: בגרות מצטיינת וטק (decisions/019) — כמו lib/bagrutHonors.ts.
-- מקצוע "עבר" = ציון סופי 55+, כולל פנימיים; יח"ל — של התלמיד, אחרת של המקצוע
create or replace function public.bagrut_calc_honors(p_round uuid, p_student text)
returns void language plpgsql security definer set search_path = public as $$
declare
  v_en numeric; v_ma numeric; v_sci text; v_sum numeric; v_units numeric; v_avg numeric; v_ok boolean;
begin
  select max(u) filter (where nm like 'אנגלית%'),
         max(u) filter (where nm like 'מתמטיקה%'),
         (array_agg(nm order by key) filter (where nm ~ '^(פיסיקה|פיזיקה|מדעי המחשב)' and u >= 5))[1],
         sum(fg * u), sum(u)
    into v_en, v_ma, v_sci, v_sum, v_units
    from (select sr.subject_key as key, coalesce(rs.subject_name, sr.subject_key) as nm,
                 sr.final_grade as fg, coalesce(sr.units, rs.units) as u
            from bagrut_subjects sr
            left join bagrut_round_subjects rs on rs.round_id = sr.round_id and rs.subject_key = sr.subject_key
           where sr.round_id = p_round and sr.student_id = p_student and sr.final_grade >= 55) x
   where u is not null;
  v_avg := case when coalesce(v_units, 0) > 0 then round(v_sum / v_units, 2) end;
  select calc_kind in ('eligible', 'one_negative') into v_ok
    from bagrut_students where round_id = p_round and student_id = p_student;
  v_ok := coalesce(v_ok, false);
  update bagrut_students set
    honors_english = v_en, honors_math = v_ma, honors_sci_tech = v_sci,
    honors_average = v_avg, honors_average_units = coalesce(v_units, 0),
    honors_excellence = v_ok and coalesce(v_en, 0) >= 5 and coalesce(v_ma, 0) >= 4 and coalesce(v_avg, 0) >= 90,
    honors_tech = v_ok and coalesce(v_ma, 0) >= 5 and v_sci is not null and coalesce(v_en, 0) >= 5,
    honors_tech_no_english = v_ok and coalesce(v_ma, 0) >= 5 and v_sci is not null
  where round_id = p_round and student_id = p_student;
end $$;

-- ── 7. דגלים: איפה המנוע אינו מסכים עם הקבצים — רק בנתון שלא נערך באתר.
-- "נערך" = ציון שאלון, משקל, יח"ל או ציון סופי ידני. תלמיד שנערך — אין דגלי
-- זכאות; מקצוע שנערך — אין דגל במקצוע.
create or replace function public.bagrut_flag_candidates(p_round uuid, p_student text)
returns table (subject_key text, field text, source text, source_value text, calc_value text)
language sql stable security definer set search_path = public as $$
  with edited as (
    select e.subject_key from bagrut_manual_edits e
     where e.round_id = p_round and e.student_id = p_student
       and (e.target = 'grade' or (e.target = 'subject' and e.field in ('units', 'final_grade')))
  ),
  o as (
    select s.*, s.t2_original as t from bagrut_students s
     where s.round_id = p_round and s.student_id = p_student and s.in_t2
       and s.t2_original is not null and s.calc_kind is not null
       and not exists (select 1 from edited)
  )
  select null::text, 'status', 't2', t->>'status', status from o
   where bagrut_kind_of(t->>'status') is distinct from calc_kind
  union all
  select null, 'total_units', 't2', t->>'total_units', total_units from o
   where bagrut_try_num(t->>'total_units') is distinct from bagrut_try_num(total_units)
  union all
  select null, 'core_units', 't2', t->>'core_units', bagrut_num(core_units) from o
   where bagrut_try_num(t->>'core_units') is distinct from core_units
  union all
  select null, 'negatives_count', 't2', t->>'negatives_count', negatives_count::text from o
   where bagrut_try_num(t->>'negatives_count') is distinct from negatives_count::numeric
  union all
  select null, 'blockers', 't2', t->>'blockers', blockers from o
   where bagrut_blocker_kinds(t->>'blockers') is distinct from bagrut_blocker_kinds(blockers)
  union all
  select sr.subject_key, 'final_grade', 't1', bagrut_num(bagrut_try_num(sr.t1_original->>'final_grade')), bagrut_num(sr.final_grade)
    from bagrut_subjects sr
   where sr.round_id = p_round and sr.student_id = p_student and sr.t1_original is not null
     and exists (select 1 from bagrut_grades g where g.round_id = p_round and g.student_id = p_student and g.subject_key = sr.subject_key)
     and not exists (select 1 from edited e where e.subject_key = sr.subject_key)
     and bagrut_try_num(sr.t1_original->>'final_grade') is distinct from sr.final_grade
  union all
  select sr.subject_key, 'completion_status', 't1', sr.t1_original->>'completion_status', sr.calc_completion
    from bagrut_subjects sr
   where sr.round_id = p_round and sr.student_id = p_student and sr.t1_original is not null
     and sr.t1_original->>'completion_status' is not null and sr.calc_completion is not null
     and not exists (select 1 from edited e where e.subject_key = sr.subject_key)
     -- רק מחלוקת אמיתית: האם יש ציון סופי. "בתהליך" מול "ללא חישוב" — אותו דבר
     and ((sr.t1_original->>'completion_status') = 'הושלם') <> (sr.calc_completion = 'הושלם')
  union all
  select sr.subject_key, 'cumulative_grade', 't1', bagrut_num(bagrut_try_num(sr.t1_original->>'cumulative_grade')), bagrut_num(sr.cumulative_grade)
    from bagrut_subjects sr
   where sr.round_id = p_round and sr.student_id = p_student and sr.t1_original is not null
     and exists (select 1 from bagrut_grades g where g.round_id = p_round and g.student_id = p_student and g.subject_key = sr.subject_key)
     and not exists (select 1 from edited e where e.subject_key = sr.subject_key)
     and ((bagrut_try_num(sr.t1_original->>'cumulative_grade') is null) <> (sr.cumulative_grade is null)
          or abs(round(bagrut_try_num(sr.t1_original->>'cumulative_grade')) - round(sr.cumulative_grade)) > 1)
$$;

create or replace function public.bagrut_calc_flags(p_round uuid, p_student text)
returns void language plpgsql security definer set search_path = public as $$
begin
  delete from bagrut_flags f
   where f.round_id = p_round and f.student_id = p_student
     and not exists (select 1 from bagrut_flag_candidates(p_round, p_student) c
                      where c.subject_key is not distinct from f.subject_key and c.field = f.field);
  -- דגל שכבר נבדק נשאר "נבדק" כל עוד שני הערכים לא השתנו
  insert into bagrut_flags as f (round_id, student_id, subject_key, field, source, source_value, calc_value)
  select p_round, p_student, c.subject_key, c.field, c.source, c.source_value, c.calc_value
    from bagrut_flag_candidates(p_round, p_student) c
  on conflict (round_id, student_id, subject_key, field) do update set
    status = case when f.source_value is distinct from excluded.source_value
                    or f.calc_value is distinct from excluded.calc_value then 'open' else f.status end,
    reviewed_at = case when f.source_value is distinct from excluded.source_value
                         or f.calc_value is distinct from excluded.calc_value then null else f.reviewed_at end,
    source_value = excluded.source_value,
    calc_value = excluded.calc_value,
    updated_at = case when f.source_value is distinct from excluded.source_value
                        or f.calc_value is distinct from excluded.calc_value then now() else f.updated_at end;
end $$;

-- ── 8. תלמיד אחד, מקצה לקצה
create or replace function public.bagrut_calc_student(p_round uuid, p_student text)
returns void language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_in_t2 boolean;
begin
  -- המקור נשמר פעם אחת — לפני שהחישוב הראשון דורס אותו
  -- graded — השאלונים שהיה להם ציון בקובץ (ראה ההשלמה ב-bagrut_calc_subject)
  update bagrut_subjects sr set t1_original = jsonb_build_object(
           'final_grade', final_grade, 'cumulative_grade', cumulative_grade,
           'cumulative_weight', cumulative_weight, 'completion_status', completion_status,
           'graded', coalesce((select jsonb_agg(g.questionnaire_code order by g.questionnaire_code)
                                 from bagrut_grades g
                                where g.round_id = sr.round_id and g.student_id = sr.student_id
                                  and g.subject_key = sr.subject_key and g.grade is not null), '[]'::jsonb))
   where sr.round_id = p_round and sr.student_id = p_student and sr.t1_original is null;
  update bagrut_students set t2_original = jsonb_build_object(
           'status', status, 'total_units', total_units, 'core_units', core_units,
           'negatives_count', negatives_count, 'blockers', blockers, 'intervention', intervention,
           'one_negative_option', one_negative_option, 'compensation_pair', compensation_pair,
           'mother_tongue_status', mother_tongue_status, 'reinforced_subject', reinforced_subject,
           'done_summary', done_summary, 'grades_summary', grades_summary)
   where round_id = p_round and student_id = p_student and t2_original is null and in_t2;

  for r in select sr.subject_key from bagrut_subjects sr where sr.round_id = p_round and sr.student_id = p_student loop
    perform bagrut_calc_subject(p_round, p_student, r.subject_key);
  end loop;

  select in_t2 into v_in_t2 from bagrut_students where round_id = p_round and student_id = p_student;
  -- זכאות — לשכבה המסיימת (מי שיש לו ניתוח זכאות), כמו עד היום
  if coalesce(v_in_t2, false) then
    perform bagrut_calc_eligibility(p_round, p_student);
    perform bagrut_calc_honors(p_round, p_student);
  end if;
  perform bagrut_calc_flags(p_round, p_student);
  update bagrut_students set calc_at = now() where round_id = p_round and student_id = p_student;
end $$;

-- ── 9. סבב שלם — אחרי קליטה (הטעינה קוראת), או בלחיצה של מנהל־על
create or replace function public.bagrut_recompute_round(p_round uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r record;
  v_n integer := 0;
begin
  -- auth.uid() ריק = סקריפט הטעינה / מיגרציה (חיבור ישיר, לא דרך ה-API)
  if auth.uid() is not null and not exists (
       select 1 from users where id = auth.uid() and role = 'super_admin' and not is_suspended) then
    raise exception 'רק מנהל־על רשאי להריץ חישוב מחדש של סבב';
  end if;
  for r in select student_id from bagrut_students where round_id = p_round order by student_id loop
    perform bagrut_calc_student(p_round, r.student_id);
    v_n := v_n + 1;
  end loop;
  return jsonb_build_object('students', v_n,
    'flags', (select count(*) from bagrut_flags where round_id = p_round and status = 'open'));
end $$;

-- ── 10. מי מעדכן ציונים: מנהל־על, ורכז/ת בגרויות (כולל מנהל/ת בית ספר — 039) בתלמידים שהוא רואה
create or replace function public.may_edit_bagrut_grades(p_round uuid, p_student text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select not u.is_suspended
       and (u.role = 'super_admin'
            or (u.bagrut_role = 'coordinator'
                and exists (select 1 from bagrut_students s
                             where s.round_id = p_round and s.student_id = p_student
                               and has_authority(s.authority_code)
                               and bagrut_student_visible(p_round, p_student, s.school_code, s.grade, s.class_name, s.track))))
    from users u where u.id = auth.uid()), false);
$$;

-- ── 11. העריכה — מחליפה את 038: ציון / משקל / יח"ל, ומיד החישוב מחדש
create or replace function public.bagrut_edit_field(
  p_round uuid, p_student text, p_target text, p_subject text, p_questionnaire integer,
  p_field text, p_value text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_table text;
  v_type  text;
  v_where text;
  v_old   text;
  v_new   text := nullif(btrim(coalesce(p_value, '')), '');  -- תא ריק נשאר ריק
  v_num   numeric;
  v_rows  integer;
  v_email text;
begin
  if p_target = 'student' then
    raise exception 'פרטי הזכאות מחושבים מהציונים, מחוקת הזכאות וממבנה הבגרות — עדכנו את הציון, והם יתעדכנו';
  elsif p_target = 'subject' then
    if p_field in ('cumulative_grade', 'cumulative_weight', 'completion_status') then
      raise exception 'השדה מחושב מציוני השאלונים — עדכנו את ציון השאלון';
    end if;
    v_table := 'bagrut_subjects';
    v_type := case p_field when 'units' then 'numeric' when 'final_grade' then 'numeric' end;
    if p_subject is null or p_questionnaire is not null then v_type := null; end if;
    if p_field = 'final_grade' and exists (select 1 from bagrut_grades
        where round_id = p_round and student_id = p_student and subject_key = p_subject) then
      raise exception 'הציון הסופי מחושב מציוני השאלונים — עדכנו את ציון השאלון';
    end if;
    v_where := 'round_id = $2 and student_id = $3 and subject_key = $4';
  elsif p_target = 'grade' then
    if p_field = 'weighted' then
      raise exception 'הציון המשוקלל מחושב (ציון × משקל) — עדכנו את הציון או את המשקל';
    end if;
    v_table := 'bagrut_grades';
    v_type := case p_field when 'grade' then 'numeric' when 'weight' then 'numeric' end;
    if p_subject is null or p_questionnaire is null then v_type := null; end if;
    v_where := 'round_id = $2 and student_id = $3 and subject_key = $4 and questionnaire_code = $5';
  end if;
  if v_type is null then
    raise exception 'השדה אינו ניתן לעריכה: % / %', p_target, p_field;
  end if;

  if not public.may_edit_bagrut_grades(p_round, p_student) then
    raise exception 'רק מנהל־על ורכז/ת הבגרויות רשאים לעדכן ציונים';
  end if;

  if v_new is not null then
    begin
      v_num := v_new::numeric;
    exception when others then
      raise exception 'הערך "%" אינו מספר', v_new;
    end;
    if p_field in ('grade', 'final_grade') and (v_num < 0 or v_num > 100) then
      raise exception 'ציון הוא בין 0 ל-100';
    elsif p_field = 'weight' and (v_num < 0 or v_num > 1) then
      raise exception 'משקל הוא בין 0%% ל-100%%';
    elsif p_field = 'units' and (v_num <= 0 or v_num > 10) then
      raise exception 'יח"ל הן בין 1 ל-10';
    end if;
  end if;

  execute format('select %I::text from public.%I where ' || v_where, p_field, v_table)
    into v_old using null, p_round, p_student, p_subject, p_questionnaire;
  -- ⚠️ EXECUTE אינו מעדכן את FOUND — ושדה ריק נראה בדיוק כמו שורה חסרה. ROW_COUNT כן.
  get diagnostics v_rows = row_count;
  if v_rows = 0 then
    raise exception 'הנתון לא נמצא בסבב הזה';
  end if;
  if v_old::numeric is not distinct from v_new::numeric then
    return jsonb_build_object('changed', false, 'value', v_old);
  end if;

  execute format('update public.%I set %I = $1::numeric where ' || v_where, v_table, p_field)
    using v_new, p_round, p_student, p_subject, p_questionnaire;
  get diagnostics v_rows = row_count;
  if v_rows <> 1 then
    raise exception 'העדכון נכשל (% שורות)', v_rows;
  end if;
  if p_target = 'grade' then
    update bagrut_grades set weighted = case when grade is not null and weight is not null then round(grade * weight, 2) end
     where round_id = p_round and student_id = p_student and subject_key = p_subject and questionnaire_code = p_questionnaire;
  end if;

  select email into v_email from public.users where id = auth.uid();
  insert into public.bagrut_manual_edits
    (round_id, student_id, target, subject_key, questionnaire_code, field, old_value, new_value, edited_by, edited_by_email)
  values
    (p_round, p_student, p_target, p_subject,
     case when p_target = 'grade' then p_questionnaire end,
     p_field, v_old, v_new, auth.uid(), v_email);

  -- כל מה שנשען על הנתון — באותה טרנזקציה: אין ציון שנשמר בלי מה שנגזר ממנו
  perform public.bagrut_calc_student(p_round, p_student);

  return jsonb_build_object('changed', true, 'value', v_new, 'old', v_old,
                            'edited_by_email', v_email, 'edited_at', now());
end;
$$;

-- ── 12. סימון דגל כ"נבדק" (או החזרה ל"פתוח"), עם הערה
create or replace function public.bagrut_review_flag(p_flag uuid, p_reviewed boolean, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_round uuid;
  v_student text;
  v_email text;
begin
  select round_id, student_id into v_round, v_student from bagrut_flags where id = p_flag;
  if v_round is null then raise exception 'הדגל לא נמצא'; end if;
  if not may_edit_bagrut_grades(v_round, v_student) then
    raise exception 'רק מנהל־על ורכז/ת הבגרויות רשאים לטפל בדגלים';
  end if;
  select email into v_email from users where id = auth.uid();
  update bagrut_flags set
    status = case when p_reviewed then 'reviewed' else 'open' end,
    note = nullif(btrim(coalesce(p_note, '')), ''),
    reviewed_by = case when p_reviewed then auth.uid() end,
    reviewed_by_email = case when p_reviewed then v_email end,
    reviewed_at = case when p_reviewed then now() end
  where id = p_flag;
  return (select to_jsonb(f) - 'reviewed_by' from bagrut_flags f where id = p_flag);
end $$;

-- ── 13. הרשאות הפונקציות: פנימיות — אף אחד מבחוץ; שערים — משתמש מחובר
revoke all on function public.bagrut_calc_subject(uuid, text, text) from public, anon, authenticated;
revoke all on function public.bagrut_calc_eligibility(uuid, text) from public, anon, authenticated;
revoke all on function public.bagrut_calc_honors(uuid, text) from public, anon, authenticated;
revoke all on function public.bagrut_flag_candidates(uuid, text) from public, anon, authenticated;
revoke all on function public.bagrut_calc_flags(uuid, text) from public, anon, authenticated;
revoke all on function public.bagrut_calc_student(uuid, text) from public, anon, authenticated;
revoke all on function public.bagrut_recompute_round(uuid) from public, anon;
grant execute on function public.bagrut_recompute_round(uuid) to authenticated;
revoke all on function public.may_edit_bagrut_grades(uuid, text) from public, anon;
grant execute on function public.may_edit_bagrut_grades(uuid, text) to authenticated;
revoke all on function public.bagrut_edit_field(uuid, text, text, text, integer, text, text) from public, anon;
grant execute on function public.bagrut_edit_field(uuid, text, text, text, integer, text, text) to authenticated;
revoke all on function public.bagrut_review_flag(uuid, boolean, text) from public, anon;
grant execute on function public.bagrut_review_flag(uuid, boolean, text) to authenticated;

-- ── 14. החישוב הראשון — לכל הסבבים הקיימים
select public.bagrut_recompute_round(id) from public.bagrut_rounds;

-- ═══════════════════════════════════════════════════════════════
-- נבדק לפני החלה (scripts/apply_041.py, בטרנזקציה שמגולגלת לאחור, כמשתמש
-- מאומת — מלכודת 26):
--   1. הסטטוס המחושב = ניתוח הזכאות אצל כל התלמידים; הדגלים — רק היח"ל באגיאל
--   2. רכז בגרויות מעדכן ציון שאלון → המקצוע, הזכאות והיומן מתעדכנים
--   3. מחנך / רכז שכבה → "רק מנהל־על ורכז/ת הבגרויות"
--   4. שדה מחושב (סטטוס, ציון סופי של מקצוע עם שאלונים, משוקלל) → נחסם
--   5. ציון 120 → "בין 0 ל-100"
--   6. דגל: רכז מסמן "נבדק"; עדכון ישיר לטבלה דרך ה-API → 0 שורות (מלכודת 21)
-- ═══════════════════════════════════════════════════════════════
