import React, { useEffect, useState } from 'react';
import { FileText, Layers, PanelRightClose } from 'lucide-react';
import Panel from './Panel';
import LesionPanel from './LesionPanel';
import ReportPanel from './ReportPanel';
import './workspace.css';

export default function WorkspacePanel({ onClosePanel }: { onClosePanel?: () => void }) {
  const [tab, setTab] = useState('lesion');
  useEffect(() => { const listener = e => setTab(e.detail); window.addEventListener('nifti:workspace-tab', listener); return () => window.removeEventListener('nifti:workspace-tab', listener); }, []);
  return (
    <div className="nw-shell">
      <nav className="nw-tabs" aria-label="报告与标注面板">
        <button className="nw-tab" aria-pressed={tab === 'lesion'} onClick={() => setTab('lesion')}>病灶工作台</button>
        <button className="nw-tab nw-tab-report" aria-pressed={tab === 'report'} onClick={() => setTab('report')}><FileText size={17} />报告</button>
        <button className="nw-tab nw-tab-annotation" aria-pressed={tab === 'annotation'} onClick={() => setTab('annotation')}><Layers size={17} />标注与 AI</button>
        {onClosePanel && <button className="nw-panel-close" aria-label="收起报告与标注面板" onClick={onClosePanel}><PanelRightClose size={18} /></button>}
      </nav>
      <div hidden={tab !== 'lesion'}><LesionPanel /></div>
      <div hidden={tab !== 'report'}><ReportPanel /></div>
      <div hidden={tab !== 'annotation'}><Panel /></div>
    </div>
  );
}
