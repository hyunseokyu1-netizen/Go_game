// 형세분석: 세력(영향력) 기반 집 추정, 죽은 돌 추정, 최종 계가
(function () {
  'use strict';
  const Go = window.Go;
  const { EMPTY, BLACK, WHITE } = Go;
  const DECAY = [1, 1, 0.55, 0.28, 0.12];

  // 그룹에서 빈 점·같은 색 돌을 따라 퍼진 영역 크기와 눈 개수
  function regionInfo(b, gr) {
    const c = gr.color, M = Go.stamp(b.N), t = ++M.t;
    const stack = gr.stones.slice();
    for (const s of stack) M.a[s] = t;
    let empty = 0, eyes = 0, stones = 0;
    while (stack.length) {
      const p = stack.pop();
      if (b.grid[p] === EMPTY) {
        empty++;
        if (b.nbr[p].every((n) => b.grid[n] === c)) eyes++;
        if (empty > 40) return { empty, eyes, stones, open: true };
      } else stones++;
      for (const n of b.nbr[p]) {
        if (M.a[n] !== t && (b.grid[n] === EMPTY || b.grid[n] === c)) { M.a[n] = t; stack.push(n); }
      }
    }
    return { empty, eyes, stones, open: false };
  }

  function guessDead(b, gs, useTactics) {
    const dead = new Set();
    for (const gr of gs.list) {
      let isDead = false;
      const A = 3 - gr.color;
      if (useTactics && gr.libs.length <= 2) {
        const r = b.toPlay === A
          ? Go.captureLine(b, gr.stones[0], A, { budget: 500 })
          : Go.defenseFails(b, gr.stones[0], A, { budget: 500 });
        if (r) isDead = true;
      }
      if (!isDead) {
        const r = regionInfo(b, gr);
        if (!r.open && r.eyes < 2) {
          if (r.empty <= 4 || (r.empty <= 7 && r.stones <= 6)) isDead = true;
          else if (r.empty <= 15) gr.weak = true;
        }
      }
      if (isDead) gr.stones.forEach((s) => dead.add(s));
    }
    return dead;
  }

  // 형세 추정. own[i]: +1(흑 집/돌) ~ -1(백 집/돌)
  Go.estimate = function (b, komi, opts) {
    opts = opts || {};
    const N = b.N, g = b.grid, gs = b.groups();
    const dead = opts.dead || guessDead(b, gs, opts.tactics !== false);
    const deadMask = new Uint8Array(N);
    dead.forEach((s) => (deadMask[s] = 1));
    const weight = gs.list.map((gr) => {
      const L = gr.libs.length;
      let w = L >= 3 ? 1 : L === 2 ? 0.75 : 0.4;
      if (gr.weak) w *= 0.6;
      return w;
    });

    const inf = new Float32Array(N);
    const M = Go.stamp(N);
    for (let i = 0; i < N; i++) {
      const c = g[i];
      if (!c || deadMask[i]) continue;
      const w = weight[gs.id[i]] * (c === BLACK ? 1 : -1), o = 3 - c;
      const t = ++M.t;
      let head = 0, tail = 0;
      M.q[tail++] = i; M.a[i] = t; M.d[i] = 0;
      while (head < tail) {
        const p = M.q[head++], d = M.d[p];
        inf[p] += w * DECAY[d];
        if (d >= 4) continue;
        const nb = b.nbr[p];
        for (let j = 0; j < nb.length; j++) {
          const n = nb[j];
          if (M.a[n] === t) continue;
          if (g[n] === o && !deadMask[n]) continue; // 상대 돌이 세력을 막음
          M.a[n] = t; M.d[n] = d + 1; M.q[tail++] = n;
        }
      }
    }

    const own = new Float32Array(N);
    let tB = 0, tW = 0, dB = 0, dW = 0;
    for (let i = 0; i < N; i++) {
      const c = g[i];
      if (c) {
        if (deadMask[i]) { own[i] = c === BLACK ? -1 : 1; if (c === BLACK) dB++; else dW++; }
        else own[i] = c === BLACK ? 1 : -1;
      } else own[i] = Math.tanh(inf[i] * 0.9);
    }
    // 한 가지 색으로만 완전히 둘러싸인 (작은) 빈 영역은 확정 집으로 본다
    const seen = new Uint8Array(N), limit = Math.max(12, N * 0.3);
    for (let i = 0; i < N; i++) {
      if (seen[i] || (g[i] !== EMPTY && !deadMask[i])) continue;
      const region = [i];
      seen[i] = 1;
      let border = 0;
      for (let k = 0; k < region.length; k++) {
        for (const n of b.nbr[region[k]]) {
          if (g[n] === EMPTY || deadMask[n]) { if (!seen[n]) { seen[n] = 1; region.push(n); } }
          else border |= g[n];
        }
      }
      if ((border === BLACK || border === WHITE) && region.length <= limit) {
        const v = border === BLACK ? 1 : -1;
        for (const p of region) if (g[p] === EMPTY) own[p] = v;
      }
    }
    for (let i = 0; i < N; i++) {
      if (g[i] !== EMPTY) continue;
      const v = own[i];
      if (v > 0) tB += v; else tW -= v;
    }
    const black = tB + b.captures[BLACK] + 2 * dW;
    const white = tW + b.captures[WHITE] + 2 * dB + komi;
    return { own, black, white, diff: black - white, dead, terrB: tB, terrW: tW, deadB: dB, deadW: dW };
  };

  // 흑 승리 확률(대략)
  Go.winProb = function (b, diff) {
    const progress = Math.min(1, b.moveNum / (b.N * 0.7));
    const scale = b.size * 0.6 * (1 - 0.6 * progress);
    return 1 / (1 + Math.exp(-diff / scale));
  };

  // 최종 계가 (집 + 따낸 돌 + 죽은 돌), 한국식 계가
  Go.scoreFinal = function (b, dead, komi) {
    const N = b.N, g = b.grid.slice();
    let capB = b.captures[BLACK], capW = b.captures[WHITE];
    for (const s of dead) {
      if (g[s] === BLACK) capW++;
      else if (g[s] === WHITE) capB++;
      g[s] = EMPTY;
    }
    const own = new Float32Array(N), seen = new Uint8Array(N);
    let tB = 0, tW = 0;
    for (let i = 0; i < N; i++) {
      if (g[i] === BLACK) own[i] = 1;
      else if (g[i] === WHITE) own[i] = -1;
    }
    for (let i = 0; i < N; i++) {
      if (g[i] !== EMPTY || seen[i]) continue;
      const region = [i];
      let border = 0;
      seen[i] = 1;
      for (let k = 0; k < region.length; k++) {
        for (const n of b.nbr[region[k]]) {
          if (g[n] === EMPTY) { if (!seen[n]) { seen[n] = 1; region.push(n); } }
          else border |= g[n];
        }
      }
      if (border === BLACK) { tB += region.length; region.forEach((p) => (own[p] = 1)); }
      else if (border === WHITE) { tW += region.length; region.forEach((p) => (own[p] = -1)); }
    }
    return { own, terrB: tB, terrW: tW, capB, capW, black: tB + capB, white: tW + capW + komi, komi };
  };
})();
