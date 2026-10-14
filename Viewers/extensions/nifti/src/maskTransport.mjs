/** Binary mask uploads: bounded waiting, real upload progress and lossless encoding. */
export async function encodeMask(pixels, gzipSupported, signal) {
  signal?.throwIfAborted();
  const raw = new Blob([pixels]);
  if (!gzipSupported || !globalThis.CompressionStream) return { blob: raw, encoding: 'raw' };
  const reader = raw.stream().pipeThrough(new CompressionStream('gzip')).getReader();
  const abort = () => reader.cancel(signal.reason).catch(() => {});
  signal?.addEventListener('abort', abort, { once: true });
  const chunks = [];
  try {
    while (true) {
      signal?.throwIfAborted();
      const { done, value } = await reader.read();
      signal?.throwIfAborted();
      if (done) break;
      chunks.push(value);
    }
    const compressed = new Blob(chunks, { type: 'application/gzip' });
    return compressed.size < raw.size
      ? { blob: compressed, encoding: 'gzip' }
      : { blob: raw, encoding: 'raw' };
  } finally {
    signal?.removeEventListener('abort', abort);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export function uploadForm(url, form, signal, progress = () => {}, headers = {}, idleMs = 90000) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new DOMException('Cancelled', 'AbortError'));
    const xhr = new XMLHttpRequest();
    let timer,
      settled = false,
      stalled = false;
    const abort = () => xhr.abort();
    const finish = (error, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal?.removeEventListener('abort', abort);
      error ? reject(error) : resolve(value);
    };
    const resetDeadline = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        stalled = true;
        xhr.abort();
      }, idleMs);
    };
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.timeout = 30 * 60 * 1000;
    for (const [name, value] of Object.entries(headers)) xhr.setRequestHeader(name, value);
    xhr.upload.onprogress = e => {
      resetDeadline();
      if (e.lengthComputable) progress(e.loaded / e.total);
    };
    xhr.upload.onload = () => {
      resetDeadline();
      progress(1);
    };
    xhr.onprogress = resetDeadline;
    xhr.onerror = () => finish(new Error('网络请求失败，当前编辑已保留，可重新保存。'));
    xhr.ontimeout = () => finish(new Error('保存请求超时，当前编辑已保留，可重新保存。'));
    xhr.onabort = () =>
      finish(
        stalled
          ? new Error('保存连续 90 秒无响应，已停止；当前编辑已保留，可重新保存。')
          : new DOMException('Cancelled', 'AbortError')
      );
    xhr.onload = () => {
      let data;
      try {
        data = JSON.parse(xhr.responseText);
      } catch {
        finish(new Error(`服务器响应无效 (${xhr.status})。`));
        return;
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const error = new Error(`保存失败 (${xhr.status})。`);
        Object.assign(error, { status: xhr.status, detail: data?.detail });
        finish(error);
      } else finish(null, data);
    };
    signal?.addEventListener('abort', abort, { once: true });
    resetDeadline();
    try {
      xhr.send(form);
    } catch (error) {
      finish(error);
    }
  });
}
