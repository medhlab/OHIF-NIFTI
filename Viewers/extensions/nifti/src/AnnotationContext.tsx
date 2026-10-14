import React from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X } from 'lucide-react';
import ToolbarIconButton from './ToolbarIconButton';
import { describeAnnotationTarget } from './annotationTarget';

export default function AnnotationContext({
  source,
  mask,
  categories,
  busy,
  message,
  error,
  dirty,
  onCancel,
  editing,
  toolLabel,
  onExit,
}) {
  const container = document.getElementById('nifti-annotation-context');
  if (!container) return null;
  const { entityId, title, categoryText } = describeAnnotationTarget(
    source?.annotationCase,
    mask,
    categories
  );
  return createPortal(
    <>
      <div
        className="nt-target"
        aria-label="当前标注 Entity"
        title={`${title} · ${categoryText}`}
        data-entity-id={entityId}
        data-editing={editing}
        data-segmentation-id={editing ? mask?.segmentationId : undefined}
      >
        <div className="nt-editing-heading">
          <b>{editing ? '正在编辑 mask' : '浏览模式'}</b>
          {editing && (
            <button
              type="button"
              onClick={onExit}
              disabled={busy}
              title="返回浏览，未保存修改会保留"
            >
              退出编辑
            </button>
          )}
        </div>
        <strong>{title}</strong>
        {editing && (
          <span>
            mask · {mask.label} · 工具：{toolLabel}
          </span>
        )}
        <span aria-label="当前 Entity 关联类别">{categoryText}</span>
      </div>
      <div
        className="nt-status"
        aria-live="polite"
        title={error || message}
      >
        {busy ? (
          <>
            <Loader2
              size={15}
              className="animate-spin"
            />
            {message || '处理中…'}
            <ToolbarIconButton
              label="取消"
              icon={X}
              onClick={onCancel}
            />
          </>
        ) : error ? (
          <span role="alert">{error}</span>
        ) : (
          message || (dirty ? `${dirty} 个 mask 未保存` : '就绪')
        )}
      </div>
    </>,
    container
  );
}
