-- ═══════════════════════════════════════════════════════════════
--  원장님 AI — 데이터베이스 설치
--  Supabase 프로젝트를 만든 뒤, SQL Editor에 이 파일을 통째로
--  붙여넣고 한 번만 실행하십시오.
-- ═══════════════════════════════════════════════════════════════

-- ── 1. 이벤트 ───────────────────────────────────────────────────
--  원장님이 무엇을 하셨는지가 한 줄씩 쌓입니다.
--  이름·이메일은 없습니다. device는 브라우저마다 생기는 무작위 글자입니다.
create table if not exists public.events (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  site       text not null default 'wonjang-ai',
  device     text not null,
  name       text not null,          -- read_open, scroll, build_copy …
  part       int,
  chapter    text,
  kind       text,
  value      text,
  path       text
);

create index if not exists events_time_idx on public.events (created_at desc);
create index if not exists events_name_idx on public.events (name);
create index if not exists events_dev_idx  on public.events (device);

-- ── 2. 피드백 ───────────────────────────────────────────────────
create table if not exists public.feedback (
  id         bigserial primary key,
  created_at timestamptz not null default now(),
  site       text not null default 'wonjang-ai',
  device     text,
  far        text,     -- 어디까지 해 보셨나요
  stuck      text,     -- 어디서 막히셨나요
  doc        text,     -- 제일 오래 붙잡은 서류
  center     text,     -- 어린이집 이름 (선택)
  path       text
);

create index if not exists feedback_time_idx on public.feedback (created_at desc);

-- ── 3. 보안 ─────────────────────────────────────────────────────
--  누구나 "쓰기"만 할 수 있고, "읽기"는 로그인한 사람만.
--  사이트에 적어 두는 anon 키가 공개되어도 남이 데이터를 볼 수 없습니다.
alter table public.events   enable row level security;
alter table public.feedback enable row level security;

drop policy if exists "anon can insert events"   on public.events;
drop policy if exists "anon can insert feedback" on public.feedback;
drop policy if exists "owner can read events"    on public.events;
drop policy if exists "owner can read feedback"  on public.feedback;

create policy "anon can insert events"
  on public.events for insert to anon, authenticated with check (true);

create policy "anon can insert feedback"
  on public.feedback for insert to anon, authenticated with check (true);

create policy "owner can read events"
  on public.events for select to authenticated using (true);

create policy "owner can read feedback"
  on public.feedback for select to authenticated using (true);

-- ── 4. 통계 ─────────────────────────────────────────────────────
--  대시보드가 부르는 함수들입니다. 로그인한 사람만 결과를 받습니다.
--
--  ※ 머문 시간은 read_time 이벤트의 value 칸에 "초|열람표" 꼴로 들어옵니다.
--    (예: "137|v8f3k2c1") 한 번 열 때 여러 번 보고되므로, 열람표별로
--    가장 큰 값 하나만 골라 씁니다. 그래야 같은 시간이 겹쳐 세어지지 않습니다.
--    표 구조는 그대로라, 이 파일만 다시 실행하면 됩니다.

--  바뀐 함수는 반환 모양이 달라져 먼저 지워야 합니다 (지워도 자료는 그대로).
drop function if exists public.stats_overview(int);
drop function if exists public.stats_overview(int, int);
drop function if exists public.stats_chapters(int);
drop function if exists public.stats_depth(int);
drop function if exists public.stats_time(int);
drop function if exists public.stats_time_chapters(int);

