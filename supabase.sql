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

-- 4-1. 한눈에
create or replace function public.stats_overview(days int default 30)
returns json language sql stable security invoker as $$
  with e as (
    select * from public.events
    where created_at > now() - (days || ' days')::interval
  )
  select json_build_object(
    'visitors',      (select count(distinct device) from e),
    'opened_novel',  (select count(distinct device) from e where name = 'read_open'     and kind = 'novel'),
    'finished_novel',(select count(distinct device) from e where name = 'read_done'     and kind = 'novel'),
    'opened_prac',   (select count(distinct device) from e where name = 'practice_open'),
    'copied',        (select count(distinct device) from e where name in ('build_copy','prompt_copy')),
    'opened_ai',     (select count(distinct device) from e where name = 'open_ai'),
    'printed',       (select count(distinct device) from e where name = 'print'),
    'events',        (select count(*) from e),
    'feedback',      (select count(*) from public.feedback
                        where created_at > now() - (days || ' days')::interval)
  );
$$;

-- 4-2. 장별 — 어디서 멈추는지
create or replace function public.stats_chapters(days int default 30)
returns table (kind text, part int, chapter text, opened bigint, finished bigint)
language sql stable security invoker as $$
  select e.kind, e.part, e.chapter,
         count(distinct e.device) filter (where e.name in ('read_open','practice_open'))            as opened,
         count(distinct e.device) filter (where e.name in ('read_done','practice_done'))            as finished
  from public.events e
  where e.created_at > now() - (days || ' days')::interval
    and e.kind is not null and e.part is not null
  group by e.kind, e.part, e.chapter
  order by e.part, e.kind, length(e.chapter), e.chapter;
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

-- 4-4. 깊이 — 스크롤을 어디까지 내렸나
create or replace function public.stats_depth(days int default 30)
returns table (depth text, people bigint)
language sql stable security invoker as $$
  with m as (
    select device, max(value::int) as d
    from public.events
    where name = 'scroll' and value ~ '^\d+$'
      and created_at > now() - (days || ' days')::interval
    group by device
  )
  select case when d >= 100 then '끝까지'
              when d >= 75  then '75%'
              when d >= 50  then '절반'
              when d >= 25  then '25%'
              else '들어오자마자' end as depth,
         count(*) as people
  from m group by 1
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

grant execute on function public.stats_overview(int) to authenticated;
grant execute on function public.stats_chapters(int) to authenticated;
grant execute on function public.stats_daily(int)    to authenticated;
grant execute on function public.stats_depth(int)    to authenticated;
grant execute on function public.stats_docs(int)     to authenticated;

-- ── 5. 마무리 ───────────────────────────────────────────────────
--  Supabase 대시보드 → Authentication → Users 에서
--  본인 이메일로 계정을 하나 만드십시오. 그 계정으로만 admin.html에
--  들어갈 수 있습니다.
--  Authentication → Providers 에서 "Enable email signup"은 꺼 두시면
--  아무도 새로 가입할 수 없습니다.
