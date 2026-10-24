// Partidas online entre dos amigos, sin servidor propio: se usa un broker MQTT público
// como pizarra compartida. El estado de la sala se guarda como mensaje "retenido", así
// que quien entra, recarga la página o se reconecta recibe al momento la última versión.
(function (root) {
  'use strict';

  const { RED, BLUE, MODES, replay, play } = root.Game;

  // Si el primero no responde se prueba el siguiente (al crear y al buscar la sala)
  const BROKERS = [
    'wss://broker.hivemq.com:8884/mqtt',
    'wss://broker.emqx.io:8084/mqtt',
  ];
  const MQTT_SCRIPT = 'https://cdn.jsdelivr.net/npm/mqtt@5.15.2/dist/mqtt.min.js';
  const MQTT_INTEGRITY = 'sha384-haZiwxTLortiFcYMBEEE1+8ayC+o18YtuwHZv+4WQHoPaLzRjwOV6h7Vva5iLSCZ';
  const TOPIC_PREFIX = '3x3x3-ultimate/v1/';
  const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // sin 0/O ni 1/I/L
  const CODE_LENGTH = 6;
  const CONNECT_TIMEOUT_MS = 8000;
  const FIND_TIMEOUT_MS = 4000; // espera del estado de la sala al unirse

  let libraryPromise = null;

  // mqtt.js solo se descarga cuando alguien juega online
  function loadLibrary() {
    if (root.mqtt) return Promise.resolve(root.mqtt);
    if (!libraryPromise) {
      libraryPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = MQTT_SCRIPT;
        script.integrity = MQTT_INTEGRITY;
        script.crossOrigin = 'anonymous';
        script.onload = () => (root.mqtt ? resolve(root.mqtt) : reject(new Error('mqtt.js no disponible')));
        script.onerror = () => {
          libraryPromise = null;
          script.remove();
          reject(new Error('No se pudo cargar mqtt.js'));
        };
        document.head.appendChild(script);
      });
    }
    return libraryPromise;
  }

  function randomString(length) {
    const values = new Uint32Array(length);
    crypto.getRandomValues(values);
    let out = '';
    for (const v of values) out += CODE_ALPHABET[v % CODE_ALPHABET.length];
    return out;
  }

  function newCode() {
    return randomString(CODE_LENGTH);
  }

  function normalizeCode(text) {
    return String(text || '').toUpperCase().split('')
      .filter((ch) => CODE_ALPHABET.includes(ch)).join('').slice(0, CODE_LENGTH);
  }

  function isValidCode(code) {
    return normalizeCode(code) === code && code.length === CODE_LENGTH;
  }

  function isValidState(s) {
    return !!s && s.v === 1 && Number.isInteger(s.rev) && Number.isInteger(s.game) &&
      (s.mode === MODES.ORIGINAL || s.mode === MODES.CLASSIC) && Array.isArray(s.moves) &&
      typeof s.red === 'string' && (s.blue === null || typeof s.blue === 'string');
  }

  const decoder = typeof TextDecoder !== 'undefined' ? new TextDecoder() : null;
  function decode(payload) {
    return decoder ? decoder.decode(payload) : String(payload);
  }

  // Una sala. Estado compartido: { v, rev, game, mode, moves, red, blue }, donde red y blue
  // son los identificadores de los jugadores sentados, `game` cuenta las revanchas y `rev`
  // crece con cada cambio (gana siempre la versión más reciente).
  class Match {
    constructor({ code, playerId, createMode, onChange }) {
      this.code = code;
      this.me = playerId;
      this.createMode = createMode || null;
      this.onChange = onChange;
      this.status = 'connecting'; // connecting | online | offline | notfound | error
      this.state = null;
      this.game = null;
      this.peers = new Set();     // jugadores conectados ahora mismo
      this.client = null;
      this.closed = false;
      this.anyConnected = false;
      this.onFound = null;
      this.base = TOPIC_PREFIX + code + '/';
      this.presenceTopic = this.base + 'p/' + playerId;

      // Al volver a la app tras bloquear el móvil, reconectar sin esperar al temporizador
      this.onVisible = () => {
        const c = this.client;
        if (!document.hidden && c && !c.connected && !c.reconnecting && !this.closed) c.reconnect();
      };
      document.addEventListener('visibilitychange', this.onVisible);

      this.start();
    }

    get seat() {
      const s = this.state;
      if (!s) return null;
      if (s.red === this.me) return RED;
      if (s.blue === this.me) return BLUE;
      return null;
    }

    get opponentId() {
      const s = this.state;
      if (!s) return null;
      if (this.seat === RED) return s.blue;
      if (this.seat === BLUE) return s.red;
      return null;
    }

    get opponentOnline() {
      const id = this.opponentId;
      return !!id && this.peers.has(id);
    }

    async start() {
      let mqtt;
      try {
        mqtt = await loadLibrary();
      } catch (_) {
        this.setStatus('error');
        return;
      }
      for (const url of BROKERS) {
        if (this.closed) return;
        if (await this.tryBroker(mqtt, url)) return;
      }
      if (!this.closed) this.setStatus(this.anyConnected ? 'notfound' : 'error');
    }

    // Resuelve true si en este broker se ha creado o encontrado la sala
    tryBroker(mqtt, url) {
      return new Promise((resolve) => {
        const client = mqtt.connect(url, {
          clientId: 'x3_' + randomString(12).toLowerCase(),
          keepalive: 20,
          reconnectPeriod: 2000,
          connectTimeout: CONNECT_TIMEOUT_MS,
          clean: true,
          resubscribe: false, // nos suscribimos a mano en cada conexión
          will: { topic: this.presenceTopic, payload: '', qos: 1, retain: true },
        });
        this.client = client;

        let settled = false;
        let timer = setTimeout(() => settle(false), CONNECT_TIMEOUT_MS);
        const settle = (ok) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          this.onFound = null;
          if (ok) {
            this.setStatus('online');
          } else {
            client.end(true);
            if (this.client === client) this.client = null;
          }
          resolve(ok);
        };

        client.on('connect', () => {
          this.anyConnected = true;
          client.subscribe([this.base + 'state', this.base + 'p/+'], { qos: 1 }, (err) => {
            if (err) {
              settle(false);
              return;
            }
            client.publish(this.presenceTopic, '1', { qos: 1, retain: true });
            if (settled) {
              this.setStatus('online'); // reconexión
            } else if (this.createMode) {
              this.publish({ v: 1, rev: 1, game: 1, mode: this.createMode, moves: [], red: this.me, blue: null });
              settle(true);
            } else if (this.state) {
              settle(true);
            } else {
              this.onFound = () => settle(true);
              clearTimeout(timer);
              timer = setTimeout(() => settle(false), FIND_TIMEOUT_MS);
            }
          });
        });
        client.on('message', (topic, payload) => this.handleMessage(topic, payload));
        client.on('close', () => {
          if (settled && !this.closed) this.setStatus('offline');
        });
        client.on('error', () => { /* los fallos de conexión se tratan con el temporizador */ });
      });
    }

    handleMessage(topic, payload) {
      if (this.closed) return;
      const text = decode(payload);
      if (topic === this.base + 'state') {
        let s = null;
        try { s = text ? JSON.parse(text) : null; } catch (_) { return; }
        if (s) this.receive(s);
      } else if (topic.startsWith(this.base + 'p/')) {
        const id = topic.slice((this.base + 'p/').length);
        if (text) this.peers.add(id);
        else this.peers.delete(id);
        this.emit();
      }
    }

    receive(s) {
      if (!isValidState(s)) return;
      const local = this.state;
      if (local && s.rev < local.rev) {
        // Al broker no le llegó nuestra última versión (p. ej. por un corte): reenviarla
        this.send(local);
        return;
      }
      const game = replay(s.mode, s.moves);
      if (game.moves.length !== s.moves.length) return; // contiene jugadas ilegales

      this.state = s;
      this.game = game;
      if (this.onFound) this.onFound();

      // Si la sala espera rival, ocupar el asiento azul
      if (s.blue === null && s.red !== this.me) {
        this.publish({ ...s, blue: this.me, rev: s.rev + 1 });
        return;
      }
      this.emit();
    }

    publish(s) {
      this.state = s;
      this.game = replay(s.mode, s.moves);
      this.send(s);
      this.emit();
    }

    send(s) {
      if (this.client) this.client.publish(this.base + 'state', JSON.stringify(s), { qos: 1, retain: true });
    }

    canPlay() {
      const g = this.game;
      return this.status === 'online' && !!g && !g.winner && !!this.state.blue && this.seat === g.player;
    }

    play(b, c) {
      if (!this.canPlay()) return false;
      const s = this.state;
      const g = replay(s.mode, s.moves);
      if (!play(g, b, c)) return false;
      this.publish({ ...s, moves: g.moves, rev: s.rev + 1 });
      return true;
    }

    // Nueva partida en la misma sala, intercambiando colores (empieza quien era azul)
    rematch() {
      const s = this.state;
      if (this.status !== 'online' || !this.game || !this.game.winner || !this.seat) return false;
      this.publish({ ...s, game: s.game + 1, moves: [], red: s.blue, blue: s.red, rev: s.rev + 1 });
      return true;
    }

    leave() {
      if (this.closed) return;
      this.closed = true;
      document.removeEventListener('visibilitychange', this.onVisible);
      const client = this.client;
      this.client = null;
      if (!client) return;
      let ended = false;
      const end = () => {
        if (ended) return;
        ended = true;
        client.end(true);
      };
      if (client.connected) client.publish(this.presenceTopic, '', { qos: 1, retain: true }, end);
      setTimeout(end, 1500);
    }

    setStatus(status) {
      if (this.status === status) return;
      this.status = status;
      this.emit();
    }

    emit() {
      if (!this.closed && this.onChange) this.onChange(this);
    }
  }

  root.Online = { Match, newCode, normalizeCode, isValidCode, CODE_LENGTH };
})(this);
