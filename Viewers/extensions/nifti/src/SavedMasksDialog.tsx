import React, { useEffect, useRef, useState } from 'react';
import { Dialog, DialogContent, DialogTitle, DialogDescription, DialogPortal, DialogOverlay } from '@ohif/ui-next';
import { History, Eye, Copy, RotateCcw, Download, Layers } from 'lucide-react';
import { request } from './api';
import { isMaskDirty, loadSaved } from './masks';
import { initialMaskColor } from './maskColors.mjs';
import { loadedAnnotation, readSavedVersion, loadLatestAnnotation, restoreAnnotation } from './history';
import HistoryPreview from './HistoryPreview';
import { targetName } from './groups';
import './history-panel.css';
import { entityLabels } from './entityLabels.mjs';

const button = 'nh-button';
const label = item => item.operation === 'restore' ? `从 v${item.restoredFrom} 恢复` : item.version === 1 ? (item.derivedFrom ? '创建独立副本' : '首次保存') : '修订保存';

export default function SavedMasksDialog({ open, onOpenChange, source, servicesManager, onNotice, initialMaskId = '' }) {
  const [catalog, setCatalog] = useState<any[]>([]), [selectedId, setSelectedId] = useState('');
  const [history, setHistory] = useState<any>(), [chosen, setChosen] = useState<any>();
  const [busy, setBusy] = useState(false), [restoring, setRestoring] = useState(false);
  const [message, setMessage] = useState(''), [error, setError] = useState(''), [search, setSearch] = useState('');
  const [preview, setPreview] = useState<any>(), [confirm, setConfirm] = useState(false);
  const task = useRef<AbortController>(), previewRef = useRef<any>(), retry = useRef<any>();
  const selectedRef = useRef(''), sourceRef = useRef('');
  const picker = useRef<HTMLDivElement>(null);
  useEffect(() => { picker.current?.querySelector('[aria-pressed="true"]')?.scrollIntoView({block:'nearest',inline:'nearest'}); }, [selectedId, catalog]);
  const endPreview = () => { previewRef.current?.dispose(); previewRef.current = undefined; setPreview(undefined); };
  const run = async (action, isRestore = false) => {
    task.current?.abort();
    const controller = new AbortController(); task.current = controller;
    setBusy(true); setRestoring(isRestore); setMessage(''); setError('');
    const timeout = setTimeout(() => controller.abort(new DOMException('操作超时。当前编辑已保留，请重试或刷新记录。', 'TimeoutError')), 10 * 60 * 1000);
    try { await action(controller.signal); }
    catch (e) {
      if (task.current !== controller) return;
      const reason = controller.signal.reason?.name === 'TimeoutError' ? controller.signal.reason.message : e.message;
      if (e.name === 'AbortError' && controller.signal.reason?.name !== 'TimeoutError') setMessage('已取消，当前编辑保持不变。');
      else { setError(reason); onNotice?.(reason); }
    } finally {
      clearTimeout(timeout);
      if (task.current === controller) { task.current = undefined; setBusy(false); setRestoring(false); }
    }
  };
  const fetchVersions = async (id, signal, append = false, requestedVersion?) => {
    setMessage('读取这份标注的版本轨迹…');
    const page = await (await request(`/${source.descriptor.sourceId}/masks/history?maskId=${id}&offset=${append ? history.items.length : 0}`, { signal })).json();
    signal.throwIfAborted();
    // A copy may link to a version older than the first page. Locate it in its own history.
    while (requestedVersion && !page.items.some(item => item.version === requestedVersion) && page.items.length < page.total) {
      const more = await (await request(`/${source.descriptor.sourceId}/masks/history?maskId=${id}&offset=${page.items.length}`, { signal })).json();
      signal.throwIfAborted(); if (!more.items.length) break; page.items.push(...more.items);
    }
    setHistory(append ? { ...page, items: [...history.items, ...page.items] } : page);
    if (!append) setChosen(page.items.find(item => item.version === requestedVersion) || page.items[0]);
    setMessage('');
  };
  const refreshCatalog = async (signal, preferred = selectedRef.current, requestedVersion?) => {
    const response = await (await request(`/${source.descriptor.sourceId}/masks`, { signal })).json();
    signal.throwIfAborted(); setCatalog(response.items);
    const id = response.items.some(item => item.maskId === preferred) ? preferred : [...response.items].sort((a,b) => Date.parse(b.created)-Date.parse(a.created))[0]?.maskId || '';
    selectedRef.current = id; setSelectedId(id);
    if (id) await fetchVersions(id, signal, false, requestedVersion);
    else { setHistory(undefined); setChosen(undefined); setMessage(''); }
  };
  useEffect(() => {
    if (!open || !source?.descriptor.sourceId) return;
    if (sourceRef.current !== source.sourceKey) { selectedRef.current = ''; retry.current = undefined; }
    sourceRef.current = source.sourceKey;
    if (initialMaskId) selectedRef.current = initialMaskId;
    setSearch(''); setConfirm(false); setCatalog([]); setHistory(undefined); setChosen(undefined);
    run(signal => refreshCatalog(signal));
    return () => { task.current?.abort(); previewRef.current?.dispose(); previewRef.current = undefined; setPreview(undefined); };
  }, [open, source?.sourceKey]);
  const select = (id, version?) => {
    endPreview(); setConfirm(false); selectedRef.current = id; setSelectedId(id); setHistory(undefined); setChosen(undefined);
    run(signal => fetchVersions(id, signal, false, version));
  };
  const annotation = catalog.find(item => item.maskId === selectedId);
  const loaded = source && loadedAnnotation(source, selectedId);
  const dirty = loaded && isMaskDirty(servicesManager, loaded);
  const color = item => item.displayColor || initialMaskColor(`${source?.descriptor.contentHash}:${item.maskId}`, []);
  const loadLatest = () => run(async signal => {
    endPreview(); await loadLatestAnnotation(servicesManager, source, annotation, signal, setMessage);
    setMessage(`已加载 ${annotation.name} 的最新版本 v${annotation.version}。`);
  });
  const restore = () => {
    setConfirm(false); endPreview();
    const key = `${source.sourceKey}:${chosen.maskId}:${chosen.version}:${annotation.version}`;
    if (retry.current?.key !== key) retry.current = { key, requestId: crypto.randomUUID() };
    run(async signal => {
      const record = await restoreAnnotation(servicesManager, source, chosen, annotation.version, retry.current.requestId, signal, setMessage);
      retry.current = undefined;
      await refreshCatalog(signal, record.maskId);
      setMessage(`已恢复为 v${record.version}，来自 v${record.restoredFrom}。旧版本全部保留。`);
    }, true);
  };
  const entityFor = item => source?.annotationCase?.entities.find(e => e.maskId === item.maskId);
  const nameFor = item => targetName({ ...item, name: entityFor(item)?.name || item.name });
  const codeFor = item => entityFor(item) ? entityLabels(source.annotationCase, entityFor(item).id) : findingFor(item);
  const findingFor = item => {
    const entity = entityFor(item), context = source?.annotationCase;
    return context?.findings.filter(f => context.links.some(l => l.entityId === entity?.id && l.findingId === f.id))
      .map(f => `F${context.findings.indexOf(f)+1}`).join(' · ') || item.segmentationSet?.name || '独立标注';
  };
  const pickerItems = catalog.filter(item => `${item.name} ${nameFor(item)} ${findingFor(item)}`.toLowerCase().includes(search.toLowerCase()));
  const parent = annotation?.derivedFrom && catalog.find(item => item.maskId === annotation.derivedFrom.maskId);
  const previousVersion = chosen && (chosen.parentVersion || Math.max(0, ...(history?.items || []).filter(i => i.version < chosen.version).map(i => i.version)));
  const showPreview = (compare = false) => run(async signal => {
    endPreview();
    let next, previous;
    try {
      next = await readSavedVersion(servicesManager, source, chosen, signal, setMessage, true);
      if (compare && previousVersion) {
        const prior = history?.items.find(i => i.version === previousVersion);
        previous = await readSavedVersion(servicesManager, source, prior || { ...chosen, version: previousVersion }, signal, setMessage, true);
      }
      signal.throwIfAborted();
      const current = next, older = previous;
      const combined = { ...current, previous: older, dispose: () => { current.dispose(); older?.dispose(); } };
      previewRef.current = combined; setPreview(combined); setMessage('');
    } catch (e) { next?.dispose(); previous?.dispose(); throw e; }
  });
  return <Dialog open={open} showOverlay={false} onOpenChange={value => { if (restoring) return; if (!value) { task.current?.abort(); endPreview(); } onOpenChange(value); }}>
    <DialogPortal><DialogOverlay className="nh-backdrop" style={{ zIndex: 130 }}/></DialogPortal>
    <DialogContent className="nh-dialog" style={{ zIndex: 140 }}>
      <div className="nh-heading"><History size={22}/><div><DialogTitle>标注历史</DialogTitle><DialogDescription>当前病例 · {source?.descriptor.name}</DialogDescription></div></div>
      <div className="nh-catalog">
        <div className="nh-row"><span className="nh-muted">选择目标 · {catalog.length} 份</span><input aria-label="搜索标注名称" placeholder="搜索目标 / Finding" value={search} onChange={e => setSearch(e.target.value)}/><button className={button} disabled={busy} onClick={() => { endPreview(); run(signal => refreshCatalog(signal)); }}>刷新记录</button></div>
        <div ref={picker} className="nh-targets" role="group" aria-label="选择标注">{pickerItems.map(item => <button key={item.maskId} data-mask-id={item.maskId} aria-label={item.name} title={item.name + '\n' + item.maskId} disabled={busy} onClick={() => select(item.maskId)} aria-pressed={selectedId === item.maskId} className="nh-target">
          <span className="nh-dot" style={{ background: `rgb(${color(item).slice(0,3).join(',')})` }}/><span><strong>{codeFor(item)} · {nameFor(item)}</strong><small>v{item.version} · {item.maskId.slice(0,6)}</small></span></button>)}</div>
        {search && !pickerItems.length && <p className="nh-muted">没有匹配的目标。</p>}
      </div>
      {busy && <div role="status" className="nh-status">{message || '处理中…'}{!restoring && <button className={button} onClick={() => task.current?.abort()}>取消</button>}</div>}
      {!busy && message && <p role="status" className="nh-status">{message}</p>}
      {error && <p role="alert" className="nh-error">{error}</p>}
      {!catalog.length && !busy && !error && <p className="nh-empty">尚无已保存的标注。首次保存后会建立版本轨迹。</p>}
      {annotation && <div className="nh-body"><section className="nh-history">
        <div className="nh-row"><h3 title={annotation.name}>{codeFor(annotation)} · {nameFor(annotation)}</h3><span className="nh-muted">{history?.total ?? '…'} 个版本</span></div>
        <p className="nh-muted" title={annotation.maskId}>{findingFor(annotation)} · ID {annotation.maskId.slice(0,8)}</p>
        <div className="nh-current"><span>当前编辑 <b>{loaded ? `v${loaded.saved.version}` : '未加载'}</b>{dirty && <em>有未保存修改</em>}</span><span>最新保存 <b>v{annotation.version}</b></span></div>
        {annotation.derivedFrom && <p className="nh-muted">副本来源 <button disabled={busy || !parent} onClick={() => select(parent.maskId, annotation.derivedFrom.version)}>{parent?.name || annotation.derivedFrom.maskId} · v{annotation.derivedFrom.version}</button></p>}
        <ol className="nh-timeline" aria-label="当前标注的版本轨迹">{[...(history?.items || [])].sort((a,b) => b.version-a.version).map(item => <li key={item.version}>
          <button disabled={busy} aria-pressed={chosen?.version === item.version} aria-label={`选择版本 v${item.version}`} onClick={() => { endPreview(); setChosen(item); setConfirm(false); setMessage(''); setError(''); }}>
            <span className="nh-version">v{item.version}</span><span><strong>{label(item)}</strong><time dateTime={item.created}>{new Date(item.created).toLocaleString()}</time></span>{item.version === annotation.version && <small>最新</small>}
          </button></li>)}</ol>
        {history && history.items.length < history.total && <button className={button} disabled={busy} onClick={() => run(signal => fetchVersions(selectedId, signal, true))}>读取更早版本（{history.items.length} / {history.total}）</button>}
        {chosen && <div className="nh-operations"><div className="nh-row"><strong>已选 v{chosen.version}</strong><span className="nh-muted">独立、只读查看</span></div>
          <div className="nh-actions"><button className={button} disabled={busy} onClick={() => showPreview()}><Eye size={16}/>预览 mask</button><button className={button} disabled={busy || !previousVersion} onClick={() => showPreview(true)}><Layers size={16}/>与 v{previousVersion || '—'} 对比</button></div>
          <div className="nh-actions"><button className={button} disabled={busy || dirty || chosen.version === annotation.version} onClick={() => setConfirm(true)}><RotateCcw size={16}/>恢复为新版本</button>
          <button className={button} disabled={busy} onClick={() => run(async signal => { endPreview(); const results = await loadSaved(servicesManager, signal, undefined, { items: [chosen], asCopy: true, progress: setMessage }); const failure = results.find(r => r.status === 'failed'); if (failure) throw Error(failure.error); setMessage('已创建独立副本；保存后建立自己的版本轨迹。'); })}><Copy size={16}/>创建副本</button></div>
          {dirty && <p className="nh-warning">当前修改尚未保存，可以预览；恢复前请先保存或导出。</p>}
          {confirm && <div className="nh-confirm"><p>用 v{chosen.version} 创建新版本，保留全部历史、当前名称和颜色；其他目标不变。</p><div className="nh-actions"><button className={button} disabled={busy || dirty} onClick={restore}>确认恢复</button><button className={button} onClick={() => setConfirm(false)}>取消恢复</button></div></div>}
        </div>}
        <p className="nh-muted nh-note">轨迹记录已保存的体素版本。名称与颜色单独维护，不生成影像版本；未保存的笔刷操作不会出现在这里。</p>
      </section>{preview ? <HistoryPreview preview={preview} onEnd={endPreview} servicesManager={servicesManager}/> : <div className="nh-placeholder"><Eye size={30}/><strong>查看这个目标的过去</strong><span>选择版本后预览；对比可定位新增和移除的区域。</span></div>}</div>}
      {!!catalog.length && <footer className="nh-footer"><button className={button} disabled={busy || !annotation || dirty} onClick={loadLatest}><Download size={16}/>加载当前目标最新版本</button>
      <button className={button} disabled={busy} onClick={() => run(async signal => { endPreview(); const results = await loadSaved(servicesManager, signal, undefined, { progress: setMessage }); const failures = results.filter(r => r.status === 'failed'); setMessage(`加载完成：新增 ${results.filter(r => r.status === 'loaded').length} 个，已有 ${results.filter(r => r.status === 'alreadyLoaded').length} 个（保留当前编辑），失败 ${failures.length} 个。`); if (failures.length) throw Error(failures.map(r => `${r.item.name}：${r.error}`).join('；')); })}><Layers size={16}/>补充其他目标</button></footer>}
    </DialogContent>
  </Dialog>;
}
