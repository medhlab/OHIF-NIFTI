import React from 'react';

/** Terminology proposals never create Findings or spatial Entities. */
export default function OntologyMappings({ concept, title = 'Ontology 映射', onEvidence = undefined }) {
  const mappings = concept?.mappings || [];
  const partials = concept?.partialMappings || [];
  const states = { unmapped: '未映射', invalid_code: '编码不在索引中', wrong_domain: '编码类型不匹配',
    not_applicable: '不适用', candidate: '等价候选', partial: '部分映射' };
  const entry = (m, i, partial = false) => <article key={`${m.system}:${m.code}:${i}`} data-ontology-partial={partial || undefined}>
    <p>{m.label || '未提供标准名称'} · <code>{m.system} / {m.code}</code></p>
    {partial && <>
      <p>已覆盖部分：<mark>{m.coverage?.coveredText}</mark></p>
      <p>此编码未覆盖：{m.coverage?.uncoveredText || '未提供覆盖明细'}</p>
    </>}
    <p>{partial ? '组成部分候选，未代表整项词义' : '等价候选'}
      {' · '}{m.humanConfirmed === true ? '来源声明人工确认' : '未经人工确认'}</p>
    <details><summary>编码验证与映射依据</summary>
      <p>索引校验：{m.indexValidated === true ? '编码存在及类型检查通过' : m.indexValidated === false ? '未通过' : '未提供'}
        {' · '}检索记录：{m.retrievedInToolHistory === true ? '有命中' : m.retrievedInToolHistory === false ? '无命中' : '未提供'}</p>
      <p>方法：{m.method || '未提供'} · 版本：{m.indexEdition || m.version || m.edition || '未提供'}</p>
      {m.semanticAssessment?.contextEvidence && <p>限定依据原句：{m.semanticAssessment.contextEvidence}</p>}
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{JSON.stringify(m, null, 2)}</pre>
    </details>
  </article>;
  return <section aria-label={title} className="rf-ontology">
    <strong>{title} · {states[concept?.mappingState] || (mappings.length ? '候选' : '未提供映射')}</strong>
    <p>来源词面：{concept?.surfaceText || concept?.text || '未提供'}</p>
    {!mappings.length && !partials.length && <p>尚无可用编码；原词与证据保留。</p>}
    {partials.length > 0 && <p>仅覆盖下列组成部分，其余信息仍未映射；这些编码不构成已校验的 SNOMED 组合表达。</p>}
    {concept?.mappingReason && <p>映射依据：{concept.mappingReason}</p>}
    {mappings.map((m, i) => entry(m, i))}
    {partials.map((m, i) => entry(m, i, true))}
    {onEvidence && (concept?.mappingEvidenceIds || []).map(id => onEvidence(id))}
    {!!concept?.mappingCandidates?.length && <details><summary>检索候选与评分</summary>
      <pre style={{ whiteSpace:'pre-wrap', overflowWrap:'anywhere' }}>{JSON.stringify(concept.mappingCandidates, null, 2)}</pre>
    </details>}
    {(mappings.length > 0 || partials.length > 0) && <p className="rf-caption">未经人工确认；映射不改变 Finding 分类、Entity 关联或 mask。</p>}
  </section>;
}
