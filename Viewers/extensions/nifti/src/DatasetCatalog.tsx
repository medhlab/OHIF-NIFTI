import React, { useEffect, useState } from 'react';
import { annotationRequest } from './annotationClient';

const labels = { train: '训练集', val: '验证集', test: '测试集', unspecified: '未指定' };

export default function DatasetCatalog({ onOpen, busy }) {
  const [datasets, setDatasets] = useState([]);
  const [id, setId] = useState('');
  const [split, setSplit] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [refresh, setRefresh] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    annotationRequest('/datasets', undefined, controller.signal).then(r => {
      setDatasets(r.items);
      setId(old => r.items.some(d => d.id === old) ? old : r.items[0]?.id || '');
    }).catch(e => { if (e.name !== 'AbortError') setError(e.message); });
    return () => controller.abort();
  }, [refresh]);
  useEffect(() => {
    setData(null);
    if (!id) return;
    const controller = new AbortController();
    setLoading(true); setError('');
    const query = new URLSearchParams({ split, search, offset: String(page * 25), limit: '25' });
    annotationRequest(`/datasets/${encodeURIComponent(id)}/cases?${query}`, undefined, controller.signal)
      .then(setData).catch(e => { if (e.name !== 'AbortError') setError(e.message); })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [id, split, search, page, refresh]);
  return <section aria-label="数据集病例">
    <div className="catalog-controls" style={{ gap: 12, flexWrap: 'wrap' }}>
      <label>数据集 <select aria-label="数据集" className="catalog-field" value={id} onChange={e => {
        setId(e.target.value); setSplit(''); setPage(0);
      }}><option value="" disabled>选择数据集</option>{datasets.map(d => <option key={d.id} value={d.id}>{d.name}</option>)}</select></label>
      <label>划分 <select aria-label="数据集划分" className="catalog-field" value={split} onChange={e => {
        setSplit(e.target.value); setPage(0);
      }}><option value="">全部</option>{Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
      <input aria-label="搜索数据集病例" className="catalog-field" placeholder="搜索病例名称" value={search} onChange={e => { setSearch(e.target.value); setPage(0); }} />
      <button className="catalog-button" disabled={busy || loading} onClick={() => setRefresh(n => n + 1)}>刷新</button>
    </div>
    {error && <p role="alert" className="catalog-error">{error}</p>}
    {loading && <p role="status">读取数据集病例…</p>}
    {data && <>
      <div className="catalog-context"><span>{data.dataset.name}</span>
        <span>{split ? labels[split] : '全部划分'} · {data.totalCases} 例 · 已完成 {data.completedCases} 例 · {data.completionPercent}%</span></div>
      <div className="catalog-table-scroll"><table className="catalog-table"><thead><tr><th>病例</th><th>划分</th><th>报告与标注</th><th>状态</th><th>打开</th></tr></thead>
        <tbody>{data.items.map(row => <tr key={row.caseId}>
          <td>{row.name}</td><td>{labels[row.split]}</td>
          <td>{row.reports} 报告来源 · {row.findings} Findings · {row.entities} Entities · {row.masks} masks</td>
          <td>{row.completed ? '已完成' : '待完成'}</td>
          <td><button className="catalog-button" disabled={busy || !row.manifestId} onClick={() => onOpen(row, { datasetId: id, split, search })} aria-label={`打开 ${row.name}`}>打开</button></td>
        </tr>)}</tbody></table></div>
      {!data.items.length && <p className="catalog-empty">当前筛选下没有已导入病例。</p>}
      <footer className="catalog-footer"><span>每页 25 例</span><div className="catalog-paging">
        <button className="catalog-button" disabled={busy || page === 0} onClick={() => setPage(p => p - 1)}>上一页</button>
        <span>{page + 1} / {Math.max(1, Math.ceil(data.totalCases / 25))}</span>
        <button className="catalog-button" disabled={busy || (page + 1) * 25 >= data.totalCases} onClick={() => setPage(p => p + 1)}>下一页</button>
      </div></footer>
    </>}
    {!loading && !datasets.length && !error && <p className="catalog-empty">尚未导入数据集。</p>}
  </section>;
}
