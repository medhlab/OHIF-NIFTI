import React, { useEffect, useRef, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Copy,
  Crosshair,
  Plus,
  FileText,
  Unlink,
  Trash2,
  Pencil,
} from 'lucide-react';
import {
  reportSegments,
  assertionText,
  relationText,
  rejectionText,
  warningText,
} from './reportPresentation';

export default function ReportFindings({
  context,
  categories,
  busy,
  activeFinding,
  onSelectFinding,
  onSelection,
  onAddEntity,
  onEditEntity,
  onLocateEntity,
  editingEntityId,
  onDeleteEntity,
  onLink,
  onUnlink,
  onCategory,
  onEntityMetadata,
  createForm,
}) {
  const [focusedId, setFocusedId] = useState(''),
    [selectedObservation, setSelectedObservation] = useState('');
  const [reportOpen, setReportOpen] = useState(true),
    [createOpen, setCreateOpen] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set()),
    [search, setSearch] = useState('');
  const [sharedEntity, setSharedEntity] = useState(''),
    [notice, setNotice] = useState('');
  const root = useRef<HTMLElement>(null);
  const scrollWithin = (container, node) => {
    if (!container || !node) return;
    const view = container.getBoundingClientRect(),
      target = node.getBoundingClientRect();
    if (target.top < view.top) container.scrollTop += target.top - view.top;
    else if (target.bottom > view.bottom)
      container.scrollTop += Math.min(target.bottom - view.bottom, target.top - view.top);
  };
  const extraction = context.reportExtraction;
  const observations = extraction?.observations || [];
  const selected = observations.find(o => o.id === selectedObservation);
  const byObservation = new Map(observations.map(o => [o.id, o]));
  const focus = (eid, fid?) => {
    setFocusedId(eid);
    setReportOpen(true);
    if (fid) onSelectFinding(fid);
    requestAnimationFrame(() =>
      scrollWithin(
        root.current?.querySelector('.rf-source-scroll'),
        root.current?.querySelector('[data-focused="true"]')
      )
    );
  };
  const selectObservation = observation => {
    setSelectedObservation(observation.id === selectedObservation ? '' : observation.id);
    setSharedEntity('');
    if (observation.findingId)
      setCollapsed(previous => {
        const n = new Set(previous);
        n.delete(observation.findingId);
        return n;
      });
    if (observation.evidenceIds[0]) focus(observation.evidenceIds[0], observation.findingId);
  };
  const selectFinding = finding => {
    onSelectFinding(finding.id);
    setSelectedObservation('');
    setSharedEntity('');
    setCollapsed(previous => {
      const n = new Set(previous);
      n.delete(finding.id);
      return n;
    });
    if (finding.evidenceIds[0]) focus(finding.evidenceIds[0], finding.id);
    requestAnimationFrame(() =>
      scrollWithin(
        root.current?.querySelector('.rf-findings-scroll'),
        root.current?.querySelector(`[data-finding-id="${finding.id}"]`)
      )
    );
  };
  useEffect(() => {
    const finding = context.findings.find(f => f.id === activeFinding);
    if (!finding) return;
    setCollapsed(previous => {
      const n = new Set(previous);
      n.delete(finding.id);
      return n;
    });
    setReportOpen(true);
    setFocusedId(finding.evidenceIds[0] || '');
    requestAnimationFrame(() => {
      scrollWithin(
        root.current?.querySelector('.rf-source-scroll'),
        root.current?.querySelector('[data-focused="true"]')
      );
      scrollWithin(
        root.current?.querySelector('.rf-findings-scroll'),
        root.current?.querySelector(`[data-finding-id="${finding.id}"]`)
      );
    });
  }, [activeFinding]);
  const captureSelection = (element, report, section) => {
    const selection = window.getSelection();
    if (!selection?.rangeCount || selection.isCollapsed) return;
    const range = selection.getRangeAt(0);
    if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) return;
    const before = range.cloneRange();
    before.selectNodeContents(element);
    before.setEnd(range.startContainer, range.startOffset);
    const start = Array.from(before.toString()).length,
      quote = range.toString();
    const end = start + Array.from(quote).length;
    if (Array.from(section.text).slice(start, end).join('') !== quote) return;
    onSelection(
      {
        reportId: report.id,
        reportVersion: report.version,
        sectionId: section.id,
        start,
        end,
        quote,
      },
      quote
    );
    setCreateOpen(true);
  };
  const related = selected
    ? (extraction.relations || []).filter(
        r => r.sourceIds.includes(selected.id) || r.targetIds.includes(selected.id)
      )
    : [];
  const selectedFinding =
    selected &&
    (context.findings.find(f => f.id === selected.findingId) ||
      context.findings.find(f => f.id === activeFinding));
  const entityLinks = entity => context.links.filter(l => l.entityId === entity.id);
  const entityNumber = entity => context.entities.findIndex(e => e.id === entity.id) + 1;
  const renderEntity = (entity, link) => (
    <div
      className="rf-entity"
      key={entity.id}
      data-entity-id={entity.id}
      data-editing={editingEntityId === entity.id}
    >
      <div className="rf-entity-header">
        <button
          className="rf-entity-edit"
          disabled={busy}
          onClick={() => onLocateEntity(entity)}
        >
          <strong>E{entityNumber(entity)}</strong>
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
            disabled={busy}
            onClick={() => onLocateEntity(entity)}
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
            disabled={busy}
            onClick={() => onEditEntity(entity)}
          >
            <Pencil size={16} />
          </button>
          {editingEntityId === entity.id && <small className="editing-badge">编辑中</small>}
          <button
            type="button"
            className="annotation-entity-action annotation-entity-action-unlink"
            title="解除关联"
            aria-label={`解除 E${entityNumber(entity)} 与 Finding 的关联`}
            disabled={busy}
            onClick={() => onUnlink(link.id)}
          >
            <Unlink
              size={16}
              aria-hidden="true"
            />
          </button>
          <button
            type="button"
            className="annotation-entity-action annotation-entity-action-delete"
            title="删除 Entity"
            aria-label={`删除 Entity ${entity.name}`}
            disabled={busy}
            onClick={() => onDeleteEntity(entity)}
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
          ? '不需标注'
          : entity.maskId
            ? '已保存'
            : '待绘制'}
        {entityLinks(entity).length > 1 ? ` · 共享 ${entityLinks(entity).length} 个 Finding` : ''}
      </small>
      {(entity.reportObservations || []).length > 0 && (
        <small>报告关联：{entity.reportObservations.map(o => o.term).join(' · ')}</small>
      )}
      <details className="rf-metadata">
        <summary>Entity 信息</summary>
        <button
          className="rf-quiet"
          disabled={busy}
          onClick={() => {
            const name = window.prompt('Entity 名称', entity.name);
            if (name?.trim()) onEntityMetadata(entity.id, { name });
          }}
        >
          改名
        </button>
        {entity.annotationDisposition === 'not_required' ? (
          <>
            <small>{entity.dispositionReason}</small>
            <button
              className="rf-quiet"
              disabled={busy}
              onClick={() =>
                onEntityMetadata(entity.id, { annotationDisposition: 'needs_annotation' })
              }
            >
              恢复待标注
            </button>
          </>
        ) : (
          <button
            className="rf-quiet"
            disabled={busy}
            onClick={() => {
              const reason = window.prompt('不需要空间标注的原因');
              if (reason?.trim())
                onEntityMetadata(entity.id, {
                  annotationDisposition: 'not_required',
                  dispositionReason: reason,
                });
            }}
          >
            不需标注
          </button>
        )}
      </details>
    </div>
  );
  const renderObservation = observation => (
    <button
      key={observation.id}
      className={`rf-hint ${observation.assertion === 'uncertain' ? 'rf-uncertain' : ''}`}
      data-observation-id={observation.id}
      aria-pressed={observation.id === selectedObservation}
      onClick={() => selectObservation(observation)}
      title={`${observation.term} · ${observation.anatomy || '部位未提供'} · ${assertionText(observation.assertion)}`}
    >
      {observation.term || '报告观察'}
      {observation.anatomy ? ` · ${observation.anatomy}` : ''}
      {observation.assertion === 'uncertain' ? ' · 不确定' : ''}
    </button>
  );
  const renderObservationDetails = () =>
    selected && (
      <div
        className="rf-observation-detail"
        role="region"
        aria-label="报告观察详情"
      >
        <div className="rf-inline">
          <strong>{selected.term}</strong>
          <span className={selected.assertion === 'uncertain' ? 'rf-uncertain' : ''}>
            {assertionText(selected.assertion)}
          </span>
          <button
            className="rf-quiet"
            onClick={() => setSelectedObservation('')}
            aria-label="关闭报告提示"
          >
            ×
          </button>
        </div>
        <p>部位：{selected.anatomy || '模型未提供'}</p>
        <small>
          {selected.section === 'impressions' ? 'Impressions' : 'Findings'} ·{' '}
          {selected.category
            ? `${selected.category} · ${categories[selected.category]}`
            : '语义观察，无 ReX 类别'}
        </small>
        <p>
          {selected.groundingDecision.status === 'semantic_only'
            ? '仅文本语义，尚未图像定位'
            : '文本定位提示，尚未图像验证'}
        </p>
        <button
          className="rf-quiet"
          onClick={() => focus(selected.evidenceIds[0], selected.findingId)}
        >
          定位原文
        </button>
        {related.length > 0 && (
          <div className="rf-relations">
            <strong>模型关系提示</strong>
            {related.map((r, i) => (
              <div key={i}>
                <small>
                  {relationText(r.type)} · {r.warnings.map(warningText).join(' · ') || '需人工判断'}
                </small>
                {[...new Set([...r.sourceIds, ...r.targetIds])]
                  .filter(id => id !== selected.id)
                  .map(id => {
                    const o: any = byObservation.get(id);
                    return (
                      o && (
                        <button
                          className="rf-hint"
                          key={id}
                          onClick={() => selectObservation(o)}
                        >
                          {o.term} · {o.section === 'impressions' ? 'Impressions' : 'Findings'}
                          {o.anatomy ? ` · ${o.anatomy}` : ''}
                        </button>
                      )
                    );
                  })}
              </div>
            ))}
          </div>
        )}
        {selectedFinding && selected.assertion !== 'negated' && (
          <div className="rf-actions">
            <button
              disabled={busy}
              onClick={() => onAddEntity(selectedFinding.id, selected.id)}
            >
              <Plus size={14} />
              新建 Entity 并绘制
            </button>
            <select
              aria-label="报告提示关联已有 Entity"
              value={sharedEntity}
              onChange={e => setSharedEntity(e.target.value)}
            >
              <option value="">关联已有 Entity…</option>
              {context.entities.map(e => (
                <option
                  key={e.id}
                  value={e.id}
                >
                  E{entityNumber(e)} · {e.name}
                </option>
              ))}
            </select>
            <button
              disabled={busy || !sharedEntity}
              onClick={() => onLink(selectedFinding.id, sharedEntity, selected.id)}
            >
              关联报告提示
            </button>
          </div>
        )}
        {!selectedFinding && (
          <small>选择已有 Finding 后可关联此提示；也可从原文选区补充 Finding。</small>
        )}
      </div>
    );
  const filtered = context.findings.filter(f =>
    `${f.text} ${f.category || ''} ${categories[f.category] || ''}`
      .toLowerCase()
      .includes(search.toLowerCase())
  );
  const extraObservations = observations.filter(o => !o.findingId);
  return (
    <section
      className="report-findings"
      ref={root}
      aria-label="报告与 Finding"
      data-case-id={context.caseId}
    >
      <div className="rf-section-heading">
        <FileText size={17} />
        <button
          aria-expanded={reportOpen}
          onClick={() => setReportOpen(!reportOpen)}
        >
          {reportOpen ? <ChevronDown size={14} /> : <ChevronRight size={14} />}报告原文
        </button>
        <small>{context.reports.length} 来源</small>
      </div>
      {reportOpen && (
        <div
          className="rf-source-scroll"
          data-testid="source-report-scroll"
        >
          <p className="rf-caption">点击高亮查看对应 Finding；选取原文可补充遗漏。</p>
          {context.reports.map(report => (
            <div key={report.id}>
              {context.reports.length > 1 && <h4>{report.name}</h4>}
              {report.sections.map(section => (
                <section key={section.id}>
                  <h4>{section.name}</h4>
                  <p
                    className="rf-report-text"
                    data-report-section={section.name}
                    onMouseUp={e => captureSelection(e.currentTarget, report, section)}
                  >
                    {reportSegments(
                      section.text,
                      context.evidence.filter(e => e.sectionId === section.id),
                      context.findings,
                      focusedId
                    ).map(part =>
                      part.evidenceIds.length ? (
                        <mark
                          key={part.start}
                          data-focused={part.focused}
                          data-evidence-id={part.evidenceIds[0]}
                          tabIndex={0}
                          role="button"
                          title={
                            part.findingIds
                              .map(id => `F${context.findings.findIndex(f => f.id === id) + 1}`)
                              .join(' · ') || '报告提示原文'
                          }
                          onClick={() => {
                            if (!window.getSelection()?.isCollapsed) return;
                            const f = context.findings.find(f => f.id === part.findingIds[0]);
                            if (f) selectFinding(f);
                            else focus(part.evidenceIds[0]);
                          }}
                          onKeyDown={e => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              const f = context.findings.find(f => f.id === part.findingIds[0]);
                              if (f) selectFinding(f);
                              else focus(part.evidenceIds[0]);
                            }
                          }}
                        >
                          {part.text}
                        </mark>
                      ) : (
                        part.text
                      )
                    )}
                  </p>
                </section>
              ))}
            </div>
          ))}
          {!context.reports.length && <p>尚无报告，可添加原文或直接记录影像发现。</p>}
        </div>
      )}
      <details
        className="rf-create"
        open={createOpen}
        onToggle={e => setCreateOpen(e.currentTarget.open)}
      >
        <summary>补充 Finding</summary>
        {createForm}
      </details>
      {extraction && (
        <div className="rf-provenance">
          <strong>{extraction.producer} · 模型报告结果</strong>
          <small>
            {extraction.counts.acceptedMentions} 条观察 · {extraction.counts.proposedLesions} 个
            Finding 候选 · {extraction.counts.rejectedMentions} 条拒绝项
          </small>
          <small>文本候选尚未图像验证；Entity 由人工创建和关联。</small>
        </div>
      )}
      <div className="rf-section-heading">
        <strong>Findings</strong>
        <span className="rf-count">{context.findings.length}</span>
        <small>{context.entities.length} 个 Entity</small>
      </div>
      <input
        className="rf-search"
        aria-label="搜索 Finding"
        placeholder="搜索描述或类别"
        value={search}
        onChange={e => setSearch(e.target.value)}
      />
      <div className="rf-findings-scroll">
        {filtered.map(finding => {
          const number = context.findings.indexOf(finding) + 1,
            links = context.links.filter(l => l.findingId === finding.id);
          const hints = observations.filter(o => o.findingId === finding.id),
            open = !collapsed.has(finding.id);
          return (
            <article
              key={finding.id}
              className={`rf-card ${activeFinding === finding.id ? 'rf-active' : ''}`}
              data-finding-id={finding.id}
            >
              <div className="rf-card-header">
                <button
                  aria-label={`${open ? '收起' : '展开'} F${number}`}
                  aria-expanded={open}
                  onClick={() =>
                    setCollapsed(previous => {
                      const n = new Set(previous);
                      n.has(finding.id) ? n.delete(finding.id) : n.add(finding.id);
                      return n;
                    })
                  }
                >
                  {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                </button>
                <button
                  className="rf-finding-title"
                  onClick={() => selectFinding(finding)}
                >
                  <strong>F{number}</strong>
                  <span>
                    {finding.category
                      ? `${finding.category} · ${categories[finding.category] || ''}`
                      : '未分类'}
                  </span>
                </button>
                <small>E · {links.length}</small>
                <button
                  className="rf-icon"
                  aria-label={`复制 F${number} 描述`}
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(finding.text);
                      setNotice(`已复制 F${number}`);
                    } catch {
                      setNotice('复制失败，请手动选择描述文字。');
                    }
                  }}
                >
                  <Copy size={13} />
                </button>
              </div>
              <button
                className="rf-description"
                onClick={() => selectFinding(finding)}
              >
                {finding.text}
              </button>
              {open && (
                <div className="rf-card-body">
                  {hints.length > 0 && (
                    <div className="rf-hints">
                      <small>报告提示</small>
                      {hints.map(renderObservation)}
                    </div>
                  )}
                  {selected && hints.some(o => o.id === selected.id) && renderObservationDetails()}
                  {links.map(link => {
                    const entity = context.entities.find(e => e.id === link.entityId);
                    return entity && renderEntity(entity, link);
                  })}
                  {!links.length && <p className="rf-caption">尚无 Entity mask</p>}
                  <div className="rf-actions">
                    <button
                      disabled={busy}
                      onClick={() => onAddEntity(finding.id)}
                    >
                      <Plus size={13} />
                      新增 Entity 并绘制
                    </button>
                  </div>
                  {activeFinding === finding.id && (
                    <div className="rf-actions">
                      <select
                        aria-label={`F${number} 关联已有 Entity`}
                        value={sharedEntity}
                        onChange={e => setSharedEntity(e.target.value)}
                      >
                        <option value="">选择共享 Entity…</option>
                        {context.entities.map(e => (
                          <option
                            key={e.id}
                            value={e.id}
                          >
                            E{entityNumber(e)} · {e.name}
                          </option>
                        ))}
                      </select>
                      <button
                        disabled={busy || !sharedEntity}
                        onClick={() => onLink(finding.id, sharedEntity)}
                      >
                        关联
                      </button>
                    </div>
                  )}
                  <details className="rf-metadata">
                    <summary>修改 Finding 类别</summary>
                    <select
                      aria-label={`Finding ${number} 类别`}
                      disabled={busy}
                      value={finding.category || ''}
                      onChange={e => onCategory(finding.id, e.target.value || null)}
                    >
                      <option value="">未分类</option>
                      {Object.entries(categories).map(([code, name]) => (
                        <option
                          key={code}
                          value={code}
                        >
                          {code} · {String(name)}
                        </option>
                      ))}
                    </select>
                  </details>
                </div>
              )}
            </article>
          );
        })}
        {!context.findings.length && (
          <p className="rf-empty">
            没有可直接标注的 Finding。请结合原文、其他报告提示和拒绝项检查，或选取原文补充。
          </p>
        )}
        {context.findings.length > 0 && !filtered.length && (
          <p className="rf-empty">没有匹配的 Finding。</p>
        )}
      </div>
      {extraObservations.length > 0 && (
        <details className="rf-extra">
          <summary>其他报告提示 · {extraObservations.length}</summary>
          <p className="rf-caption">包含摘要或仅语义的观察，模型没有将其直接转为 Finding。</p>
          <div className="rf-hints">{extraObservations.map(renderObservation)}</div>
          {selected && !selected.findingId && renderObservationDetails()}
        </details>
      )}
      {extraction?.rejected.length > 0 && (
        <details className="rf-rejected">
          <summary>提取问题 · {extraction.rejected.length} 条</summary>
          <p className="rf-caption">
            以下内容被规则拒绝，并不表示原文没有异常；可定位原文补充 Finding。
          </p>
          {extraction.rejected.map(item => (
            <div
              key={item.id}
              className="rf-rejection"
            >
              <strong>
                {item.term || '提取项'}
                {item.category ? ` · ${item.category}` : ''}
              </strong>
              <small>{rejectionText(item.reason)}</small>
              <p>{item.quote || '没有可精确定位的原文引用。'}</p>
              {item.evidenceIds.length > 0 && (
                <button onClick={() => focus(item.evidenceIds[0])}>定位问题原文</button>
              )}
            </div>
          ))}
        </details>
      )}
      {notice && <small role="status">{notice}</small>}
    </section>
  );
}
