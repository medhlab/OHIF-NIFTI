import { maskIndex, activeMask as selectedMask } from './packedMasks';
import React, { useEffect, useRef, useState } from 'react';
import { useSystem } from '@ohif/core';
import { createPortal } from 'react-dom';
import AnnotationTools from './AnnotationTools';
import AnnotationContext from './AnnotationContext';
import ToolbarIconButton from './ToolbarIconButton';
import AnatomyPanel from './AnatomyPanel';
import {
  Layers,
  Plus,
  Upload,
  FolderOpen,
  Download,
  History,
  Loader2,
  AlertTriangle,
} from 'lucide-react';
import {
  currentSource,
  createMask,
  importMasks,
  saveAll,
  loadSaved,
  exportLocal,
  isMaskDirty,
  copyGroup,
} from './masks';
import GroupedSegmentationPanel from './GroupedSegmentationPanel';
import { config, memorySnapshot } from './sourceStore';
import { ensureStored } from './api';
import { annotationRequest } from './annotationClient';
import { segmentation } from '@cornerstonejs/tools';
import './annotation-toolbar.css';
import { currentEditingMask, editingMask, enterMaskEditing, exitMaskEditing } from './editing';
import SavedMasksDialog from './SavedMasksDialog';
import { ensureSlice, requestComplete, pauseComplete } from './streaming';

