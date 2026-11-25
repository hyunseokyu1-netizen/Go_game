// 조언 엔진: 모든 빈 자리를 평가해 추천수·위험수·이유를 만든다. AI도 이 엔진을 사용.
(function () {
  'use strict';
  const Go = window.Go;
  const { BLACK, EMPTY, PASS } = Go;

  function lineOf(size, i) {
    const x = i % size, y = Math.floor(i / size);
    return Math.min(x, y, size - 1 - x, size - 1 - y) + 1;
  }

  function openingBonus(b, i) {
    const l = lineOf(b.size, i), big = b.size >= 13;
    const phase = b.moveNum / (b.N * (big ? 0.2 : 0.25));
    if (phase < 1) {
      const v = l === 1 ? -4 : l === 2 ? -2 : l === 3 ? 1.5 : l === 4 ? (big ? 1.5 : 0.5) : big ? 0 : 0.3;
      return v * (1 - phase);
    }
    return l === 1 ? -0.4 : 0;
  }

  function evalMove(b, i, ctx) {
    const { P, opp, sgn } = ctx;
    const size = b.size;
    const L = (x) => Go.label(size, x);
    const e = {
      i, P, score: 0, reasons: [], warnings: [], captured: 0, capturedStones: [],
      danger: null, kills: [], ataris: [], saves: [], lost: [], ownEye: false, libs: 0, gain: 0,
    };

    if (b.nbr[i].every((n) => b.grid[n] === P)) {
      e.ownEye = true;
      e.score = -99;
      e.warnings.push('내 집(눈)을 스스로 메우는 수예요. 눈이 사라지면 돌이 약해지고 집도 줄어요.');
      return e;
    }

    const bb = b.clone();
    const cap = bb.play(i, P);
    e.captured = cap.length;
    e.capturedStones = cap;
    const my = bb.group(i);
    e.libs = my.libs.length;
    e.groupSize = my.stones.length;

    // 1) 이 돌이 잡히는가?
    if (my.libs.length <= 2) {
      const d = Go.captureLine(bb, i, opp, { budget: ctx.budget });
      if (d) e.danger = d;
    }

    // 2) 이웃한 상대 돌을 잡거나 단수 치는가?
    const seen = new Set();
    for (const s of my.stones) {
      for (const n of bb.nbr[s]) {
        if (bb.grid[n] !== opp || seen.has(n)) continue;
        const og = bb.group(n);
        og.stones.forEach((x) => seen.add(x));
        if (og.libs.length > 2) continue;
        const k = Go.defenseFails(bb, n, P, { budget: ctx.budget });
        if (k) e.kills.push({ rep: n, stones: og.stones, danger: k });
        else if (og.libs.length === 1) e.ataris.push({ rep: n, stones: og.stones });
      }
    }

    // 3) 위험한 내 돌을 살리는가?
    for (const t of ctx.threats) {
      const relevant = t.relevant.has(i) || cap.some((c) => t.adjOpp.has(c));
      if (!relevant || bb.grid[t.rep] !== P) { e.lost.push(t); continue; }
      const still = Go.captureLine(bb, t.rep, opp, { budget: ctx.budget });
      if (still) e.lost.push(t); else e.saves.push(t);
    }

    // 4) 형세(집) 변화
    const est = Go.estimate(bb, 0, { tactics: false });
    const gain = est.diff * sgn - ctx.base;
    e.gain = gain;

    let s = gain + e.captured * 0.5;
    if (e.danger) s -= Math.max(gain, 0) * 0.9 + e.danger.size * 2 + 4;
    for (const t of e.saves) s += t.size * 2.5 + 3;
    if (!e.danger) for (const k of e.kills) s += k.stones.length * 2 + 3;
    s += Math.min(e.ataris.length, 2) * 0.7;
    const ob = openingBonus(b, i);
    // 초반에 이유 없이 상대 돌에 바로 붙이는 수는 감점
    const early = b.moveNum < b.N * 0.15;
    const contact = early && !e.captured && !e.kills.length && !e.saves.length && !e.ataris.length && b.nbr[i].some((n) => b.grid[n] === opp);
    s += ob + (contact ? -2.5 : 0);
    e.score = s;

    // 이유 / 경고 문장
    if (e.captured) e.reasons.push(`상대 돌 <b>${e.captured}개</b>를 따내요.`);
    for (const t of e.saves) e.reasons.push(`위험한 내 돌 ${t.size}개(${L(t.rep)})를 살려요.`);
    if (!e.danger) for (const k of e.kills) e.reasons.push(`상대 돌 <b>${k.stones.length}개</b>를 잡을 수 있어요 — ${Go.KIND_NAME[k.danger.kind]}으로 도망칠 길이 없어요.`);
    if (e.ataris.length && !e.kills.length) e.reasons.push('상대 돌에 <b>단수</b>를 쳐요 (활로가 1개만 남아요). 상대는 도망가야 해요.');
    if (gain >= 1.5 && !e.danger) e.reasons.push(`형세가 약 <b>${gain.toFixed(1)}집</b> 좋아져요.`);
    const l = lineOf(size, i);
    if (ob > 0.5 && (l === 3 || l === 4) && early) e.reasons.push('초반에는 귀와 변의 3선·4선을 먼저 차지하는 게 좋아요.');

    if (e.danger) e.warnings.push(Go.dangerText(b, e));
    else if (e.libs === 1) e.warnings.push('놓은 뒤 활로가 1개뿐이에요. 지금은 바로 잡히지 않지만 조심하세요.');
    if (contact && !e.danger) e.warnings.push('초반부터 상대 돌에 바로 붙이면 상대를 강하게 만들어 줘요. 조금 떨어져서 넓게 두는 게 좋아요.');
    if (ob <= -1.5) e.warnings.push(l === 1 ? '초반의 1선은 너무 낮아 집을 거의 못 만들어요.' : '초반의 2선은 낮아서 효율이 떨어져요.');
    if (!e.saves.length) for (const t of e.lost) e.warnings.push(`${L(t.rep)} 쪽 내 돌 ${t.size}개가 여전히 위험해요.`);
    return e;
  }

  Go.dangerText = function (b, e) {
    const d = e.danger;
    const opp = Go.colorName(3 - e.P);
    const first = Go.label(b.size, d.line[0].i);
    const n = d.size;
    switch (d.kind) {
      case 'atari-take':
        return `여기에 두면 활로가 1개(<b>${first}</b>)뿐인 <b>단수</b> 상태가 돼요. ${opp}이 ${first}에 두면 돌 ${n}개가 바로 따내져요.`;
      case 'ladder':
        return `<b>축(사다리)</b>에 걸려요. ${opp}이 <b>${first}</b>에 단수를 치고 계속 같은 방식으로 몰면, 지그재그로 도망가도 판 끝이나 상대 돌에 막혀 돌 ${n}개가 잡혀요. (모두 ${d.line.length}수)`;
      case 'net':
        return `<b>장문(그물)</b>에 걸려요. ${opp}이 <b>${first}</b>에 씌우면 어느 쪽으로 나가도 막혀서 돌 ${n}개가 잡혀요.`;
      default:
        return `활로가 ${e.libs}개뿐이라 약해요. ${opp}이 <b>${first}</b>에 두어 몰아붙이면 도망쳐도 활로가 늘지 않아 결국 돌 ${n}개가 잡혀요.`;
    }
  };

  // 현재 국면을 P 입장에서 분석
  Go.analyzePosition = function (b, P, opts) {
    opts = opts || {};
    const budget = opts.budget || 1200;
    const opp = 3 - P, sgn = P === BLACK ? 1 : -1;
    const gs = b.groups();
    const threats = [], chances = [];
    for (const g of gs.list) {
      if (g.libs.length > 2) continue;
      const rep = g.stones[0];
      if (g.color === P) {
        const d = Go.captureLine(b, rep, opp, { budget: budget * 2 });
        if (!d) continue;
        const relevant = new Set(g.libs), adjOpp = new Set(), seen = new Set();
        for (const s of g.stones) {
          for (const n of b.nbr[s]) {
            if (b.grid[n] === opp && !seen.has(n)) {
              const og = b.group(n);
              og.stones.forEach((x) => { seen.add(x); adjOpp.add(x); });
              if (og.libs.length <= 2) og.libs.forEach((l) => relevant.add(l));
            }
          }
        }
        for (const l of g.libs) for (const n of b.nbr[l]) if (b.grid[n] === EMPTY) relevant.add(n);
        threats.push({ rep, size: g.stones.length, stones: g.stones, libs: g.libs, danger: d, relevant, adjOpp });
      } else {
        const d = Go.captureLine(b, rep, P, { budget: budget * 2 });
        if (d) chances.push({ rep, size: g.stones.length, stones: g.stones, danger: d });
      }
    }

    const base = Go.estimate(b, 0, { tactics: false }).diff * sgn;
    const ctx = { P, opp, sgn, base, threats, budget };
    const evals = new Map();
    for (let i = 0; i < b.N; i++) {
      if (b.grid[i] !== EMPTY) continue;
      const why = b.checkLegal(i, P);
      if (why) { evals.set(i, { i, P, illegal: why }); continue; }
      evals.set(i, evalMove(b, i, ctx));
    }
    const ranked = [...evals.values()].filter((e) => !e.illegal && !e.ownEye).sort((a, c) => c.score - a.score);
    ranked.forEach((e, k) => (e.rank = k + 1));
    const late = b.moveNum > b.N * 0.45;
    const best = ranked[0];
    const suggestPass = !best || best.score < 0 || (late && best.score < 0.6);
    for (const c of chances) {
      const e = evals.get(c.danger.line[0].i);
      c.move = c.danger.line[0].i;
      c.eval = e;
    }
    for (const t of threats) {
      const saver = ranked.find((e) => e.saves.includes(t));
      t.saveMove = saver ? saver.i : -1;
    }
    return { P, evals, ranked, threats, chances, suggestPass };
  };

  // AI 수 선택. level: 1 쉬움, 2 보통, 3 어려움
  Go.chooseAIMove = function (an, level, b) {
    const r = an.ranked;
    if (!r.length) return { i: PASS, reasons: ['둘 곳이 없어 패스해요.'] };
    const best = r[0];
    const late = b.moveNum > b.N * 0.45;
    if (best.score < 0 || (late && best.score < 0.6) || (b.passes > 0 && best.score < 1.2)) {
      return { i: PASS, reasons: ['더 이상 이득을 볼 곳이 없어 패스해요.'] };
    }
    if (level >= 3) return best;
    const n = level === 1 ? 10 : 4;
    const margin = level === 1 ? 9 : 3.5;
    const temp = level === 1 ? 3 : 1.2;
    let pool = r.slice(0, n).filter((e) => e.score > best.score - margin && e.score > Math.min(0.3, best.score) && (level === 1 || !e.danger));
    if (!pool.length) pool = [best];
    const ws = pool.map((e) => Math.exp((e.score - best.score) / temp));
    let x = Math.random() * ws.reduce((a, c) => a + c, 0);
    for (let k = 0; k < pool.length; k++) { x -= ws[k]; if (x <= 0) return pool[k]; }
    return pool[0];
  };
})();
