import React from 'react';
import OntologyMappings from './OntologyMappings';
import { assertionText, relationText } from './reportPresentation';

/** Read-only source semantics. Categories, concepts and spatial Entities stay separate. */
export default function CaseV2Report({ context, onEvidence, onFinding }) {
  const extraction = context.caseV2Extraction;
  if (!extraction) return null;
  const payload = extraction.sourcePayload;
  const overlay = context.caseV2Ontology?.sourceInputSha256 === extraction.inputSha256
    ? context.caseV2Ontology.sourcePayload : null;
  const mapped = new Map<string, any>((overlay?.items || []).map(item => [item.key, item]));
  const conceptView = (concept, key) => {
    const item = mapped.get(key);
    return item ? { ...concept, mappings: item.mappings, mappingState: item.state,
      mappingReason: item.reason, mappingCandidates: item.candidates, partialMappings: item.partialMappings,
      decisionStrategy: item.decisionStrategy, mappingEvidenceIds: item.evidenceIds } : concept;
  };
  const observation = new Map<string, any>(extraction.observations.map(o => [o.id, o]));
  const sourceEvidence = new Map<string, any>(payload.evidence.map(e => [e.id, e]));
  const evidenceButton = id => {
    const e = sourceEvidence.get(id);
    return e && <button key={id} type="button" className="rf-hint"
      onClick={() => onEvidence(extraction.sourceIdMap.evidence[id])}>{e.text}</button>;
  };
  return <details className="rf-extra" open>
    <summary>报告观察 · {extraction.observations.length}（case-v2）</summary>
    <p className="rf-caption">报告提取提示，未经医师确认。观察和概念不代表独立空间病灶；可选取原文补充 Finding。</p>
    {extraction.observations.map(o => <details key={o.id} data-case-v2-observation={o.id}>
      <summary>{o.term} · {assertionText(o.assertion)} · {o.section}</summary>
      <p>{o.text}</p>
      <div>{o.evidenceIds.map(id => <button type="button" key={id} onClick={() => onEvidence(id)}>定位原文</button>)}</div>
      <p>{o.anatomy || '未提供部位'} · 时间：{({current:'当前', historical:'既往', comparison:'比较', unknown:'未说明'})[o.temporal.value]}</p>
      {(o.temporal.statements || []).map(s => <div key={s.id}>
        <small>时间陈述 · {s.status === 'ambiguous' ? '归属待核对' : '提取提示'}</small>
        <p>{s.text}</p>{s.evidenceIds.map(evidenceButton)}
      </div>)}
      {o.temporal.change && <div>时间变化提示：{o.temporal.change.value}{o.temporal.change.evidenceIds.map(evidenceButton)}</div>}
      {o.source.attributes.map((a, i) => <div key={i}>{a.kind}：{a.text}{a.evidenceIds.map(evidenceButton)}</div>)}
      {o.findingIds.map(id => <button type="button" key={id} onClick={() => onFinding(context.findings.find(f => f.id === id))}>查看关联 Finding</button>)}
      {payload.labelAssignments.filter(l => l.subjectId === o.id).map((l, i) => <p key={i}>归档标签（未验证）：{l.labelSetId} / {l.labelId}</p>)}
      <OntologyMappings concept={conceptView(o.source.concept, o.id)} onEvidence={evidenceButton} />
      {o.source.anatomy.map((a, i) => <div key={i}>
        <OntologyMappings title={`解剖映射 · ${a.text}`} concept={conceptView(a, `${o.id}/anatomy/${i}`)} onEvidence={evidenceButton} />
        {(a.evidenceIds || []).map(evidenceButton)}
      </div>)}
      {extraction.relations.filter(r => [...r.sourceIds, ...r.targetIds].includes(o.id)).map(r => <div key={r.id}>
        <small>{relationText(r.type)} · 提议，未合并对象</small>
        <p>{r.sourceIds.map(id => observation.get(id)?.term || id).join('、')} → {r.targetIds.map(id => observation.get(id)?.term || id).join('、')}</p>
        {r.evidenceIds.map(id => <button type="button" key={id} onClick={() => onEvidence(id)}>定位关系证据</button>)}
      </div>)}
    </details>)}
    {(extraction.temporalGroups || []).map(g => <div key={g.id} data-temporal-group={g.id}>
      <strong>整组时间陈述（未分配成员变化标签）</strong>
      <p>成员：{g.observationIds.map(id => observation.get(id)?.term || id).join('、')}</p>
      {g.evidenceIds.map(id => <button type="button" key={id} onClick={() => onEvidence(id)}>{context.evidence.find(e => e.id === id)?.quote}</button>)}
    </div>)}
    {overlay && <details><summary>Ontology 映射批次与完整记录（只读）</summary>
      <p>索引版次：{overlay.indexEdition || '未知'} · 候选结果，未经医师确认</p>
      <pre style={{whiteSpace:'pre-wrap', overflowWrap:'anywhere'}}>{JSON.stringify(overlay, null, 2)}</pre>
    </details>}
    {!!context.caseV2OntologyHistory?.length && <details><summary>历史 Ontology 版本 · {context.caseV2OntologyHistory.length}（只读）</summary>
      <p>旧候选、索引来源和原始模型回答保留；版本更新不改变人工标注。</p>
      <pre style={{whiteSpace:'pre-wrap', overflowWrap:'anywhere'}}>{JSON.stringify(context.caseV2OntologyHistory, null, 2)}</pre>
    </details>}
    <details><summary>来源与完整提取记录（只读）</summary>
      <p>额外语义、原始模型回答和审核修正来源完整保留，未应用到 Entity 或 mask。审核修正不表示医师确认。</p>
      <pre style={{whiteSpace:'pre-wrap', overflowWrap:'anywhere'}}>{JSON.stringify(payload, null, 2)}</pre>
    </details>
  </details>;
}
