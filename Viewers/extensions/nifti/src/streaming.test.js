import { createStream, ensureSlice, ensureComplete, prepareStreaming, startBackground, pauseComplete, requestComplete } from './streaming';
import { request } from './api';
import { createFrameDecoder } from './workerClient';

jest.mock('./api', () => ({ request: jest.fn() }));
jest.mock('./workerClient', () => ({ createFrameDecoder: jest.fn() }));
jest.mock('./sourceStore', () => ({ reserve: jest.fn(), release: jest.fn() }));
jest.mock('./frameCodec.mjs', () => ({ scalarTypes: { i2: Int16Array }, dtypeName: x => x.replace(/[<>=|]/g, '') }));

function source(count = 12) {
  const descriptor = { cacheKey: 'key', sourceId: 'source', frames: Array.from({ length: count }, () => ({ bytes: 2 })) };
  const result = { sourceKey: 'local', descriptor: { sourceId: 'source', dimensions: [1, 1, count] }, scalarData: new Int16Array(count) };
  createStream(result, descriptor); return result;
}
function response(index = 0) {
  let read = false;
  return { headers: { get: name => ({ 'X-Nifti-Cache-Key': 'key', 'X-Nifti-Frame': String(index), 'content-length': '1' })[name] },
    body: { getReader: () => ({ read: async () => read ? { done: true } : (read = true, { value: new Uint8Array([1]) }), cancel: async () => {}, releaseLock() {} }) } };
}
// The locked Jest jsdom predates this browser AbortSignal API.
if (!AbortSignal.prototype.throwIfAborted) AbortSignal.prototype.throwIfAborted = function () {
  if (this.aborted) throw this.reason || new DOMException('Cancelled', 'AbortError');
};
beforeEach(() => { jest.resetAllMocks(); createFrameDecoder.mockReturnValue({ decode: jest.fn().mockResolvedValue(new Int16Array([42])), dispose: jest.fn() }); });

test('transient HTTP failure retries the same frame and restores its working pixels', async () => {
  const s = source(1);
  request.mockRejectedValueOnce(Object.assign(Error('service unavailable'), { status: 503 })).mockResolvedValue(response());
  await ensureSlice(s, 0);
  expect(request).toHaveBeenCalledTimes(2); expect(s.scalarData[0]).toBe(42); expect(s.stream.loaded[0]).toBe(1);
  s.stream.dispose();
});

test('failed complete request cancels remaining consumers and retains already loaded pixels', async () => {
  const s = source(); s.stream.loaded[5] = 1; s.scalarData[5] = 73;
  request.mockImplementation((_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true });
    if (_.endsWith('/0')) reject(Object.assign(Error('invalid frame'), { status: 400 }));
  }));
  await expect(ensureComplete(s)).rejects.toThrow('invalid frame');
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(s.stream.queue.jobs.size).toBe(0); expect(s.stream.completing).toBe(0);
  expect(s.scalarData[5]).toBe(73); expect(s.stream.loaded[5]).toBe(1);
  s.stream.dispose();
});

test('protocol mismatch rejects without downloading or silently using the whole file', async () => {
  request.mockResolvedValueOnce({ json: async () => ({ state: 'ready', descriptor: { version: 2 } }) });
  await expect(prepareStreaming('source', {}, undefined, () => {})).rejects.toThrow('协议');
  expect(request.mock.calls.map(call => call[0])).toEqual(['/source/stream/prepare']);
});

test('60-second idle timeout stops after two retries without replacing source pixels', async () => {
  jest.useFakeTimers(); const s = source(1); s.scalarData[0] = 73;
  request.mockImplementation((_, { signal }) => new Promise((resolve, reject) => {
    signal.addEventListener('abort', () => reject(signal.reason), { once: true });
  }));
  const result = ensureSlice(s, 0).catch(error => error);
  await jest.advanceTimersByTimeAsync(182000);
  expect((await result).name).toBe('TimeoutError'); expect(request).toHaveBeenCalledTimes(3);
  expect(s.scalarData[0]).toBe(73); expect(s.stream.loaded[0]).toBe(0); s.stream.dispose(); jest.useRealTimers();
});

