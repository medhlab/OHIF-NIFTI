/** Evidence offsets use Unicode code points. Overlapping spans never duplicate text. */
export function reportSegments(text, evidence, findings, focusedId) {
  const points = Array.from(text);
  const valid = evidence.filter(
    e =>
      Number.isInteger(e.start) &&
      Number.isInteger(e.end) &&
      e.start >= 0 &&
      e.start < e.end &&
      e.end <= points.length &&
      points.slice(e.start, e.end).join('') === e.quote
  );
  const boundaries = [...new Set([0, points.length, ...valid.flatMap(e => [e.start, e.end])])].sort(
    (a: number, b: number) => a - b
  );
  return boundaries.slice(0, -1).map((start: number, index) => {
    const end = boundaries[index + 1] as number;
    const spans = valid.filter(e => e.start <= start && e.end >= end);
    return {
      start,
      text: points.slice(start, end).join(''),
      evidenceIds: spans.map(e => e.id),
      findingIds: findings
        .filter(f => spans.some(e => f.evidenceIds.includes(e.id)))
        .map(f => f.id),
      focused: spans.some(e => e.id === focusedId),
    };
  });
}

export const assertionText = assertion =>
  ({ definite: '明确描述', uncertain: '不确定', negated: '阴性', unknown: '未说明' })[assertion] ||
  '未说明';
export const rejectionText = reason =>
  ({
    invalid_mention_fields: '类别或字段格式不合法',
    negation_needs_review: '否定规则拦截，需核对作用域',
    negated: '否定描述',
    source_text_not_found: '无法精确匹配原文',
    source_quote_not_exact: '引用不是精确原文',
    invalid_source_span: '原文范围无效',
  })[reason] || reason;
export const relationText = type =>
  ({
    same_observation: '可能同一观察',
    summarizes: '摘要提示',
    adjacent_to: '相邻',
    associated_with: '相关',
    located_in: '位于',
    caused_by: '原因提示',
    supports: '支持',
    co_occurs_with: '共同出现',
    suggestive_of: '提示可能诊断',
    anatomy_reference: '部位参照',
    compared_to: '对比描述',
  })[type] || type;
export const warningText = warning =>
  ({
    anatomy_not_exact: '部位不完全一致',
    observation_type_differs: '观察类型不同',
    laterality_conflict: '左右侧冲突',
    size_conflict: '尺寸存在差异',
    anatomy_missing: '缺少部位信息',
    laterality_scope_differs: '左右侧范围不同',
    certainty_differs: '确定性不同',
  })[warning] || warning;
