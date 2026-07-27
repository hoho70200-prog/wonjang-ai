/* ══════════════════════════════════════════════════════════════
   원장님 AI — 공통 뼈대
   측정 · 진도 저장 · 입력 보관을 모두 여기서 맡습니다.
   ══════════════════════════════════════════════════════════════ */

/* ── 설정 ──────────────────────────────────────────────────────
   Supabase 가입 후 아래 두 줄만 채우면 통계가 쌓이기 시작합니다.
   비워 두면 사이트는 그대로 돌아가고, 통계만 안 쌓입니다.
   여기 적는 anon 키는 공개되어도 되는 키입니다. (배포안내.md 참고)
   ────────────────────────────────────────────────────────────── */
const CONFIG = {
  SUPABASE_URL: "https://arsnfylagakrjgmekkbx.supabase.co",
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFyc25meWxhZ2FrcmpnbWVra2J4Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODUwODM0MjksImV4cCI6MjEwMDY1OTQyOX0.eHXlzDCvoAlGYorAtjyfbKdl7A-vEFKhp9KoYFtn1AQ",
  SITE: "wonjang-ai"
};

/* 키를 아직 안 넣었는데 넣은 것처럼 굴면, 통계는 조용히 실패하는데
   대시보드는 "로그인하세요" 화면을 띄웁니다. 진짜 키인지 한 번 봅니다. */
const KEY_OK = /^(eyJ|sb_)/.test(String(CONFIG.SUPABASE_ANON_KEY || "").trim());

/* ── 잔손 ── */
const $  = (s, r) => (r || document).querySelector(s);
const $$ = (s, r) => [...(r || document).querySelectorAll(s)];
const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g,
  c => ({ "&":"&amp;", "<":"&lt;", ">":"&gt;", '"':"&quot;" }[c]));
const qs = k => new URLSearchParams(location.search).get(k);

function toast(msg){
  let t = $("#toast");
  if(!t){ t = document.createElement("div"); t.id = "toast"; document.body.appendChild(t); }
  t.textContent = msg; t.classList.add("on");
  clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("on"), 2600);
}

/* ── 저장소 ──────────────────────────────────────────────────── */
const Store = {
  get(k, d){ try{ const v = localStorage.getItem("wai_" + k);
                  return v == null ? d : JSON.parse(v); }catch(e){ return d; } },
  set(k, v){ try{ localStorage.setItem("wai_" + k, JSON.stringify(v)); }catch(e){} }
};

/* 내 기기는 통계에서 빼기 ────────────────────────────────────────
   주소 뒤에 ?tester=1 을 붙여 한 번만 열면, 그 뒤로 이 브라우저에서
   한 일은 서버로 가지 않습니다. 검수하러 들어간 내 발자국이 원장님들
   숫자에 섞이면 완독률이 통째로 흔들립니다. (?tester=0 이면 해제) */
if(qs("tester") !== null) Store.set("tester", qs("tester") === "0" ? 0 : 1);
const isTester = () => !!Store.get("tester");

function testerBadge(){
  if(!isTester() || $("#tester-badge")) return;
  const b = document.createElement("div");
  b.id = "tester-badge";
  b.textContent = "통계 제외 중 · " + anonId();
  b.title = "이 브라우저의 기록은 대시보드에 쌓이지 않습니다. 해제하려면 주소 뒤에 ?tester=0";
  b.style.cssText = "position:fixed;left:10px;bottom:10px;z-index:60;background:#3A3A38;color:#fff;" +
    "font-size:12px;padding:5px 9px;border-radius:6px;opacity:.72;pointer-events:none";
  document.body.appendChild(b);
}

/* 익명 식별표 — 이름도 이메일도 아닌, 이 브라우저에만 있는 무작위 글자입니다.
   같은 사람이 폰과 PC를 오가면 서로 다른 표가 됩니다. */
function anonId(){
  let id = Store.get("id");
  if(!id){
    id = "d" + Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
    Store.set("id", id);
    Store.set("first", new Date().toISOString());
  }
  return id;
}

/* ── 진도 ───────────────────────────────────────────────────────
   done: { "novel-1-3": {at, pct}, "practice-1-5": {at}, ... }        */
