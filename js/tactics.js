// 수읽기 엔진: 단수·축(사다리)·장문(그물)으로 돌이 잡히는지 읽고, 잡히는 수순을 돌려줌
(function () {
  'use strict';
  const Go = window.Go;
  const { EMPTY } = Go;

  let budget = 0;

  // 공격자 A 차례: 그룹(s)을 잡을 수 있으면 수순 [{i,c}...] 반환, 아니면 null
  function attack(b, s, A, depth, net) {
    if (--budget < 0) return null;
    const g = b.group(s);
    const L = g.libs;
    if (L.length === 1) {
      const bb = b.clone();
      return bb.play(L[0], A) ? [{ i: L[0], c: A }] : null;
    }
    if (L.length > 2 || depth <= 0) return null;

    const cands = L.slice();
    if (net) {
      // 장문(그물) 후보: 활로 옆의 빈 자리
      for (const l of L) {
        for (const n of b.nbr[l]) {
          if (b.grid[n] === EMPTY && !cands.includes(n)) cands.push(n);
        }
      }
    }
    for (const m of cands) {
      const bb = b.clone();
      if (!bb.play(m, A)) continue;
      if (bb.grid[s] === EMPTY) return [{ i: m, c: A }];
      const r = defend(bb, s, A, depth - 1);
      if (r) return [{ i: m, c: A }, ...r];
    }
    return null;
  }

  // 수비자 차례: 어떤 방법으로도 못 살면 (가장 긴) 잡히는 수순 반환, 살 수 있으면 null
  function defend(b, s, A, depth) {
    if (--budget < 0) return null;
    const D = 3 - A;
    const g = b.group(s);
    const cands = g.libs.slice();
    // 단수에 걸린 공격자 돌을 따내서 사는 수
    const seen = new Set();
    for (const st of g.stones) {
      for (const n of b.nbr[st]) {
        if (b.grid[n] === A && !seen.has(n)) {
          const og = b.group(n);
          og.stones.forEach((x) => seen.add(x));
          if (og.libs.length === 1 && !cands.includes(og.libs[0])) cands.push(og.libs[0]);
        }
      }
    }
    let best = null, any = false;
    for (const m of cands) {
      const bb = b.clone();
      if (!bb.play(m, D)) continue;
      any = true;
      const ng = bb.group(s);
      if (ng.libs.length >= 3) return null; // 탈출 성공
      const r = attack(bb, s, A, depth - 1, false);
      if (!r) return null;
      const line = [{ i: m, c: D }, ...r];
      if (!best || line.length > best.length) best = line;
    }
    if (!any) return attack(b, s, A, depth - 1, false);
    return best;
  }

  function classify(b, s, line, A) {
    const g0 = b.group(s);
    const atk = line.filter((m) => m.c === A);
    const def = line.filter((m) => m.c !== A);
    const bb = b.clone();
    let captured = [];
    for (const mv of line) {
      const cap = bb.play(mv.i, mv.c) || [];
      if (mv.c === A && cap.includes(s)) captured = cap;
    }
    let kind = 'chase';
    if (b.grid[s] !== EMPTY && atk.length && !g0.libs.includes(atk[0].i) && line[0].c === A && atk.length > 1) kind = 'net';
    else if (atk.length === 1 && def.length === 0) kind = 'atari-take';
    else if (def.length >= 2) kind = 'ladder';
    return { line, kind, captured, size: captured.length };
  }

  // A가 먼저 둘 때 s 그룹을 잡을 수 있나?
  Go.captureLine = function (b, s, A, opts) {
    opts = opts || {};
    if (b.grid[s] === EMPTY || b.grid[s] === A) return null;
    if (b.group(s).libs.length > 2) return null;
    budget = opts.budget || 2000;
    const line = attack(b, s, A, opts.depth || 60, opts.net !== false);
    return line ? classify(b, s, line, A) : null;
  };

  // s 그룹 주인이 먼저 둬도 A에게 잡히나? (= 이미 도망칠 수 없음)
  Go.defenseFails = function (b, s, A, opts) {
    opts = opts || {};
    if (b.grid[s] === EMPTY || b.grid[s] === A) return null;
    if (b.group(s).libs.length > 2) return null;
    budget = opts.budget || 2000;
    const line = defend(b, s, A, opts.depth || 60);
    return line ? classify(b, s, line, A) : null;
  };

  Go.KIND_NAME = { 'atari-take': '단수 따냄', chase: '몰아잡기', ladder: '축(사다리)', net: '장문(그물)' };

  // 수순 각 단계에 설명 붙이기. target/tColor: 관심 대상 돌과 그 색
  Go.annotate = function (base, seq, target, tColor) {
    const b = base.clone();
    const size = b.size;
    return seq.map((mv, k) => {
      const cap = b.play(mv.i, mv.c) || [];
      const who = Go.colorName(mv.c), at = Go.label(size, mv.i);
      const alive = b.grid[target] === tColor;
      const libs = alive ? b.group(target).libs.length : 0;
      let note;
      if (!alive) note = `${who} ${at} — 돌 ${cap.length}개를 따냈어요. 잡혔습니다!`;
      else if (mv.c === tColor) {
        if (cap.length) note = `${who} ${at} — 상대 돌 ${cap.length}개를 따내며 버팀 (활로 ${libs}개)`;
        else if (k === 0) note = `${who} ${at}에 둠 — 이 돌의 활로는 ${libs}개`;
        else note = `${who} ${at} — 도망침 (활로 ${libs}개)`;
      } else {
        if (cap.length) note = `${who} ${at} — 돌 ${cap.length}개를 따냄`;
        else if (libs === 1) note = `${who} ${at} — 단수! (활로가 1개만 남음)`;
        else note = `${who} ${at} — 도망길을 막음 (활로 ${libs}개)`;
      }
      return { i: mv.i, c: mv.c, note, captured: cap };
    });
  };
})();
