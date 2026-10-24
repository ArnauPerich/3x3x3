// Web Worker del bot: piensa en segundo plano para no congelar la interfaz.
importScripts('engine.js');

self.onmessage = (e) => {
  const { id, mode, moves, level } = e.data;
  try {
    const result = self.Engine.think(mode, moves, level);
    self.postMessage({ id, move: result.move, iterations: result.iterations });
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