const Progress = {
  all(){ return Store.get("done", {}); },
  key(kind, part, ch){ return `${kind}-${part}-${ch}`; },
  mark(kind, part, ch, extra){
    const d = Progress.all();
    const k = Progress.key(kind, part, ch);
    d[k] = Object.assign({ at: Date.now() }, d[k], extra || {});
    Store.set("done", d);
  },
  has(kind, part, ch){ return !!Progress.all()[Progress.key(kind, part, ch)]; },

  /* 한 부를 얼마나 했나. 보는 방식에 따라 셈의 분모가 달라집니다 —
     단계로 볼 땐 실습까지, 소설만 볼 땐 소설 10장만. */
  partPct(part, mode){
    const seq = Flow.seq(part, mode || Mode.get());
    if(!seq.length) return 0;
    return Math.round(seq.filter(Flow.done).length / seq.length * 100);
  }
};

/* ── 읽는 방식 ───────────────────────────────────────────────────
   stage — 단계로 보기 (소설 → 개념서 → 실습을 한 묶음으로, 기본)
   novel — 소설만 이어 읽기 (이야기 흐름이 안 끊기게)              */
const Mode = {
  get(){ return Store.get("mode") === "novel" ? "novel" : "stage"; },
  set(m){ Store.set("mode", m === "novel" ? "novel" : "stage"); }
};

/* ── 흐름 ────────────────────────────────────────────────────────
   목차의 단계 정보를 한 줄로 펴서 "다음은 어디"를 답합니다.
   이 한 곳만 보면 되니, 읽기 화면과 실습 화면이 서로 몰라도 됩니다. */
const Flow = {
  ref(it){ return { kind: it.kind, part: it.part,
                    ch: it.kind === "practice" ? it.id : it.ch }; },

  key(it){ const r = Flow.ref(it); return `${r.kind}-${r.part}-${r.ch}`; },

  href(it){
    const r = Flow.ref(it);
    return r.kind === "practice"
      ? `practice.html?part=${r.part}&id=${r.ch}`
      : `read.html?kind=${r.kind}&part=${r.part}&ch=${r.ch}`;
  },

  label(it){
    if(it.kind === "practice") return `실습 ${it.no} · ${it.title}`;
    const c = it.ch === 99 ? "부록" : it.ch + "장";
    return `${it.kind === "novel" ? "소설" : "개념서"} ${c} · ${it.title}`;
  },

  /* 한 부의 항목을 읽는 순서대로 펴 놓습니다 */
  seq(part, mode){
    if(!part) return [];
    if(mode === "novel" || !part.stages){
      return (part.novel || []).map(c =>
        Object.assign({ kind:"novel", part: part.n }, c));
    }
    return part.stages.flatMap(s =>
      s.items.map(it => Object.assign({ part: part.n, stage: s.name, stageN: s.n }, it)));
  },

  /* 열린 부 전체를 이어 붙인 순서 */
  all(index, mode){
    return (index.parts || []).filter(p => p.open)
      .flatMap(p => Flow.seq(p, mode || Mode.get()));
  },

  at(seq, kind, part, ch){
    const k = `${kind}-${part}-${ch}`;
    return seq.findIndex(it => Flow.key(it) === k);
  },

  next(seq, kind, part, ch){
    const i = Flow.at(seq, kind, part, ch);
    return i >= 0 ? seq[i + 1] : null;
  },

  done(it){ const r = Flow.ref(it); return Progress.has(r.kind, r.part, r.ch); }
};

/* 실습 입력값 — 실습끼리 서로 참조할 수 있게 한 곳에 모아 둡니다. */
const Fields = {
  all(){ return Store.get("fields", {}); },
  get(id){ return (Fields.all()[id] || "").trim(); },
  set(id, v){ const f = Fields.all(); f[id] = v; Store.set("fields", f); }
};

/* ── 측정 ───────────────────────────────────────────────────────
   이벤트를 잠깐 모았다가 한 번에 보냅니다. 실패해도 화면은 멀쩡합니다. */
