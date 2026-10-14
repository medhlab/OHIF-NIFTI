import React, { useRef, useState, useEffect } from 'react';
import { annotationRequest, installAnnotationContext } from './annotationClient';
import { isMaskDirty } from './masks';

export default function CaseCompletion({ source, servicesManager }) {
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const mounted = useRef(true), pending = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const context = source?.annotationCase;
  if (!context) return null;
  const complete = context.completedRevision === context.revision;
  const markComplete = async () => {
    if (pending.current) return;
    pending.current = true; setBusy(true); setError('');
    try {
      if ([...source.masks.values()].some(m => !m.anatomyReadOnly && isMaskDirty(servicesManager, m)))
        throw Error('请先保存当前编辑。');
      const body = await annotationRequest(`/cases/${context.caseId}/operations`, {
        operation: 'complete', expectedCaseRevision: source.annotationCase.revision,
      });
      if (mounted.current) installAnnotationContext(source, body);
    } catch (e) {
      if (mounted.current) setError(e.message);
    } finally {
      pending.current = false;
      if (mounted.current) setBusy(false);
    }
  };
  return <section className="nw-case-completion" aria-label="当前病例完成状态">
    <strong>本例 · {complete ? '已完成' : '待完成'}</strong>
    <button disabled={busy || complete || !context.sourceId || source.annotationStatus?.busy}
      onClick={markComplete}>{busy ? '检查中…' : complete ? '已完成' : '标记完成'}</button>
    {complete && <small>继续修改标注后，本例会自动恢复为待完成。</small>}
    {error && <small role="alert">{error}</small>}
  </section>;
}
