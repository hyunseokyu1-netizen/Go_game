// 바둑판 규칙 엔진: 돌 놓기, 따내기, 자살수 금지, 패
(function () {
  'use strict';
  const Go = (window.Go = window.Go || {});
  const EMPTY = 0, BLACK = 1, WHITE = 2, PASS = -1;

  const nbrCache = {};
  const markCache = {};

  function neighborTable(size) {
    if (nbrCache[size]) return nbrCache[size];
    const t = [];
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const n = [];
        if (x > 0) n.push(y * size + x - 1);
        if (x < size - 1) n.push(y * size + x + 1);
        if (y > 0) n.push((y - 1) * size + x);
        if (y < size - 1) n.push((y + 1) * size + x);
        t.push(n);
      }
    }
    return (nbrCache[size] = t);
  }

  // 그룹 탐색용 공유 마킹 배열 (stamp 방식으로 매번 할당하지 않음)
  function marks(N) {
    return markCache[N] || (markCache[N] = { s: new Int32Array(N), l: new Int32Array(N), t: 0 });
  }

  // 분석 모듈에서 쓰는 BFS용 공유 버퍼
  const stampCache = {};
  Go.stamp = function (N) {
    return stampCache[N] || (stampCache[N] = { a: new Int32Array(N), d: new Int8Array(N), q: new Int32Array(N), t: 0 });
  };

  class Board {
    constructor(size) {
      this.size = size;
      this.N = size * size;
      this.grid = new Int8Array(this.N);
      this.nbr = neighborTable(size);
      this.ko = -1;
      this.captures = [0, 0, 0]; // [_, 흑이 따낸 수, 백이 따낸 수]
      this.toPlay = BLACK;
      this.moveNum = 0;
      this.lastMove = null;
      this.passes = 0;
    }

    clone() {
      const b = Object.create(Board.prototype);
      b.size = this.size;
      b.N = this.N;
      b.grid = this.grid.slice();
      b.nbr = this.nbr;
      b.ko = this.ko;
      b.captures = this.captures.slice();
      b.toPlay = this.toPlay;
      b.moveNum = this.moveNum;
      b.lastMove = this.lastMove;
      b.passes = this.passes;
      return b;
    }

    // i 위치 돌이 속한 그룹: { color, stones[], libs[] }
    group(i) {
      const g = this.grid, c = g[i], M = marks(this.N);
      const t = ++M.t;
      const stones = [i], libs = [];
      M.s[i] = t;
      for (let k = 0; k < stones.length; k++) {
        const nb = this.nbr[stones[k]];
        for (let j = 0; j < nb.length; j++) {
          const n = nb[j], v = g[n];
          if (v === c) {
            if (M.s[n] !== t) { M.s[n] = t; stones.push(n); }
          } else if (v === EMPTY) {
            if (M.l[n] !== t) { M.l[n] = t; libs.push(n); }
          }
        }
      }
      return { color: c, stones, libs };
    }

    // 판 위 모든 그룹 목록과 위치→그룹 id 매핑
    groups() {
      const id = new Int32Array(this.N).fill(-1);
      const list = [];
      for (let i = 0; i < this.N; i++) {
        if (this.grid[i] !== EMPTY && id[i] < 0) {
          const g = this.group(i);
          g.id = list.length;
          for (const s of g.stones) id[s] = g.id;
          list.push(g);
        }
      }
      return { list, id };
    }

    // 둘 수 있으면 null, 없으면 이유(한국어)
    checkLegal(i, c) {
      if (i === PASS) return null;
      const g = this.grid;
      if (g[i] !== EMPTY) return '이미 돌이 놓인 자리예요.';
      if (i === this.ko) return '패(覇) 규칙: 방금 돌을 따낸 자리를 곧바로 되따낼 수 없어요. 다른 곳에 한 수 둔 다음에 따낼 수 있어요.';
      const nb = this.nbr[i];
      for (let j = 0; j < nb.length; j++) if (g[nb[j]] === EMPTY) return null;
      g[i] = c;
      let ok = false;
      for (let j = 0; j < nb.length && !ok; j++) {
        if (g[nb[j]] === 3 - c && this.group(nb[j]).libs.length === 0) ok = true;
      }
      if (!ok && this.group(i).libs.length > 0) ok = true;
      g[i] = EMPTY;
      return ok ? null : '자살수: 놓는 순간 활로(숨 쉴 곳)가 하나도 없어서 둘 수 없어요.';
    }

    // 성공하면 따낸 돌 위치 배열, 둘 수 없으면 null
    play(i, c) {
      if (c === undefined) c = this.toPlay;
      if (i === PASS) {
        this.passes++;
        this.ko = -1;
        this.toPlay = 3 - c;
        this.moveNum++;
        this.lastMove = PASS;
        return [];
      }
      if (this.checkLegal(i, c)) return null;
      const g = this.grid;
      g[i] = c;
      const captured = [];
      for (const n of this.nbr[i]) {
        if (g[n] === 3 - c) {
          const gr = this.group(n);
          if (gr.libs.length === 0) {
            for (const s of gr.stones) { g[s] = EMPTY; captured.push(s); }
          }
        }
      }
      this.ko = -1;
      if (captured.length === 1) {
        const me = this.group(i);
        if (me.stones.length === 1 && me.libs.length === 1) this.ko = captured[0];
      }
      this.captures[c] += captured.length;
      this.toPlay = 3 - c;
      this.moveNum++;
      this.lastMove = i;
      this.passes = 0;
      return captured;
    }
  }

  Go.Board = Board;
  Go.EMPTY = EMPTY; Go.BLACK = BLACK; Go.WHITE = WHITE; Go.PASS = PASS;
  Go.COLS = 'ABCDEFGHJKLMNOPQRST';
  Go.label = (size, i) => (i === PASS || i == null || i < 0 ? '패스' : Go.COLS[i % size] + (size - Math.floor(i / size)));
  Go.colorName = (c) => (c === BLACK ? '흑' : '백');
})();