const Track = (() => {
  const buf = [];
  let timer = null;
  const on = () => !!(CONFIG.SUPABASE_URL && KEY_OK);

  async function flush(useBeacon){
    if(!buf.length) return;
    const rows = buf.splice(0, buf.length);
    if(!on()){ if(window.__devlog) window.__devlog(rows); return; }
    const url = CONFIG.SUPABASE_URL.replace(/\/$/, "") + "/rest/v1/events";
    const body = JSON.stringify(rows);
    try{
      if(useBeacon && navigator.sendBeacon){
        navigator.sendBeacon(url + "?apikey=" + encodeURIComponent(CONFIG.SUPABASE_ANON_KEY),
                             new Blob([body], { type: "application/json" }));
        return;
      }
      await fetch(url, { method:"POST", keepalive:true,
        headers:{ "Content-Type":"application/json",
                  "apikey": CONFIG.SUPABASE_ANON_KEY,
                  "Authorization": "Bearer " + CONFIG.SUPABASE_ANON_KEY,
                  "Prefer": "return=minimal" },
        body });
    }catch(e){ /* 통계 실패가 열람을 막지 않도록 조용히 넘어갑니다 */ }
  }

  function push(name, props){
    if(isTester()) return;
    buf.push({
      site: CONFIG.SITE,
      device: anonId(),
      name,
      part: (props && props.part) || null,
      chapter: (props && props.chapter != null) ? String(props.chapter) : null,
      kind: (props && props.kind) || null,
      value: (props && props.value != null) ? String(props.value).slice(0, 300) : null,
      path: location.pathname.split("/").pop() || "index.html"
    });
    if(window.__devlog) window.__devlog([buf[buf.length - 1]]);
    clearTimeout(timer);
    timer = setTimeout(() => flush(false), 1500);
  }

  addEventListener("visibilitychange", () => { if(document.hidden) flush(true); });
  addEventListener("pagehide", () => flush(true));
  return { push, flush, enabled: on };
})();

const track = (name, props) => Track.push(name, props);

/* ── 머문 시간 ───────────────────────────────────────────────────
   "이 화면에 얼마나 계셨나"를 잽니다. 다만 켜 두고 자리를 뜬 시간까지
   읽은 시간으로 세면 숫자가 통째로 부풀므로, 두 경우에는 시계를 멈춥니다.
     · 다른 탭·다른 앱으로 넘어가 화면이 안 보일 때
     · 90초 넘게 아무 움직임(스크롤·터치·키·마우스)이 없을 때

   한 번 열 때마다 무작위 표(view)를 붙여 여러 번 보고합니다.
   중간에 창을 닫아도 마지막 보고가 남고, 대시보드는 한 열람에서
   가장 큰 값 하나만 쓰므로 같은 시간이 두 번 세어지지 않습니다.     */
const Dwell = (() => {
  const IDLE = 90000;    // 이만큼 조용하면 자리를 뜬 것으로 봅니다
  const GAP  = 5000;     // 탭이 멈춰 있던 큰 공백은 세지 않습니다
  const STEP = 60000;    // 보고 간격
  const MIN  = 5;        // 5초 미만은 잘못 눌러 들어온 것으로 보고 안 보냅니다
  const view = "v" + Math.random().toString(36).slice(2, 10);

  let meta = null, active = 0, last = 0, act = 0, sent = -1, started = false;

  const mark = () => { act = Date.now(); };
  const sec  = () => Math.round(active / 1000);

  function step(){
    const now = Date.now();
    const dt = Math.min(now - last, GAP);
    last = now;
    if(!document.hidden && now - act < IDLE) active += dt;
    const s = sec();
    if(s >= MIN && (sent < 0 ? s >= 15 : s - sent >= STEP / 1000)) report();
  }

  function report(closing){
    const s = sec();
    if(!meta || s < MIN || s === sent) return;
    sent = s;
    track("read_time", Object.assign({}, meta, { value: s + "|" + view }));
    if(closing) Track.flush(true);
  }

  function start(m){
    meta = m;
    if(started) return;
    started = true;
    last = act = Date.now();
    ["scroll", "keydown", "mousedown", "mousemove", "touchstart", "wheel"]
      .forEach(e => addEventListener(e, mark, { passive: true }));
    setInterval(step, 1000);
    addEventListener("visibilitychange", () => { step(); if(document.hidden) report(true); });
    addEventListener("pagehide", () => { step(); report(true); });
  }

  return { start, sec, view };
})();

/* ── 스크롤 깊이와 완독 판정 ──────────────────────────────────────
   25 / 50 / 75 / 100%를 지날 때 한 번씩 기록합니다.

   "다 읽었다"로 치려면 두 가지가 함께 맞아야 합니다.
     ① 맨 아래(95% 이상)까지 내려갔을 것
     ② 그 장을 읽을 만한 시간을 실제로 머물렀을 것

   ②가 없으면, 화면보다 짧은 장은 열자마자 100%가 되어 버리고
   맨 아래로 한 번 튕겨 내린 사람도 완독으로 잡힙니다. 3,500자짜리
   장을 20초에 읽을 수는 없으니, 예상 읽는 시간의 40%를 기준으로
   잡되 아무리 짧아도 45초, 아무리 길어도 4분이면 인정합니다.       */