-- 4-1. 한눈에
--   novel_ch — 지금 열려 있는 소설이 모두 몇 장인가. 이 수를 다 채운 사람만
--   '완독'입니다. 한 장만 읽고 완독으로 잡히던 것을 바로잡는 자리입니다.
create or replace function public.stats_overview(days int default 30, novel_ch int default 10)
returns json language sql stable security invoker as $$
  with e as (
    select * from public.events
    where created_at > now() - (days || ' days')::interval
  ),
  fin as (   -- 기기별로 소설을 몇 장이나 끝냈나
    select device, count(distinct chapter) as n
    from e where name = 'read_done' and kind = 'novel' and chapter is not null
    group by device
  ),
  t as (     -- 열람 한 번마다 마지막으로 보고된 초
    select kind, device, split_part(value, '|', 2) as view,
           max(substring(value from '^[0-9]+')::int) as secs
    from e where name = 'read_time' and value ~ '^[0-9]+\|'
    group by 1, 2, 3
  ),
  tv as (select * from t where secs >= 5)
  select json_build_object(
    'visitors',      (select count(distinct device) from e),
    'opened_novel',  (select count(distinct device) from e where name = 'read_open' and kind = 'novel'),
    'finished_any',  (select count(*) from fin),
    'finished_all',  (select count(*) from fin where n >= novel_ch),
    'novel_ch',      novel_ch,
    'opened_prac',   (select count(distinct device) from e where name = 'practice_open'),
    'copied',        (select count(distinct device) from e where name in ('build_copy','prompt_copy')),
    'opened_ai',     (select count(distinct device) from e where name = 'open_ai'),
    'printed',       (select count(distinct device) from e where name = 'print'),
    'events',        (select count(*) from e),
    'stay_avg',      (select avg(secs)::int from tv where kind <> 'home'),
    'stay_total_min',(select coalesce(sum(secs), 0)::int / 60 from tv),
    'feedback',      (select count(*) from public.feedback
                        where created_at > now() - (days || ' days')::interval)
  );
$$;

-- 4-2. 장별 — 어디서 멈추는지, 그리고 그 장에 얼마나 머무는지
create or replace function public.stats_chapters(days int default 30)
returns table (kind text, part int, chapter text,
               opened bigint, finished bigint, avg_sec int, max_sec int)
language sql stable security invoker as $$
  with e as (
    select * from public.events
    where created_at > now() - (days || ' days')::interval
      and kind is not null and part is not null
  ),
  t as (
    select kind, part, chapter, split_part(value, '|', 2) as view,
           max(substring(value from '^[0-9]+')::int) as secs
    from e where name = 'read_time' and value ~ '^[0-9]+\|' and chapter is not null
    group by 1, 2, 3, 4
  ),
  s as (
    select t.kind, t.part, t.chapter, avg(secs)::int as a, max(secs) as m
    from t where secs >= 5 group by 1, 2, 3
  )
  select e.kind, e.part, e.chapter,
         count(distinct e.device) filter (where e.name in ('read_open','practice_open'))  as opened,
         count(distinct e.device) filter (where e.name in ('read_done','practice_done'))  as finished,
         max(s.a), max(s.m)
  from e left join s on s.kind = e.kind and s.part = e.part and s.chapter = e.chapter
  group by e.kind, e.part, e.chapter
  order by e.part, e.kind, length(e.chapter), e.chapter;
$$;

-- 4-2b. 구분별 머문 시간 — 소설·개념서·실습 중 어디에 오래 붙잡히나
create or replace function public.stats_time(days int default 30)
returns table (kind text, views bigint, people bigint,
               avg_sec int, med_sec int, max_sec int, min_sec int)
language sql stable security invoker as $$
  with t as (
    select kind, device, split_part(value, '|', 2) as view,
           max(substring(value from '^[0-9]+')::int) as secs
    from public.events
    where name = 'read_time' and value ~ '^[0-9]+\|' and kind is not null
      and created_at > now() - (days || ' days')::interval
    group by 1, 2, 3
  )
  select kind, count(*), count(distinct device),
         avg(secs)::int,
         (percentile_cont(0.5) within group (order by secs))::int,
         max(secs)::int, min(secs)::int
  from t where secs >= 5
  group by kind order by avg(secs) desc;
$$;

-- 4-2c. 장별 머문 시간 — 가장 오래 붙잡은 장과 가장 빨리 지나친 장
create or replace function public.stats_time_chapters(days int default 30)
returns table (kind text, part int, chapter text, views bigint, people bigint,
               avg_sec int, med_sec int, max_sec int, min_sec int)
