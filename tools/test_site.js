/* 사이트 자동 점검 — 실제 페이지를 띄워 눌러 봅니다.
 *
 *   npm install jsdom
 *   node tools/test_site.js
 */
const fs = require("fs");
const path = require("path");
const { JSDOM, VirtualConsole } = require("jsdom");

const WEB = path.dirname(__dirname);
const ok = [], ng = [];
const check = (c, m) => (c ? ok : ng).push((c ? "OK   " : "★NG  ") + m);

/* 브라우저 흉내 — fetch는 파일에서 바로 읽어 줍니다 */
function makeFetch(){
  return (url) => {
    const p = path.join(WEB, String(url).replace(/^\.?\//, "").split("?")[0]);
    if(!fs.existsSync(p)) return Promise.resolve({ ok:false, status:404 });
    const body = fs.readFileSync(p, "utf8");
    return Promise.resolve({ ok:true, status:200,
      json: () => Promise.resolve(JSON.parse(body)), text: () => Promise.resolve(body) });
  };
}

const STORE = {};   // 페이지를 옮겨 다녀도 남는 localStorage

function localStorageShim(){
  return {
    getItem: k => (k in STORE ? STORE[k] : null),
    setItem: (k, v) => { STORE[k] = String(v); },
    removeItem: k => { delete STORE[k]; },
    clear: () => { for(const k in STORE) delete STORE[k]; }
  };
}

async function open(file, query){
  const vc = new VirtualConsole();
  const errs = [];
  vc.on("jsdomError", e => errs.push(e.message));
  vc.on("error", (...a) => errs.push(a.join(" ")));

  // <script src="assets/app.js"> 를 미리 본문에 넣어 둡니다 (jsdom은 외부 파일을 안 읽음)
  const appjs = fs.readFileSync(path.join(WEB, "assets/app.js"), "utf8");
  // 치환 함수를 쓰는 것이 중요합니다 — 문자열로 넘기면 app.js 안의 $$가 $로 삼켜집니다
  const html = fs.readFileSync(path.join(WEB, file), "utf8")
    .replace(/<script src="assets\/app\.js[^"]*"><\/script>/,
             () => "<script>" + appjs.replace(/<\/script>/g, "<\\/script>") + "</script>");

  const dom = new JSDOM(html, {
    url: "http://localhost/" + file + (query ? "?" + query : ""),
    runScripts: "dangerously",
    resources: undefined,
    pretendToBeVisual: true,
    virtualConsole: vc,
    beforeParse(w){
      w.fetch = makeFetch();
      Object.defineProperty(w, "localStorage", { value: localStorageShim(), configurable:true });
      Object.defineProperty(w, "sessionStorage", { value: localStorageShim(), configurable:true });
      w.navigator.clipboard = { writeText: t => { w.__clip = t; return Promise.resolve(); } };
      w.scrollTo = () => {};
      w.print = () => { w.__printed = true; };
      w.matchMedia = () => ({ matches:false, addListener(){}, removeListener(){} });
    }
  });

  const w = dom.window;
  for(let i = 0; i < 6; i++) await new Promise(r => setTimeout(r, 40));  // fetch 소화
  return { w, d: w.document, errs };
}

const txt = (d, sel) => (d.querySelector(sel) || {}).textContent || "";
const n   = (d, sel) => d.querySelectorAll(sel).length;

(async function(){

  /* ── 홈 ── */
  {
    const { w, d, errs } = await open("index.html");
    check(d.body.textContent.includes("영란 원장"), "홈 — 제목");
    check(n(d, ".part") === 6, `홈 — 6개 부 (실제 ${n(d, ".part")})`);
    check(n(d, ".toc-item") >= 24, `홈 — 1부 목차 ${n(d, ".toc-item")}개`);
    check(n(d, ".toc-group") === 8, `홈 — 단계 ${n(d, ".toc-group")}개`);
    check(d.body.textContent.includes("책상을 차리다") &&
          d.body.textContent.includes("비품을 세다"), "홈 — 단계 이름 표시");
    check(n(d, ".modes button") === 2, "홈 — 보기 전환 버튼 2개");
    const firstStage = d.querySelector(".toc-group");
    check(firstStage.textContent.includes("소설") && firstStage.textContent.includes("실습"),
          "홈 — 한 단계 안에 소설과 실습이 함께 있음");
    check(d.querySelector("#welcome").style.display === "block", "홈 — 첫 방문 안내");
    const locked = d.querySelectorAll(".part")[1];
    check(locked.querySelectorAll(".toc-item").length === 0, "홈 — 2부는 잠김");
    check(locked.textContent.includes("준비 중"), "홈 — 준비 중 표시");
    check(!errs.length, `홈 — 오류 없음 ${errs.slice(0,1)}`);
  }

  /* ── 소설 ── */
  {
    const { w, d, errs } = await open("read.html", "kind=novel&part=1&ch=1");
    check(d.body.textContent.includes("금요일 밤의 원장실"), "소설 — 제목");
    check(n(d, ".body p") > 20, `소설 — 본문 ${n(d, ".body p")}문단`);
    check(n(d, ".fsize button") === 3, "소설 — 글자 크기 버튼");
    check(d.body.textContent.includes("읽는 시간"), "소설 — 읽는 시간 표시");
    check(n(d, ".nextnav a") >= 2, "소설 — 다음 장 안내");

    // 머문 시간 — 켜져 있는지, 완독 기준이 장 길이를 따라가는지
    const ev = (s) => { try{ return w.eval(s); }catch(e){ return "오류: " + e.message; } };
    check(ev("typeof Dwell") === "object", "소설 — 머문 시간 시계가 붙음");
    check(ev("needSec(7)") === 168,  `소설 — 7분짜리 장은 168초 기준 (실제 ${ev("needSec(7)")})`);
    check(ev("needSec(1)") === 45,   `소설 — 아무리 짧아도 45초 (실제 ${ev("needSec(1)")})`);
    check(ev("needSec(30)") === 240, `소설 — 아무리 길어도 240초 (실제 ${ev("needSec(30)")})`);
    check(!errs.length, `소설 — 오류 없음 ${errs.slice(0,1)}`);
  }

  /* ── 소설만 이어 읽기 ── */
  {
    STORE["wai_mode"] = JSON.stringify("novel");
    const { d } = await open("index.html");
    check(n(d, ".toc-group") === 1, `소설만 보기 — 묶음 1개 (실제 ${n(d, ".toc-group")})`);
    check(n(d, ".toc-item") === 10, `소설만 보기 — 소설 10장만 (실제 ${n(d, ".toc-item")})`);
    check(!d.body.textContent.includes("책상을 차리다"), "소설만 보기 — 단계 이름 숨김");

    const { d: r } = await open("read.html", "kind=novel&part=1&ch=1");
    const nav = r.querySelector(".nextnav a");
    check(nav && nav.getAttribute("href").includes("kind=novel") &&
          nav.getAttribute("href").includes("ch=2"),
          `소설만 보기 — 1장 다음이 2장 (${nav ? nav.getAttribute("href") : "없음"})`);
    check(r.body.textContent.includes("소설만 이어 읽기"), "소설만 보기 — 되돌아가는 안내 있음");
    STORE["wai_mode"] = JSON.stringify("stage");
  }

  /* ── 단계 흐름: 소설 1장 다음은 실습 0 ── */
  {
    const { d } = await open("read.html", "kind=novel&part=1&ch=1");
    const nav = d.querySelector(".nextnav a");
    check(nav && nav.getAttribute("href").includes("practice.html") &&
          nav.getAttribute("href").includes("id=1-0"),
          `단계 흐름 — 소설 1장 → 실습 0 (${nav ? nav.getAttribute("href") : "없음"})`);
    check(d.querySelector(".top .now").textContent.includes("책상을 차리다"),
          "단계 흐름 — 상단에 단계 이름");
  }

  /* ── 단계 흐름: 실습 0 다음은 소설 2장 ── */
  {
    const { d } = await open("practice.html", "part=1&id=1-0");
    const nav = d.querySelector(".nextnav a");
    check(nav && nav.getAttribute("href").includes("kind=novel") &&
          nav.getAttribute("href").includes("ch=2"),
          `단계 흐름 — 실습 0 → 소설 2장 (${nav ? nav.getAttribute("href") : "없음"})`);
  }

  /* ── 단계 흐름: 개념서 1장 다음은 실습 1 ── */
  {
    const { d } = await open("read.html", "kind=concept&part=1&ch=1");
    const nav = d.querySelector(".nextnav a");
    check(nav && nav.getAttribute("href").includes("id=1-1"),
          `단계 흐름 — 개념서 1장 → 실습 1 (${nav ? nav.getAttribute("href") : "없음"})`);
  }

  /* ── 소설에 프롬프트 상자가 섞이지 않았는지 (대사 오분류 방지) ── */
  {
    const fs2 = require("fs");
    const p1 = JSON.parse(fs2.readFileSync(path.join(WEB, "assets/content/part1.json"), "utf8"));
    const bad = p1.novel.flatMap(c => c.blocks.filter(b => b.t === "prompt")).length;
    check(bad === 0, `소설 — 대사가 프롬프트 상자로 잘못 잡히지 않음 (${bad}건)`);
    const okc = p1.concept.flatMap(c => c.blocks.filter(b => b.t === "prompt")).length;
    check(okc > 0, `개념서 — 진짜 예시 부탁은 상자로 남음 (${okc}건)`);
    const { d } = await open("read.html", "kind=novel&part=1&ch=1");
    check(n(d, ".pbox") === 0, "소설 화면 — 검은 상자 없음");
    check(d.body.textContent.includes("물놀이"), "소설 화면 — 대사가 본문에 있음");
  }

  /* ── 개념서 ── */
  {
    const { d } = await open("read.html", "kind=concept&part=1&ch=3");
    check(d.body.textContent.includes("그럴듯한 거짓말"), "개념서 — 제목");
    check(n(d, ".body h2") >= 4, `개념서 — 소제목 ${n(d, ".body h2")}개`);
  }

  /* ── 실습 4 : 조립 ── */
  {
    const { w, d, errs } = await open("practice.html", "part=1&id=1-4");
    check(d.body.textContent.includes("역할 한 줄"), "실습4 — 제목");
    check(n(d, ".step") === 4, `실습4 — 단계 ${n(d, ".step")}개`);
    check(n(d, ".pbox") >= 4, `실습4 — 부탁 상자 ${n(d, ".pbox")}개`);
    const empties = [...d.querySelectorAll(".pbox pre")].map(e => e.textContent);
    check(empties.some(t => t.includes("채우시면")), "실습4 — 빈 칸일 때 안내 문구");
    check(empties.some(t => t.includes("20년 경력의 어린이집 원감")),
          "실습4 — 빈 칸이어도 견본(fallback)은 보여 줌");

    const type = (id, v) => {
      const el = d.querySelector("#f_" + id);
      el.value = v;
      el.dispatchEvent(new w.Event("input", { bubbles:true }));
    };
    type("p4_year","20"); type("p4_title","어린이집 원감");
    type("p4_reader","학부모님"); type("p4_feel","안심");
    type("p4_style","따뜻하지만 격식 있는");
    const F = () => JSON.parse(STORE["wai_fields"] || "{}");
    check((F().p4_role1 || "").includes("20년 경력의 어린이집 원감"),
          `실습4 — 역할 한 줄 조립 → “${(F().p4_role1||"").slice(0,40)}…”`);

    type("p4_cap","49"); type("p4_now","44"); type("p4_class","4");
    type("p4_ops","물놀이는 화·목 오전"); type("p4_form","A4 반 장");
    check((F().p4_card || "").includes("정원 49명, 현원 44명, 반 4개"), "실습4 — 소개 카드 조립");

    type("p4_event","가을 소풍");
    const boxes = [...d.querySelectorAll(".pbox pre")].map(e => e.textContent);
    check(boxes.some(b => b.includes("가을 소풍 안내문 써 줘")), "실습4 — 역할 없는 부탁");
    check(boxes.some(b => b.includes("20년 경력의 어린이집 원감") && b.includes("가을 소풍")),
          "실습4 — 역할 얹은 부탁");
    check(!errs.length, `실습4 — 오류 없음 ${errs.slice(0,1)}`);
  }

  /* ── 실습 5 : 앞 실습이 따라오나 ── */
  {
    const { w, d } = await open("practice.html", "part=1&id=1-5");
    const recalls = [...d.querySelectorAll(".recall .rv")].map(e => e.textContent);
    check(recalls.some(r => r.includes("20년 경력")), "실습5 — 실습4의 역할이 따라옴");

    const type = (id, v) => { const el = d.querySelector("#f_" + id); el.value = v;
                              el.dispatchEvent(new w.Event("input", { bubbles:true })); };
    type("p5_ctx","10월 15일 도토리공원으로 가을 소풍을 갑니다.");
    type("p5_task","이 내용으로 가정통신문을 써 주세요.");
    type("p5_form","일정, 준비물, 유의사항 순서로. A4 한 장.");
    const built = [...d.querySelectorAll(".pbox pre")].map(e => e.textContent)
                    .find(b => b.includes("도토리공원"));
    check(!!built, "실습5 — 뼈대 부탁 조립");
    check(built && built.includes("20년 경력의 어린이집 원감"), "실습5 — 역할이 앞에 붙음");
    check(built && built.includes("먼저 질문해 주세요"), "실습5 — 안전핀 한 줄");
    check(built && !built.includes("{{"), "실습5 — 치환 안 된 자리 없음");
    check(built && !built.includes("□□□"), "실습5 — 채운 칸에 빈칸 표시 없음");
  }

  /* ── 실습 6 : 총동원 ── */
  {
    const { w, d } = await open("practice.html", "part=1&id=1-6");
    const type = (id, v) => { const el = d.querySelector("#f_" + id); el.value = v;
                              el.dispatchEvent(new w.Event("input", { bubbles:true })); };
    type("p6_ex1","가을이 깊어 가는 요즘, OO어린이집 뜰의 은행잎도 물이 들었습니다.");
    const big = d.querySelector(".pbox pre").textContent;
    check(big.includes("20년 경력"),   "실습6 — 역할 들어옴");
    check(big.includes("정원 49명"),   "실습6 — 소개 카드 들어옴");
    check(big.includes("은행잎"),      "실습6 — 예시 들어옴");
    check(big.includes("도토리공원"),  "실습6 — 실습5의 맥락 들어옴");
    check(!big.includes("{{"),         "실습6 — 치환 완료");
    check(!/\n\n\n/.test(big),         "실습6 — 빈 줄 정리됨");

    // 복사
    d.querySelector("[data-bcopy]").click();
    await new Promise(r => setTimeout(r, 40));
    check((w.__clip || "").includes("20년 경력"), "실습6 — 복사 버튼이 클립보드에 넣음");
    check(!!d.querySelector("#toast.on"), "실습6 — 복사 안내 표시");
  }

  /* ── 마무리 : 비품 상자 ── */
  {
    const { d } = await open("practice.html", "part=1&id=1-9");
    const on = n(d, ".kit li.on");
    check(on >= 3, `마무리 — 비품 상자가 만들어진 것 ${on}개 인식`);
    check(n(d, ".check label") === 5, "마무리 — 채점표 5줄");
  }

  /* ── 짧은 장이 열자마자 완독으로 잡히지 않는지 ── */
  {
    STORE["wai_done"] = "{}";
    const { d } = await open("read.html", "kind=novel&part=1&ch=5");
    await new Promise(r => setTimeout(r, 200));
    const done = JSON.parse(STORE["wai_done"] || "{}");
    check(!done["novel-1-5"], "읽기 — 열자마자 완독 처리되지 않음 (머문 시간 조건)");

    STORE["wai_done"] = "{}";
    const { d: p } = await open("practice.html", "part=1&id=1-4");
    await new Promise(r => setTimeout(r, 200));
    check(!JSON.parse(STORE["wai_done"] || "{}")["practice-1-1-4"],
          "실습 — 열자마자 완료 처리되지 않음");
  }

  /* ── 내 기기를 통계에서 빼는 스위치 ── */
  {
    const { w } = await open("index.html", "tester=1");
    check(STORE["wai_tester"] === "1", "통계 제외 — ?tester=1 로 켜짐");
    check(!!w.document.getElementById("tester-badge"), "통계 제외 — 화면에 딱지 표시");
    const { w: w2 } = await open("index.html", "tester=0");
    check(STORE["wai_tester"] === "0", "통계 제외 — ?tester=0 으로 풀림");
    check(!w2.document.getElementById("tester-badge"), "통계 제외 — 풀리면 딱지 사라짐");
  }

  /* ── 진도 반영 ── */
  {
    STORE["wai_done"] = JSON.stringify({
      "novel-1-1": { at: Date.now() },
      "novel-1-2": { at: Date.now() }
    });

    const { d } = await open("index.html");
    check(n(d, "#resume .btn") === 1, "홈 — 이어서 하기 카드");
    check(txt(d, ".prog .pct") !== "0%", `홈 — 1부 진도 ${txt(d, ".prog .pct")}`);
    check(n(d, ".toc-item.done") === 2, `홈 — 읽은 장 ✓ 표시 ${n(d, ".toc-item.done")}개`);
    check([...d.querySelectorAll(".toc-item")].every(a => !a.getAttribute("href").includes("undefined")),
          "홈 — 모든 링크에 부 번호가 들어감");
    check(d.querySelector("#welcome").style.display !== "block",
          "홈 — 재방문자에겐 첫 방문 안내를 안 띄움");
    const nextTitle = txt(d, "#resume p:nth-of-type(2)");
    check(nextTitle.includes("실습 0"),
          `홈 — 이어서 할 곳이 단계 순서를 따름 (${nextTitle.trim()})`);
  }

  /* ── 관리자 ── */
  {
    const { d } = await open("admin.html");
    // CONFIG는 const라 window에 안 붙으므로 app.js 원문으로 판단합니다.
    // 주소만 있고 키가 자리표시자면 아직 '설정 전'입니다 — 통계가 한 건도 안 쌓입니다.
    const cfg = fs.readFileSync(path.join(WEB, "assets/app.js"), "utf8");
    const configured = /SUPABASE_URL:\s*"https?:\/\//.test(cfg) &&
                       /SUPABASE_ANON_KEY:\s*"(eyJ|sb_)/.test(cfg);
    const shown = configured ? "#login" : "#setup";
    check(d.querySelector(shown).style.display === "block",
          configured ? "관리자 — 로그인 화면 표시"
                     : "관리자 — 설정 전 안내 화면 (이 폴더 app.js에는 키가 없는 것이 정상)");
    check(d.querySelector("#dash").style.display === "none", "관리자 — 로그인 전엔 대시보드 숨김");
  }

  /* ── 파일 존재 ── */
  {
    const need = ["index.html","read.html","practice.html","admin.html",
                  "assets/app.js","assets/style.css","assets/practice.json",
                  "assets/content/index.json","supabase.sql"];
    need.forEach(f => check(fs.existsSync(path.join(WEB, f)), "파일 — " + f));
    check(fs.existsSync(path.join(WEB, "assets/content/part1.json")), "파일 — part1.json (열린 부)");
    check(!fs.existsSync(path.join(WEB, "assets/content/part2.json")),
          "파일 — 잠긴 부의 원고는 올라가지 않음");
  }

  console.log(ok.join("\n"));
  if(ng.length){ console.log("\n" + ng.join("\n")); console.log(`\n실패 ${ng.length}건 / 통과 ${ok.length}건`); process.exit(1); }
  console.log(`\n전부 통과 — ${ok.length}건`);
})();
