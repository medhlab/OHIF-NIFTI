import React, { useRef, useState, useEffect } from 'react';
import { annotationRequest, installAnnotationContext } from './annotationClient';
import { isMaskDirty } from './masks';
import { CircleCheck, CircleDashed, Loader2 } from 'lucide-react';

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
    <button type="button" className="nw-completion-action" data-complete={complete}
      title={busy ? '正在检查完成状态' : complete ? '已完成；修改标注后自动恢复待完成' : '待完成 · 点击标记完成'}
      aria-label={busy ? '正在检查完成状态' : complete ? '病例已完成' : '标记完成'}
      disabled={busy || complete || !context.sourceId || source.annotationStatus?.busy}
      onClick={markComplete}>{busy ? <Loader2 size={18} className="animate-spin" /> : complete ? <CircleCheck size={18} /> : <CircleDashed size={18} />}</button>
    {error && <small role="alert">{error}</small>}
  </section>;
}
