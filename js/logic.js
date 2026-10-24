// Lógica pura del 3x3x3 (sin DOM), para poder probarla aparte de la interfaz.
(function (root) {
  'use strict';

  const RED = 'red';
  const BLUE = 'blue';
  const DRAW = 'draw';

  const MODES = {
    // Como el juego original: los tableros ganados siguen abiertos y, si te
    // envían a uno, juegas allí.
    ORIGINAL: 'original',
    // Reglas habituales del Ultimate Tic-Tac-Toe: los tableros ganados se
    // cierran y, si te envían a uno, tienes tirada libre.
    CLASSIC: 'classic',
  };

  // Todas las combinaciones ganadoras posibles
  const LINES = [
    [0, 1, 2], [3, 4, 5], [6, 7, 8], // filas
    [0, 3, 6], [1, 4, 7], [2, 5, 8], // columnas
    [0, 4, 8], [2, 4, 6],            // diagonales
  ];

  function findLine(cells) {
    for (const line of LINES) {
      const v = cells[line[0]];
      if ((v === RED || v === BLUE) && v === cells[line[1]] && v === cells[line[2]]) {
        return line;
      }
    }
    return null;
  }

  function createGame(mode) {
    return {
      mode: mode === MODES.CLASSIC ? MODES.CLASSIC : MODES.ORIGINAL,
      cells: Array.from({ length: 9 }, () => Array(9).fill(null)),
      boardWinners: Array(9).fill(null), // null | 'red' | 'blue' | 'draw'
      boardLines: Array(9).fill(null),   // línea ganadora de cada tablero
      player: RED,
      active: null,   // tablero obligatorio; null = tirada libre
      winner: null,   // null | 'red' | 'blue' | 'draw'
      winLine: null,  // tableros que forman el 3 en raya final
      lastMove: null, // { board, cell }
      moves: [],      // historial [[board, cell], ...]
    };
  }

  // Un tablero admite jugadas si le quedan casillas libres y, en modo
  // clásico, si nadie lo ha ganado todavía.
  function isBoardPlayable(game, b) {
    if (game.mode === MODES.CLASSIC && game.boardWinners[b] !== null) return false;
    return game.cells[b].includes(null);
  }

  function playableBoards(game) {
    if (game.winner) return [];
    if (game.active !== null) return [game.active];
    const boards = [];
    for (let b = 0; b < 9; b++) {
      if (isBoardPlayable(game, b)) boards.push(b);
    }
    return boards;
  }

  function isLegalMove(game, b, c) {
    return game.cells[b][c] === null && playableBoards(game).includes(b);
  }

  // Aplica la jugada sobre `game`. Devuelve false si no es legal.
  function play(game, b, c) {
    if (!isLegalMove(game, b, c)) return false;

    const p = game.player;
    game.cells[b][c] = p;
    game.moves.push([b, c]);
    game.lastMove = { board: b, cell: c };

    // ¿Se gana o se llena el tablero pequeño? Un tablero ganado no cambia de dueño.
    if (game.boardWinners[b] === null) {
      const line = findLine(game.cells[b]);
      if (line) {
        game.boardWinners[b] = p;
        game.boardLines[b] = line;
      } else if (!game.cells[b].includes(null)) {
        game.boardWinners[b] = DRAW;
      }
    }

    // ¿Se gana la partida?
    const winLine = findLine(game.boardWinners);
    if (winLine) {
      game.winner = p;
      game.winLine = winLine;
      game.active = null;
      return true;
    }

    game.player = p === RED ? BLUE : RED;

    // La casilla jugada decide el tablero del rival. Si ese tablero no admite
    // jugadas, el rival puede jugar en cualquiera.
    game.active = isBoardPlayable(game, c) ? c : null;

    if (playableBoards(game).length === 0) {
      game.winner = DRAW;
    }
    return true;
  }

  // Reconstruye una partida a partir de su historial (para deshacer y para
  // restaurar la partida guardada). Se detiene en la primera jugada ilegal.
  function replay(mode, moves) {
    const game = createGame(mode);
    for (const move of moves || []) {
      if (!Array.isArray(move) || !play(game, move[0], move[1])) break;
    }
    return game;
  }

  const api = {
    RED, BLUE, DRAW, MODES, LINES,
    findLine, createGame, isBoardPlayable, playableBoards, isLegalMove, play, replay,
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = api;
  } else {
    root.Game = api;
  }
})(this);
