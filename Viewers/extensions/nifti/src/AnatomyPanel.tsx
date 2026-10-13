import React, { useState } from 'react';
import { useSystem } from '@ohif/core';
import { currentSource, loadSaved } from './masks';
import { annotationRoot, annotationRequest, installAnnotationContext } from './annotationClient';

export default function AnatomyPanel({ source }) {
  const { servicesManager } = useSystem();
  const [file, setFile] = useState<File>(null), [mapping, setMapping] = useState(''), [error, setError] = useState(''), [busy, setBusy] = useState(false);
  const layers = source?.annotationCase?.anatomyLayers || [];
  const run = async action => {
    if (busy || source.annotationStatus?.busy) return;
    setBusy(true); setError('');
    try { await action(); } catch (e) { setError(e.message); } finally { setBusy(false); }
  };
  return <details className="lesion-panel"><summary>解剖结构 · 只读辅助图层</summary>
    <p>导入已有 TotalSegmentator 结果，不运行模型。多标签文件需提供对应模型的标签映射，不能凭标签序号猜结构。</p>
    <input type="file" accept=".nii,.nii.gz" aria-label="结构分割文件" onChange={e => setFile(e.target.files?.[0] || null)} />
    <textarea aria-label="结构标签映射" value={mapping} onChange={e => setMapping(e.target.value)} placeholder={'例如 {"1":"spleen","2":"kidney_right"}，以实际模型标签表为准'} />
    <button disabled={busy || !file || !mapping.trim()} onClick={() => run(async () => {
      const labelMap = JSON.parse(mapping); const form = new FormData(); form.append('file', file); form.append('labelMap', JSON.stringify(labelMap));
      const response = await fetch(annotationRoot() + `/cases/${source.annotationCase.caseId}/anatomy-layers`, { method: 'POST', credentials: 'same-origin', body: form });
      const body = await response.json(); if (!response.ok) throw Error(body.detail?.message || '结构导入失败。');
      const current = currentSource(servicesManager).source; if (current !== source) return;
      installAnnotationContext(source, await annotationRequest(`/cases/${source.annotationCase.caseId}/context`));
      await loadSaved(servicesManager, undefined, body.items.map(i => i.maskId));
      setFile(null);
    })}>导入并显示</button>
    {layers.map(layer => <div key={layer.id}>{layer.name}<button disabled={busy} onClick={() => run(() => loadSaved(servicesManager, undefined, layer.maskIds))}>加载结构</button></div>)}
    {busy && <p role="status">加载结构中…</p>}{error && <p role="alert">{error}</p>}
  </details>;
}
