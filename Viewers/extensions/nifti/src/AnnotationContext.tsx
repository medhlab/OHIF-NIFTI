import React from 'react';
import { createPortal } from 'react-dom';
import { Loader2, X, Save, LogOut, Pencil, Eye } from 'lucide-react';
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
  onSave,
  canSave,
}) {
  const container = document.getElementById('nifti-annotation-context');
  if (!container) return null;
  const { entityId, title, categoryText } = describeAnnotationTarget(
    source?.annotationCase,
    mask,
    categories
  );
  return createPortal(
    <section
      className="nt-context-card"
      aria-label="标注状态"
      data-state={error ? 'error' : busy ? 'busy' : editing ? 'editing' : 'browse'}
    >
      <div className="nt-card-heading">
        <h2>标注状态</h2>
        <span className="nt-mode-badge">
          {editing ? (
            <Pencil
              size={13}
              aria-hidden="true"
            />
          ) : (
            <Eye
              size={13}
              aria-hidden="true"
            />
          )}
          {editing ? '正在编辑 mask' : '浏览模式'}
        </span>
      </div>
      <div
        className="nt-target"
        aria-label="当前标注 Entity"
        title={`${title} · ${categoryText}`}
        data-entity-id={entityId}
        data-editing={editing}
        data-segmentation-id={editing ? mask?.segmentationId : undefined}
      >
        <strong>当前 Entity · {title}</strong>
        {editing && (
          <span>
            工具：{toolLabel}
          </span>
        )}
        <span aria-label="当前 Entity 关联类别">{categoryText}</span>
      </div>
      <div className="nt-card-footer">
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
        <div className="nt-card-actions">
          <span className="nt-save-action">
            <ToolbarIconButton
              label="保存标注"
              icon={Save}
              onClick={onSave}
              disabled={busy || !canSave}
            />
          </span>
          <span className="nt-exit-action">
            <ToolbarIconButton
              label="退出编辑"
              icon={LogOut}
              onClick={onExit}
              disabled={busy || !editing}
            />
          </span>
        </div>
      </div>
    </section>,
    container
  );
}
