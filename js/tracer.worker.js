import { traceWork } from './tracer.js';

self.onmessage = (e) => {
  const { id, pixels, opts } = e.data;
  try {
    const result = traceWork(pixels, opts, (fraction, stage) => {
      self.postMessage({ id, progress: fraction, stage });
    });
    self.postMessage({ id, result }, [result.path.buffer, result.edges.buffer]);
  } catch (err) {
    self.postMessage({ id, error: String(err && err.message || err) });
  }
};
