import { firstReadyEntity } from './findingLocation';
import { maskId, maskIndex, removeMask } from './packedMasks';
import { entitiesForFinding, entityLabel } from './entityLabels.mjs';
import React, { useEffect, useRef, useState } from 'react';
import { useSystem } from '@ohif/core';
import { Crosshair, Trash2, Pencil } from 'lucide-react';
import { currentSource, createMask, loadSaved, isMaskDirty, maskAppearance } from './masks';
import {
  annotationRequest,
  installAnnotationContext,
  registerAnnotationCase,
} from './annotationClient';
import { editingMask, enterMaskEditing, exitMaskEditing } from './editing';
import { maskLocation } from './maskLocation';
import EntityName from './EntityName';
import { entityMaskEmpty } from './entityMaskEmpty';
import ReportFindings from './ReportFindings';
import { getWorkspace } from './workspace';
import './finding-entity-panel.css';

export default function FindingEntityPanel() {
  const { servicesManager, commandsManager } = useSystem();
  const [caseContext, setContext] = useState<any>(null),
    [categories, setCategories] = useState<any>({});
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  const [selectedEntityId, setSelectedEntityId] = useState('');
  const [reportText, setReportText] = useState(''),
    [findingText, setFindingText] = useState(''),
    [category, setCategory] = useState('');
  const [evidence, setEvidence] = useState<any>(null),
    [selection, setSelection] = useState(''),
    [activeFinding, setActiveFinding] = useState('');
  const [, render] = useState(0);
  const generation = useRef(0),
    operation = useRef(false);
  let source;
  try {
    source = currentSource(servicesManager).source;
  } catch {
    /* Viewer initializes separately. */
  }
  const context = source?.annotationCase?.caseId === caseContext?.caseId ? caseContext : null;
  const workspace = getWorkspace();
  const caseReady =
    !document.body.classList.contains('nifti-case-switching') &&
    (!workspace.manifest?.id ||
      workspace.manifest.items?.some(
        row => row.caseId === workspace.caseId && row.sourceId === source?.descriptor.sourceId
      ));
  const selectFindingRef = useRef<(id: string, locate?: boolean) => void>();
  const sourceRef = useRef(source);
  sourceRef.current = source;
  const refresh = async (target, signal?) => {
    if (!target?.annotationCase) return;
    const response = await annotationRequest(
      `/cases/${target.annotationCase.caseId}/context`,
      undefined,
      signal
    );
    if (sourceRef.current !== target) return;
    installAnnotationContext(target, response);
    setContext(response.data);

  };
  const run = async action => {
    if (operation.current || source?.annotationStatus?.busy) return;
    operation.current = true;
    setBusy(true);
    setError('');
    const target = sourceRef.current,
      token = generation.current;
    try {
      await action(target);
    } catch (e) {
      if (generation.current === token) {
        setError(e.message);
        if (e.status === 409) await refresh(target).catch(() => {});
      }
    } finally {
      operation.current = false;
      if (generation.current === token) setBusy(false);
    }
  };
  useEffect(() => {
    generation.current++;
    setContext(null);
    setActiveFinding('');
    setSelectedEntityId('');
    setSelection('');
    setEvidence(null);
    setFindingText('');
    setReportText('');
    setCategory('');
    setError('');
    setBusy(false);
    const target = source;
    const controller = new AbortController();
    if (target?.descriptor.modality === 'CT' && caseReady) {
      setBusy(true);
      (async () => {
        // Registration is shared with manual editing; unmount only cancels this view's reads.
        await registerAnnotationCase(target);
        if (controller.signal.aborted || sourceRef.current !== target) return;
        await refresh(target, controller.signal);
      })()
        .catch(e => {
          if (!controller.signal.aborted && sourceRef.current === target) setError(e.message);
        })
        .finally(() => {
          if (!controller.signal.aborted && sourceRef.current === target) setBusy(false);
        });
    }
    return () => {
      generation.current++;
      controller.abort();
    };
  }, [source?.sourceKey, caseReady]);
  useEffect(() => {
    const updated = event => {
      const target = sourceRef.current;
      if (event.detail !== target?.sourceKey || !target?.annotationCase) return;
      setContext({ ...target.annotationCase });

    };
    const selected = event => {
      if (event.detail?.sourceKey === sourceRef.current?.sourceKey)
        selectFindingRef.current?.(event.detail.findingId, event.detail.locate !== false);
    };
    window.addEventListener('nifti:annotation-updated', updated);
    window.addEventListener('nifti:select-finding', selected);
    annotationRequest('/categories')
      .then(body => setCategories(body.items))
      .catch(e => setError(e.message));
    const timer = setInterval(() => {
      render(n => n + 1);
      const target = sourceRef.current;
      if (target?.annotationCase) setContext({ ...target.annotationCase });
    }, 500);
    return () => {
      clearInterval(timer);
      window.removeEventListener('nifti:annotation-updated', updated);
      window.removeEventListener('nifti:select-finding', selected);
    };
  }, []);
  const initialise = target =>
    run(async () => {
      const context = await registerAnnotationCase(target);
      if (sourceRef.current !== target) return;
      setContext(context);
      await refresh(target);
    });
  const mutate = async (target, payload) => {
    const body = await annotationRequest(`/cases/${target.annotationCase.caseId}/operations`, {
      expectedCaseRevision: target.annotationCase.revision,
      ...payload,
    });
    if (sourceRef.current !== target) return null;
    installAnnotationContext(target, body);
    setContext(body.data);
    await refresh(target);
    return body.data;
  };
  const editEntity = async (target, entity) => {
    const active = editingMask(target);
    if (active && (active.entityId === entity.id ||
        (entity.maskId && active.saved?.maskId === entity.maskId))) {
      exitMaskEditing(servicesManager);
      return;
    }
    let mask = [...target.masks.values()].find(
      (m: any) => m.entityId === entity.id || m.saved?.maskId === entity.maskId
    );
    if (!mask && entity.maskId) {
      const results = await loadSaved(servicesManager, undefined, [entity.maskId]);
      const failure = results.find(r => r.status === 'failed');
      if (failure) throw Error(failure.error);
      mask = [...target.masks.values()].find((m: any) => m.saved?.maskId === entity.maskId);
    }
    if (!mask) {
      const id = await createMask(servicesManager, entity.name, undefined, undefined, undefined, undefined, entity.id);
      mask = target.masks.get(id);
      mask.entityId = entity.id;
    }
    if (sourceRef.current !== target) return;
    mask.entityId = entity.id;
    mask.annotationCaseId = target.annotationCase.caseId;
    const { viewportId } = currentSource(servicesManager);
    servicesManager.services.segmentationService.setActiveSegmentation(
      viewportId,
      mask.segmentationId
    );
    servicesManager.services.segmentationService.setActiveSegment(mask.segmentationId, maskIndex(mask));
    window.dispatchEvent(
      new CustomEvent('nifti:select-target', {
        detail: { sourceKey: target.sourceKey, segmentationId: maskId(mask) },
      })
    );
    enterMaskEditing(servicesManager, commandsManager, mask);
  };
  const locateEntity = async (target, entity) => {
    if (
      entity.maskId &&
      ![...target.masks.values()].some(
        (m: any) => m.entityId === entity.id || m.saved?.maskId === entity.maskId
      )
    )
      await loadSaved(servicesManager, undefined, [entity.maskId]);
    if (sourceRef.current !== target) return;
    const mask = [...target.masks.values()].find(
      (m: any) => m.entityId === entity.id || m.saved?.maskId === entity.maskId
    );
    const location = mask && maskLocation(target, mask);
    if (!location) throw Error('此 Entity 暂无非空 mask，请点击编辑后绘制。');
    const { viewportId } = currentSource(servicesManager);
    const viewport =
      servicesManager.services.cornerstoneViewportService.getCornerstoneViewport(viewportId);
    if (viewport.type === 'stack') await viewport.setImageIdIndex(location.slice);
    else viewport.jumpToWorld(location.world);
    viewport.render();
  };
  const selectFinding = (findingId, locate = true) => {
    setActiveFinding(findingId);
    if (!locate) return;
    return run(async target => {
      if (!target?.annotationCase) return;
      const entities = entitiesForFinding(target.annotationCase, findingId);
      const missing = entities.filter(entity => entity.maskId &&
        ![...target.masks.values()].some((m: any) =>
          m.entityId === entity.id || m.saved?.maskId === entity.maskId
        ));
      const started = performance.now();
      const pending = new Set(missing.map(e => e.maskId));
      let located = false;
      const locateFirst = async () => {
        if (located || sourceRef.current !== target) return;
        const first = firstReadyEntity(entities, pending, entity =>
          [...target.masks.values()].find((m: any) =>
            m.entityId === entity.id || (entity.maskId && m.saved?.maskId === entity.maskId)
          ), mask => maskLocation(target, mask));
        if (!first) return;
        await locateEntity(target, first);
        located = true;
        console.debug('[nifti-finding-locate]', JSON.stringify({ ms: performance.now() - started }));
      };
      await locateFirst();
      const results = missing.length
        ? await loadSaved(servicesManager, undefined, [...pending], {
            onSettled: async result => {
              pending.delete(result.item.maskId);
              await locateFirst();
            },
          })
        : [];
      if (sourceRef.current !== target) return;
      pending.clear();
      await locateFirst();
      console.debug('[nifti-finding-ready]', JSON.stringify({ ms: performance.now() - started }));
      const failures = results.filter(result => result.status === 'failed');
      if (failures.length) throw Error(`部分 Entity mask 加载失败：${failures.map(result => result.error).join('；')}。点击 Finding 可重试。`);
    });
  };
  selectFindingRef.current = selectFinding;
  const entityColor = entity => {
    const mask = [...(source?.masks.values() || [])].find((m: any) =>
      m.entityId === entity.id || (entity.maskId && m.saved?.maskId === entity.maskId)
    );
    return mask ? maskAppearance(servicesManager, mask) : undefined;
  };
  const editingEntityId = editingMask(source)?.entityId;
  const deleteEntity = entity =>
    run(async target => {
      const links = target.annotationCase.links.filter(link => link.entityId === entity.id).length;
      if (
        !window.confirm(
          `删除 Entity“${entity.name}”？将解除 ${links} 个 Finding 关联，并移除当前 mask 和 AI 提示。已保存的 mask 历史会保留。`
        )
      )
        return;
      const state = await mutate(target, { operation: 'deleteEntity', entityId: entity.id });
      if (!state) return;
      const { segmentationService, measurementService } = servicesManager.services;
      for (const mask of [...target.masks.values()] as any[]) {
        if (mask.entityId !== entity.id && (!entity.maskId || mask.saved?.maskId !== entity.maskId))
          continue;
        const ids = measurementService
          .getMeasurements()
          .filter(m => m.metadata?.segmentationId === mask.segmentationId)
          .map(m => m.uid);
        if (ids.length) measurementService.removeMany(ids);
        if (editingMask(target) === mask) exitMaskEditing(servicesManager);
        removeMask(servicesManager, target, mask);
      }
    });
  const addEntity = (findingId, observationId?) =>
    run(async target => {
      const observation = target.annotationCase.reportExtraction?.observations.find(
        o => o.id === observationId
      );
      const state = await mutate(target, {
        operation: 'entity',
        name:
          observation?.term ||
          `Entity ${entitiesForFinding(target.annotationCase, findingId).length + 1}`,
        findingIds: findingId ? [findingId] : [],
        ...(observationId ? { observationIds: [observationId] } : {}),
      });
      if (state) await editEntity(target, state.entities[state.entities.length - 1]);
    });
  return (
    <section
      className="annotation-panel"
      aria-label="Finding / Entity 标注工作台"
    >
      {!context ? (
        <>
          <p role="status">
            {!source
              ? '正在加载 CT…'
              : source.descriptor.modality !== 'CT'
                ? 'Finding / Entity 工作台目前支持 CT。'
                : error
                  ? '工作台加载失败，请重试。'
                  : '正在加载报告与 Entity…'}
          </p>
          {error && source?.descriptor.modality === 'CT' && (
            <button
              disabled={busy || source?.annotationStatus?.busy}
              onClick={() => initialise(source)}
            >
              重试加载工作台
            </button>
          )}
        </>
      ) : (
        <>
          {!!context.legacyManifestImport?.warnings?.length && (
            <p role="alert">
              旧清单有 {context.legacyManifestImport.warnings.length} 项关联未导入（文件缺失、归属冲突或报告引用缺失）。原始记录已保留，请核对清单。
            </p>
          )}
          <ReportFindings
            key={context.caseId}
            context={context}
            categories={categories}
            busy={busy || source?.annotationStatus?.busy}
            activeFinding={activeFinding}
            onSelectFinding={selectFinding}
            onSelection={(next, quote) => {
              setEvidence(next);
              setSelection(quote);
              setFindingText(quote);
            }}
            onAddEntity={addEntity}
            onDeleteEntity={deleteEntity}
            onEditEntity={entity => run(target => editEntity(target, entity))}
            onLocateEntity={entity => run(target => locateEntity(target, entity))}
            editingEntityId={editingEntityId}
            entityColor={entityColor}
            isEntityEmpty={entity => entityMaskEmpty(source, entity)}
            onUnlink={linkId => run(target => mutate(target, { operation: 'unlink', linkId }))}
            onCategory={(findingId, value) =>
              run(target =>
                mutate(target, { operation: 'updateFinding', findingId, category: value })
              )
            }
            onEntityMetadata={(entityId, values) =>
              run(target => mutate(target, { operation: 'entityMetadata', entityId, ...values }))
            }
            createForm={
              <div className="finding-create">
                <h3>创建 Finding</h3>
                <small>
                  {selection ? `原文证据：${selection}` : '可以选取报告原文，或补充影像发现。'}
                </small>
                <textarea
                  aria-label="Finding 描述"
                  value={findingText}
                  onChange={e => setFindingText(e.target.value)}
                />
                <select
                  aria-label="ReX 类别"
                  value={category}
                  onChange={e => setCategory(e.target.value)}
                >
                  <option value="">暂未分类</option>
                  {Object.entries(categories).map(([code, name]) => (
                    <option
                      key={code}
                      value={code}
                    >
                      {code} · {String(name)}
                    </option>
                  ))}
                </select>
                {evidence && (
                  <button
                    onClick={() => {
                      setEvidence(null);
                      setSelection('');
                    }}
                  >
                    清除原文选区
                  </button>
                )}
                <button
                  disabled={busy || !findingText.trim()}
                  onClick={() =>
                    run(async target => {
                      const state = await mutate(target, {
                        operation: 'finding',
                        text: findingText,
                        category: category || null,
                        evidence,
                      });
                      if (state) {
                        setActiveFinding(state.findings[state.findings.length - 1].id);
                        setFindingText('');
                        setEvidence(null);
                        setSelection('');
                      }
                    })
                  }
                >
                  创建 Finding
                </button>
              </div>
            }
          />
          <details className="annotation-utilities">
            <summary>其他功能</summary>
            <div className="annotation-utilities-content">
          <h3>未关联 Finding 的 Entity</h3>
          <button
            disabled={busy || source?.annotationStatus?.busy}
            onClick={() => addEntity(null)}
          >
            新增未关联 Entity
          </button>
          {context.entities
            .filter(entity => !context.links.some(link => link.entityId === entity.id))
            .map(entity => (
              <div
                key={entity.id}
                className="annotation-entity"
                data-entity-id={entity.id}
                data-editing={editingEntityId === entity.id}
              >
                <div className="rf-entity-header">
                  <EntityName entity={entity} color={entityColor(entity)} prefix={entityLabel(context, entity.id)} selected={selectedEntityId === entity.id || editingEntityId === entity.id}
                    empty={entityMaskEmpty(source, entity)} busy={busy || source?.annotationStatus?.busy}
                    onSelect={() => { setSelectedEntityId(entity.id); if (!entityMaskEmpty(source, entity)) run(target => locateEntity(target, entity)); }}
                    onRename={name => run(target => mutate(target, { operation: 'entityMetadata', entityId: entity.id, name }))} />
                  <div
                    className="annotation-entity-actions"
                    role="group"
                    aria-label={`${entity.name} 操作`}
                  >
                    <button
                      type="button"
                      className="annotation-entity-action"
                      title="定位 Entity"
                      aria-label={`定位 Entity ${entity.name}`}
                      disabled={busy || source?.annotationStatus?.busy}
                      onClick={() => run(target => locateEntity(target, entity))}
                    >
                      <Crosshair
                        size={16}
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      type="button"
                      className="annotation-entity-action"
                      title="编辑 Entity mask"
                      aria-label={`编辑 Entity ${entity.name}`}
                      aria-pressed={editingEntityId === entity.id}
                      disabled={busy || source?.annotationStatus?.busy}
                      onClick={() => run(target => editEntity(target, entity))}
                    >
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      className="annotation-entity-action annotation-entity-action-delete"
                      title="删除 Entity"
                      aria-label={`删除 Entity ${entity.name}`}
                      disabled={busy || source?.annotationStatus?.busy}
                      onClick={() => deleteEntity(entity)}
                    >
                      <Trash2
                        size={16}
                        aria-hidden="true"
                      />
                    </button>
                  </div>
                </div>
              </div>
            ))}
          <button
            disabled={busy || source?.annotationStatus?.busy}
            onClick={() => run(target => refresh(target))}
          >
            刷新状态
          </button>
          <p>
            点击 Entity 的铅笔按钮进入编辑；新增 Entity
            会自动进入。保存后继续编辑，退出编辑保留未保存修改。保存新版本后需重新标记完成。
          </p>
          <details open={!context.reports.length}>
            <summary>添加报告原文</summary>
            <textarea
              aria-label="报告原文"
              value={reportText}
              onChange={e => setReportText(e.target.value)}
              placeholder="粘贴完整报告章节原文"
            />
            <button
              disabled={busy || !reportText.trim()}
              onClick={() =>
                run(async target => {
                  await mutate(target, {
                    operation: 'report',
                    name: '报告',
                    sections: [{ name: 'Findings', text: reportText }],
                  });
                  setReportText('');
                })
              }
            >
              保存报告
            </button>
          </details>
            </div>
          </details>
        </>
      )}
      {busy && <p role="status">处理中…</p>}
      {error && (
        <p
          role="alert"
          className="annotation-error"
        >
          {error}
        </p>
      )}
    </section>
  );
}
