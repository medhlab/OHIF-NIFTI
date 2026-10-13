import React, { useEffect, useRef, useState } from 'react';
import { useSystem } from '@ohif/core';
import { currentSource, createMask, loadSaved, isMaskDirty } from './masks';
import { ensureStored } from './api';
import { annotationRequest, installAnnotationContext } from './annotationClient';
import { getWorkspace } from './workspace';
import './lesion-panel.css';

export default function LesionPanel() {
  const { servicesManager } = useSystem();
  const [context, setContext] = useState<any>(null), [categories, setCategories] = useState<any>({});
  const [error, setError] = useState(''), [busy, setBusy] = useState(false), [progress, setProgress] = useState<any>(null);
  const [reportText, setReportText] = useState(''), [findingText, setFindingText] = useState(''), [category, setCategory] = useState('');
  const [evidence, setEvidence] = useState<any>(null), [selection, setSelection] = useState(''), [activeFinding, setActiveFinding] = useState('');
  const [linkEntity, setLinkEntity] = useState('');
  const [, render] = useState(0);
  const generation = useRef(0), operation = useRef(false);
  let source; try { source = currentSource(servicesManager).source; } catch { /* Viewer initializes separately. */ }
  const sourceRef = useRef(source); sourceRef.current = source;
  const refresh = async (target, signal?) => {
    if (!target?.annotationCase) return;
    const response = await annotationRequest(`/cases/${target.annotationCase.caseId}/context`, undefined, signal);
    if (sourceRef.current !== target) return;
    installAnnotationContext(target, response); setContext(response.data);
    if (response.data.worklistId) {
      const next = await annotationRequest(`/worklists/${response.data.worklistId}/progress`, undefined, signal);
      if (sourceRef.current === target) setProgress(next);
    }
  };
  const run = async action => {
    if (operation.current || source?.annotationStatus?.busy) return;
    operation.current = true; setBusy(true); setError('');
    const target = sourceRef.current, token = generation.current;
    try { await action(target); }
    catch (e) { if (generation.current === token) { setError(e.message); if (e.status === 409) await refresh(target).catch(() => {}); } }
    finally { operation.current = false; if (generation.current === token) setBusy(false); }
  };
  useEffect(() => {
    generation.current++; setContext(null); setProgress(null); setActiveFinding(''); setSelection(''); setEvidence(null); setFindingText(''); setReportText(''); setLinkEntity(''); setCategory(''); setError(''); setBusy(false);
    const target = source; const controller = new AbortController();
    if (target?.annotationCase) refresh(target, controller.signal).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => { generation.current++; controller.abort(); };
  }, [source?.sourceKey]);
  useEffect(() => {
    const updated = event => {
      const target = sourceRef.current;
      if (event.detail !== target?.sourceKey || !target?.annotationCase) return;
      setContext({ ...target.annotationCase });
      if (target.annotationCase.worklistId) annotationRequest(`/worklists/${target.annotationCase.worklistId}/progress`).then(p => { if (sourceRef.current === target) setProgress(p); }).catch(() => {});
    };
    window.addEventListener('nifti:annotation-updated', updated);
    annotationRequest('/categories').then(body => setCategories(body.items)).catch(e => setError(e.message));
    const timer = setInterval(() => { render(n => n + 1); const target = sourceRef.current; if (target?.annotationCase) setContext({ ...target.annotationCase }); }, 500);
    return () => { clearInterval(timer); window.removeEventListener('nifti:annotation-updated', updated); };
  }, []);
  const initialise = target => run(async () => {
    await ensureStored(target);
    const w = getWorkspace(); let caseId = target.annotationCase?.caseId;
    if (w.manifest?.id && w.caseId) {
      const list = await annotationRequest('/worklists', { manifestId: w.manifest.id });
      caseId = list.items.find(i => i.externalCaseId === w.caseId)?.caseId;
    } else if (!caseId) {
      const fromUrl = new URL(window.location.href).searchParams.get('annotationCaseId');
      if (fromUrl) {
        const existing = await annotationRequest(`/cases/${encodeURIComponent(fromUrl)}/context`);
        if (existing.data.sourceId === target.descriptor.sourceId) caseId = fromUrl;
      }
    }
    target.registrationKey ||= crypto.randomUUID();
    const body = await annotationRequest('/cases', { sourceId: target.descriptor.sourceId, ...(caseId ? { caseId } : {}) }, undefined, target.registrationKey);
    target.registrationKey = undefined;
    installAnnotationContext(target, body);
    if (sourceRef.current !== target) return;
    setContext(body.data);
    // A direct-source link can restore the same explicitly registered annotation Case.
    if (!w.manifest?.id) {
      const url = new URL(window.location.href); url.searchParams.set('annotationCaseId', body.caseId);
      url.searchParams.set('sourceId', target.descriptor.sourceId);
      window.history.replaceState(window.history.state, '', url);
    }
    await refresh(target);
  });
  const mutate = async (target, payload) => {
    const body = await annotationRequest(`/cases/${target.annotationCase.caseId}/operations`, { expectedCaseRevision: target.annotationCase.revision, ...payload });
    if (sourceRef.current !== target) return null;
    installAnnotationContext(target, body); setContext(body.data); await refresh(target); return body.data;
  };
  const editEntity = async (target, entity) => {
    let mask = [...target.masks.values()].find((m: any) => m.entityId === entity.id || m.saved?.maskId === entity.maskId);
    if (!mask && entity.maskId) {
      const results = await loadSaved(servicesManager, undefined, [entity.maskId]);
      const failure = results.find(r => r.status === 'failed'); if (failure) throw Error(failure.error);
      mask = [...target.masks.values()].find((m: any) => m.saved?.maskId === entity.maskId);
    }
    if (!mask) {
      const id = await createMask(servicesManager, entity.name);
      mask = target.masks.get(id); mask.entityId = entity.id;
    }
    if (sourceRef.current !== target) return;
    mask.entityId = entity.id; mask.annotationCaseId = target.annotationCase.caseId;
    window.dispatchEvent(new CustomEvent('nifti:select-target', { detail: { sourceKey: target.sourceKey, segmentationId: mask.segmentationId } }));
    window.dispatchEvent(new CustomEvent('nifti:workspace-tab', { detail: 'annotation' }));
  };
  const addEntity = findingId => run(async target => {
    const state = await mutate(target, { operation: 'entity', name: `病灶 ${target.annotationCase.entities.length + 1}`, findingIds: findingId ? [findingId] : [] });
    if (state) await editEntity(target, state.entities[state.entities.length - 1]);
  });
  const completed = context && context.completedRevision === context.revision;
  const selectEvidence = (event, report, section) => {
    const start16 = event.currentTarget.selectionStart, end16 = event.currentTarget.selectionEnd;
    const quote = section.text.slice(start16, end16);
    if (!quote) return;
    setSelection(quote); setFindingText(quote);
    setEvidence({ reportId: report.id, reportVersion: report.version, sectionId: section.id,
      start: Array.from(section.text.slice(0, start16)).length, end: Array.from(section.text.slice(0, end16)).length, quote });
  };
  const locateEvidence = finding => {
    setActiveFinding(finding.id);
    const e = context.evidence.find(i => finding.evidenceIds.includes(i.id));
    if (!e) return;
    setSelection(e.quote); setEvidence(e);
    const node = document.getElementById(`report-section-${e.sectionId}`) as HTMLTextAreaElement;
    const report = context.reports.find(r => r.id === e.reportId), section = report?.sections.find(s => s.id === e.sectionId);
    if (node && section) {
      node.focus(); node.setSelectionRange(Array.from(section.text).slice(0,e.start).join('').length, Array.from(section.text).slice(0,e.end).join('').length);
      node.scrollIntoView({ block: 'nearest' });
    }
  };
  return <section className="lesion-panel" aria-label="病灶标注工作台">
    <h2>病灶标注</h2>
    {!context ? <><p>单 CT · 报告、病灶与保存状态</p><button disabled={busy || !source || source.descriptor.modality !== 'CT'} onClick={() => initialise(source)}>打开病灶工作台</button><small>从病例清单进入时，所有病例组成同一进度任务。</small></> : <>
      <div className="lesion-status"><strong>{completed ? '已完成' : '待完成'}</strong><span>{context.entities.length} 个病灶</span></div>
      {progress && <p role="status">任务完成 {progress.completedCases}/{progress.totalCases} · {Math.round(progress.completionPercent || 0)}%</p>}
      <button disabled={busy || completed || source?.annotationStatus?.busy} onClick={() => run(async target => {
        if ([...target.masks.values()].some(m => !m.anatomyReadOnly && isMaskDirty(servicesManager, m))) throw Error('请先保存当前编辑。');
        await mutate(target, { operation: 'complete' });
      })}>标记完成</button>
      <details open={!context.reports.length}><summary>添加报告原文</summary>
        <textarea aria-label="报告原文" value={reportText} onChange={e => setReportText(e.target.value)} placeholder="粘贴完整报告章节原文" />
        <button disabled={busy || !reportText.trim()} onClick={() => run(async target => { await mutate(target, { operation: 'report', name: '报告', sections: [{ name: 'Findings', text: reportText }] }); setReportText(''); })}>保存报告</button>
      </details>
      {context.reports.map(report => <div key={report.id}><h3>{report.name}</h3>{report.sections.map(section => <div key={section.id}>
        <small>{section.name}</small><textarea id={`report-section-${section.id}`} aria-label={`报告章节 ${section.name}`} readOnly value={section.text}
          onSelect={event => selectEvidence(event, report, section)} />
      </div>)}</div>)}
      <div className="lesion-create"><h3>创建 Finding</h3><small>{selection ? `原文证据：${selection}` : '可以选取报告原文，或补充影像发现。'}</small>
        <textarea aria-label="Finding 描述" value={findingText} onChange={e => setFindingText(e.target.value)} />
        <select aria-label="ReX 类别" value={category} onChange={e => setCategory(e.target.value)}><option value="">暂未分类</option>{Object.entries(categories).map(([code, name]) => <option key={code} value={code}>{code} · {String(name)}</option>)}</select>
        {evidence && <button onClick={() => { setEvidence(null); setSelection(''); }}>清除原文选区</button>}
        <button disabled={busy || !findingText.trim()} onClick={() => run(async target => { const state = await mutate(target, { operation: 'finding', text: findingText, category: category || null, evidence }); if (state) { setActiveFinding(state.findings[state.findings.length - 1].id); setFindingText(''); setEvidence(null); setSelection(''); } })}>创建 Finding</button>
      </div>
      {context.findings.map((finding, index) => <article className="lesion-finding" key={finding.id}>
        <button aria-pressed={activeFinding === finding.id} onClick={() => locateEvidence(finding)}>F{index + 1} · {finding.text}</button>
        <select aria-label={`Finding ${index + 1} 类别`} value={finding.category || ''} disabled={busy} onChange={event => { const value = event.target.value; run(target => mutate(target, { operation: 'updateFinding', findingId: finding.id, category: value || null })); }}>
          <option value="">未分类</option>{Object.entries(categories).map(([code,name]) => <option key={code} value={code}>{code} · {String(name)}</option>)}
        </select>
        {context.links.filter(l => l.findingId === finding.id).map(l => { const entity = context.entities.find(e => e.id === l.entityId); return <div key={l.id}>
          <button disabled={busy || source?.annotationStatus?.busy} onClick={() => run(target => editEntity(target, entity))}>{entity.name} · {entity.maskId ? '已保存' : '待绘制'}</button>
          <button disabled={busy} aria-label={`解除 ${entity.name} 与 Finding 的关联`} onClick={() => run(target => mutate(target, { operation: 'unlink', linkId: l.id }))}>解除关联</button>
        </div>; })}
        <button disabled={busy} onClick={() => addEntity(finding.id)}>新增病灶并绘制</button>
        {activeFinding === finding.id && <div><select aria-label="关联已有病灶" value={linkEntity} onChange={e => setLinkEntity(e.target.value)}><option value="">选择共享病灶</option>{context.entities.map(entity => <option key={entity.id} value={entity.id}>{entity.name}</option>)}</select><button disabled={busy || !linkEntity} onClick={() => run(target => mutate(target, { operation: 'link', findingId: finding.id, entityId: linkEntity }))}>关联</button></div>}
      </article>)}
      <h3>全部病灶</h3><button disabled={busy} onClick={() => addEntity(null)}>新增未关联病灶</button>
      {context.entities.map(entity => <div key={entity.id} className="lesion-entity"><button disabled={busy} onClick={() => run(target => editEntity(target, entity))}>{entity.name}</button><small>{entity.annotationDisposition === 'not_required' ? '不需空间标注' : entity.maskId ? '已保存（非空状态以完成校验为准）' : '待标注'}</small>
        <button disabled={busy} onClick={() => run(async target => { const name = window.prompt('病灶名称', entity.name); if (name?.trim()) await mutate(target, { operation: 'entityMetadata', entityId: entity.id, name }); })}>改名</button>
        <button disabled={busy} onClick={() => run(async target => { const reason = window.prompt('不需要空间标注的原因'); if (reason?.trim()) await mutate(target, { operation: 'entityMetadata', entityId: entity.id, annotationDisposition: 'not_required', dispositionReason: reason }); })}>不需标注</button>
        {entity.annotationDisposition === 'not_required' && <button disabled={busy} onClick={() => run(target => mutate(target, { operation: 'entityMetadata', entityId: entity.id, annotationDisposition: 'needs_annotation' }))}>恢复待标注</button>}
      </div>)}
      <button disabled={busy} onClick={() => run(target => refresh(target))}>刷新状态</button>
      <p>选中病灶后在“标注与 AI”编辑，使用 Save All 保存。保存新版本后需重新标记完成。</p>
    </>}
    {busy && <p role="status">处理中…</p>}{error && <p role="alert" className="lesion-error">{error}</p>}
  </section>;
}