language sql stable security invoker as $$
  with t as (
    select kind, part, chapter, device, split_part(value, '|', 2) as view,
           max(substring(value from '^[0-9]+')::int) as secs
    from public.events
    where name = 'read_time' and value ~ '^[0-9]+\|'
      and kind is not null and part is not null and chapter is not null
      and created_at > now() - (days || ' days')::interval
    group by 1, 2, 3, 4, 5
  )
  select kind, part, chapter, count(*), count(distinct device),
         avg(secs)::int,
         (percentile_cont(0.5) within group (order by secs))::int,
         max(secs)::int, min(secs)::int
  from t where secs >= 5
  group by kind, part, chapter
  order by avg(secs) desc;
$$;

-- 4-3. 날짜별
create or replace function public.stats_daily(days int default 30)
returns table (day date, visitors bigint, opens bigint, copies bigint)
language sql stable security invoker as $$
  select date_trunc('day', created_at)::date as day,
         count(distinct device)                                              as visitors,
         count(*) filter (where name in ('read_open','practice_open'))        as opens,
         count(*) filter (where name in ('build_copy','prompt_copy'))         as copies
  from public.events
  where created_at > now() - (days || ' days')::interval
  group by 1 order by 1;
$$;

-- 4-4. 깊이 — 한 장을 열었을 때 어디까지 내려갔나
--   기기 단위로 세면 여러 장 중 한 곳만 끝까지 내려가도 그 사람 전체가
--   '끝까지'가 됩니다. 그래서 '장을 연 것' 하나하나를 셉니다.
create or replace function public.stats_depth(days int default 30)
returns table (depth text, views bigint)
language sql stable security invoker as $$
  with e as (
    select * from public.events
    where created_at > now() - (days || ' days')::interval
      and chapter is not null and part is not null
  ),
  v as (
    select device, part, chapter from e
    where name in ('read_open','practice_open')
    group by 1, 2, 3
  ),
  s as (
    select device, part, chapter, max(substring(value from '^[0-9]+')::int) as d
    from e where name = 'scroll' and value ~ '^[0-9]+$'
    group by 1, 2, 3
  ),
  j as (
    select coalesce(s.d, 0) as d
    from v left join s on s.device = v.device and s.part = v.part and s.chapter = v.chapter
  )
  select case when d >= 100 then '끝까지'
              when d >= 75  then '75%'
              when d >= 50  then '절반'
              when d >= 25  then '25%'
              else '거의 안 내려감' end as depth,
         count(*) as views
  from j group by 1
  order by min(d) desc;
$$;

-- 4-5. 제일 오래 붙잡은 서류 — 서비스의 재료
create or replace function public.stats_docs(days int default 90)
returns table (doc text, n bigint)
language sql stable security invoker as $$
  select trim(doc) as doc, count(*) as n
  from public.feedback
  where doc is not null and trim(doc) <> ''
    and created_at > now() - (days || ' days')::interval
  group by 1 order by 2 desc, 1;
$$;

grant execute on function public.stats_overview(int, int)   to authenticated;
grant execute on function public.stats_chapters(int)        to authenticated;
grant execute on function public.stats_daily(int)           to authenticated;
grant execute on function public.stats_depth(int)           to authenticated;
grant execute on function public.stats_docs(int)            to authenticated;
grant execute on function public.stats_time(int)            to authenticated;
grant execute on function public.stats_time_chapters(int)   to authenticated;

-- ── 5. 마무리 ───────────────────────────────────────────────────
--  Supabase 대시보드 → Authentication → Users 에서
--  본인 이메일로 계정을 하나 만드십시오. 그 계정으로만 admin.html에
--  들어갈 수 있습니다.
--  Authentication → Providers 에서 "Enable email signup"은 꺼 두시면
--  아무도 새로 가입할 수 없습니다.
--
--  ── 검수하며 남긴 내 발자국 지우기 ─────────────────────────────
--  사이트를 ?tester=1 로 한 번 열면 그 뒤로는 안 쌓입니다. 그전에 쌓인
--  것은 아래로 지웁니다. 기기 표는 화면 왼쪽 아래 "통계 제외 중" 딱지에
--  적혀 있습니다.
--
--    delete from public.events   where device = '여기에_기기표';
--    delete from public.feedback where device = '여기에_기기표';
--
--  기기 표를 모르겠고 아직 원장님들께 안 돌리셨다면, 통째로 비웁니다.
--
--    truncate public.events;
