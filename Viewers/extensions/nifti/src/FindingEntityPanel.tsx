import { entitiesForFinding } from './entityLabels.mjs';
import React, { useEffect, useRef, useState } from 'react';
import { useSystem } from '@ohif/core';
import { Crosshair, Trash2, Pencil } from 'lucide-react';
import { currentSource, createMask, loadSaved, isMaskDirty } from './masks';
import {
  annotationRequest,
  installAnnotationContext,
  registerAnnotationCase,
} from './annotationClient';
import { editingMask, enterMaskEditing, exitMaskEditing } from './editing';
import { maskLocation } from './maskLocation';
import ReportFindings from './ReportFindings';
import { getWorkspace } from './workspace';
import './finding-entity-panel.css';

export default function FindingEntityPanel() {
  const { servicesManager, commandsManager } = useSystem();
  const [caseContext, setContext] = useState<any>(null),
    [categories, setCategories] = useState<any>({});
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [progress, setProgress] = useState<any>(null);
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
    if (response.data.worklistId) {
      const next = await annotationRequest(
        `/worklists/${response.data.worklistId}/progress`,
        undefined,
        signal
      );
      if (sourceRef.current === target) setProgress(next);
    }
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
    setProgress(null);
    setActiveFinding('');
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
      if (target.annotationCase.worklistId)
        annotationRequest(`/worklists/${target.annotationCase.worklistId}/progress`)
          .then(p => {
            if (sourceRef.current === target) setProgress(p);
          })
          .catch(() => {});
    };
    const selected = event => {
      if (event.detail?.sourceKey === sourceRef.current?.sourceKey)
        setActiveFinding(event.detail.findingId);
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
      const id = await createMask(servicesManager, entity.name);
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
    servicesManager.services.segmentationService.setActiveSegment(mask.segmentationId, 1);
    window.dispatchEvent(
      new CustomEvent('nifti:select-target', {
        detail: { sourceKey: target.sourceKey, segmentationId: mask.segmentationId },
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
        segmentationService.remove(mask.segmentationId);
        target.masks.delete(mask.segmentationId);
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
  const completed = context && context.completedRevision === context.revision;
  return (
    <section
      className="annotation-panel"
      aria-label="Finding / Entity 标注工作台"
    >
      <h2>Entity 标注</h2>
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
          <div className="annotation-status">
            <strong>{completed ? '已完成' : '待完成'}</strong>
            <span>{context.entities.length} 个 Entity</span>
          </div>
          {progress && (
            <p role="status">
              任务完成 {progress.completedCases}/{progress.totalCases} ·{' '}
              {Math.round(progress.completionPercent || 0)}%
            </p>
          )}
          <button
            disabled={busy || completed || !context.sourceId || source?.annotationStatus?.busy}
            onClick={() =>
              run(async target => {
                if (
                  [...target.masks.values()].some(
                    m => !m.anatomyReadOnly && isMaskDirty(servicesManager, m)
                  )
                )
                  throw Error('请先保存当前编辑。');
                await mutate(target, { operation: 'complete' });
              })
            }
          >
            标记完成
          </button>
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
          <ReportFindings
            key={context.caseId}
            context={context}
            categories={categories}
            busy={busy || source?.annotationStatus?.busy}
            activeFinding={activeFinding}
            onSelectFinding={setActiveFinding}
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
            onLink={(findingId, entityId, observationId?) =>
              run(target =>
                mutate(target, {
                  operation: 'link',
                  findingId,
                  entityId,
                  ...(observationId ? { observationIds: [observationId] } : {}),
                })
              )
            }
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
                  <button
                    className="rf-entity-edit"
                    disabled={busy || source?.annotationStatus?.busy}
                    onClick={() => run(target => locateEntity(target, entity))}
                  >
                    <span>{entity.name}</span>
                  </button>
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
                    {editingEntityId === entity.id && (
                      <small className="editing-badge">编辑中</small>
                    )}
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
                <small>
                  {entity.annotationDisposition === 'not_required'
                    ? '不需空间标注'
                    : entity.maskId
                      ? '已保存（非空状态以完成校验为准）'
                      : '待标注'}
                </small>
                <button
                  disabled={busy || source?.annotationStatus?.busy}
                  onClick={() =>
                    run(async target => {
                      const name = window.prompt('Entity 名称', entity.name);
                      if (name?.trim())
                        await mutate(target, {
                          operation: 'entityMetadata',
                          entityId: entity.id,
                          name,
                        });
                    })
                  }
                >
                  改名
                </button>
                <button
                  disabled={busy || source?.annotationStatus?.busy}
                  onClick={() =>
                    run(async target => {
                      const reason = window.prompt('不需要空间标注的原因');
                      if (reason?.trim())
                        await mutate(target, {
                          operation: 'entityMetadata',
                          entityId: entity.id,
                          annotationDisposition: 'not_required',
                          dispositionReason: reason,
                        });
                    })
                  }
                >
                  不需标注
                </button>
                {entity.annotationDisposition === 'not_required' && (
                  <button
                    disabled={busy || source?.annotationStatus?.busy}
                    onClick={() =>
                      run(target =>
                        mutate(target, {
                          operation: 'entityMetadata',
                          entityId: entity.id,
                          annotationDisposition: 'needs_annotation',
                        })
                      )
                    }
                  >
                    恢复待标注
                  </button>
                )}
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
