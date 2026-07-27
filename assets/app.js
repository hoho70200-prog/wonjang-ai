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
  partPct(part, index){
    const d = Progress.all();
    const items = [];
    (index.novel   || []).forEach(c => items.push(`novel-${part}-${c.ch}`));
    (index.concept || []).forEach(c => items.push(`concept-${part}-${c.ch}`));
    (index.practice|| []).forEach(c => items.push(`practice-${part}-${c}`));
    if(!items.length) return 0;
    return Math.round(items.filter(k => d[k]).length / items.length * 100);
  }
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
  const on = () => CONFIG.SUPABASE_URL && CONFIG.SUPABASE_ANON_KEY;

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

/* ── 스크롤 깊이 ─────────────────────────────────────────────────
   25 / 50 / 75 / 100%를 지날 때 한 번씩 기록합니다.
   100%가 곧 완독률입니다.

   다만 화면보다 짧은 장은 열자마자 100%가 되어 버리므로,
   최소 머문 시간(DWELL)을 넘겨야 "읽었다"로 칩니다.
   열자마자 닫은 사람이 완독으로 잡히면 숫자를 믿을 수 없게 됩니다. */
const DWELL = 20000;   // 20초

function watchScroll(meta){
  const marks = [25, 50, 75, 100];
  const hit = new Set();
  const bar = $(".bar");
  const t0 = Date.now();
  let maxPct = 0, marked = false, timer = null;

  function finish(){
    if(marked || !meta.kind || !meta.part) return;
    marked = true;
    Progress.mark(meta.kind, meta.part, meta.chapter, { pct: 100 });
    track("read_done", Object.assign({ value: Math.round((Date.now() - t0) / 1000) + "초" }, meta));
    const b = document.getElementById("done");
    if(b && !b.disabled){ b.textContent = "다 읽으셨습니다 ✓"; b.style.opacity = ".6"; }
  }

  function check(){
    const h = document.documentElement;
    const total = h.scrollHeight - h.clientHeight;
    const pct = total <= 0 ? 100 : Math.min(100, Math.round(h.scrollTop / total * 100));
    if(pct > maxPct) maxPct = pct;
    if(bar) bar.style.width = pct + "%";

    marks.forEach(m => {
      if(pct >= m && !hit.has(m)){
        hit.add(m);
        track("scroll", Object.assign({ value: m }, meta));
      }
    });

    if(pct >= 100 && !marked && !timer){
      const left = DWELL - (Date.now() - t0);
      if(left <= 0) finish();
      else timer = setTimeout(() => { timer = null; finish(); }, left);
    }
  }

  addEventListener("scroll", check, { passive: true });
  addEventListener("resize", check);
  setTimeout(check, 500);
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
