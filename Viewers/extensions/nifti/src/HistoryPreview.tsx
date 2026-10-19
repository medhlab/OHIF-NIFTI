import React, { useEffect, useRef, useState } from 'react';
import { Crosshair, Scan, X } from 'lucide-react';
import { ensureSlice } from './streaming';
import { previewSlices, previewPixel, previewBounds } from './historyPreviewModel.mjs';

/** Isolated raster preview: never registers an editable labelmap or changes the viewport. */
export default function HistoryPreview({ preview, onEnd, servicesManager }) {
  const { source, item, pixels, previous } = preview;
  const [nx, ny, nz] = source.descriptor.dimensions;
  const [slice, setSlice] = useState(0), [analysis, setAnalysis] = useState<any>();
  const [zoom, setZoom] = useState(true);
  const [maskOnly, setMaskOnly] = useState(false), [opacity, setOpacity] = useState(.7);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [readySlice, setReadySlice] = useState(-1), [error, setError] = useState(''), [retry, setRetry] = useState(0);
  useEffect(() => {
    const controller = new AbortController(); setAnalysis(undefined); setError('');
    previewSlices(pixels, [nx,ny,nz], previous?.pixels, controller.signal).then(result => {
      if (controller.signal.aborted) return;
      setAnalysis(result); setSlice(previous ? result.changeSlice : result.maskSlice);
    }).catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [preview]);
  useEffect(() => {
    if (!analysis) return;
    const controller = new AbortController(); setReadySlice(-1); setError('');
    ensureSlice(source, slice, controller.signal).then(() => { if (!controller.signal.aborted) setReadySlice(slice); })
      .catch(e => { if (!controller.signal.aborted) setError(e.message); });
    return () => controller.abort();
  }, [source, slice, analysis, retry]);
  useEffect(() => {
    if (!analysis || !source.scalarData || !canvas.current || readySlice !== slice) return;
    let low = source.descriptor.min, high = source.descriptor.max;
    const { viewportGridService, cornerstoneViewportService } = servicesManager.services;
    const viewport = cornerstoneViewportService.getCornerstoneViewport(viewportGridService.getState().activeViewportId);
    const range = viewport?.getProperties?.()?.voiRange;
    if (Number.isFinite(range?.lower) && Number.isFinite(range?.upper) && range.upper > range.lower) { low = range.lower; high = range.upper; }
    if (!Number.isFinite(low) || !Number.isFinite(high) || high <= low) { low = 0; high = 255; }
    const context = canvas.current.getContext('2d');
    const image = context.createImageData(nx, ny), start = slice * nx * ny;
    const color = item.displayColor || [187, 151, 248, 255];
    for (let i = 0; i < nx * ny; i++) {
      const grey = Math.max(0, Math.min(255, (source.scalarData[start+i] - low) / (high-low) * 255));
      const rgb = previewPixel(grey, !!pixels[start+i], !!previous?.pixels[start+i], !!previous, color, opacity, maskOnly);
      for (let c = 0; c < 3; c++) image.data[4*i+c] = rgb[c];
      image.data[4*i+3] = 255;
    }
    context.putImageData(image, 0, 0);
    if (zoom) {
      const crop = previewBounds(pixels, previous?.pixels, nx, ny, slice);
      context.imageSmoothingEnabled = false;
      context.drawImage(canvas.current, crop.x, crop.y, crop.width, crop.height, 0, 0, nx, ny);
      canvas.current.style.aspectRatio = String(crop.width / crop.height * ratio * ny / nx);
    } else canvas.current.style.aspectRatio = String(ratio);
  }, [preview, slice, readySlice, analysis, opacity, maskOnly, zoom]);
  const affine = source.descriptor.voxelToLPS;
  const ratio = nx * Math.hypot(...affine.slice(0, 3).map(r => r[0])) / (ny * Math.hypot(...affine.slice(0, 3).map(r => r[1])));
  return <section className="nh-preview" aria-label="只读历史影像预览">
    <header><span><EyeLabel />v{item.version}{previous ? ` / v${previous.item.version} 对比` : ' · 只读预览'}</span><button className="nh-icon" aria-label="结束预览" onClick={onEnd}><X size={17}/></button></header>
    {error ? <p role="alert">{error}<button className="nh-button" onClick={() => setRetry(n => n+1)}>重试</button></p> : (!analysis || readySlice !== slice) && <p role="status">{analysis ? '当前层加载中…' : '定位标注范围…'}</p>}
    <div className="nh-canvas"><canvas ref={canvas} width={nx} height={ny} aria-label={`${item.name} v${item.version} 原始切片 ${slice+1}`}
      data-ready={!!analysis && readySlice === slice} data-mask-voxels={analysis?.counts[slice]} data-added={analysis?.added[slice]} data-removed={analysis?.removed[slice]}
      style={{ opacity: analysis && readySlice === slice ? 1 : 0, aspectRatio: String(ratio) }}/></div>
    {analysis && <>
      <div className="nh-stats"><span>本层 {analysis.counts[slice].toLocaleString()} 体素</span><span>全体 {analysis.total.toLocaleString()}</span></div>
      {previous && <div className="nh-stats"><span className="nh-added">新增 +{analysis.addedTotal.toLocaleString()}</span><span className="nh-removed">移除 −{analysis.removedTotal.toLocaleString()}</span></div>}
      {!analysis.total && <p className="nh-muted">此版本是空 mask{previous && analysis.removedTotal ? '；粉色显示被移除的区域。' : '，没有可显示的标注体素。'}</p>}
      {previous && !analysis.addedTotal && !analysis.removedTotal && <p className="nh-muted">与上一版的体素完全相同。</p>}
      <label className="nh-slider">原始切片 <b>{slice+1} / {nz}</b><input aria-label="历史预览切片" type="range" min={0} max={nz-1} value={slice} onChange={e => setSlice(Number(e.target.value))}/></label>
      <div className="nh-actions"><button className="nh-button" disabled={!analysis.total} onClick={() => setSlice(analysis.maskSlice)}><Crosshair size={15}/>定位 mask</button>{previous && <button className="nh-button" disabled={!analysis.addedTotal && !analysis.removedTotal} onClick={() => setSlice(analysis.changeSlice)}><Scan size={15}/>定位改动</button>}
        <button className="nh-button" aria-pressed={zoom} onClick={() => setZoom(v => !v)}>局部放大</button><button className="nh-button" aria-pressed={maskOnly} onClick={() => setMaskOnly(v => !v)}>仅看 mask</button></div>
      {!maskOnly && <label className="nh-slider">预览透明度 <b>{Math.round(opacity*100)}%</b><input aria-label="预览透明度" type="range" min={0} max={1} step={.05} value={opacity} onChange={e => setOpacity(Number(e.target.value))}/></label>}
    </>}
    <p className="nh-muted nh-note">原始 IJK 切片 · 当前编辑不变。{previous ? '绿色为新增，粉色为移除，目标色为保留。' : '自动定位到标注最多的层。'}</p>
  </section>;
}
const EyeLabel = () => <span className="nh-readonly-dot"/>;
