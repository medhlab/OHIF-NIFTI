/** Two bounded frame pipelines; stop both on cancellation, failure, or capacity. */
export async function prefetchFrames(indices, process, signal) {
  const controller = new AbortController();
  const abort = () => controller.abort(signal.reason);
  signal.addEventListener('abort', abort, { once: true });
  if (signal.aborted) abort();
  let cursor = 0, stopped = false, failure;
  const worker = async () => {
    try {
      while (!stopped && cursor < indices.length) {
        controller.signal.throwIfAborted();
        const index = indices[cursor++];
        if (await process(index, controller.signal) === false) {
          stopped = true; controller.abort();
        }
      }
    } catch (error) {
      if (!stopped) { failure = error; stopped = true; controller.abort(); }
    }
  };
  try {
    await Promise.all([worker(), worker()]);
    signal.throwIfAborted();
    if (failure) throw failure;
    return !stopped;
  } finally { signal.removeEventListener('abort', abort); }
}
