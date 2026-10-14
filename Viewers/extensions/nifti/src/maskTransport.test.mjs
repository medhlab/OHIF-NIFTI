import { test } from 'node:test';
import assert from 'node:assert/strict';
import { gunzipSync } from 'node:zlib';
import { encodeMask, uploadForm } from './maskTransport.mjs';

test('compressed masks retain every voxel and older servers receive raw bytes', async () => {
  const pixels = new Uint8Array(512 * 512 * 236);
  pixels[12345] = 1;
  pixels[12346] = 1;
  const packed = await encodeMask(pixels, true);
  assert.equal(packed.encoding, 'gzip');
  assert.ok(packed.blob.size < pixels.length / 100);
  assert.deepEqual(
    new Uint8Array(gunzipSync(Buffer.from(await packed.blob.arrayBuffer()))),
    pixels
  );
  const raw = await encodeMask(pixels.subarray(0, 256), false);
  assert.equal(raw.encoding, 'raw');
  assert.deepEqual(new Uint8Array(await raw.blob.arrayBuffer()), pixels.subarray(0, 256));
});

test('cancel during compression returns AbortError', async () => {
  const controller = new AbortController();
  const result = encodeMask(new Uint8Array(1024 * 1024), true, controller.signal);
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
});

class XHR {
  static current;
  constructor() {
    this.upload = {};
    this.headers = {};
    XHR.current = this;
  }
  open(method, url) {
    this.method = method;
    this.url = url;
  }
  setRequestHeader(k, v) {
    this.headers[k] = v;
  }
  send(form) {
    this.form = form;
  }
  abort() {
    this.onabort();
  }
}
globalThis.XMLHttpRequest = XHR;

test('upload sends idempotency headers, reports progress and waits for server result', async () => {
  const progress = [];
  const form = new FormData();
  const promise = uploadForm('/annotation/mask-versions', form, undefined, p => progress.push(p), {
    'Idempotency-Key': 'retry-key',
  });
  const xhr = XHR.current;
  assert.equal(xhr.headers['Idempotency-Key'], 'retry-key');
  assert.equal(xhr.form, form);
  xhr.upload.onprogress({ lengthComputable: true, loaded: 5, total: 10 });
  xhr.upload.onload();
  assert.deepEqual(progress, [0.5, 1]);
  xhr.status = 200;
  xhr.responseText = '{"items":[{"version":2}]}';
  xhr.onload();
  assert.equal((await promise).items[0].version, 2);
});

test('stalled upload stops waiting and explicit cancellation stays distinguishable', async () => {
  await assert.rejects(uploadForm('/save', new FormData(), undefined, undefined, {}, 5), /无响应/);
  const controller = new AbortController();
  const result = uploadForm('/save', new FormData(), controller.signal);
  controller.abort();
  await assert.rejects(result, { name: 'AbortError' });
});

test('revision errors retain status and server detail for retry UI', async () => {
  const promise = uploadForm('/save', new FormData());
  const xhr = XHR.current;
  xhr.status = 409;
  xhr.responseText = '{"detail":{"code":"CONFLICT"}}';
  xhr.onload();
  await assert.rejects(promise, error => error.status === 409 && error.detail.code === 'CONFLICT');
});
