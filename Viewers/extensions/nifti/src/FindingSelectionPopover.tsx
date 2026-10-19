import React, { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Plus, X } from 'lucide-react';

/** A transient action anchored to the report selection, outside scroll clipping. */
export default function FindingSelectionPopover({ anchor, findingCount, onClose, children }) {
  const [expanded, setExpanded] = useState(false);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const popup = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  const initialCount = useRef(findingCount);

  useEffect(() => {
    if (findingCount > initialCount.current) close.current();
  }, [findingCount]);

  useLayoutEffect(() => {
    const box = popup.current.getBoundingClientRect();
    const gap = 8;
    const left = Math.max(gap, Math.min(anchor.left + anchor.width / 2 - box.width / 2,
      window.innerWidth - box.width - gap));
    // Prefer above the selection; fall below only if there is no room above.
    const top = anchor.top >= box.height + gap * 2
      ? anchor.top - box.height - gap
      : Math.max(gap, Math.min(anchor.bottom + gap, window.innerHeight - box.height - gap));
    setPosition({ left, top });
  }, [anchor, expanded]);

  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (!popup.current?.contains(event.target as Node)) close.current();
    };
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        close.current();
      }
    };
    const scroll = (event: Event) => {
      if (!popup.current?.contains(event.target as Node)) close.current();
    };
    const resize = () => close.current();
    document.addEventListener('pointerdown', outside, true);
    document.addEventListener('keydown', key, true);
    document.addEventListener('scroll', scroll, true);
    window.addEventListener('resize', resize);
    return () => {
      document.removeEventListener('pointerdown', outside, true);
      document.removeEventListener('keydown', key, true);
      document.removeEventListener('scroll', scroll, true);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return createPortal(
    <div ref={popup} className="annotation-panel rf-selection-popover"
      role={expanded ? 'dialog' : 'toolbar'} aria-label="从选中原文创建 Finding"
      style={{ ...position, width: expanded ? 300 : undefined }}>
      <div className="rf-selection-actions">
        {!expanded && <button type="button" onMouseDown={event => event.preventDefault()}
          onClick={() => setExpanded(true)}><Plus size={14} />创建 Finding</button>}
        <button type="button" className="rf-selection-close" title="关闭（Esc）"
          aria-label="关闭创建 Finding" onClick={() => close.current()}><X size={14} /></button>
      </div>
      {expanded && children}
    </div>, document.body
  );
}
