// Motor del bot: las mismas reglas que js/logic.js pero con bitboards (rápidas),
// y una búsqueda MCTS (Monte Carlo Tree Search) con resolución de finales.
// Funciona en un Web Worker, en la página y en Node (para las pruebas).
(function (root) {
  'use strict';

  const NONE = -1;
  const DRAW = 2;
  const FULL = 511;
  const COLORS = ['red', 'blue'];

  // Presupuesto de cada nivel: número de simulaciones o tiempo de búsqueda.
  // `randomness`: probabilidad de jugar al azar (para que el nivel fácil sea asequible).
  const LEVELS = {
    facil: { iterations: 40, randomness: 0.25 },
    medio: { iterations: 1500 },
    dificil: { timeMs: 1500 },
    experto: { timeMs: 4000 },
  };
  const MAX_ITERATIONS = 2000000;
  const MAX_NODES = 150000;  // tope de memoria: a partir de aquí solo se simula, sin crecer el árbol
  const EXPLORATION = 0.5;   // constante de exploración de UCT (ajustada con partidas bot contra bot)

  // WIN[m] = 1 si la máscara de 9 casillas m contiene un 3 en raya
  const LINE_MASKS = [7, 56, 448, 73, 146, 292, 273, 84];
  const WIN = new Uint8Array(512);
  // BITS[m] = posiciones ocupadas en m; COUNT[m] = cuántas son
  const BITS = [];
  const COUNT = new Uint8Array(512);
  for (let m = 0; m < 512; m++) {
    for (const line of LINE_MASKS) {
      if ((m & line) === line) { WIN[m] = 1; break; }
    }
    const bits = [];
    for (let i = 0; i < 9; i++) if ((m >> i) & 1) bits.push(i);
    BITS.push(bits);
    COUNT[m] = bits.length;
  }

  // Generador pseudoaleatorio rápido (xorshift32)
  let seed = (Date.now() ^ 0x9e3779b9) >>> 0 || 1;
  function random() {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  }

  class State {
    constructor(classic) {
      this.classic = classic;
      this.marks = new Int32Array(18);   // marks[p * 9 + b]: casillas del jugador p en el tablero b
      this.owner = new Int8Array(9).fill(NONE);
      this.won = new Int32Array(2);      // tableros ganados por cada jugador
      this.closed = 0;                   // tableros en los que ya no se puede jugar
      this.active = NONE;                // tablero obligatorio o NONE (tirada libre)
      this.player = 0;                   // 0 = rojo, 1 = azul
      this.winner = NONE;                // NONE, 0, 1 o DRAW
    }

    copyFrom(s) {
      this.marks.set(s.marks);
      this.owner.set(s.owner);
      this.won[0] = s.won[0];
      this.won[1] = s.won[1];
      this.closed = s.closed;
      this.active = s.active;
      this.player = s.player;
      this.winner = s.winner;
    }

    empties(b) {
      return ~(this.marks[b] | this.marks[9 + b]) & FULL;
    }

    // move = b * 9 + c
    play(move) {
      const b = (move / 9) | 0;
      const c = move - b * 9;
      const p = this.player;
      const m = (this.marks[p * 9 + b] |= 1 << c);
      const full = (this.marks[b] | this.marks[9 + b]) === FULL;

      if (this.owner[b] === NONE) {
        if (WIN[m]) {
          this.owner[b] = p;
          const won = (this.won[p] |= 1 << b);
          if (this.classic) this.closed |= 1 << b;
          if (WIN[won]) {
            this.winner = p;
            this.active = NONE;
            return;
          }
        } else if (full) {
          this.owner[b] = DRAW;
        }
      }
      if (full) this.closed |= 1 << b;

      this.player = p ^ 1;
      this.active = (this.closed >> c) & 1 ? NONE : c;
      if (this.closed === FULL) this.winner = DRAW;
    }

    // Escribe las jugadas legales en `out` y devuelve cuántas hay
    moves(out) {
      let n = 0;
      if (this.winner !== NONE) return 0;
      if (this.active !== NONE) {
        const b = this.active;
        for (const c of BITS[this.empties(b)]) out[n++] = b * 9 + c;
        return n;
      }
      for (let b = 0; b < 9; b++) {
        if ((this.closed >> b) & 1) continue;
        for (const c of BITS[this.empties(b)]) out[n++] = b * 9 + c;
      }
      return n;
    }

    randomMove() {
      if (this.active !== NONE) {
        const bits = BITS[this.empties(this.active)];
        return this.active * 9 + bits[(random() * bits.length) | 0];
      }
      let total = 0;
      for (let b = 0; b < 9; b++) {
        if (!((this.closed >> b) & 1)) total += COUNT[this.empties(b)];
      }
      let r = (random() * total) | 0;
      for (let b = 0; b < 9; b++) {
        if ((this.closed >> b) & 1) continue;
        const e = this.empties(b);
        if (r < COUNT[e]) return b * 9 + BITS[e][r];
        r -= COUNT[e];
      }
      return NONE;
    }

    // Jugada que gana la partida ahora mismo, o NONE
    winningMove() {
      const p = this.player;
      const from = this.active !== NONE ? this.active : 0;
      const to = this.active !== NONE ? this.active : 8;
      for (let b = from; b <= to; b++) {
        if ((this.closed >> b) & 1 || this.owner[b] !== NONE) continue;
        if (!WIN[this.won[p] | (1 << b)]) continue;
        const mine = this.marks[p * 9 + b];
        for (const c of BITS[this.empties(b)]) {
          if (WIN[mine | (1 << c)]) return b * 9 + c;
        }
      }
      return NONE;
    }

    // Partida aleatoria hasta el final. En cada turno, si hay una jugada que gana
    // la partida se juega: simulaciones más realistas sin perder mucha velocidad.
    rollout() {
      while (this.winner === NONE) {
        const win = this.winningMove();
        this.play(win !== NONE ? win : this.randomMove());
      }
      return this.winner;
    }
  }

  function stateFromMoves(mode, moves) {
    const state = new State(mode === 'classic');
    const legal = new Int8Array(81);
    for (const [b, c] of moves) {
      const move = b * 9 + c;
      const n = state.moves(legal);
      if (!legal.subarray(0, n).includes(move)) throw new Error('Jugada ilegal en el historial');
      state.play(move);
    }
    return state;
  }

  // Nodo del árbol. `mover` es el jugador que hizo la jugada que lleva a este nodo.
  // `proven`: 1 si esa jugada gana con seguridad, -1 si pierde con seguridad, 0 si no se sabe.
  // Las jugadas por probar se generan la primera vez que se expande el nodo: la mayoría
  // de nodos son hojas visitadas una sola vez y así ocupan mucha menos memoria.
  const MOVE_BUFFER = new Int8Array(81);
  class Node {
    constructor(parent, move, mover) {
      this.parent = parent;
      this.move = move;
      this.mover = mover;
      this.children = null;
      this.untried = null;
      this.left = 0;
      this.visits = 0;
      this.score = 0;
      this.proven = 0;
    }

    init(state) {
      this.untried = MOVE_BUFFER.slice(0, state.moves(MOVE_BUFFER));
      this.left = this.untried.length;
      this.children = [];
    }
  }

  class Search {
    constructor(mode, moves, budget) {
      this.root = stateFromMoves(mode, moves);
      this.state = new State(this.root.classic);
      this.tree = new Node(null, NONE, this.root.player ^ 1);
      this.tree.init(this.root);
      this.budget = budget || LEVELS.dificil;
      this.exploration = this.budget.exploration || EXPLORATION;
      this.nodes = 1;
      this.maxIterations = Math.min(this.budget.iterations || MAX_ITERATIONS, MAX_ITERATIONS);
      this.deadline = this.budget.timeMs ? now() + this.budget.timeMs : Infinity;
      this.iterations = 0;
      this.careless = random() < (this.budget.randomness || 0);
    }

    done() {
      return this.careless || this.tree.proven !== 0 || this.tree.left + this.tree.children.length <= 1 ||
        this.iterations >= this.maxIterations || now() >= this.deadline;
    }

    // Busca durante `sliceMs` (o hasta agotar el presupuesto). Devuelve true si queda trabajo.
    step(sliceMs) {
      const end = Math.min(this.deadline, now() + sliceMs);
      while (!this.done()) {
        for (let i = 0; i < 128 && this.iterations < this.maxIterations; i++) this.iterate();
        if (now() >= end) break;
      }
      return !this.done();
    }

    run() {
      while (this.step(1000)) { /* sigue buscando */ }
    }

    iterate() {
      const state = this.state;
      state.copyFrom(this.root);
      let node = this.tree;

      // 1. Selección: bajar por el árbol con UCT mientras el nodo esté expandido
      while (node.proven === 0) {
        if (node.untried === null) {
          if (this.nodes >= MAX_NODES) break;
          node.init(state);
        }
        if (node.left > 0 || node.children.length === 0) break;
        node = this.select(node);
        state.play(node.move);
      }

      let result;
      if (node.proven !== 0) {
        result = node.proven === 1 ? node.mover : node.mover ^ 1;
      } else {
        // 2. Expansión: añadir una jugada no probada
        if (node.left > 0 && this.nodes < MAX_NODES) {
          const i = (random() * node.left) | 0;
          const move = node.untried[i];
          node.untried[i] = node.untried[--node.left];
          const mover = state.player;
          state.play(move);
          const child = new Node(node, move, mover);
          node.children.push(child);
          this.nodes++;
          node = child;
          if (state.winner === mover) {
            child.proven = 1;
            this.propagateProof(child);
          }
        }
        // 3. Simulación
        result = state.winner !== NONE ? state.winner : state.rollout();
      }

      // 4. Retropropagación
      for (let n = node; n; n = n.parent) {
        n.visits++;
        if (result === n.mover) n.score += 1;
        else if (result === DRAW) n.score += 0.5;
      }
      this.iterations++;
    }

    select(node) {
      const logN = Math.log(node.visits);
      let best = null;
      let bestValue = -Infinity;
      for (const child of node.children) {
        if (child.proven === 1) return child;
        if (child.proven === -1) continue;
        const value = child.score / child.visits + this.exploration * Math.sqrt(logN / child.visits);
        if (value > bestValue) { bestValue = value; best = child; }
      }
      return best || node.children[0];
    }

    // Si una jugada gana seguro, el nodo anterior pierde seguro, y si todas las
    // respuestas de un nodo pierden seguro, la jugada que lleva a él gana seguro.
    propagateProof(node) {
      while (node.parent) {
        const parent = node.parent;
        if (node.proven === 1) {
          parent.proven = -1;
        } else if (node.proven === -1 && parent.left === 0 &&
                   parent.children.every((ch) => ch.proven === -1)) {
          parent.proven = 1;
        } else {
          return;
        }
        node = parent;
      }
    }

    bestMove() {
      if (this.careless && this.root.winner === NONE) {
        const m = this.root.randomMove();
        return [(m / 9) | 0, m % 9];
      }
      const children = this.tree.children;
      let best = null;
      for (const child of children) {
        if (child.proven === 1) { best = child; break; }
        if (!best || (best.proven === -1 && child.proven !== -1) ||
            (child.proven === best.proven && child.visits > best.visits)) {
          best = child;
        }
      }
      let move = best ? best.move : this.tree.untried[0];
      if (move === undefined) {
        const buf = new Int8Array(81);
        if (this.root.moves(buf) === 0) return null;
        move = buf[0];
      }
      return [(move / 9) | 0, move % 9];
    }

    // Probabilidad estimada de que gane el jugador al que le toca (para estadísticas)
    winRate() {
      const t = this.tree;
      return t.visits ? 1 - t.score / t.visits : 0.5;
    }
  }

  function now() {
    return typeof performance !== 'undefined' ? performance.now() : Date.now();
  }

  function think(mode, moves, level) {
    const search = new Search(mode, moves, LEVELS[level] || LEVELS.dificil);
    search.run();
    return { move: search.bestMove(), iterations: search.iterations, winRate: search.winRate() };
  }

  const api = { LEVELS, COLORS, State, Search, think, stateFromMoves };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Engine = api;
  }
})(this);