const READ = { FLOOR: 45, RATIO: 0.4, CEIL: 240, DEPTH: 95 };

function needSec(minutes){
  const m = Number(minutes) || 0;
  return Math.round(Math.min(READ.CEIL, Math.max(READ.FLOOR, m * 60 * READ.RATIO)));
}

function watchScroll(meta, minutes){
  const marks = [25, 50, 75, 100];
  const hit = new Set();
  const bar = $(".bar");
  const need = needSec(minutes);
  const DONE = meta.kind === "practice" ? "practice_done" : "read_done";
  let maxPct = 0, marked = false, tick = null;

  Dwell.start(meta);

  function finish(){
    if(marked || !meta.kind || !meta.part) return;
    marked = true;
    clearInterval(tick);
    Progress.mark(meta.kind, meta.part, meta.chapter, { pct: 100 });
    track(DONE, Object.assign({}, meta, { value: "끝까지 · " + Dwell.sec() + "초" }));
    const b = document.getElementById("done");
    if(b && !b.disabled){
      b.textContent = meta.kind === "practice" ? "마치셨습니다 ✓" : "다 읽으셨습니다 ✓";
      b.style.opacity = ".6";
    }
  }

  function check(){
    const h = document.documentElement;
    const total = h.scrollHeight - h.clientHeight;
    const pct = total <= 8 ? 100 : Math.min(100, Math.round(h.scrollTop / total * 100));
    if(pct > maxPct) maxPct = pct;
    if(bar) bar.style.width = pct + "%";

    marks.forEach(m => {
      if(pct >= m && !hit.has(m)){
        hit.add(m);
        track("scroll", Object.assign({}, meta, { value: m }));
      }
    });

    if(!marked && maxPct >= READ.DEPTH && Dwell.sec() >= need) finish();
  }

  addEventListener("scroll", check, { passive: true });
  addEventListener("resize", check);
  setTimeout(check, 500);
  tick = setInterval(check, 5000);   // 다 내려간 뒤 가만히 읽는 시간도 세어야 합니다
  return () => maxPct;
}

/* ── 복사 ── */
function copyText(text, okMsg){
  const done = () => toast(okMsg || "복사했습니다. AI에 붙여넣으세요");
  if(navigator.clipboard && location.protocol !== "file:"){
    navigator.clipboard.writeText(text).then(done).catch(fallback);
  }else{ fallback(); }
  function fallback(){
    const ta = document.createElement("textarea");
    ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
    document.body.appendChild(ta); ta.select();
    try{ document.execCommand("copy"); done(); }
    catch(e){ toast("복사가 안 됩니다. 상자 안 글을 직접 선택해 주세요"); }
    ta.remove();
  }
}

/* ── 상단 바 ── */
function topBar(backHref, backText, nowText){
  const el = document.createElement("div");
  el.className = "top";
  el.innerHTML = `<div class="top-in">
      <a class="back" href="${esc(backHref)}">← ${esc(backText)}</a>
      <span class="now">${esc(nowText || "")}</span>
    </div><div class="bar"></div>`;
  document.body.insertBefore(el, document.body.firstChild);
}

/* ── 자료 읽어 오기 ── */
const Data = {
  _c: {},
  async json(path){
    if(Data._c[path]) return Data._c[path];
    const r = await fetch(path, { cache: "no-cache" });
    if(!r.ok) throw new Error(path + " 를 못 읽었습니다 (" + r.status + ")");
    return (Data._c[path] = await r.json());
  },
  index(){ return Data.json("assets/content/index.json"); },
  part(n){ return Data.json(`assets/content/part${n}.json`); },
  practice(){ return Data.json("assets/practice.json"); }
};

function fail(msg){
  document.body.innerHTML =
    `<div class="wrap"><div class="loading">
       <p style="font-size:19px;color:var(--ink)">${esc(msg)}</p>
       <p><a href="index.html">처음으로 돌아가기</a></p>
     </div></div>`;
}

/* 통계에서 빠져 있는 상태라면 화면 구석에 조용히 알려 줍니다 */
if(document.body) testerBadge();
else addEventListener("DOMContentLoaded", testerBadge);
