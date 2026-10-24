// Bot: ejecuta el motor (js/engine.js) en un Web Worker. Si el navegador no permite
// workers (por ejemplo, al abrir index.html desde el disco), piensa a trozos en la página.
(function (root) {
  'use strict';

  const SLICE_MS = 25;

  let worker = null;
  let workerBroken = false;
  let pending = null; // { id, mode, moves, level, resolve, reject }
  let nextId = 0;

  function getWorker() {
    if (workerBroken) return null;
    if (worker) return worker;
    try {
      worker = new Worker('js/bot-worker.js');
    } catch (_) {
      workerBroken = true;
      return null;
    }
    worker.onmessage = (e) => {
      const job = pending;
      if (!job || e.data.id !== job.id) return;
      pending = null;
      if (e.data.error) job.reject(new Error(e.data.error));
      else job.resolve(e.data.move);
    };
    worker.onerror = (e) => {
      if (e.preventDefault) e.preventDefault();
      worker.terminate();
      worker = null;
      workerBroken = true;
      if (pending) thinkInPage(pending);
    };
    return worker;
  }

  function thinkInPage(job) {
    let search;
    try {
      search = new root.Engine.Search(job.mode, job.moves, root.Engine.LEVELS[job.level]);
    } catch (err) {
      pending = null;
      job.reject(err);
      return;
    }
    (function step() {
      if (pending !== job) return;
      if (search.step(SLICE_MS)) {
        setTimeout(step, 0);
        return;
      }
      pending = null;
      job.resolve(search.bestMove());
    })();
  }

  // Devuelve una promesa con la jugada [tablero, casilla]
  function think(mode, moves, level) {
    cancel();
    return new Promise((resolve, reject) => {
      const job = { id: ++nextId, mode, moves, level, resolve, reject };
      pending = job;
      const w = getWorker();
      if (w) w.postMessage({ id: job.id, mode, moves, level });
      else thinkInPage(job);
    });
  }

  // Abandona la búsqueda en curso (la promesa pendiente no se resuelve nunca)
  function cancel() {
    if (pending && worker) {
      worker.terminate();
      worker = null;
    }
    pending = null;
  }

  root.Bot = { think, cancel };
})(this);
