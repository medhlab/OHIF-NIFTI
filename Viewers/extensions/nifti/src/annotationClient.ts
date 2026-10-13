import { apiRoot } from './api';

export const annotationRoot = () => apiRoot().replace(/\/nifti-images\/?$/, '') + '/api/annotation/v1';
export async function annotationRequest(path: string, payload?, signal?: AbortSignal, key?: string) {
  const response = await fetch(annotationRoot() + path, {
    credentials: 'same-origin', signal,
    ...(payload === undefined ? {} : { method: 'POST', headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key || crypto.randomUUID() }, body: JSON.stringify(payload) }),
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(body.detail?.message || body.error?.message || '标注操作失败。');
    Object.assign(error, { status: response.status }); throw error;
  }
  return body;
}
export function installAnnotationContext(source, body) {
  source.annotationCase = body.data;
  window.dispatchEvent(new CustomEvent('nifti:annotation-updated', { detail: source.sourceKey }));
}
