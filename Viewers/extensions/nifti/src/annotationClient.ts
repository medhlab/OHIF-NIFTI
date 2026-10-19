import { segmentation } from '@cornerstonejs/tools';
import { bindings } from './packedMasks';
import { annotationErrorMessage } from './annotationMessages';
import { apiRoot, ensureStored } from './api';
import { getWorkspace } from './workspace';
import { bindLoadedMask } from './legacyMaskAccess.mjs';

export const annotationRoot = () =>
  apiRoot().replace(/\/nifti-images\/?$/, '') + '/api/annotation/v1';
export async function annotationRequest(
  path: string,
  payload?,
  signal?: AbortSignal,
  key?: string
) {
  const response = await fetch(annotationRoot() + path, {
    credentials: 'same-origin',
    signal,
    ...(payload === undefined
      ? {}
      : {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Idempotency-Key': key || crypto.randomUUID(),
          },
          body: JSON.stringify(payload),
        }),
  });
  const body = await response.json();
  if (!response.ok) {
    const error = new Error(annotationErrorMessage(body.detail || body.error, '标注操作失败。'));
    Object.assign(error, { status: response.status });
    throw error;
  }
  return body;
}
export function installAnnotationContext(source, body) {
  source.annotationCase = body.data;
  source.masks?.forEach(mask => {
    bindLoadedMask(mask, body.data);
    const metadata = body.maskMetadata?.find(item => item.maskId === mask.saved?.maskId);
    if (metadata && metadata.version === mask.saved.version && mask.label === mask.saved.name) {
      mask.label = metadata.name;
      mask.saved = { ...mask.saved, name: metadata.name, metadataRevision: metadata.metadataRevision };
      for (const binding of bindings(mask)) {
        const segment = segmentation.state.getSegmentation(binding.segmentationId)?.segments?.[binding.segmentIndex];
        if (segment) segment.label = metadata.name;
      }
    }
  });
  window.dispatchEvent(new CustomEvent('nifti:annotation-updated', { detail: source.sourceKey }));
}

/** Register the same business Case from either workbench or manual editing entry. */
export async function registerAnnotationCase(target, signal?: AbortSignal) {
  if (target.annotationCase) return target.annotationCase;
  if (target.registrationPromise) return target.registrationPromise;
  // Capture identity before async storage; switching CTs must not change this request's Case.
  const w = { ...getWorkspace() },
    entryUrl = window.location.href;
  const registration = (async () => {
    await ensureStored(target, signal);
    let caseId;
    if (w.manifest?.id && w.caseId) {
      const list = await annotationRequest('/worklists', { manifestId: w.manifest.id }, signal);
      caseId = list.items.find(i => i.externalCaseId === w.caseId)?.caseId;
    } else {
      const fromUrl = new URL(entryUrl).searchParams.get('annotationCaseId');
      if (fromUrl) {
        const existing = await annotationRequest(
          `/cases/${encodeURIComponent(fromUrl)}/context`,
          undefined,
          signal
        );
        if (existing.data.sourceId === target.descriptor.sourceId) caseId = fromUrl;
      }
    }
    target.registrationKey ||= crypto.randomUUID();
    const body = await annotationRequest(
      '/cases',
      { sourceId: target.descriptor.sourceId, ...(caseId ? { caseId } : {}) },
      signal,
      target.registrationKey
    );
    signal?.throwIfAborted();
    target.registrationKey = undefined;
    installAnnotationContext(target, body);
    if (!w.manifest?.id && window.location.href === entryUrl) {
      const url = new URL(window.location.href);
      url.searchParams.set('annotationCaseId', body.caseId);
      url.searchParams.set('sourceId', target.descriptor.sourceId);
      window.history.replaceState(window.history.state, '', url);
    }
    return body.data;
  })();
  target.registrationPromise = registration;
  try {
    return await registration;
  } finally {
    if (target.registrationPromise === registration) target.registrationPromise = undefined;
  }
}
