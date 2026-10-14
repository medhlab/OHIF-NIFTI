import React, { useEffect, useState } from 'react';
import { utilities } from '@cornerstonejs/core';
import { useSystem } from '@ohif/core';
import { currentSource } from './masks';

export default function ImageInfoPanel() {
  const { servicesManager } = useSystem();
  const [, refresh] = useState(0);
  useEffect(() => {
    const timer = setInterval(() => refresh(n => n + 1), 500);
    return () => clearInterval(timer);
  }, []);
  let source, viewport;
  try {
    const current = currentSource(servicesManager);
    source = current.source;
    viewport = servicesManager.services.cornerstoneViewportService.getCornerstoneViewport(
      current.viewportId
    );
  } catch {
    /* The viewport is initialized asynchronously. */
  }
  const d = source?.descriptor;
  if (!d)
    return (
      <section
        className="nt-image-info"
        aria-label="图像元信息"
      >
        <p>等待图像加载…</p>
      </section>
    );
  const spacing =
    d.voxelToLPS && [0, 1, 2].map(c => Math.hypot(...[0, 1, 2].map(r => d.voxelToLPS[r][c])));
  const range = viewport?.getProperties?.().voiRange;
  const windowLevel = range && utilities.windowLevel.toWindowLevel(range.lower, range.upper);
  const number = value => (Number.isFinite(value) ? Number(value.toFixed(3)).toString() : '未提供');
  const slice = viewport?.getCurrentImageIdIndex?.();
  const rows = [
    ['文件名', d.name],
    ['模态', d.modality],
    ['格式', d.format],
    ['体素尺寸（I × J × K）', d.dimensions.join(' × ')],
    ['体素间距（mm）', spacing?.map(number).join(' × ') || '未提供'],
    ['物理尺寸（mm）', spacing?.map((v, i) => number(v * d.dimensions[i])).join(' × ') || '未提供'],
    ['当前层', Number.isInteger(slice) ? `${slice + 1} / ${d.dimensions[2]}` : '体视图 / MPR'],
    [
      '窗宽 / 窗位',
      range ? `${number(windowLevel.windowWidth)} / ${number(windowLevel.windowCenter)}` : '未提供',
    ],
    ['像素范围', `${number(d.min)} ～ ${number(d.max)}${d.modality === 'CT' ? ' HU' : ''}`],
    ['原始 / 工作数据类型', `${d.rawDtype} / ${d.workingDtype}`],
    ['像素缩放 slope / intercept', `${number(d.slope)} / ${number(d.intercept)}`],
    ['原始空间单位', d.unit],
    ['采用的仿射', d.selectedAffine],
    ['原图大小', `${number(d.sourceBytes / 1024 ** 2)} MiB`],
    ['体数据工作内存', `${number(d.workingBytes / 1024 ** 2)} MiB`],
    [
      '加载状态',
      source.stream
        ? `${source.stream.loaded.reduce((a, b) => a + b, 0)} / ${source.stream.loaded.length} 层`
        : '完整加载',
    ],
    ['原图 ID', d.sourceId || '本地未保存'],
    ['内容标识', d.contentHash],
  ];
  return (
    <section
      className="nt-image-info"
      aria-label="图像元信息"
    >
      <h2>图像信息</h2>
      <dl>
        {rows.map(([name, value]) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{value || '未提供'}</dd>
          </div>
        ))}
      </dl>
      <details>
        <summary>体素到 LPS 的仿射矩阵（mm）</summary>
        <pre>{d.voxelToLPS?.map(row => row.map(number).join('  ')).join('\n')}</pre>
      </details>
      {[...(d.warnings || []), ...(source.importWarnings || [])].map(w => (
        <p
          key={w}
          role="alert"
        >
          {w}
        </p>
      ))}
    </section>
  );
}
