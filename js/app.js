// Interfaz del 3x3x3: menú, partida en el mismo móvil, contra el bot y online.
(function () {
  'use strict';

  const { RED, BLUE, DRAW, MODES, createGame, play, replay, playableBoards } = window.Game;
  const { Bot, Online } = window;

  const KEYS = {
    local: '3x3x3:partida',
    bot: '3x3x3:bot',
    botPrefs: '3x3x3:bot-opciones',
    screen: '3x3x3:pantalla',
    help: '3x3x3:ayuda-vista',
    player: '3x3x3:jugador',
  };
  const BOT_MIN_DELAY_MS = 450; // que el bot no conteste al instante
  const TOAST_MS = 2800;

  const LEVEL_NAMES = { facil: 'Fácil', medio: 'Medio', dificil: 'Difícil', experto: 'Experto' };
  const MODE_NAMES = { original: 'Original', classic: 'Clásico' };
  const MODE_NOTES = {
    original: 'Los tableros ganados siguen abiertos: si te envían a uno, juegas allí.',
    classic: 'Los tableros ganados se cierran: si te envían a uno, juegas donde quieras.',
  };
  const PLAYER_NAMES = { red: 'Rojo', blue: 'Azul' };
  const CELL_STATES = { red: 'roja', blue: 'azul' };
  const BOARD_NAMES = [
    'de arriba a la izquierda', 'de arriba', 'de arriba a la derecha',
    'de la izquierda', 'del centro', 'de la derecha',
    'de abajo a la izquierda', 'de abajo', 'de abajo a la derecha',
  ];
  const CELL_NAMES = [
    'superior izquierda', 'superior', 'superior derecha',
    'izquierda', 'central', 'derecha',
    'inferior izquierda', 'inferior', 'inferior derecha',
  ];
  const EMPTY_GAME = createGame(MODES.ORIGINAL);

  const $ = (id) => document.getElementById(id);
  const boardEl = $('board');
  const dlgBot = $('dlg-bot');
  const dlgOnline = $('dlg-online');
  const dlgLocal = $('dlg-local');
  const dlgHelp = $('dlg-help');

  const store = {
    get(key) {
      try { return JSON.parse(localStorage.getItem(key)); } catch (_) { return null; }
    },
    set(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* sin almacenamiento */ }
    },
  };

  // Identificador de este jugador: permite recuperar tu asiento en una sala al recargar
  const playerId = (() => {
    let id = store.get(KEYS.player);
    if (typeof id !== 'string' || id.length < 12) {
      id = Online.newCode() + Online.newCode();
      store.set(KEYS.player, id);
    }
    return id;
  })();

  // Partida en curso:
  //   { kind: 'local', game }
  //   { kind: 'bot', game, level, human, thinking, turn }
  //   { kind: 'online', code, match, seen }
  let session = null;

  // Construir el tablero una sola vez; render() solo actualiza clases y atributos
  const minis = [];
  const cells = [];
  for (let b = 0; b < 9; b++) {
    const mini = document.createElement('div');
    mini.className = 'mini';
    mini.setAttribute('role', 'group');
    mini.setAttribute('aria-label', `Tablero ${BOARD_NAMES[b]}`);
    cells[b] = [];
    for (let c = 0; c < 9; c++) {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'cell';
      cell.dataset.board = b;
      cell.dataset.cell = c;
      mini.appendChild(cell);
      cells[b][c] = cell;
    }
    boardEl.appendChild(mini);
    minis[b] = mini;
  }

  // ---------- Sesiones ----------

  function currentGame() {
    if (!session) return EMPTY_GAME;
    if (session.kind === 'online') return session.match.game || EMPTY_GAME;
    return session.game;
  }

  function endSession() {
    const s = session;
    session = null;
    if (!s) return;
    if (s.kind === 'bot') Bot.cancel();
    if (s.kind === 'online') {
      s.match.leave();
      setRoomInUrl(null);
    }
  }

  function startLocal(mode, moves) {
    endSession();
    session = { kind: 'local', game: replay(mode, moves || []) };
    enterGame();
  }

  function startBot({ mode, level, human, moves }) {
    endSession();
    session = {
      kind: 'bot',
      game: replay(mode, moves || []),
      level: LEVEL_NAMES[level] ? level : 'dificil',
      human: human === BLUE ? BLUE : RED,
      thinking: false,
      turn: 0,
    };
    enterGame();
    botTurn();
  }

  function startOnline(code, createMode) {
    endSession();
    const s = { kind: 'online', code, match: null, seen: null };
    session = s;
    s.match = new Online.Match({
      code,
      playerId,
      createMode,
      onChange: () => {
        if (session === s) onlineChanged(s);
      },
    });
    setRoomInUrl(code);
    enterGame();
  }

  function enterGame() {
    save();
    showScreen('game');
    render();
  }

  function goHome() {
    endSession();
    store.set(KEYS.screen, 'home');
    document.body.className = '';
    document.title = '3x3x3';
    showScreen('home');
  }

  function showScreen(name) {
    $('screen-home').hidden = name !== 'home';
    $('screen-game').hidden = name !== 'game';
  }

  function save() {
    const s = session;
    if (!s) return;
    if (s.kind === 'local') {
      store.set(KEYS.local, { mode: s.game.mode, moves: s.game.moves });
      store.set(KEYS.screen, 'local');
    } else if (s.kind === 'bot') {
      store.set(KEYS.bot, { mode: s.game.mode, moves: s.game.moves, level: s.level, human: s.human });
      store.set(KEYS.screen, 'bot');
    } else {
      // Las salas se recuperan con el enlace (?sala=...), no con el almacenamiento
      store.set(KEYS.screen, 'home');
    }
  }

  function savedGame(key) {
    const data = store.get(key);
    if (!data || !Array.isArray(data.moves)) return null;
    return data;
  }

  function hasUnfinished(key) {
    const data = savedGame(key);
    if (!data || data.moves.length === 0) return false;
    return !replay(data.mode, data.moves).winner;
  }

  function resumeLocal() {
    const data = savedGame(KEYS.local);
    if (!data) return false;
    startLocal(data.mode, data.moves);
    return true;
  }

  function resumeBot() {
    const data = savedGame(KEYS.bot);
    if (!data) return false;
    startBot(data);
    return true;
  }

  // ---------- Bot ----------

  function botTurn() {
    const s = session;
    if (!s || s.kind !== 'bot' || s.game.winner || s.game.player === s.human) return;
    const turn = ++s.turn;
    const isCurrent = () => session === s && s.turn === turn;
    const started = Date.now();
    s.thinking = true;
    Bot.think(s.game.mode, s.game.moves, s.level).then((move) => {
      if (!isCurrent()) return;
      setTimeout(() => {
        if (!isCurrent()) return;
        s.thinking = false;
        if (move) play(s.game, move[0], move[1]);
        save();
        render();
      }, Math.max(0, BOT_MIN_DELAY_MS - (Date.now() - started)));
    }, () => {
      if (!isCurrent()) return;
      s.thinking = false;
      toast('El bot no ha podido pensar su jugada');
      render();
    });
    render();
  }

  function canUndo() {
    const s = session;
    if (!s) return false;
    if (s.kind === 'local') return s.game.moves.length > 0;
    // Contra el bot hace falta al menos una jugada tuya
    if (s.kind === 'bot') return s.game.moves.length > (s.human === RED ? 0 : 1);
    return false;
  }

  function undo() {
    const s = session;
    if (!canUndo()) return;
    if (s.kind === 'local') {
      s.game = replay(s.game.mode, s.game.moves.slice(0, -1));
    } else {
      // Deshacer hasta que vuelva a ser tu turno (tu jugada y la respuesta del bot)
      Bot.cancel();
      s.thinking = false;
      s.turn++;
      const moves = s.game.moves.slice();
      let game;
      do {
        moves.pop();
        game = replay(s.game.mode, moves);
      } while (moves.length > 0 && game.player !== s.human);
      s.game = game;
    }
    save();
    render();
    botTurn();
  }

  // ---------- Online ----------

  function onlineChanged(s) {
    const m = s.match;
    if (m.status === 'notfound') {
      toast(`No existe la sala ${s.code}`);
      goHome();
      return;
    }
    if (m.status === 'error') {
      toast('No se ha podido conectar con el servidor de salas');
      goHome();
      return;
    }

    // Avisos: entra el rival, mueve el rival, empieza la revancha
    const st = m.state;
    if (st) {
      const prev = s.seen;
      const seat = m.seat;
      if (prev) {
        if (!prev.blue && st.blue && seat === RED) {
          toast('¡Tu amigo ha entrado! Empiezas tú');
          vibrate(60);
        } else if (st.game > prev.game && seat) {
          toast(`Revancha: ahora juegas con ${PLAYER_NAMES[seat]}`);
        } else if (st.game === prev.game && st.moves.length > prev.moves && seat && m.game.player === seat && !m.game.winner) {
          vibrate(30);
        }
      }
      s.seen = { blue: st.blue, game: st.game, moves: st.moves.length };
    }
    render();
  }

  function roomUrl(code) {
    const url = new URL(location.href);
    url.search = '?sala=' + code;
    url.hash = '';
    return url.toString();
  }

  function setRoomInUrl(code) {
    try {
      history.replaceState(null, '', code ? '?sala=' + code : location.pathname);
    } catch (_) { /* p. ej. file:// en algunos navegadores */ }
  }

  async function shareRoom() {
    if (!session || session.kind !== 'online') return;
    const url = roomUrl(session.code);
    if (navigator.share) {
      try {
        await navigator.share({ title: '3x3x3', text: `¿Echamos una partida al 3x3x3? Sala ${session.code}`, url });
        return;
      } catch (err) {
        if (err && err.name === 'AbortError') return;
      }
    }
    copyText(url, 'Enlace copiado');
  }

  async function copyText(text, message) {
    try {
      await navigator.clipboard.writeText(text);
      toast(message);
    } catch (_) {
      const area = document.createElement('textarea');
      area.value = text;
      area.setAttribute('readonly', '');
      area.style.position = 'fixed';
      area.style.opacity = '0';
      document.body.appendChild(area);
      area.select();
      let ok = false;
      try { ok = document.execCommand('copy'); } catch (_) { ok = false; }
      area.remove();
      toast(ok ? message : text);
    }
  }

  // ---------- Pintar ----------

  function canInteract() {
    const s = session;
    if (!s) return false;
    if (s.kind === 'local') return !s.game.winner;
    if (s.kind === 'bot') return !s.game.winner && !s.thinking && s.game.player === s.human;
    return s.match.canPlay();
  }

  function render() {
    const s = session;
    if (!s) return;
    const game = currentGame();
    const over = game.winner !== null;
    const waiting = s.kind === 'online' && !(s.match.state && s.match.state.blue);
    const interactive = canInteract();
    const playable = playableBoards(game);
    const last = game.lastMove;

    document.body.className = over ? `winner-${game.winner} game-over` : `turn-${game.player}`;
    boardEl.classList.toggle('is-free', !over && !waiting && game.active === null);
    boardEl.classList.toggle('is-forced', !over && !waiting && game.active !== null);
    boardEl.classList.toggle('is-over', over);
    boardEl.classList.toggle('is-waiting', waiting);

    for (let b = 0; b < 9; b++) {
      const owner = game.boardWinners[b];
      const active = playable.includes(b);
      const mini = minis[b];
      mini.classList.toggle('is-active', active);
      mini.classList.toggle('won-red', owner === RED);
      mini.classList.toggle('won-blue', owner === BLUE);
      mini.classList.toggle('is-draw', owner === DRAW);
      mini.classList.toggle('in-winline', !!game.winLine && game.winLine.includes(b));

      for (let c = 0; c < 9; c++) {
        const cell = cells[b][c];
        const value = game.cells[b][c];
        if (value) cell.dataset.owner = value;
        else delete cell.dataset.owner;
        cell.disabled = !interactive || !active || value !== null;
        cell.classList.toggle('is-last', !!last && last.board === b && last.cell === c);
        cell.setAttribute('aria-label', `Casilla ${CELL_NAMES[c]}, ${value ? CELL_STATES[value] : 'vacía'}`);
      }
    }

    const [redName, blueName] = playerNames(s);
    $('who-red').textContent = redName;
    $('who-blue').textContent = blueName;
    $('score-red').textContent = game.boardWinners.filter((w) => w === RED).length;
    $('score-blue').textContent = game.boardWinners.filter((w) => w === BLUE).length;
    $('game-label').textContent = gameLabel(s, game);

    const [title, hint] = statusText(s, game);
    $('status-title').textContent = title;
    $('status-hint').textContent = hint;

    const online = s.kind === 'online';
    $('btn-undo').hidden = online;
    $('btn-undo').disabled = !canUndo();
    $('btn-new').hidden = online;
    $('btn-invite').hidden = !online;
    $('btn-rematch').hidden = !online;
    $('btn-rematch').disabled = !(online && over && s.match.seat && s.match.status === 'online');

    const showShare = online && waiting && s.match.seat === RED;
    $('share-card').hidden = !showShare;
    if (online) $('share-code').textContent = s.code;

    const myTurn = online && interactive;
    document.title = myTurn ? '● Tu turno · 3x3x3' : '3x3x3';
  }

  function playerNames(s) {
    if (s.kind === 'bot') return s.human === RED ? ['Tú', 'Bot'] : ['Bot', 'Tú'];
    if (s.kind === 'online') {
      if (s.match.seat === RED) return ['Tú', 'Amigo'];
      if (s.match.seat === BLUE) return ['Amigo', 'Tú'];
    }
    return ['Rojo', 'Azul'];
  }

  function gameLabel(s, game) {
    if (s.kind === 'bot') return `Bot ${LEVEL_NAMES[s.level].toLowerCase()} · ${MODE_NAMES[game.mode]}`;
    if (s.kind === 'online') return `Sala ${s.code}` + (s.match.state ? ` · ${MODE_NAMES[game.mode]}` : '');
    return `Mismo móvil · ${MODE_NAMES[game.mode]}`;
  }

  function boardHint(game) {
    if (game.moves.length === 0) return 'Tirada libre: elige cualquier casilla';
    if (game.active === null) return 'Tirada libre: juega en cualquier tablero';
    let hint = `Juega en el tablero ${BOARD_NAMES[game.active]}`;
    if (game.boardWinners[game.active] !== null) hint += ' (ya ganado)';
    return hint;
  }

  function statusText(s, game) {
    if (s.kind === 'local') {
      if (game.winner === DRAW) return ['Empate', 'No quedan jugadas posibles'];
      if (game.winner) return [`¡Gana ${PLAYER_NAMES[game.winner]}!`, `3 tableros en raya en ${game.moves.length} jugadas`];
      return [`Turno de ${PLAYER_NAMES[game.player]}`, boardHint(game)];
    }

    if (s.kind === 'bot') {
      if (game.winner === DRAW) return ['Empate', 'No quedan jugadas posibles'];
      if (game.winner === s.human) return ['¡Has ganado!', `Has vencido al bot en nivel ${LEVEL_NAMES[s.level]}`];
      if (game.winner) return ['Gana el bot', 'Deshaz tu última jugada o empieza otra partida'];
      if (game.player !== s.human) return ['El bot está pensando…', `Nivel ${LEVEL_NAMES[s.level]}`];
      return ['Tu turno', boardHint(game)];
    }

    const m = s.match;
    const st = m.state;
    if (!st) return ['Conectando…', `Buscando la sala ${s.code}`];
    const seat = m.seat;
    let title;
    let hint;
    if (!st.blue) {
      title = 'Esperando a tu amigo';
      hint = seat === RED ? 'Comparte el enlace o el código de la sala' : 'Entrando en la sala…';
    } else if (game.winner) {
      if (game.winner === DRAW) title = 'Empate';
      else if (seat) title = game.winner === seat ? '¡Has ganado!' : 'Has perdido';
      else title = `Gana ${PLAYER_NAMES[game.winner]}`;
      hint = seat ? 'Pulsa Revancha para jugar otra' : 'Estás mirando la partida';
    } else if (!seat) {
      title = `Turno de ${PLAYER_NAMES[game.player]}`;
      hint = 'La sala está llena: estás mirando la partida';
    } else if (game.player === seat) {
      title = 'Tu turno';
      hint = boardHint(game);
      if (!m.opponentOnline) hint += ' · tu amigo está desconectado';
    } else {
      title = 'Turno de tu amigo';
      hint = m.opponentOnline ? 'Esperando su jugada…' : 'Tu amigo se ha desconectado. Esperando a que vuelva…';
    }
    if (m.status !== 'online') hint = 'Sin conexión. Reconectando…';
    return [title, hint];
  }

  let toastTimer = 0;
  function toast(text) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    // Forzar el reinicio de la animación si ya había un aviso visible
    el.classList.remove('show');
    void el.offsetWidth;
    el.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      el.classList.remove('show');
      el.hidden = true;
    }, TOAST_MS);
  }

  function vibrate(ms) {
    if (navigator.vibrate) {
      try { navigator.vibrate(ms); } catch (_) { /* no disponible */ }
    }
  }

  // ---------- Diálogos ----------

  function openDialog(dlg) {
    dlg.returnValue = '';
    dlg.showModal();
  }

  function setRadio(form, name, value) {
    const input = form.querySelector(`input[name="${name}"][value="${value}"]`);
    if (input) input.checked = true;
  }

  function updateModeNotes(root) {
    for (const note of root.querySelectorAll('[data-mode-note]')) {
      const checked = note.closest('fieldset').querySelector('input[name="mode"]:checked');
      note.textContent = MODE_NOTES[checked ? checked.value : MODES.ORIGINAL];
    }
  }

  for (const dlg of [dlgBot, dlgOnline, dlgLocal, dlgHelp]) {
    // Cerrar al tocar fuera del diálogo
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) dlg.close();
    });
    dlg.addEventListener('change', () => updateModeNotes(dlg));
  }

  function openBotDialog() {
    const form = dlgBot.querySelector('form');
    const prefs = store.get(KEYS.botPrefs) || {};
    setRadio(form, 'level', LEVEL_NAMES[prefs.level] ? prefs.level : 'dificil');
    setRadio(form, 'color', prefs.color || RED);
    setRadio(form, 'mode', prefs.mode || MODES.ORIGINAL);
    form.querySelector('[data-resume]').hidden = !hasUnfinished(KEYS.bot) || (session && session.kind === 'bot');
    updateModeNotes(dlgBot);
    openDialog(dlgBot);
  }

  dlgBot.addEventListener('close', () => {
    const action = dlgBot.returnValue;
    if (action === 'resume') {
      resumeBot();
    } else if (action === 'start') {
      const form = dlgBot.querySelector('form');
      const level = form.querySelector('input[name="level"]:checked').value;
      const color = form.querySelector('input[name="color"]:checked').value;
      const mode = form.querySelector('input[name="mode"]:checked').value;
      store.set(KEYS.botPrefs, { level, color, mode });
      const human = color === 'random' ? (Math.random() < 0.5 ? RED : BLUE) : color;
      startBot({ mode, level, human, moves: [] });
    }
  });

  function openLocalDialog() {
    const form = dlgLocal.querySelector('form');
    const data = savedGame(KEYS.local);
    setRadio(form, 'mode', data && data.mode === MODES.CLASSIC ? MODES.CLASSIC : MODES.ORIGINAL);
    form.querySelector('[data-resume]').hidden = !hasUnfinished(KEYS.local) || (session && session.kind === 'local');
    updateModeNotes(dlgLocal);
    openDialog(dlgLocal);
  }

  dlgLocal.addEventListener('close', () => {
    const action = dlgLocal.returnValue;
    if (action === 'resume') resumeLocal();
    else if (action === 'start') startLocal(dlgLocal.querySelector('input[name="mode"]:checked').value, []);
  });

  const joinInput = $('join-code');
  const joinError = $('join-error');

  function openOnlineDialog() {
    joinInput.value = '';
    joinError.hidden = true;
    updateModeNotes(dlgOnline);
    openDialog(dlgOnline);
  }

  joinInput.addEventListener('input', () => {
    const code = Online.normalizeCode(joinInput.value);
    if (joinInput.value !== code) joinInput.value = code;
    joinError.hidden = true;
  });

  $('form-join').addEventListener('submit', (e) => {
    if (!Online.isValidCode(joinInput.value)) {
      e.preventDefault();
      joinError.hidden = false;
      joinInput.focus();
    }
  });

  dlgOnline.addEventListener('close', () => {
    const action = dlgOnline.returnValue;
    if (action === 'create') {
      const mode = $('form-create').querySelector('input[name="mode"]:checked').value;
      startOnline(Online.newCode(), mode);
    } else if (action === 'join') {
      startOnline(joinInput.value, null);
    }
  });

  // ---------- Eventos ----------

  boardEl.addEventListener('click', (e) => {
    const cell = e.target.closest('.cell');
    if (!cell || cell.disabled || !canInteract()) return;
    const b = Number(cell.dataset.board);
    const c = Number(cell.dataset.cell);
    if (session.kind === 'online') {
      session.match.play(b, c); // onChange vuelve a pintar
      return;
    }
    if (play(session.game, b, c)) {
      save();
      render();
      botTurn();
    }
  });

  $('menu-bot').addEventListener('click', openBotDialog);
  $('menu-online').addEventListener('click', openOnlineDialog);
  $('menu-local').addEventListener('click', openLocalDialog);
  $('menu-help').addEventListener('click', () => openDialog(dlgHelp));
  $('btn-help').addEventListener('click', () => openDialog(dlgHelp));
  $('btn-back').addEventListener('click', goHome);
  $('btn-undo').addEventListener('click', undo);
  $('btn-new').addEventListener('click', () => {
    if (session && session.kind === 'bot') openBotDialog();
    else openLocalDialog();
  });
  $('btn-rematch').addEventListener('click', () => {
    if (session && session.kind === 'online') session.match.rematch();
  });
  $('btn-invite').addEventListener('click', shareRoom);
  $('btn-share').addEventListener('click', shareRoom);
  $('btn-copy-code').addEventListener('click', () => {
    if (session && session.kind === 'online') copyText(session.code, 'Código copiado');
  });

  // ---------- Inicio ----------

  const roomCode = Online.normalizeCode(new URLSearchParams(location.search).get('sala'));
  if (Online.isValidCode(roomCode)) {
    startOnline(roomCode, null);
  } else {
    const screen = store.get(KEYS.screen);
    if (!((screen === 'bot' && resumeBot()) || (screen === 'local' && resumeLocal()))) goHome();
  }

  // Mostrar las reglas la primera vez
  if (!store.get(KEYS.help)) {
    store.set(KEYS.help, true);
    openDialog(dlgHelp);
  }
})();
