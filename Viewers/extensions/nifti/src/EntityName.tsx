import React, { useState } from 'react';

export default function EntityName({ entity, prefix = '', color, selected, empty, busy, onSelect, onRename }) {
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
    <span className="rf-entity-legend" role="img"
      title={empty ? 'Mask 为空' : color ? 'Entity mask 颜色' : 'Mask 尚未加载'}
      aria-label={empty ? 'Mask 为空' : color ? 'Entity mask 颜色' : 'Mask 尚未加载'}
      style={{ borderColor: color ? `rgb(${color.slice(0, 3).join(',')})` : '#94a3b8',
        borderStyle: empty ? 'dashed' : 'solid',
        backgroundColor: !empty && color ? `rgba(${color.slice(0, 3).join(',')}, 0.45)` : 'transparent' }} />
    {prefix && <strong>{prefix}</strong>}
    <span>{entity.name}</span>
  </button>;
}