test('180-second total timeout ends a trickling body that never goes idle', async () => {
  jest.useFakeTimers(); const s = source(1);
  request.mockImplementation((_, { signal }) => {
    const reply = response(); reply.body.getReader = () => ({ read: () => new Promise((resolve, reject) => {
      const abort = () => { clearTimeout(timer); reject(signal.reason); };
      const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve({ value: new Uint8Array([1]) }); }, 40000);
      signal.addEventListener('abort', abort, { once: true });
    }), cancel: async () => {}, releaseLock() {} });
    return Promise.resolve(reply);
  });
  const result = ensureSlice(s, 0).catch(error => error);
  await jest.advanceTimersByTimeAsync(542000);
  expect((await result).name).toBe('TimeoutError'); expect(request).toHaveBeenCalledTimes(3);
  expect(s.stream.loaded[0]).toBe(0); s.stream.dispose(); jest.useRealTimers();
});


test('first display expands to the whole volume without navigation and preserves already loaded pixels', async () => {
  const s = source(31); s.stream.loaded[15] = 1; s.scalarData[15] = 73;
  request.mockImplementation(async path => response(Number(path.split('/').at(-1))));
  startBackground(s, 15); const fill = s.stream.backgroundCompletion;
  startBackground(s, 25); expect(s.stream.backgroundOrigin).toBe(15);
  await fill;
  expect(s.stream.loaded.every(Boolean)).toBe(true); expect(s.scalarData[15]).toBe(73);
  expect(request.mock.calls).toHaveLength(30);
  expect(request.mock.calls.slice(0, 6).map(([path]) => Number(path.split('/').at(-1)))).toEqual([16,14,17,13,18,12]);
  expect(s.stream.backgroundController).toBeUndefined(); s.stream.dispose();
});

test('one failed background frame does not stop the others and explicit completion retries only the missing frame', async () => {
  const s = source(31); s.stream.loaded[15] = 1;
  request.mockImplementation(async path => {
    const index = Number(path.split('/').at(-1));
    if (index === 13) throw Object.assign(Error('invalid frame'), { status: 400 });
    return response(index);
  });
  startBackground(s, 15); await s.stream.backgroundCompletion;
  expect([...s.stream.loaded].filter(Boolean)).toHaveLength(30);
  expect(s.stream.errors.get(13)).toBe('invalid frame'); expect(s.stream.loaded[0]).toBe(1); expect(s.stream.loaded[30]).toBe(1);
  startBackground(s, 20); expect(request.mock.calls).toHaveLength(30);
  request.mockImplementation(async path => response(Number(path.split('/').at(-1))));
  await requestComplete(s); expect(request.mock.calls).toHaveLength(31);
  expect(s.stream.loaded.every(Boolean)).toBe(true); expect(s.stream.errors.size).toBe(0); s.stream.dispose();
});

test('pausing the background retains loaded pixels, does not restart on display, and explicit resume completes', async () => {
  const s = source(31); s.stream.loaded[15] = 1; s.scalarData[15] = 73;
  request.mockImplementation((_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })));
  startBackground(s, 15); const fill = s.stream.backgroundCompletion;
  await new Promise(resolve => setTimeout(resolve, 10)); expect(request.mock.calls).toHaveLength(2);
  pauseComplete(s); await fill; await new Promise(resolve => setTimeout(resolve, 10));
  expect(s.stream.queue.jobs.size).toBe(0); expect(s.stream.loaded[15]).toBe(1); expect(s.scalarData[15]).toBe(73); expect(s.stream.errors.size).toBe(0);
  startBackground(s, 25); expect(request.mock.calls).toHaveLength(2);
  request.mockImplementation(async path => response(Number(path.split('/').at(-1))));
  await requestComplete(s); expect(s.stream.loaded.every(Boolean)).toBe(true); expect(s.scalarData[15]).toBe(73); s.stream.dispose();
});

test('releasing a source cancels background requests and the decoder without populating missing pixels', async () => {
  const s = source(31); s.stream.loaded[15] = 1; s.scalarData[15] = 73;
  request.mockImplementation((_, { signal }) => new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true })));
  startBackground(s, 15); const fill = s.stream.backgroundCompletion;
  await new Promise(resolve => setTimeout(resolve, 10)); s.stream.dispose(); await fill;
  await new Promise(resolve => setTimeout(resolve, 10));
  expect(s.stream.queue.jobs.size).toBe(0); expect(s.stream.queue.active).toBe(0);
  expect(s.scalarData[15]).toBe(73); expect(s.stream.loaded[14]).toBe(0); expect(s.stream.decoder.dispose).toHaveBeenCalledTimes(1);
});
