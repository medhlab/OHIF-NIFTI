import React, { useEffect, useState } from 'react';
import { Info, PanelRightClose } from 'lucide-react';
import ImageInfoPanel from './ImageInfoPanel';
import FindingEntityPanel from './FindingEntityPanel';
import './workspace.css';

export default function WorkspacePanel({ onClosePanel }: { onClosePanel?: () => void }) {
  const [tab, setTab] = useState('findingEntity');
  useEffect(() => {
    const listener = event => {
      // Accept the legacy event value while all current callers use findingEntity.
      if (['report', 'findingEntity', 'lesion', 'info'].includes(event.detail)) {
        setTab(event.detail === 'info' ? 'info' : 'findingEntity');
      }
    };
    window.addEventListener('nifti:workspace-tab', listener);
    return () => window.removeEventListener('nifti:workspace-tab', listener);
  }, []);
  return (
    <div className="nw-shell">
      <div className="nw-sticky-header">
        <div id="nifti-annotation-context" />
        <nav
          className="nw-tabs"
          aria-label="报告与标注面板"
        >
          <button
            className="nw-tab"
            aria-pressed={tab === 'findingEntity'}
            onClick={() => setTab('findingEntity')}
          >
            Finding / Entity
          </button>
          <button
            className="nw-tab nw-tab-annotation"
            aria-pressed={tab === 'info'}
            onClick={() => setTab('info')}
          >
            <Info size={17} />
            图像信息
          </button>
          {onClosePanel && (
            <button
              className="nw-panel-close"
              aria-label="收起报告与标注面板"
              onClick={onClosePanel}
            >
              <PanelRightClose size={18} />
            </button>
          )}
        </nav>
      </div>
      <div className="nw-tab-content" hidden={tab !== 'findingEntity'}>
        <FindingEntityPanel />
      </div>
      <div className="nw-tab-content" hidden={tab !== 'info'}>
        <ImageInfoPanel />
      </div>
    </div>
  );
}
