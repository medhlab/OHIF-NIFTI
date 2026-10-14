import React, { useState } from 'react';
import { CircleDashed } from 'lucide-react';

export default function EntityName({ entity, prefix = '', selected, empty, busy, onSelect, onRename }) {
  const [renaming, setRenaming] = useState(false), [draft, setDraft] = useState('');
  if (renaming) return <input autoFocus className="rf-entity-name-input"
    aria-label="Entity 名称" title="回车保存，Esc 取消" value={draft} disabled={busy}
    onChange={e => setDraft(e.target.value)} onBlur={() => setRenaming(false)}
    onKeyDown={e => {
      e.stopPropagation();
      if (e.key === 'Escape') { e.preventDefault(); setRenaming(false); }
      if (e.key === 'Enter') {
        e.preventDefault();
        if (draft.trim() && draft.trim() !== entity.name) onRename(draft.trim());
        setRenaming(false);
      }
    }} />;
  return <button className="rf-entity-edit" disabled={busy} aria-pressed={selected}
    title="点击选中，再次点击名称可改名" onClick={() => {
      if (selected) { setDraft(entity.name); setRenaming(true); } else onSelect();
    }}>
    {prefix && <strong>{prefix}</strong>}
    {empty && <span className="rf-entity-empty" title="暂无标注" aria-label="暂无标注"><CircleDashed size={14} /></span>}
    <span>{entity.name}</span>
  </button>;
}
