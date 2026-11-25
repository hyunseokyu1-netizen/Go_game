// 화면/상호작용
(function () {
  'use strict';
  const Go = window.Go;
  const { BLACK, WHITE, EMPTY, PASS } = Go;
  const $ = (id) => document.getElementById(id);
  const canvas = $('board');
  const ctx = canvas.getContext('2d');

  const S = {
    settings: { size: 9, mode: 'ai', human: BLACK, level: 2, komi: 6.5 },
    opts: { eval: true, rec: true, danger: true, confirm: true },
    board: null, history: [], phase: 'play', // play | scoring | over
    analysis: null, est: null, final: null, dead: new Set(),
    hover: -1, selected: -1, highlight: -1,
    demo: null, demoTimer: null, busy: false, token: 0,
    msg: null, lastAI: null, resultText: '',
  };

  try {
    const o = JSON.parse(localStorage.getItem('go-learn-opts') || 'null');
    if (o) Object.assign(S.opts, o);
    const s = JSON.parse(localStorage.getItem('go-learn-settings') || 'null');
    if (s) Object.assign(S.settings, s);
  } catch (e) { /* 저장소 사용 불가 */ }
  function persist() {
    try {
      localStorage.setItem('go-learn-opts', JSON.stringify(S.opts));
      localStorage.setItem('go-learn-settings', JSON.stringify(S.settings));
    } catch (e) { /* 무시 */ }
  }

  const L = (i) => Go.label(S.board.size, i);
  const cname = Go.colorName;
  const stoneIco = (c) => `<span class="stone-ico ${c === BLACK ? 'b' : 'w'}"></span>`;

  // ───────── 게임 진행 ─────────
  function isAITurn() {
    return S.settings.mode === 'ai' && S.phase === 'play' && S.board.toPlay !== S.settings.human;
  }
  function isHumanTurn() {
    return S.phase === 'play' && !isAITurn();
  }

  function newGame() {
    stopDemo();
    S.board = new Go.Board(S.settings.size);
    S.history = [];
    S.phase = 'play';
    S.final = null; S.dead = new Set();
    S.selected = -1; S.hover = -1; S.lastAI = null; S.resultText = '';
    S.msg = { text: S.settings.mode === 'ai'
      ? `새 게임을 시작했어요. 당신은 ${cname(S.settings.human)}이에요. ${S.settings.human === BLACK ? '먼저 두세요!' : '컴퓨터(흑)가 먼저 둡니다.'}`
      : '두 사람이 번갈아 두는 연습 모드예요. 차례인 쪽 기준으로 분석해 줘요.' };
    layout();
    recompute();
  }

  function recompute() {
    const token = ++S.token;
    S.analysis = null; S.est = null;
    if (S.phase !== 'play') { renderAll(); return; }
    S.busy = true;
    renderAll();
    setTimeout(() => {
      if (token !== S.token) return;
      const b = S.board;
      S.est = Go.estimate(b, S.settings.komi, {});
      S.analysis = Go.analyzePosition(b, b.toPlay, {});
      S.busy = false;
      renderAll();
      if (isAITurn()) setTimeout(() => { if (token === S.token) aiMove(); }, 380);
    }, 20);
  }

  function pushHistory() { S.history.push(S.board.clone()); }

  function humanPlay(i) {
    if (!isHumanTurn() || S.busy) return;
    const b = S.board;
    const why = b.checkLegal(i, b.toPlay);
    if (why) { S.msg = { text: why, cls: 'err' }; renderPanels(); return; }
    const e = S.analysis && S.analysis.evals.get(i);
    pushHistory();
    const cap = b.play(i);
    S.selected = -1;
    stopDemo();
    let t = `${cname(3 - b.toPlay)} ${L(i)}에 두었어요.`;
    if (cap.length) t += ` 돌 ${cap.length}개를 따냈어요!`;
    let cls = cap.length ? 'good' : '';
    if (e && e.danger) { t += ' ⚠ 이 돌은 잡힐 위험이 있어요.'; cls = 'err'; }
    S.msg = { text: t, cls };
    S.lastAI = null;
    recompute();
  }

  function doPass() {
    if (!isHumanTurn() || S.busy) return;
    pushHistory();
    S.board.play(PASS);
    S.selected = -1;
    stopDemo();
    S.msg = { text: `${cname(3 - S.board.toPlay)}이 패스했어요. 상대도 패스하면 대국이 끝나요.` };
    if (S.board.passes >= 2) return enterScoring();
    recompute();
  }

  function aiMove() {
    if (!isAITurn() || !S.analysis) return;
    const b = S.board, color = b.toPlay;
    const mv = Go.chooseAIMove(S.analysis, S.settings.level, b);
    pushHistory();
    const cap = b.play(mv.i, color) || [];
    S.lastAI = { i: mv.i, color, reasons: mv.reasons || [], captured: cap.length };
    if (mv.i === PASS) {
      S.msg = { text: `컴퓨터(${cname(color)})가 패스했어요. ${b.passes >= 2 ? '' : '당신도 패스하면 대국이 끝나요.'}` };
      if (b.passes >= 2) return enterScoring();
    } else {
      S.msg = { text: `컴퓨터(${cname(color)})가 ${L(mv.i)}에 두었어요.${cap.length ? ` 당신의 돌 ${cap.length}개를 따냈어요.` : ''}`, cls: cap.length ? 'err' : '' };
    }
    recompute();
  }

  function undo() {
    if (!S.history.length || S.busy) return;
    stopDemo();
    if (S.settings.mode === 'ai') {
      S.board = S.history.pop();
      while (S.history.length && S.board.toPlay !== S.settings.human) S.board = S.history.pop();
    } else {
      S.board = S.history.pop();
    }
    S.phase = 'play'; S.final = null; S.selected = -1; S.lastAI = null;
    S.msg = { text: '한 수 물렀어요.' };
    recompute();
  }

  // ───────── 계가 ─────────
  function enterScoring() {
    stopDemo();
    S.token++;
    S.phase = 'scoring';
    S.busy = false;
    S.dead = new Set(Go.estimate(S.board, S.settings.komi, {}).dead);
    S.final = Go.scoreFinal(S.board, S.dead, S.settings.komi);
    S.msg = { text: '두 번 연속 패스로 대국이 끝났어요. 판에서 ✕ 표시된 돌은 죽은 돌로 추정했어요. 틀렸다면 돌을 눌러 바꾸고 “계가 확정”을 누르세요.' };
    renderAll();
  }
  function toggleDead(i) {
    if (S.board.grid[i] === EMPTY) return;
    const g = S.board.group(i);
    const isDead = S.dead.has(i);
    g.stones.forEach((s) => (isDead ? S.dead.delete(s) : S.dead.add(s)));
    S.final = Go.scoreFinal(S.board, S.dead, S.settings.komi);
    renderAll();
  }
  function finishScoring() {
    const f = S.final;
    const d = f.black - f.white;
    S.phase = 'over';
    S.resultText = d > 0 ? `흑이 ${d.toFixed(1)}집 이겼어요!` : `백이 ${(-d).toFixed(1)}집 이겼어요!`;
    let who = '';
    if (S.settings.mode === 'ai') who = (d > 0) === (S.settings.human === BLACK) ? ' 🎉 축하해요, 당신의 승리예요!' : ' 아쉽네요. 다음 판에서는 추천 수와 위험 표시를 참고해 보세요.';
    S.msg = { text: S.resultText + who, cls: 'good' };
    renderAll();
  }
  function resumePlay() {
    S.phase = 'play'; S.final = null; S.board.passes = 0;
    S.msg = { text: '대국을 이어서 둡니다.' };
    recompute();
  }

  // ───────── 수순 시연 ─────────
  function startDemo(base, seq, target, tColor, title) {
    stopDemo();
    const notes = Go.annotate(base, seq, target, tColor);
    const frames = [base.clone()];
    let b = base.clone();
    for (const mv of seq) { b.play(mv.i, mv.c); frames.push(b.clone()); }
    S.demo = { frames, seq: notes, step: 0, title };
    renderDemo(); draw();
    toggleAutoplay(true);
    canvas.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function stopDemo() {
    if (S.demoTimer) clearInterval(S.demoTimer);
    S.demoTimer = null;
    if (S.demo) { S.demo = null; renderDemo(); draw(); }
  }
  function demoStep(d) {
    if (!S.demo) return;
    const n = S.demo.frames.length - 1;
    S.demo.step = Math.max(0, Math.min(n, S.demo.step + d));
    renderDemo(); draw();
  }
  function toggleAutoplay(force) {
    if (!S.demo) return;
    const on = force !== undefined ? force : !S.demoTimer;
    if (S.demoTimer) { clearInterval(S.demoTimer); S.demoTimer = null; }
    if (on) {
      if (S.demo.step >= S.demo.frames.length - 1) S.demo.step = 0;
      S.demoTimer = setInterval(() => {
        if (!S.demo || S.demo.step >= S.demo.frames.length - 1) { clearInterval(S.demoTimer); S.demoTimer = null; renderDemo(); return; }
        demoStep(1);
      }, 1000);
    }
    renderDemo();
  }
  function renderDemo() {
    const bar = $('demoBar');
    if (!S.demo) { bar.hidden = true; return; }
    bar.hidden = false;
    const d = S.demo, n = d.frames.length - 1;
    $('demoTitle').textContent = d.title;
    $('demoStep').textContent = `${d.step} / ${n}`;
    $('demoNote').innerHTML = d.step === 0
      ? '지금 판에서 시작해요. ▶ 를 눌러 한 수씩 따라가 보세요. (숫자 = 두는 순서)'
      : `<b>${d.step}.</b> ${d.seq[d.step - 1].note}`;
    $('demoPlayBtn').textContent = S.demoTimer ? '⏸ 멈춤' : '⏵ 자동';
  }

  // 데모 종류별 시작
  function demoAction(kind, i, k) {
    const b = S.board, an = S.analysis;
    if (!an) return;
    const P = an.P, opp = 3 - P;
    if (kind === 'danger') {
      const e = an.evals.get(i);
      if (!e || !e.danger) return;
      startDemo(b, [{ i, c: P }, ...e.danger.line], i, P, `${cname(P)} ${L(i)}에 두면 이렇게 잡혀요 (${Go.KIND_NAME[e.danger.kind]})`);
    } else if (kind === 'kill') {
      const e = an.evals.get(i);
      const kl = e && e.kills[k];
      if (!kl) return;
      startDemo(b, [{ i, c: P }, ...kl.danger.line], kl.rep, opp, `${L(i)}에 두면 상대 돌을 이렇게 잡아요`);
    } else if (kind === 'threat') {
      const t = an.threats[k];
      if (!t) return;
      startDemo(b, t.danger.line, t.rep, P, `가만히 두면 상대가 이렇게 잡으러 와요 (${Go.KIND_NAME[t.danger.kind]})`);
    } else if (kind === 'chance') {
      const c = an.chances[k];
      if (!c) return;
      startDemo(b, c.danger.line, c.rep, opp, `이렇게 두면 상대 돌을 잡을 수 있어요 (${Go.KIND_NAME[c.danger.kind]})`);
    }
  }

  // ───────── 그리기 ─────────
  let G = { W: 0, cell: 0, pad: 0, dpr: 1 };
  function layout() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const W = Math.round(rect.width * dpr);
    if (W <= 0 || !S.board) return;
    canvas.width = W; canvas.height = W;
    const n = S.board.size;
    const cell = W / (n - 1 + 1.8);
    G = { W, cell, pad: cell * 0.9, dpr };
    draw();
  }
  const px = (k) => G.pad + k * G.cell;
  function xy(i) { const n = S.board.size; return [px(i % n), px(Math.floor(i / n))]; }

  function pointFromEvent(e) {
    if (!S.board || !G.W) return -1;
    const r = canvas.getBoundingClientRect();
    const x = (e.clientX - r.left) * G.dpr, y = (e.clientY - r.top) * G.dpr;
    const n = S.board.size;
    const gx = Math.round((x - G.pad) / G.cell), gy = Math.round((y - G.pad) / G.cell);
    if (gx < 0 || gy < 0 || gx >= n || gy >= n) return -1;
    if (Math.hypot(x - px(gx), y - px(gy)) > G.cell * 0.55) return -1;
    return gy * n + gx;
  }

  function starPoints(n) {
    const s = n === 19 ? [3, 9, 15] : n === 13 ? [3, 6, 9] : [2, 4, 6];
    const pts = [];
    for (const a of s) for (const b of s) pts.push([a, b]);
    if (n === 9) return pts.filter(([a, b]) => (a !== 4 && b !== 4) || (a === 4 && b === 4));
    return pts;
  }

  function drawStone(x, y, color, alpha) {
    const r = G.cell * 0.47;
    ctx.save();
    ctx.globalAlpha = alpha == null ? 1 : alpha;
    if (alpha == null || alpha > 0.8) {
      ctx.beginPath();
      ctx.arc(x + r * 0.08, y + r * 0.12, r, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(0,0,0,.28)';
      ctx.fill();
    }
    const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r);
    if (color === BLACK) { g.addColorStop(0, '#5c5c5c'); g.addColorStop(1, '#0d0d0d'); }
    else { g.addColorStop(0, '#ffffff'); g.addColorStop(1, '#cdc8bf'); }
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();
    if (color === WHITE) { ctx.strokeStyle = 'rgba(0,0,0,.25)'; ctx.lineWidth = 1; ctx.stroke(); }
    ctx.restore();
  }

  function ring(x, y, r, color, w, dash) {
    ctx.save();
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.strokeStyle = color;
    ctx.lineWidth = w;
    if (dash) ctx.setLineDash(dash);
    ctx.stroke();
    ctx.restore();
  }
  function cross(x, y, r, color, w) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - r, y - r); ctx.lineTo(x + r, y + r);
    ctx.moveTo(x + r, y - r); ctx.lineTo(x - r, y + r);
    ctx.stroke();
    ctx.restore();
  }
  function text(x, y, s, color, size, weight) {
    ctx.save();
    ctx.fillStyle = color;
    ctx.font = `${weight || 700} ${size}px system-ui, -apple-system, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(s, x, y + size * 0.04);
    ctx.restore();
  }

  function draw() {
    if (!G.W || !S.board) return;
    const b = S.board, n = b.size, cell = G.cell, W = G.W;

    // 판
    const bg = ctx.createLinearGradient(0, 0, W, W);
    bg.addColorStop(0, '#e6bd77'); bg.addColorStop(1, '#d6a35a');
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, W);
    ctx.strokeStyle = '#4e3613';
    for (let k = 0; k < n; k++) {
      ctx.lineWidth = k === 0 || k === n - 1 ? Math.max(1.5, cell * 0.045) : Math.max(1, cell * 0.025);
      ctx.beginPath(); ctx.moveTo(px(0), px(k)); ctx.lineTo(px(n - 1), px(k)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px(k), px(0)); ctx.lineTo(px(k), px(n - 1)); ctx.stroke();
    }
    for (const [a, c] of starPoints(n)) {
      ctx.beginPath(); ctx.arc(px(a), px(c), Math.max(2, cell * 0.09), 0, Math.PI * 2);
      ctx.fillStyle = '#4e3613'; ctx.fill();
    }
    const fs = Math.max(9, cell * 0.3);
    for (let k = 0; k < n; k++) {
      text(px(k), px(n - 1) + cell * 0.62, Go.COLS[k], '#6b4c1f', fs, 600);
      text(px(k), px(0) - cell * 0.62, Go.COLS[k], '#6b4c1f', fs, 600);
      text(px(0) - cell * 0.62, px(k), String(n - k), '#6b4c1f', fs, 600);
      text(px(n - 1) + cell * 0.62, px(k), String(n - k), '#6b4c1f', fs, 600);
    }

    const demo = S.demo;
    const view = demo ? demo.frames[demo.step] : b;

    // 형세/집 표시
    let own = null, deadSet = null;
    if (!demo && S.phase !== 'play' && S.final) { own = S.final.own; deadSet = S.dead; }
    else if (!demo && S.opts.eval && S.est) { own = S.est.own; deadSet = S.est.dead; }
    if (own) {
      for (let i = 0; i < b.N; i++) {
        if (view.grid[i] !== EMPTY && !(deadSet && deadSet.has(i))) continue;
        const v = own[i];
        if (Math.abs(v) < 0.15) continue;
        const [x, y] = xy(i);
        const s = cell * (S.phase === 'play' ? 0.4 : 0.36) * Math.min(1, Math.abs(v));
        if (view.grid[i] !== EMPTY) continue; // 죽은 돌 표시는 아래에서
        ctx.fillStyle = v > 0 ? `rgba(20,20,20,${0.25 + 0.45 * Math.abs(v)})` : `rgba(255,255,255,${0.35 + 0.5 * Math.abs(v)})`;
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
      }
    }

    // 돌
    for (let i = 0; i < b.N; i++) {
      const c = view.grid[i];
      if (!c) continue;
      const [x, y] = xy(i);
      const isDead = !demo && deadSet && deadSet.has(i);
      drawStone(x, y, c, isDead ? 0.45 : 1);
      if (isDead) {
        const s = cell * 0.3;
        ctx.fillStyle = c === BLACK ? 'rgba(255,255,255,.9)' : 'rgba(20,20,20,.85)';
        ctx.fillRect(x - s / 2, y - s / 2, s, s);
        if (S.phase !== 'play') cross(x, y, cell * 0.2, '#c8402f', Math.max(2, cell * 0.06));
      }
    }

    if (demo) return drawDemoMarks(demo, view);

    // 마지막 수
    if (b.lastMove != null && b.lastMove >= 0 && b.grid[b.lastMove]) {
      const [x, y] = xy(b.lastMove);
      ring(x, y, cell * 0.2, b.grid[b.lastMove] === BLACK ? '#fff' : '#111', Math.max(1.5, cell * 0.05));
    }

    const an = S.analysis;
    const showAdvice = an && S.phase === 'play' && isHumanTurn();
    if (showAdvice) {
      // 위험한 내 돌
      if (S.opts.danger) {
        for (const t of an.threats) {
          for (const s of t.stones) { const [x, y] = xy(s); ring(x, y, cell * 0.52, '#e0442f', Math.max(2, cell * 0.07)); }
        }
        // 두면 잡히는 자리
        for (const e of an.evals.values()) {
          if (!e.danger) continue;
          const [x, y] = xy(e.i);
          cross(x, y, cell * 0.13, 'rgba(200,40,30,.75)', Math.max(1.5, cell * 0.045));
        }
      }
      // 추천 수
      if (S.opts.rec && !an.suggestPass) {
        an.ranked.slice(0, 3).forEach((e, k) => {
          if (e.score <= 0 && k > 0) return;
          const [x, y] = xy(e.i);
          const hl = S.highlight === e.i;
          ctx.beginPath(); ctx.arc(x, y, cell * (hl ? 0.4 : 0.32), 0, Math.PI * 2);
          ctx.fillStyle = k === 0 ? 'rgba(47,143,78,.92)' : 'rgba(95,170,120,.85)';
          ctx.fill();
          text(x, y, String(k + 1), '#fff', cell * 0.36);
        });
      }
    }

    // 미리보기(호버/선택)
    const p = S.selected >= 0 ? S.selected : S.hover;
    if (p >= 0 && S.phase === 'play' && isHumanTurn() && b.grid[p] === EMPTY) {
      const [x, y] = xy(p);
      drawStone(x, y, b.toPlay, 0.5);
      const e = an && an.evals.get(p);
      if (e) {
        const col = e.illegal ? '#888' : e.danger ? '#e0442f' : e.rank && e.rank <= 3 ? '#2f8f4e' : '#2f6fb0';
        ring(x, y, cell * 0.5, col, Math.max(2, cell * 0.07), S.selected === p ? null : [cell * 0.12, cell * 0.08]);
        // 이 수로 따내는 돌
        for (const s of e.capturedStones || []) { const [cx, cy] = xy(s); cross(cx, cy, cell * 0.22, '#e0442f', Math.max(2, cell * 0.07)); }
      }
    }
    if (S.highlight >= 0 && b.grid[S.highlight] === EMPTY && S.highlight !== p) {
      const [x, y] = xy(S.highlight);
      ring(x, y, cell * 0.5, '#2f8f4e', Math.max(2, cell * 0.07));
    }
  }

  function drawDemoMarks(demo, view) {
    const cell = G.cell;
    // 순서 번호
    const lastAt = new Map();
    for (let k = 0; k < demo.step; k++) lastAt.set(demo.seq[k].i, k);
    for (const [i, k] of lastAt) {
      const mv = demo.seq[k];
      if (view.grid[i] !== mv.c) continue;
      const [x, y] = xy(i);
      text(x, y, String(k + 1), mv.c === BLACK ? '#fff' : '#111', cell * (k + 1 >= 10 ? 0.32 : 0.4));
      if (k === demo.step - 1) ring(x, y, cell * 0.5, '#f0b429', Math.max(2, cell * 0.08));
    }
    // 이번 수에 따내진 돌
    if (demo.step > 0) {
      const mv = demo.seq[demo.step - 1];
      for (const s of mv.captured) {
        const [x, y] = xy(s);
        drawStone(x, y, 3 - mv.c, 0.35);
        cross(x, y, cell * 0.22, '#e0442f', Math.max(2, cell * 0.08));
      }
    }
  }

  // ───────── 패널 ─────────
  function renderAll() { renderPanels(); draw(); }

  function renderPanels() {
    renderStatus(); renderEval(); renderSituation(); renderInfo(); renderRecs(); renderControls();
  }

  function renderStatus() {
    const b = S.board;
    let turn;
    if (S.phase === 'scoring') turn = '계가 중 — 죽은 돌 확인';
    else if (S.phase === 'over') turn = '대국 종료';
    else if (S.settings.mode === 'ai') turn = isAITurn() ? `${stoneIco(b.toPlay)} 컴퓨터(${cname(b.toPlay)}) 생각 중…` : `${stoneIco(b.toPlay)} 당신(${cname(b.toPlay)}) 차례`;
    else turn = `${stoneIco(b.toPlay)} ${cname(b.toPlay)} 차례`;
    let h = `<div class="turn">${turn}</div>
      <div class="caps">${b.moveNum}수째 · 따낸 돌: 흑 ${b.captures[BLACK]}개 / 백 ${b.captures[WHITE]}개 · 덤 ${S.settings.komi}</div>`;
    if (S.msg) h += `<div class="msg ${S.msg.cls || ''}">${S.msg.text}</div>`;
    if (S.lastAI && S.lastAI.i !== PASS && S.lastAI.reasons.length && S.phase === 'play') {
      h += `<p class="muted">컴퓨터가 그 수를 둔 이유: ${S.lastAI.reasons.map(stripB).join(' ')}</p>`;
    }
    $('statusCard').innerHTML = h;
  }
  const stripB = (s) => s.replace(/<\/?b>/g, '');

  function renderEval() {
    const el = $('evalCard');
    const b = S.board;
    if (S.phase !== 'play' && S.final) {
      const f = S.final, d = f.black - f.white;
      el.innerHTML = `<h3>계가 결과</h3>
        <table class="score-table">
          <tr><th></th><th>집</th><th>따낸 돌(사석 포함)</th><th>덤</th><th>합계</th></tr>
          <tr><td>${stoneIco(BLACK)} 흑</td><td>${f.terrB}</td><td>${f.capB}</td><td>-</td><td><b>${f.black}</b></td></tr>
          <tr><td>${stoneIco(WHITE)} 백</td><td>${f.terrW}</td><td>${f.capW}</td><td>${f.komi}</td><td><b>${f.white}</b></td></tr>
        </table>
        <div class="result">${d > 0 ? `흑 ${d.toFixed(1)}집 승` : `백 ${(-d).toFixed(1)}집 승`}</div>
        ${S.phase === 'scoring' ? `<div class="btn-row"><button class="primary" data-act="finish">계가 확정</button><button data-act="resume">대국 이어 두기</button></div>
          <p class="muted">돌을 누르면 죽은 돌 ↔ 산 돌이 바뀌어요.</p>` : ''}`;
      return;
    }
    if (!S.est) { el.innerHTML = '<h3>형세 분석</h3><p class="muted">분석 중…</p>'; return; }
    const e = S.est;
    const p = Go.winProb(b, e.diff);
    const pct = Math.round(p * 100);
    const lead = e.diff;
    const verdict = Math.abs(lead) < 2 ? '비슷한 형세예요.' : `${lead > 0 ? '흑' : '백'}이 약 <b>${Math.abs(lead).toFixed(1)}집</b> 앞서 있어요.`;
    let mine = '';
    if (S.settings.mode === 'ai') {
      const me = S.settings.human;
      const myLead = me === BLACK ? lead : -lead;
      if (b.moveNum >= 6) mine = myLead >= 2 ? ' 좋아요, 지금처럼만 두세요!' : myLead <= -2 ? ' 조금 불리해요. 추천 수를 참고해 보세요.' : '';
    }
    el.innerHTML = `<h3>형세 분석 (예상)</h3>
      <div class="evalbar"><div class="b" style="width:${Math.max(8, Math.min(92, pct))}%">흑 ${pct}%</div><div class="w">백 ${100 - pct}%</div></div>
      <div class="eval-nums"><span>흑 약 ${e.black.toFixed(1)}집</span><span>백 약 ${e.white.toFixed(1)}집 (덤 포함)</span></div>
      <p class="verdict">${verdict}${mine}</p>
      ${S.opts.eval ? '<p class="muted">판 위 작은 네모: 그 자리가 누구 집이 될지 예상 (클수록 확실). 반투명 돌 = 죽을 것으로 보이는 돌.</p>' : ''}`;
  }

  function renderSituation() {
    const el = $('situationCard');
    const an = S.analysis;
    if (!an || S.phase !== 'play' || !isHumanTurn()) { el.hidden = true; return; }
    const items = [];
    an.threats.forEach((t, k) => {
      const save = t.saveMove >= 0 ? `살리려면 <b>${L(t.saveMove)}</b>을(를) 추천해요.` : '살리기 어려워 보여요. 다른 곳에서 이득을 보는 것도 방법이에요.';
      items.push(`<div class="sit-item threat">⚠ <b>${L(t.rep)}</b> 쪽 내 돌 ${t.size}개가 위험해요 — ${t.libs.length === 1 ? '<b>단수</b> 상태예요.' : `${Go.KIND_NAME[t.danger.kind]}으로 잡힐 수 있어요.`} ${save}
        <div class="btn-row"><button class="small warn" data-act="demo" data-kind="threat" data-k="${k}">▶ 어떻게 잡히나 보기</button>${t.saveMove >= 0 ? `<button class="small" data-act="select" data-i="${t.saveMove}">살리는 자리 보기</button>` : ''}</div></div>`);
    });
    an.chances.forEach((c, k) => {
      items.push(`<div class="sit-item chance">💡 상대 <b>${L(c.rep)}</b> 돌 ${c.size}개를 잡을 수 있어요 → <b>${L(c.move)}</b> (${Go.KIND_NAME[c.danger.kind]})
        <div class="btn-row"><button class="small ok" data-act="demo" data-kind="chance" data-k="${k}">▶ 잡는 수순 보기</button><button class="small" data-act="select" data-i="${c.move}">그 자리 분석</button></div></div>`);
    });
    if (!items.length) { el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = `<h3>지금 판의 급한 곳</h3>${items.join('')}`;
  }

  function renderInfo() {
    const el = $('infoCard');
    const b = S.board, an = S.analysis;
    if (S.phase !== 'play') { el.hidden = true; return; }
    el.hidden = false;
    const p = S.selected >= 0 ? S.selected : S.hover;
    if (!isHumanTurn()) { el.innerHTML = '<h3>이 자리에 두면?</h3><p class="muted">컴퓨터가 두는 중이에요…</p>'; return; }
    if (p < 0 || !an) {
      el.innerHTML = `<h3>이 자리에 두면?</h3><p class="muted">${S.opts.confirm
        ? '판의 빈 자리를 <b>한 번</b> 누르면 그 자리에 두었을 때 어떻게 되는지 알려줘요. <b>한 번 더</b> 누르면 실제로 둬요.'
        : '빈 자리에 마우스를 올리면 그 자리에 두었을 때 어떻게 되는지 알려줘요.'}</p>`;
      return;
    }
    if (b.grid[p] !== EMPTY) { el.innerHTML = `<h3>이 자리에 두면?</h3><p><b>${L(p)}</b>에는 이미 돌이 있어요.</p>`; return; }
    const e = an.evals.get(p);
    if (!e) return;
    let badge, cls;
    if (e.illegal) { badge = '둘 수 없음'; cls = 'no'; }
    else if (e.danger) { badge = '위험한 수'; cls = 'bad'; }
    else if (e.ownEye) { badge = '손해'; cls = 'bad'; }
    else if (e.rank <= 3 && e.score > 0) { badge = `추천 ${e.rank}위`; cls = 'good'; }
    else if (e.score > 0 && e.score >= an.ranked[0].score - 3) { badge = '괜찮은 수'; cls = 'good'; }
    else { badge = '보통'; cls = 'mid'; }
    let h = `<div class="info-head"><span class="pt">${stoneIco(an.P)} ${L(p)}에 두면?</span><span class="badge ${cls}">${badge}</span></div>`;
    if (e.illegal) {
      h += `<ul class="warnings"><li>${e.illegal}</li></ul>`;
    } else {
      if (e.reasons.length) h += `<ul class="reasons">${e.reasons.map((r) => `<li>${r}</li>`).join('')}</ul>`;
      if (e.warnings.length) h += `<ul class="warnings">${e.warnings.map((w) => `<li>${w}</li>`).join('')}</ul>`;
      if (!e.reasons.length && !e.warnings.length) h += `<p class="muted">특별한 문제는 없지만 큰 이득도 없는 자리예요${e.gain ? ` (형세 변화 약 ${e.gain >= 0 ? '+' : ''}${e.gain.toFixed(1)}집)` : ''}.</p>`;
      if (e.danger) {
        const notes = Go.annotate(b, [{ i: p, c: an.P }, ...e.danger.line], p, an.P);
        const show = notes.slice(0, 7);
        h += `<ol class="steps">${show.map((s) => `<li>${s.note}</li>`).join('')}${notes.length > show.length ? `<li>… (모두 ${notes.length}수)</li>` : ''}</ol>`;
      }
      h += '<div class="btn-row">';
      if (e.danger) h += `<button class="small warn" data-act="demo" data-kind="danger" data-i="${p}">▶ 어떻게 잡히는지 판에서 보기</button>`;
      if (!e.danger) e.kills.forEach((k, j) => (h += `<button class="small ok" data-act="demo" data-kind="kill" data-i="${p}" data-k="${j}">▶ 잡는 수순 보기 (${k.stones.length}개)</button>`));
      if (S.selected === p) h += `<button class="small primary" data-act="play" data-i="${p}">여기에 두기</button><button class="small" data-act="deselect">취소</button>`;
      h += '</div>';
    }
    el.innerHTML = h;
  }

  function renderRecs() {
    const el = $('recCard');
    const an = S.analysis;
    if (S.phase !== 'play') { el.hidden = true; return; }
    el.hidden = false;
    if (!S.opts.rec) { el.innerHTML = '<h3>추천 수</h3><p class="muted">“추천 수 표시”를 켜면 볼 수 있어요. 먼저 스스로 생각해 보는 것도 좋은 연습이에요!</p>'; return; }
    if (!isHumanTurn()) { el.innerHTML = '<h3>추천 수</h3><p class="muted">상대 차례예요.</p>'; return; }
    if (!an) { el.innerHTML = '<h3>추천 수</h3><p class="muted">분석 중…</p>'; return; }
    if (an.suggestPass) {
      el.innerHTML = '<h3>추천 수</h3><p>이제 더 둘 곳이 거의 없어요. <b>패스</b>를 추천해요. 둘 다 패스하면 계가를 해요.</p>';
      return;
    }
    const top = an.ranked.slice(0, 3).filter((e, k) => k === 0 || e.score > 0);
    el.innerHTML = `<h3>추천 수 (${cname(an.P)})</h3><ul class="rec-list">${top.map((e, k) => {
      const why = e.reasons.length ? e.reasons.slice(0, 2).join(' ') : '형세상 가장 이득이 큰 자리예요.';
      return `<li data-act="select" data-i="${e.i}" data-hl="${e.i}"><span class="rank r${k + 1}">${k + 1}</span><div class="rec-body"><b class="pt">${L(e.i)}</b><div class="why">${why}</div></div></li>`;
    }).join('')}</ul><p class="muted">항목을 누르면 그 자리 분석을 볼 수 있어요.</p>`;
  }

  function renderControls() {
    document.querySelectorAll('[data-opt]').forEach((inp) => (inp.checked = !!S.opts[inp.dataset.opt]));
    const human = isHumanTurn();
    document.querySelector('[data-act="pass"]').disabled = !human;
    document.querySelector('[data-act="undo"]').disabled = !S.history.length;
  }

  function fillSettingsForm() {
    $('setSize').value = String(S.settings.size);
    $('setMode').value = S.settings.mode;
    $('setColor').value = String(S.settings.human);
    $('setLevel').value = String(S.settings.level);
    $('setKomi').value = String(S.settings.komi);
  }

  // ───────── 이벤트 ─────────
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerType !== 'mouse') return;
    const p = pointFromEvent(e);
    if (p !== S.hover) {
      S.hover = p;
      draw();
      if (S.selected < 0) renderInfo();
    }
  });
  canvas.addEventListener('pointerleave', () => {
    if (S.hover !== -1) { S.hover = -1; draw(); if (S.selected < 0) renderInfo(); }
  });
  canvas.addEventListener('click', (e) => {
    const p = pointFromEvent(e);
    if (p < 0) return;
    if (S.demo) { stopDemo(); return; }
    if (S.phase === 'scoring') { toggleDead(p); return; }
    if (!isHumanTurn() || S.busy) return;
    if (S.board.grid[p] !== EMPTY) return;
    if (S.opts.confirm && S.selected !== p) {
      S.selected = p;
      renderInfo(); draw();
      return;
    }
    humanPlay(p);
  });

  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-act]');
    if (!t) return;
    const act = t.dataset.act;
    const i = t.dataset.i != null ? +t.dataset.i : -1;
    const k = t.dataset.k != null ? +t.dataset.k : 0;
    switch (act) {
      case 'pass': doPass(); break;
      case 'undo': undo(); break;
      case 'new': $('settingsCard').open = true; $('settingsCard').scrollIntoView({ behavior: 'smooth', block: 'center' }); break;
      case 'start': readSettings(); newGame(); $('settingsCard').open = false; break;
      case 'finish': finishScoring(); break;
      case 'resume': resumePlay(); break;
      case 'play': humanPlay(i); break;
      case 'select': S.selected = i; stopDemo(); renderInfo(); draw(); $('infoCard').scrollIntoView({ behavior: 'smooth', block: 'nearest' }); break;
      case 'deselect': S.selected = -1; renderInfo(); draw(); break;
      case 'demo': demoAction(t.dataset.kind, i, k); break;
      case 'demo-close': stopDemo(); break;
      case 'demo-prev': toggleAutoplay(false); demoStep(-1); break;
      case 'demo-next': toggleAutoplay(false); demoStep(1); break;
      case 'demo-first': toggleAutoplay(false); demoStep(-999); break;
      case 'demo-play': toggleAutoplay(); break;
    }
  });

  // 추천 목록에 마우스를 올리면 판에서 강조
  document.addEventListener('mouseover', (e) => {
    const t = e.target.closest('[data-hl]');
    const v = t ? +t.dataset.hl : -1;
    if (v !== S.highlight) { S.highlight = v; draw(); }
  });

  document.querySelectorAll('[data-opt]').forEach((inp) => {
    inp.addEventListener('change', () => {
      S.opts[inp.dataset.opt] = inp.checked;
      if (inp.dataset.opt === 'confirm' && !inp.checked) S.selected = -1;
      persist();
      renderAll();
    });
  });

  document.addEventListener('keydown', (e) => {
    if (!S.demo) {
      if (e.key === 'Escape' && S.selected >= 0) { S.selected = -1; renderInfo(); draw(); }
      return;
    }
    if (e.key === 'ArrowRight') { toggleAutoplay(false); demoStep(1); }
    else if (e.key === 'ArrowLeft') { toggleAutoplay(false); demoStep(-1); }
    else if (e.key === 'Escape') stopDemo();
  });

  function readSettings() {
    S.settings.size = +$('setSize').value;
    S.settings.mode = $('setMode').value;
    S.settings.human = +$('setColor').value;
    S.settings.level = +$('setLevel').value;
    S.settings.komi = +$('setKomi').value;
    persist();
  }

  Go._state = S; Go._recompute = () => recompute();
  new ResizeObserver(() => layout()).observe(canvas);
  fillSettingsForm();
  newGame();
})();
