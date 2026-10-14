// Translate known server UI messages only. Report text and user-entered names stay verbatim.
const messages = {
  '还有病灶尚未保存非空 mask。': '还有 Entity 尚未保存非空 mask。',
  '此 mask 必须通过病灶标注上下文保存。': '此 mask 必须通过 Entity 标注上下文保存。',
  '病灶主 mask 已变化，请刷新。': 'Entity 主 mask 已变化，请刷新。',
  '一个病灶只允许一份二值 mask。': '一个 Entity 只允许一份二值 mask。',
};
export function annotationErrorMessage(detail, fallback: string) {
  const text = typeof detail === 'string' ? detail : detail?.message;
  return typeof text === 'string' ? messages[text] || text : fallback;
}