export default function AnnotationToolbar() {
  const { servicesManager, commandsManager } = useSystem();
  const [message, setMessage] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyMaskId, setHistoryMaskId] = useState('');
  const [menu, setMenu] = useState('');
  const [categories, setCategories] = useState<Record<string, string>>({});
  const toolbarRoot = useRef<HTMLDivElement>(null);
  const [streamOpen, setStreamOpen] = useState(false);
  const [pendingLoad, setPendingLoad] = useState(0);
  const [, update] = useState(0),
    task = useRef<AbortController>(),
    input = useRef<HTMLInputElement>();
  let source, viewportId;
  try {
    ({ source, viewportId } = currentSource(servicesManager));
  } catch {
    /* Viewport not ready. */
  }
  useEffect(() => {
    annotationRequest('/categories')
      .then(body => setCategories(body.items))
      .catch(() => {});
    const open = () => setMenu('tools');
    const outside = event => {
      // Dialogs and tool-settings portals manage their own focus and dismissal.
      if (
        !toolbarRoot.current?.contains(event.target) &&
        !(event.target as HTMLElement)?.closest(
          '.nt-popover, [role="dialog"], [data-radix-popper-content-wrapper]'
        )
      )
        setMenu('');
    };
    const escape = event => {
      const trigger = toolbarRoot.current?.querySelector<HTMLButtonElement>(
        '.at-heading[aria-expanded="true"], .nt-icon[aria-expanded="true"]'
      );
      if (
        event.key !== 'Escape' ||
        !trigger ||
        document.querySelector('[role="dialog"]:not([data-state="closed"])')
      )
        return;
      // Handle menu dismissal before OHIF's global Escape tool shortcut.
      event.preventDefault();
      event.stopPropagation();
      setMenu('');
      trigger.focus();
    };
    window.addEventListener('nifti:annotation-tools-open', open);
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape, true);
    return () => {
      window.removeEventListener('nifti:annotation-tools-open', open);
      document.removeEventListener('pointerdown', outside);
      document.removeEventListener('keydown', escape, true);
    };
  }, []);
  const run = async action => {
    task.current?.abort();
    const controller = new AbortController();
    task.current = controller;
    setBusy(true);
    setError('');
    setMessage('');
    const timeout = setTimeout(
      () =>
        controller.abort(new DOMException('操作超时，当前编辑已保留。请重试。', 'TimeoutError')),
      10 * 60 * 1000
    );
    try {
      await action(controller.signal);
      if (task.current === controller) update(n => n + 1);
    } catch (e) {
      if (task.current !== controller) return;
      if (controller.signal.reason?.name === 'TimeoutError')
        setError(controller.signal.reason.message);
      else if (e.name !== 'AbortError') setError(e.message);
      else setMessage('已取消。已完成加载的目标及当前编辑均已保留。');
    } finally {
      clearTimeout(timeout);
      if (task.current === controller) {
        task.current = undefined;
        setBusy(false);
      }
    }
  };
  const load = async (signal, ids?, options = {}) => {
    setMessage('读取已保存 mask…');
    const results = await loadSaved(servicesManager, signal, ids, {
      ...options,
      progress: setMessage,
    });
    const loaded = results.filter(r => r.status === 'loaded').length;
    const existing = results.filter(r => r.status === 'alreadyLoaded').length;
    const failures = results.filter(r => r.status === 'failed');
    setMessage(
      results.length
        ? `加载完成：新增 ${loaded} 个，已有 ${existing} 个（保留当前编辑），失败 ${failures.length} 个。`
        : '当前原图没有已保存的 mask。'
    );
    if (failures.length) throw Error(failures.map(r => `${r.item.name}：${r.error}`).join('；'));
  };
  useEffect(() => {
    const id = setInterval(() => update(n => n + 1), 500);
    const unload = e => {
      let active;
      try {
        active = currentSource(servicesManager).source;
      } catch {
        return;
      }
      if ([...active.masks.values()].some(m => isMaskDirty(servicesManager, m))) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    const editingChanged = () => {
      setMessage('');
      setError('');
      update(n => n + 1);
    };
    window.addEventListener('nifti:editing-changed', editingChanged);
    window.addEventListener('beforeunload', unload);
    return () => {
      clearInterval(id);
      task.current?.abort();
      window.removeEventListener('nifti:editing-changed', editingChanged);
      window.removeEventListener('beforeunload', unload);
    };
  }, []);
  useEffect(() => {
    setHistoryOpen(false);
    setMenu('');
    setMessage('');
    setError('');
    if (source?.pendingMaskIds?.length) {
      const ids = source.pendingMaskIds;
      source.pendingMaskIds = [];
      run(signal => load(signal, ids));
    }
    return () => {
      task.current?.abort();
    };
  }, [source?.sourceKey]);
  useEffect(() => {
    if (source) source.annotationStatus = { busy, message, error };
  }, [source, busy, message, error]);
  useEffect(() => {
    const listener = e => {
      let active;
      try {
        active = currentSource(servicesManager).source;
      } catch {
        return;
      }
      if (active.sourceKey !== e.detail || !active.pendingMaskIds?.length) return;
      setPendingLoad(n => n + 1);
    };
    window.addEventListener('nifti:load-pending-masks', listener);
    return () => window.removeEventListener('nifti:load-pending-masks', listener);
  }, [source?.sourceKey]);
  useEffect(() => {
    if (!source?.pendingMaskIds?.length) return;
    const ids = source.pendingMaskIds;
    source.pendingMaskIds = [];
    run(signal => load(signal, ids));
  }, [source?.sourceKey, pendingLoad]);
  const save = signal =>
    saveAll(servicesManager, signal, stage => setMessage(stage)).then(results => {
      const failures = results.filter(r => !r.success);
      setMessage(`已保存 ${results.length - failures.length} / ${results.length} 个 mask。`);
      if (failures.length) throw Error(failures.map(r => r.error).join('；'));
    });
  const add = (group?) =>
    run(async signal => {
      const id = await createMask(
        servicesManager,
        `新目标 ${(source?.masks.size || 0) + 1}`,
        undefined,
        undefined,
        signal,
        group
      );
      enterMaskEditing(servicesManager, commandsManager, source.masks.get(id));
    });
  const prepareManual = async () => {
    if (task.current || busy) throw Error('请等待当前操作完成。');
    const mask = currentEditingMask(servicesManager);
    if (segmentation.segmentLocking.isSegmentIndexLocked(mask.segmentationId, maskIndex(mask)))
      throw Error('当前 mask 已锁定，请先解锁。');
  };
  const prepareAI = async () => {
    if (task.current || busy) throw Error('请等待当前操作完成。');
    const mask = currentEditingMask(servicesManager);
    const controller = new AbortController();
    task.current = controller;
    setBusy(true);
    setError('');
    try {
      await ensureStored(source, controller.signal, p =>
        setMessage(`上传原图 ${Math.round(p * 100)}%`)
      );
      if (currentEditingMask(servicesManager) !== mask)
        throw Error('编辑目标已切换，请重新选择工具。');
    } finally {
      if (task.current === controller) {
        task.current = undefined;
        setBusy(false);
      }
    }
  };
  const dirty = source
    ? [...source.masks.values()].filter(m => isMaskDirty(servicesManager, m)).length
    : 0;
  const viewport = servicesManager.services.cornerstoneViewportService.getCornerstoneViewport(
    servicesManager.services.viewportGridService.getState().activeViewportId
  );
  const slicePending =
    source?.stream &&
    viewport?.getCurrentImageId?.() !== viewport?.getCornerstoneImage?.()?.imageId;
  const activeId =
    servicesManager.services.segmentationService.getActiveSegmentation(viewportId)?.segmentationId;
  const activeToolName = servicesManager.services.toolGroupService
    .getToolGroupForViewport(viewportId)
    ?.getActivePrimaryMouseButtonTool();
  const toolLabel =
    {
      Pan: '浏览',
      Probe2: '点提示',
      RectangleROI2: '框选',
      PlanarFreehandROI2: '涂鸦',
      PlanarFreehandROI3: '套索',
    }[activeToolName] ||
    (/Brush/.test(activeToolName || '')
      ? '画笔'
      : /Eraser/.test(activeToolName || '')
        ? '橡皮擦'
        : activeToolName || '浏览');
  const editing = editingMask(source);
  const activeMask = editing || selectedMask(source, activeId);
  const toggle = name => setMenu(menu === name ? '' : name);
  return (
    <div
      ref={toolbarRoot}
      className="nt-toolbar"
      role="toolbar"
      aria-label="Entity 标注工具栏"
    >
      <AnnotationContext
        source={source}
        mask={activeMask}
        categories={categories}
        busy={busy}
        message={message}
        error={error}
        dirty={dirty}
        editing={!!editing}
        toolLabel={toolLabel}
        onSave={() => run(save)}
        canSave={config.enableNiftiLibrary && !!source?.masks.size}
        onExit={() => {
          exitMaskEditing(servicesManager);
          setMessage('已退出编辑，未保存修改保留。');
          update(n => n + 1);
        }}
        onCancel={() => task.current?.abort()}
      />
      {(config.enableNiftiAI || config.enableNiftiEditing) && (
        <AnnotationTools
          key={source?.sourceKey || 'pending'}
          sourceKey={source?.sourceKey}
          enableAI={config.enableNiftiAI}
          enableEditing={config.enableNiftiEditing}
          editing={!!editing}
          beforeAI={prepareAI}
          beforeManual={prepareManual}
          expanded={menu === 'tools'}
          onExpandedChange={value => setMenu(value ? 'tools' : '')}
        />
      )}
      <ToolbarIconButton
        label="Mask 与文件"
        icon={FolderOpen}
        expanded={menu === 'files'}
        controls="nt-files"
        onClick={() => toggle('files')}
      />
      <ToolbarIconButton
        label="图层与结构"
        icon={Layers}
        expanded={menu === 'layers'}
        controls="nt-layers"
        onClick={() => toggle('layers')}
      />
      {createPortal(
        <div
          id="nt-files"
          hidden={menu !== 'files'}
          className="nt-popover nt-file-menu"
          role="region"
          aria-label="Mask 与文件操作"
        >
          <h3>Mask 与文件</h3>
          <p>{source?.descriptor.name || '等待原图…'}</p>
          <div className="nt-file-actions">
            {source?.stream && (
              <ToolbarIconButton
                label="原图加载状态"
                icon={
                  source.stream.queue.active
                    ? Loader2
                    : source.stream.errors.size
                      ? AlertTriangle
                      : Download
                }
                disabled={false}
                onClick={() => setStreamOpen(v => !v)}
              />
            )}
            {config.enableNiftiEditing && (
              <>
                <ToolbarIconButton
                  label="新建二值 mask"
                  icon={Plus}
                  disabled={busy || !source}
                  onClick={() => add()}
                />
                <ToolbarIconButton
                  label="导入 mask"
                  icon={FolderOpen}
                  disabled={busy || !source}
                  onClick={() => input.current.click()}
                />
              </>
            )}
            {config.enableNiftiLibrary && (
              <>
                <ToolbarIconButton
                  label="上传原图"
                  icon={Upload}
                  disabled={busy || !source || !!source.descriptor.sourceId}
                  onClick={() => run(signal => ensureStored(source, signal))}
                />
                <ToolbarIconButton
                  label="标注历史"
                  icon={History}
                  disabled={busy || !source?.descriptor.sourceId}
                  onClick={() => {
                    setError('');
                    setHistoryMaskId('');
                    setHistoryOpen(true);
                  }}
                />
              </>
            )}
            {config.enableNiftiEditing && (
              <ToolbarIconButton
                label="导出 NIfTI ZIP（本地）"
                icon={Download}
                disabled={busy || !source?.masks.size}
                onClick={() => run(signal => exportLocal(servicesManager, signal))}
              />
            )}
          </div>
          <p>
            {source?.descriptor.sourceId ? '原图已保存' : '保存或启动 AI 时上传原图。'} ·{' '}
            {Math.round(memorySnapshot().bytes / 1024 ** 2)} MiB
          </p>
          {streamOpen && source?.stream && (
            <div aria-label="原图渐进加载状态">
              <p role="status">
                {source.stream.loaded.every(Boolean)
                  ? '完整体数据已加载 · '
                  : source.stream.completing
                    ? '正在准备完整体数据 · '
                    : slicePending
                      ? '当前层加载中 · '
                      : source.stream.backgroundCompletion
                        ? '后台向上下加载 · '
                        : source.stream.backgroundPaused
                          ? '后台加载已暂停 · '
                          : '按需加载 · '}
                已加载 {source.stream.loaded.reduce((a, b) => a + b, 0)}/
                {source.stream.loaded.length} 层（
                {Math.round(
                  (source.stream.loaded.reduce((a, b) => a + b, 0) / source.stream.loaded.length) *
                    100
                )}
                %）
              </p>
              {source.stream.completeController || source.stream.backgroundController ? (
                <button onClick={() => pauseComplete(source)}>暂停后台加载</button>
              ) : (
                <button
                  disabled={source.stream.loaded.every(Boolean)}
                  onClick={() =>
                    requestComplete(source).catch(e => {
                      if (e.name !== 'AbortError') setError(e.message);
                    })
                  }
                >
                  加载完整体数据
                </button>
              )}
              <button
                onClick={() => {
                  const index = viewport?.getCurrentImageIdIndex?.();
                  if (Number.isInteger(index))
                    ensureSlice(source, index)
                      .then(async () => {
                        const presentation = viewport.getViewPresentation?.(),
                          properties = viewport.getProperties();
                        await viewport.setStack(viewport.getImageIds(), index);
                        if (presentation) viewport.setViewPresentation?.(presentation);
                        viewport.setProperties(properties);
                        viewport.render();
                      })
                      .catch(e => setError(e.message));
                }}
              >
                重试当前层
              </button>
              {[...source.stream.errors.values()].slice(0, 1).map(text => (
                <p
                  key={text}
                  role="alert"
                >
                  {text}
                </p>
              ))}
            </div>
          )}
          {source?.descriptor.sourceId && (
            <a
              aria-label="原图访问链接"
              href={`/nifti?sourceId=${source.descriptor.sourceId}`}
              target="_blank"
              rel="noreferrer"
            >
              原图访问链接
            </a>
          )}
          <p>NIfTI 使用独立分割文件保存与导出。</p>
        </div>,
        document.body
      )}
      <input
        ref={input}
        aria-label="导入 NIfTI mask"
        className="hidden"
        type="file"
        accept=".nii,.nii.gz"
        multiple
        onChange={e => {
          const files = Array.from(e.target.files || []);
          e.target.value = '';
          run(async signal => {
            for (const file of files) await importMasks(servicesManager, file, signal);
          });
        }}
      />
      {createPortal(
        <div
          id="nt-layers"
          hidden={menu !== 'layers'}
          className="nt-popover nt-layer-menu"
          role="region"
          aria-label="图层与结构管理"
        >
          {source?.annotationCase && (
            <AnatomyPanel
              key={source.sourceKey}
              source={source}
            />
          )}
          {config.enableNiftiEditing && (
            <GroupedSegmentationPanel
              source={source}
              servicesManager={servicesManager}
              commandsManager={commandsManager}
              busy={busy || historyOpen}
              onAdd={add}
              onCopy={id => run(signal => copyGroup(servicesManager, id, signal))}
              onHistory={id => {
                setHistoryMaskId(id);
                setHistoryOpen(true);
              }}
              onError={setError}
            />
          )}
        </div>,
        document.body
      )}
      <SavedMasksDialog
        open={historyOpen}
        onOpenChange={setHistoryOpen}
        source={source}
        servicesManager={servicesManager}
        onNotice={setError}
        initialMaskId={historyMaskId}
      />
    </div>
  );
}
