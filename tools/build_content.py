#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
원고(docx) → 웹 콘텐츠(content.json) 변환기

쓰는 법
    python3 tools/build_content.py

원고를 고친 뒤 이 스크립트를 다시 돌리면 사이트에 그대로 반영됩니다.
손으로 옮겨 적을 일은 없습니다.

읽어 들이는 파일 (원장님AI 폴더 기준)
    소설    원장{N}부_{MM}장_*.docx
    개념서  원장개념서{N}편_{M}장_*.docx  ·  원장개념서{N}편_부록_*.docx
실습서는 손으로 만든 practice.json을 쓰므로 여기서 다루지 않습니다.
"""

import json, os, re, sys, glob

try:
    from docx import Document
except ImportError:
    sys.exit("python-docx가 필요합니다:  pip install python-docx")

HERE = os.path.dirname(os.path.abspath(__file__))
WEB = os.path.dirname(HERE)
SRC = os.path.normpath(os.path.join(WEB, "..", "원장님AI"))
OUTDIR = os.path.join(WEB, "assets", "content")

# 지금 열어 둘 부. 나머지는 목차에 '준비 중'으로만 보입니다.
OPEN_PARTS = [1]

PART_TITLES = {
    1: "AI라는 새 선생님",
    2: "글의 산을 넘다",
    3: "서류라는 미로",
    4: "숫자가 말을 걸다",
    5: "큰 산, 평가제",
    6: "AI와 함께 가는 어린이집",
}

# 본문에서 따로 떼어 보여 줄 안내 문구들
CALLOUTS = ("막혔을 때", "원칙 한 줄 점검", "다음 실습 예고", "다음 장 예고",
            "다음 예고", "요령 하나", "연장통에 넣은 것", "한 줄 요약",
            "비품 상자에 넣은 것", "오늘의 한 줄")


def style_of(p):
    try:
        return p.style.name or ""
    except Exception:
        return ""


def texts(path):
    """(스타일, 본문) 목록. 빈 문단은 버린다."""
    doc = Document(path)
    out = []
    for p in doc.paragraphs:
        t = p.text.strip()
        if t:
            out.append((style_of(p), t))
    return out


def classify(style, t):
    """문단 한 줄이 무엇인지 판정한다."""
    if style.startswith("Heading 2"):
        return {"t": "h", "x": t}
    if re.match(r"^[□☐]\s*", t):
        return {"t": "check", "x": re.sub(r"^[□☐]\s*", "", t)}
    if re.match(r"^_{5,}$", t):
        return {"t": "blank"}
    for c in CALLOUTS:
        if t.startswith(c + " —") or t.startswith(c + " -"):
            head, _, body = t.partition("—")
            return {"t": "note", "h": head.strip(), "x": body.strip()}
    # 통째로 따옴표에 싸인 줄 = AI에 그대로 쳐 볼 부탁
    if re.match(r'^["“].+["”]$', t) and len(t) > 12:
        return {"t": "prompt", "x": t.strip("\"“”")}
    return {"t": "p", "x": t}


def parse_chapter(path, kind):
    rows = texts(path)
    if not rows:
        return None

    series = rows[0][1]
    title, sub, pair = "", "", ""
    body_from = 1

    for i, (s, t) in enumerate(rows):
        if s.startswith("Heading 1"):
            title = re.sub(r"^(\d+\s*장|실습\s*\d+|마무리|부록)", "", t)
            title = title.lstrip(" .·-—").strip()
            body_from = i + 1
            break

    # 제목 바로 다음 짧은 줄 = 부제
    if body_from < len(rows):
        s, t = rows[body_from]
        if not s.startswith("Heading") and len(t) < 45 and not t.startswith("짝꿍"):
            sub = t
            body_from += 1

    blocks = []
    for s, t in rows[body_from:]:
        if t.startswith("짝꿍"):
            pair = t.replace("짝꿍 —", "").replace("짝꿍 -", "").strip()
            continue
        if t.startswith("예상 시간"):
            continue
        blocks.append(classify(s, t))

    words = sum(len(b.get("x", "")) for b in blocks)
    return {
        "title": title or os.path.basename(path),
        "sub": sub,
        "pair": pair,
        "series": series,
        "kind": kind,
        "chars": words,
        "minutes": max(2, round(words / 500)),   # 분당 500자 기준
        "blocks": blocks,
    }


def collect(part):
    novel, concept = [], []

    pat = os.path.join(SRC, f"원장{part}부_*장_*.docx")
    for f in sorted(glob.glob(pat)):
        m = re.search(r"_(\d+)장_", os.path.basename(f))
        ch = parse_chapter(f, "novel")
        if ch:
            ch["ch"] = int(m.group(1)) if m else len(novel) + 1
            novel.append(ch)

    pat = os.path.join(SRC, f"원장개념서{part}편_*.docx")
    for f in sorted(glob.glob(pat)):
        base = os.path.basename(f)
        m = re.search(r"_(\d+)장_", base)
        ch = parse_chapter(f, "concept")
        if not ch:
            continue
        if m:
            ch["ch"] = int(m.group(1))
        else:                      # 부록
            ch["ch"] = 99
            ch["title"] = "부록 · " + ch["title"]
        concept.append(ch)

    novel.sort(key=lambda c: c["ch"])
    concept.sort(key=lambda c: c["ch"])
    return novel, concept


def slim(ch):
    """목차용 — 본문은 빼고 제목과 분량만."""
    return {k: ch[k] for k in ("ch", "title", "sub", "pair", "minutes") if k in ch}


def main():
    if not os.path.isdir(SRC):
        sys.exit(f"원고 폴더를 못 찾았습니다: {SRC}")

    os.makedirs(OUTDIR, exist_ok=True)
    index = []

    for n in range(1, 7):
        novel, concept = collect(n)
        if not novel and not concept:
            continue

        # 본문 파일은 '열린 부'만 만듭니다.
        # 잠긴 부의 원고를 웹에 올려 두면 주소만 알면 누구나 읽을 수 있습니다.
        path = os.path.join(OUTDIR, f"part{n}.json")
        if n in OPEN_PARTS:
            with open(path, "w", encoding="utf-8") as fp:
                json.dump({"n": n, "novel": novel, "concept": concept},
                          fp, ensure_ascii=False, separators=(",", ":"))
        elif os.path.exists(path):
            os.remove(path)

        index.append({
            "n": n,
            "title": PART_TITLES.get(n, f"{n}부"),
            "open": n in OPEN_PARTS,
            "novel": [slim(c) for c in novel],
            "concept": [slim(c) for c in concept],
        })
        if n in OPEN_PARTS:
            kb = os.path.getsize(path) / 1024
            print(f"  {n}부 「{PART_TITLES.get(n)}」 — 소설 {len(novel)}장 · "
                  f"개념서 {len(concept)}장 · {kb:.0f} KB · 열림")
        else:
            print(f"  {n}부 「{PART_TITLES.get(n)}」 — 소설 {len(novel)}장 · "
                  f"개념서 {len(concept)}장 · 준비 중 (원고는 올리지 않음)")

    with open(os.path.join(OUTDIR, "index.json"), "w", encoding="utf-8") as fp:
        json.dump({"parts": index}, fp, ensure_ascii=False, separators=(",", ":"))

    ikb = os.path.getsize(os.path.join(OUTDIR, "index.json")) / 1024
    print(f"\n완료 → {OUTDIR}")
    print(f"  목차 index.json {ikb:.0f} KB (첫 화면에서 이것만 내려받습니다)")


if __name__ == "__main__":
    main()
