import {
  createNnEditor,
  commitPrediction,
  targetKey,
  NnTarget,
  NnTicket,
} from './nnInteractiveEdit';
import { inspectBinaryMaskSlices } from './niftiMaskInspection';
import { niftiMemoryLedger } from './niftiMemoryLedger';
import { backendErrorMessage } from './backendError';
import { parseMultipart } from './multipart';
import { encodeNnSeed } from './nnSeedTransport';

const AI_TOOLS = ['Probe2', 'RectangleROI2', 'PlanarFreehandROI2', 'PlanarFreehandROI3'];

/** Dependencies are supplied by commandsModule; importing this adapter is GPU-free. */
export function createNnInteractiveController({
  servicesManager,
  cache,
  metaData,
  csToolsSegmentation,
  csToolsEnums,
  eventTarget,
  axios,
  toolboxState,
  patchStackLabelmapModifiedSlices,
  triggerSegmentationDataModified,
  triggerSegmentationModified,
}: Record<string, any>) {
  // default's command module is registered BEFORE cornerstone.preRegistration.
  // Only core services exist here. Never capture missing extension services in
  // this closure, or subscribe to them while the worklist is bootstrapping.
  const { measurementService, viewportGridService, displaySetService, uiNotificationService } =
    servicesManager.services;
  let segmentationService: any;
  let cornerstoneViewportService: any;
  let segmentationUnsubscribes: Array<() => void> = [];

  function ensureCornerstoneServices(): boolean {
    const services = servicesManager.services;
    const nextSegmentationService = services.segmentationService;
    const nextViewportService = services.cornerstoneViewportService;
    if (!nextSegmentationService || !nextViewportService) return false;
    cornerstoneViewportService = nextViewportService;
    if (segmentationService !== nextSegmentationService) {
      segmentationUnsubscribes.forEach(unsubscribe => unsubscribe());
      segmentationUnsubscribes = [];
      segmentationService = nextSegmentationService;
      for (const name of ['SEGMENTATION_MODIFIED', 'SEGMENTATION_REMOVED']) {
        const eventName = segmentationService.EVENTS[name];
        if (eventName) {
          const { unsubscribe } = segmentationService.subscribe(eventName, editor.selectionChanged);
          segmentationUnsubscribes.push(unsubscribe);
        }
      }
    }
    return true;
  }
  const owners = new Map<
    string,
    {
      key: string;
      epoch: number;
      ticket: NnTicket;
      signature?: string;
      active?: boolean;
      applied?: boolean;
      archived?: boolean;
    }
  >();
  const notify = (message: string, type = 'info') =>
    uiNotificationService.show({
      title: 'nnInteractive',
      message,
      type,
      duration: 4500,
    });
  const vec = (v: any) =>
    Array.isArray(v) || ArrayBuffer.isView(v)
      ? Array.from(v as ArrayLike<number>)
      : v && [v.x, v.y, v.z];

  function dicomSlice(imageId: string) {
    const plane = metaData.get('imagePlaneModule', imageId) || {};
    const instance = metaData.get('instance', imageId) || {};
    const sop = metaData.get('sopCommonModule', imageId)?.sopInstanceUID || instance.SOPInstanceUID;
    const orientation = instance.ImageOrientationPatient || [
      ...(vec(plane.rowCosines) || []),
      ...(vec(plane.columnCosines) || []),
    ];
    const result = {
      sopInstanceUID: sop,
      position: vec(plane.imagePositionPatient) || instance.ImagePositionPatient,
      orientation: Array.from(orientation, Number),
      spacing: [
        plane.rowPixelSpacing ?? instance.PixelSpacing?.[0],
        plane.columnPixelSpacing ?? instance.PixelSpacing?.[1],
      ].map(Number),
    };
    if (
      !sop ||
      result.position?.length !== 3 ||
      result.orientation.length !== 6 ||
      [...result.position, ...result.orientation, ...result.spacing].some(
        v => !Number.isFinite(Number(v))
      )
    ) {
      throw new Error('当前影像缺少 DICOM 空间信息，不能安全运行 AI。');
    }
    result.position = result.position.map(Number);
    return result;
  }

  function capture(): NnTarget {
    if (!ensureCornerstoneServices()) throw new Error('影像编辑服务尚未就绪，请先打开影像。');
    if (toolboxState.getLocked()) throw new Error('编辑工具已锁定。');
    const { activeViewportId, viewports } = viewportGridService.getState();
    const displaySetId = viewports.get(activeViewportId)?.displaySetInstanceUIDs?.[0];
    const ds = displaySetService.getDisplaySetByUID(displaySetId);
    const segmentation = segmentationService.getActiveSegmentation(activeViewportId);
    const segment = segmentationService.getActiveSegment(activeViewportId);
    if (
      !ds?.SeriesInstanceUID ||
      !segmentation ||
      !segment ||
      segment.segmentIndex < 1 ||
      segment.locked ||
      csToolsSegmentation.segmentLocking.isSegmentIndexLocked(
        segmentation.segmentationId,
        segment.segmentIndex
      )
    ) {
      throw new Error('请先在当前序列选择一个未锁定的 mask。');
    }
    const labelmap = segmentation.representationData?.Labelmap;
    const imageIds: string[] = labelmap?.imageIds;
    const references: string[] = imageIds?.map(
      (id, i) => cache.getImage(id)?.referencedImageId || labelmap.referencedImageIds?.[i]
    );
    if (
      !imageIds?.length ||
      !references?.every(Boolean) ||
      !ds.imageIds?.length ||
      references.length !== ds.imageIds.length
    ) {
      throw new Error('当前 mask 缺少完整的引用影像或 labelmap 数据。');
    }
    const sourceUids: string[] = ds.imageIds.map((id: string) => dicomSlice(id).sopInstanceUID);
    const slices = references.map(dicomSlice);
    const uidSet = new Set(sourceUids);
    if (
      uidSet.size !== slices.length ||
      new Set(slices.map(s => s.sopInstanceUID)).size !== slices.length ||
      slices.some(s => !uidSet.has(s.sopInstanceUID))
    ) {
      throw new Error('选中的 mask 不属于当前影像序列。');
    }
    const viewport = cornerstoneViewportService.getCornerstoneViewport(activeViewportId);
    const volumeId = viewport?.getVolumeId?.();
    const volume = volumeId ? cache.getVolume(volumeId) : undefined;
    // The bundled Probe/Rectangle/Freehand tools already normalize volume IJK
    // z to displaySet.imageIds (see backup/esm/*Tool.js). Sending volume order
    // here would flip an MPR prompt twice. Stack tools use stack slice indices.
    const promptIds: string[] = volume ? ds.imageIds : viewport?.getImageIds?.() || ds.imageIds;
    if (promptIds.length !== references.length) throw new Error('AI 提示影像与 mask 尺寸不一致。');
    const first = cache.getImage(imageIds[0]);
    const rows = first?.rows || first?.height;
    const columns = first?.columns || first?.width;
    if (
      !rows ||
      !columns ||
      imageIds.some(
        id => cache.getImage(id)?.voxelManager?.getScalarData()?.length !== rows * columns
      )
    ) {
      throw new Error('当前 mask 像素缓存不完整。');
    }
    let nativeSource;
    if (ds.sourceType === 'nifti') {
      if (
        viewport?.getCurrentImageId?.()?.startsWith('nifti:') &&
        viewport.getCornerstoneImage?.()?.imageId !== viewport.getCurrentImageId()
      ) {
        throw new Error('请等待当前切片加载完成后添加 AI 提示。');
      }
      const descriptor = ds.sourceDescriptor;
      if (!descriptor?.capabilities?.ai) throw new Error('此部署尚未启用 NIfTI AI。');
      if (!descriptor.sourceId) throw new Error('请先在 NIfTI 面板上传原图，再添加 AI 提示。');
      if (descriptor.editingSegmentationId !== segmentation.segmentationId)
        throw new Error('请先点击 Entity 的编辑按钮进入编辑状态。');
      const order = ids =>
        ids.map(id => {
          const native = metaData.get('niftiSource', id);
          if (!native || native.sourceKey !== ds.sourceKey)
            throw new Error('NIfTI 提示或 mask 引用了另一例原图。');
          return native.slice;
        });
      nativeSource = {
        sourceId: descriptor.sourceId,
        geometryHash: descriptor.geometryHash,
        maskOrder: order(references),
        promptOrder: order(promptIds),
        ...(descriptor.capabilities.nnSeedEncodings?.includes('gzip')
          ? { seedEncoding: 'gzip' }
          : {}),
      };
    }
    return {
      ...(nativeSource ? { nativeSource, editingEpoch: ds.sourceDescriptor.editingEpoch } : {}),
      seriesUID: ds.SeriesInstanceUID,
      studyUID: ds.StudyInstanceUID,
      segmentationId: segmentation.segmentationId,
      segmentIndex: segment.segmentIndex,
      viewportId: activeViewportId,
      imageIds: [...imageIds],
      referenceImageIds: [...references],
      shape: [imageIds.length, rows, columns],
      slices,
      promptSlices: promptIds.map(id => dicomSlice(id).sopInstanceUID),
    };
  }

  function getSlices(target: NnTarget) {
    return target.imageIds.map(id => {
      const pixels = cache.getImage(id)?.voxelManager?.getScalarData();
      if (!pixels || pixels.length !== target.shape[1] * target.shape[2])
        throw new Error('Mask 像素缓存不完整。');
      return pixels;
    });
  }

  const editor = createNnEditor({
    capture,
    notify,
    retainBaseline: async (target, pixels) => {
      const owner = target.segmentationId + ':ai-prompt-base';
      if (target.nativeSource)
        (await import('../../../nifti/src/sourceStore')).reserve(owner, pixels.byteLength);
      niftiMemoryLedger.trackBuffer(pixels, { source: 'nninteractive-prompt-base', owner });
    },
    releaseBaseline: target => {
      const owner = target.segmentationId + ':ai-prompt-base';
      niftiMemoryLedger.releaseOwner(owner);
      if (target.nativeSource)
        void import('../../../nifti/src/sourceStore').then(module => module.release(owner));
    },
    invalidatePrompts: target => {
      for (const owner of owners.values())
        if (owner.key === targetKey(target)) owner.archived = true;
      histories.delete(targetKey(target));
    },
    inspect: async (target, includeBuffer) => {
      const native =
        target.nativeSource && includeBuffer
          ? await import('../../../nifti/src/sourceStore')
          : undefined;
      const budgetOwner = target.seriesUID.replace(/:study$|:series$/, '') + ':seed-inspection';
      if (native)
        native.reserve(
          budgetOwner,
          target.shape.reduce((a, b) => a * b, 1)
        );
      try {
        return await inspectBinaryMaskSlices({
          sliceCount: target.imageIds.length,
          getSlice: index => {
            const pixels = cache.getImage(target.imageIds[index])?.voxelManager?.getScalarData();
            if (!pixels) throw new Error('Mask 像素缓存已释放。');
            return pixels;
          },
          segmentIndex: target.segmentIndex,
          flipped: false,
          includeBuffer,
          allowEmpty: true,
        });
      } finally {
        native?.release(budgetOwner);
      }
    },
    prompts: (target, epoch) => {
      const prompts = [];
      for (const measurement of measurementService.getMeasurements()) {
        const owner = owners.get(measurement.uid);
        if (
          !owner ||
          !owner.active ||
          owner.archived ||
          owner.key !== targetKey(target) ||
          owner.epoch !== epoch ||
          measurement.referenceSeriesUID !== target.seriesUID
        )
          continue;
        const entries = Object.entries(measurement.data || {});
        // Verify volume ownership; bundled tools normalize its IJK to display
        // set order, so a forward/reverse ordering difference is expected.
        const entry = entries.find(([id]) => id.startsWith('volumeId:')) || entries[0];
        if (!entry) continue;
        const [dataId, data] = entry as [string, any];
        if (dataId.startsWith('volumeId:')) {
          const ids: string[] = cache.getVolume(dataId.slice('volumeId:'.length))?.imageIds;
          const uids = ids?.map(id => dicomSlice(id).sopInstanceUID);
          if (
            !uids ||
            uids.length !== target.promptSlices.length ||
            new Set(uids).size !== uids.length ||
            uids.some(uid => !target.promptSlices.includes(uid))
          ) {
            throw new Error('AI 提示坐标来自不同影像体积，请在当前视口重新添加提示。');
          }
        }
        let kind = '';
        let value: any;
        if (measurement.toolName === 'Probe2') {
          kind = 'points';
          value = data.index;
        } else if (measurement.toolName === 'RectangleROI2') {
          kind = 'boxes';
          const points = data.pointsInShape;
          if (points?.length) value = [points[0].pointIJK, points[points.length - 1].pointIJK];
        } else if (measurement.toolName === 'PlanarFreehandROI3') {
          kind = 'lassos';
          value = data.boundary;
        } else if (measurement.toolName === 'PlanarFreehandROI2') {
          kind = 'scribbles';
          value = data.scribble;
        }
        if (!kind || !value?.length) continue;
        // Snapshot before async work; dragging an annotation must not mutate an
        // already in-flight request. A changed annotation has a new fingerprint.
        owner.signature = promptSignature(measurement);
        const copied = JSON.parse(JSON.stringify(value));
        const sign = measurement.metadata?.neg === true ? 'neg' : 'pos';
        prompts.push({
          uid: JSON.stringify([measurement.uid, sign, kind, copied]),
          measurementUID: measurement.uid,
          kind: `${sign}_${kind}`,
          value: copied,
        });
      }
      return prompts;
    },
    infer: async (context, seed, prompts) => {
      const owner = niftiMemoryLedger.createOwner('nninteractive-selected-mask-request');
      const native =
        context.version === 2 ? await import('../../../nifti/src/sourceStore') : undefined;
      // Seed, multipart Blob, response and decoded prediction can coexist.
      if (native)
        native.reserve(owner, context.shape.reduce((a, b) => a * b, 1) * 4 + 2 * 1024 ** 2);
      try {
        if (seed) niftiMemoryLedger.trackBuffer(seed, { source: 'nninteractive-seed', owner });
        const params: any = {
          nninter: true,
          nn_context: context,
          studyInstanceUID: context.studyInstanceUID,
          texts: [],
          pos_points: [],
          neg_points: [],
          pos_boxes: [],
          neg_boxes: [],
          pos_lassos: [],
          neg_lassos: [],
          pos_scribbles: [],
          neg_scribbles: [],
        };
        for (const prompt of prompts) params[prompt.kind].push(prompt.value);
        const form = new FormData();
        if (seed) {
          const encoded = await encodeNnSeed(
            seed,
            context.version === 2 && context.seedEncoding === 'gzip'
          );
          params.nn_seed_encoding = encoded.encoding;
          form.append(
            'nn_seed',
            encoded.blob,
            encoded.encoding === 'gzip' ? 'mask.bin.gz' : 'mask.bin'
          );
        }
        form.append('params', JSON.stringify(params));
        notify('正在细化当前 mask…');
        const endpoint =
          context.version === 2
            ? `/monai/nifti-images/${encodeURIComponent(context.sourceId)}/infer`
            : `/monai/infer/segmentation?image=${encodeURIComponent(context.seriesUID)}&output=dicom_seg`;
        const response = await axios.post(endpoint, form, { responseType: 'arraybuffer' });
        niftiMemoryLedger.trackBuffer(response.data, { source: 'nninteractive-response', owner });
        const { meta, seg } = await parseMultipart(response.data, response.headers['content-type']);
        const pixels = seg instanceof Uint8Array ? seg : new Uint8Array(seg);
        niftiMemoryLedger.trackBuffer(pixels, { source: 'nninteractive-prediction', owner });
        return {
          pixels,
          context: meta.nn_context,
          shape: meta.mask_shape,
          elapsed: meta.nninter_elapsed,
          flipped: meta.flipped === true || meta.flipped === 'true',
        };
      } catch (error) {
        let body = (error as any)?.response?.data;
        try {
          if (body instanceof ArrayBuffer && body.byteLength <= 16384)
            body = JSON.parse(new TextDecoder().decode(body));
        } catch {
          body = undefined;
        }
        const safe = new Error(backendErrorMessage(error));
        (safe as any).code = body?.detail?.code || body?.code;
        throw safe;
      } finally {
        niftiMemoryLedger.releaseOwner(owner);
        native?.release(owner);
      }
    },
    commit: (target, reply) => {
      // No creation, representation removal, activation or visibility changes.
      const segmentation = csToolsSegmentation.state.getSegmentation(target.segmentationId);
      const segment = segmentation?.segments?.[target.segmentIndex];
      if (!segment || segment.locked) throw new Error('目标 mask 已删除或锁定。');
      const result = commitPrediction(getSlices(target), target.segmentIndex, reply.pixels);
      const stats = segment.cachedStats || {};
      segment.cachedStats = {
        ...stats,
        isDirty: true,
        algorithmName: `nninter_${reply.elapsed || 0}`,
        algorithmType: target.seriesUID,
        seriesInstanceUID: target.seriesUID,
        // The response pixels already use browser order; this flag is solely
        // for the unchanged draft/PACS exporters' browser -> DICOM conversion.
        flipped: reply.flipped,
        center: result.foregroundSlices.length
          ? result.foregroundSlices.reduce((a, b) => a + b, 0) / result.foregroundSlices.length
          : 0,
        // Preserve draftOrigin/currentDraftFilename/savedMaskHash/savedLabel.
      };
      patchStackLabelmapModifiedSlices(target.imageIds);
      if (result.modifiedSlices.length) {
        triggerSegmentationDataModified(
          target.segmentationId,
          result.modifiedSlices,
          target.segmentIndex
        );
      }
      triggerSegmentationModified(target.segmentationId);
      cornerstoneViewportService.getCornerstoneViewport(target.viewportId)?.render?.();
      return result;
    },
    retirePrompts: (prompts, applied) => {
      for (const prompt of prompts as any[]) {
        const owner = owners.get(prompt.measurementUID);
        if (owner && applied) owner.applied = true;
      }
    },
  });

  const histories = new Map<string, { undo: any[]; redo: any[] }>();
  const visible = new Map<string, boolean>();
  const snapshot = key =>
    [...owners]
      .filter(([, owner]) => owner.key === key)
      .map(([uid, owner]) => ({ uid, active: owner.active }));
  const remember = key => {
    const history = histories.get(key) || { undo: [], redo: [] };
    history.undo.push(snapshot(key));
    if (history.undo.length > 100) history.undo.shift();
    history.redo = [];
    histories.set(key, history);
  };
  function managedCapture() {
    let ticket = editor.capture();
    if (!ticket) return undefined;
    const key = targetKey(ticket.target);
    const previous = [...owners.values()].filter(
      owner => owner.key === key && owner.active && !owner.archived
    );
    if (previous.some(owner => owner.epoch !== ticket.epoch)) {
      // Returning to a lesion replays its own prompts from its retained base.
      ticket = editor.replacePrompts();
      for (const owner of previous) {
        owner.epoch = ticket.epoch;
        owner.ticket = ticket;
      }
    }
    return ticket;
  }
  function syncVisibility(ticket = managedCapture()) {
    const key = ticket && targetKey(ticket.target);
    for (const [uid, owner] of owners) {
      const show = owner.key === key && owner.active && visible.get(owner.key) !== false;
      const measurement = measurementService.getMeasurements().find(m => m.uid === uid);
      if (measurement && measurement.isVisible !== show)
        measurementService.toggleVisibilityMeasurement(uid, show);
    }
  }
  function replayCurrent(ticket, run = true) {
    const next = editor.replacePrompts();
    if (!next) return Promise.resolve();
    for (const owner of owners.values())
      if (owner.key === targetKey(next.target) && owner.active && !owner.archived) {
        owner.epoch = next.epoch;
        owner.ticket = next;
        owner.applied = false;
      }
    syncVisibility(next);
    return run ? editor.run(next) : Promise.resolve();
  }
  function managePrompts({ action, uid }: { action: string; uid?: string }) {
    const ticket = managedCapture();
    if (!ticket) return Promise.resolve();
    const key = targetKey(ticket.target),
      own = owners.get(uid);
    if (action === 'visibility') {
      visible.set(key, visible.get(key) === false);
      syncVisibility(ticket);
      return;
    }
    if (action === 'locate') {
      if (own?.key === key && own.active)
        measurementService.jumpToMeasurement(ticket.target.viewportId, uid);
      return;
    }
    const history = histories.get(key) || { undo: [], redo: [] };
    if (action === 'undo' || action === 'redo') {
      const from = action === 'undo' ? history.undo : history.redo;
      const to = action === 'undo' ? history.redo : history.undo;
      const previous = from.pop();
      if (!previous) return;
      to.push(snapshot(key));
      histories.set(key, history);
      const states = new Map(previous.map(entry => [entry.uid, entry.active]));
      for (const [id, owner] of owners)
        if (owner.key === key) owner.active = states.get(id) === true;
    } else if (action === 'delete' || action === 'clear') {
      if (action === 'delete' && (!own || own.key !== key || !own.active)) return;
      remember(key);
      for (const [id, owner] of owners)
        if (owner.key === key && (action === 'clear' || id === uid)) owner.active = false;
    } else return;
    return replayCurrent(ticket);
  }
  function getPromptState() {
    const ticket = managedCapture();
    const key = ticket && targetKey(ticket.target),
      history = histories.get(key);
    const prompts = [...owners]
      .filter(([, owner]) => owner.key === key && owner.active)
      .map(([uid, owner]) => {
        const measurement = measurementService.getMeasurements().find(m => m.uid === uid);
        const value: any = Object.values(measurement?.data || {})[0];
        return {
          uid,
          toolName: measurement?.toolName,
          negative: measurement?.metadata?.neg === true,
          applied: !!owner.applied,
          archived: !!owner.archived,
          index: value?.index,
        };
      });
    return {
      prompts,
      visible: visible.get(key) !== false,
      busy: editor.isRunning(),
      error: editor.getError(),
      undoCount: history?.undo.length || 0,
      redoCount: history?.redo.length || 0,
      target: ticket?.target.segmentationId,
    };
  }

  function promptSignature(measurement) {
    const entries = Object.entries(measurement.data || {});
    const entry: any = entries.find(([id]) => id.startsWith('volumeId:')) || entries[0];
    const data = entry?.[1];
    const value =
      measurement.toolName === 'Probe2'
        ? data?.index
        : measurement.toolName === 'RectangleROI2'
          ? data?.pointsInShape?.map(p => p.pointIJK)
          : measurement.toolName === 'PlanarFreehandROI3'
            ? data?.boundary
            : data?.scribble;
    // Cached intensity/statistics updates do not change the spatial prompt.
    return JSON.stringify([measurement.toolName, value, measurement.metadata?.neg === true]);
  }
  function added({ measurement }: any) {
    if (!measurement || !AI_TOOLS.includes(measurement.toolName)) return;
    const ticket = managedCapture();
    if (!ticket || measurement.referenceSeriesUID !== ticket.target.seriesUID) {
      notify('请先选择当前序列的可编辑 mask，再添加 AI 提示。', 'warning');
      return;
    }
    // Restored/imported annotations can already belong to another mask. Never
    // steal their ownership just because that mask is not currently active.
    if (
      (measurement.metadata?.segmentationId &&
        measurement.metadata.segmentationId !== ticket.target.segmentationId) ||
      (measurement.metadata?.SegmentNumber !== undefined &&
        measurement.metadata.SegmentNumber !== ticket.target.segmentIndex)
    )
      return;
    const existing = owners.get(measurement.uid);
    if (existing?.key === targetKey(ticket.target)) return;
    remember(targetKey(ticket.target));
    owners.set(measurement.uid, {
      key: targetKey(ticket.target),
      epoch: ticket.epoch,
      ticket,
      active: true,
      signature: promptSignature(measurement),
    });
    measurement.metadata ||= {};
    measurement.metadata.segmentationId = ticket.target.segmentationId;
    measurement.metadata.SegmentNumber = ticket.target.segmentIndex;
    syncVisibility(ticket);
    if (toolboxState.getLiveMode()) {
      setTimeout(() => {
        const current = managedCapture();
        if (current && targetKey(current.target) === targetKey(ticket.target))
          void editor.run(current);
      }, 50);
    }
  }
  measurementService.subscribe(measurementService.EVENTS.MEASUREMENT_ADDED, added);
  if (measurementService.EVENTS.MEASUREMENT_UPDATED) {
    measurementService.subscribe(
      measurementService.EVENTS.MEASUREMENT_UPDATED,
      ({ measurement }: any) => {
        const owner = owners.get(measurement?.uid);
        if (!owner || !owner.active || owner.archived) return;
        const signature = promptSignature(measurement);
        if (signature === owner.signature) return; // Visibility-only updates are not new prompts.
        const initialCompletion = JSON.parse(owner.signature || '[]')[1] == null;
        owner.signature = signature;
        owner.applied = false;
        if (!toolboxState.getLiveMode() && !initialCompletion) void replayCurrent(owner.ticket, false);
        if (toolboxState.getLiveMode())
          setTimeout(() => {
            const current = managedCapture();
            if (current && owner.key === targetKey(current.target)) {
              // Probe publishes ADDED with null IJK, then its first calculated IJK.
              // Both events describe one new prompt; do not invalidate its first run.
              if (initialCompletion) void editor.run(current);
              else void replayCurrent(current);
            }
          }, 50);
      }
    );
  }
  // Removal invalidates in-flight prompts, but never touches the mask itself.
  measurementService.subscribe(
    measurementService.EVENTS.MEASUREMENT_REMOVED,
    ({ measurement, uid }: any) => {
      const id = typeof measurement === 'string' ? measurement : measurement?.uid || uid;
      const owner = owners.get(id);
      owners.delete(id);
      if (owner) {
        const current = managedCapture();
        if (current && owner.key === targetKey(current.target)) void replayCurrent(current);
      }
    }
  );
  measurementService.subscribe(
    measurementService.EVENTS.MEASUREMENTS_CLEARED,
    ({ measurements }: any = {}) => {
      const ids = measurements?.map(m => m.uid) || [...owners.keys()];
      const removed = new Set<string>();
      for (const uid of ids) {
        const owner = owners.get(uid);
        if (owner) removed.add(owner.ticket.target.segmentationId);
        owners.delete(uid);
      }
      for (const id of removed) editor.forget(id);
    }
  );
  eventTarget.addEventListener(csToolsEnums.Events.SEGMENTATION_REMOVED, (event: any) => {
    const id = event.detail.segmentationId;
    editor.forget(id);
    for (const [uid, owner] of owners)
      if (owner.ticket.target.segmentationId === id) owners.delete(uid);
  });
  const selectionChanged = () => {
    const ticket = managedCapture();
    syncVisibility(ticket);
  };
  window.addEventListener('nifti:editing-changed', selectionChanged);
  // Use the immediate Cornerstone event, not the 1-second debounced stats event.
  eventTarget.addEventListener(csToolsEnums.Events.SEGMENTATION_DATA_MODIFIED, (event: any) =>
    editor.changed(event.detail.segmentationId)
  );
  for (const name of [
    'SEGMENTATION_MODIFIED',
    'SEGMENTATION_REPRESENTATION_MODIFIED',
    'SEGMENTATION_REMOVED',
  ]) {
    const eventName = csToolsEnums.Events[name];
    if (eventName) eventTarget.addEventListener(eventName, selectionChanged);
  }
  // Subsequent viewport/measurement events and explicit commands call capture(),
  // which binds extension services once they exist. No timers or model loading
  // are needed for startup, and repeated captures do not duplicate listeners.
  viewportGridService.subscribe(
    viewportGridService.EVENTS.ACTIVE_VIEWPORT_ID_CHANGED,
    selectionChanged
  );
  viewportGridService.subscribe(viewportGridService.EVENTS.GRID_STATE_CHANGED, selectionChanged);
  return {
    ...editor,
    getPromptState,
    managePrompts,
    selectionChanged,
    run: () => {
      const ticket = managedCapture();
      return ticket ? editor.run(ticket) : editor.run();
    },
    reset: () => managePrompts({ action: 'clear' }),
  };
}
