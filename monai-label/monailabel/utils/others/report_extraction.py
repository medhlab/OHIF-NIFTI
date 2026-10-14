"""Import a cached lesion_harvest result without rerunning or reinterpreting the model."""
import hashlib
import json
from . import annotation_domain as domain


def normalize_result(source, result, run_id):
    def invalid(message): domain.fail('INVALID_REPORT_EXTRACTION', message)
    if not isinstance(source, dict) or not isinstance(result, dict): invalid('报告原文和模型结果须为对象。')
    run_id = domain.text(run_id, 200)
    if not isinstance(source.get('name'), str) or source['name'] != result.get('volumeName'):
        invalid('模型结果与报告体积标识不一致。')
    sections = {k: source.get(k, '') for k in ('findings', 'impressions')}
    if any(not isinstance(v, str) or len(v) > 100000 for v in sections.values()): invalid('报告章节无效。')
    if not isinstance(result.get('reportSha256'), dict) or not isinstance(result.get('counts'), dict): invalid('报告校验和统计字段无效。')
    for key in ('crossSectionCandidates', 'heldImpressionMentionIds'):
        if not isinstance(result.get(key), list) or len(result[key]) > 1000: invalid('报告关系或摘要数组无效。')
    if not isinstance(result.get('reportContext'), dict) or not isinstance(result['reportContext'].get('relations'), list): invalid('报告上下文无效。')
    for key, value in sections.items():
        if hashlib.sha256(value.encode()).hexdigest() != result.get('reportSha256', {}).get(key):
            invalid('报告原文哈希与模型处理输入不一致。')
    report = {'id': domain.identity(), 'version': 1, 'name': 'CT-RATE 原始报告', 'sections': []}
    section_ids = {}
    for name, text in sections.items():
        section_id = domain.identity(); section_ids[name] = section_id
        report['sections'].append({'id': section_id, 'name': 'Findings' if name == 'findings' else 'Impressions',
                                  'text': text, 'textSha256': hashlib.sha256(text.encode()).hexdigest()})
    evidence, span_ids = [], {}

    def span_id(span):
        if not isinstance(span, dict): invalid('模型证据缺少精确原文范围。')
        name, start, end, quote = (span.get(k) for k in ('reportSection', 'start', 'end', 'text'))
        if (name not in sections or type(start) is not int or type(end) is not int
                or not 0 <= start < end <= len(sections[name]) or sections[name][start:end] != quote):
            invalid('模型证据与报告原文范围不一致。')
        key = (name, start, end)
        if key not in span_ids:
            eid = domain.identity(); span_ids[key] = eid
            evidence.append({'id': eid, 'reportId': report['id'], 'reportVersion': 1, 'sectionId': section_ids[name],
                             'start': start, 'end': end, 'quote': quote})
        return span_ids[key]

    mentions, seeds = result.get('mentions'), result.get('lesions')
    rejected = result.get('rejectedMentions')
    if any(not isinstance(v, list) or len(v) > 1000 for v in (mentions, seeds, rejected)):
        invalid('模型提取数组无效。')
    observations, observation_ids = [], set()
    for mention in mentions:
        if not isinstance(mention, dict): invalid('报告观察无效。')
        if any(mention.get(k) is not None and not isinstance(mention[k], str) for k in ('term', 'text', 'anatomy', 'observationType', 'section')):
            invalid('报告观察文本字段无效。')
        if not isinstance(mention.get('groundingDecision', {}), dict): invalid('定位提示字段无效。')
        oid = domain.text(mention.get('mentionId'), 200)
        if oid in observation_ids: invalid('报告观察 ID 重复。')
        observation_ids.add(oid)
        code = mention.get('categoryCode') or None
        if code is not None and code not in domain.CATEGORIES: invalid('通过规则检查的报告观察类别无效。')
        assertion = mention.get('certainty', 'unknown')
        if assertion not in ('definite', 'uncertain', 'negated', 'unknown'): invalid('报告确定性无效。')
        observations.append({'id': oid, 'term': mention.get('term') or '', 'text': mention.get('text') or '',
                             'category': code, 'anatomy': mention.get('anatomy') or '', 'assertion': assertion,
                             'observationType': mention.get('observationType') or '',
                             'evidenceIds': [span_id(mention.get('sourceReportSpan'))],
                             'section': mention.get('section'), 'groundingDecision': mention.get('groundingDecision') or {},
                             'heldImpression': oid in result.get('heldImpressionMentionIds', []), 'findingId': None})
    findings, seed_ids = [], set()
    by_id = {o['id']: o for o in observations}
    for seed in seeds:
        if not isinstance(seed, dict): invalid('Finding 候选无效。')
        sid = domain.text(seed.get('sourceFindingId'), 200)
        oid = seed.get('originMentionId')
        if sid in seed_ids or oid not in by_id: invalid('Finding 候选引用无效或重复。')
        seed_ids.add(sid)
        if seed.get('categoryCode') not in domain.CATEGORIES: invalid('Finding 候选类别无效。')
        fid = domain.identity()
        findings.append({'id': fid, 'text': domain.text(seed.get('text')), 'category': seed['categoryCode'],
                         'evidenceIds': [span_id(seed.get('sourceReportSpan'))], 'assertion': by_id[oid]['assertion'],
                         'origin': 'model', 'sourceFindingId': sid, 'observationIds': [oid], 'extractionRunId': run_id})
        by_id[oid]['findingId'] = fid
    relations = []
    if any(not isinstance(oid, str) or oid not in by_id for oid in result['heldImpressionMentionIds']): invalid('暂存摘要引用无效。')
    for relation in result.get('crossSectionCandidates', []):
        if not isinstance(relation, dict): invalid('跨章节提示无效。')
        source_id, target_id = relation.get('findingsMentionId'), relation.get('impressionsMentionId')
        if not isinstance(source_id, str) or not isinstance(target_id, str) or source_id not in by_id or target_id not in by_id: invalid('跨章节提示引用不存在的观察。')
        if any(not isinstance(relation.get(k, []), list) or any(not isinstance(i, str) for i in relation.get(k, [])) for k in ('warnings', 'signals')): invalid('跨章节提示信息无效。')
        relations.append({'type': 'same_observation', 'sourceIds': [source_id], 'targetIds': [target_id],
                          'warnings': relation.get('warnings', []), 'signals': relation.get('signals', []), 'status': 'needs_review'})
    for relation in result.get('reportContext', {}).get('relations', []):
        if not isinstance(relation, dict): invalid('报告上下文关系无效。')
        source_ids, target_ids = relation.get('sourceMentionIds', []), relation.get('targetMentionIds', [])
        if not isinstance(source_ids, list) or not isinstance(target_ids, list) or any(not isinstance(oid, str) or oid not in by_id for oid in source_ids + target_ids): invalid('报告上下文引用不存在的观察。')
        relations.append({'type': relation.get('relationType'), 'sourceIds': source_ids, 'targetIds': target_ids,
                          'warnings': [], 'signals': [], 'status': 'needs_review',
                          'evidenceIds': [span_id(s) for s in relation.get('evidenceSpans', [])]})
    rejected_items = []
    for index, item in enumerate(rejected):
        if not isinstance(item, dict): invalid('拒绝项无效。')
        raw = item.get('rawMention')
        raw_index = item.get('index')
        if raw is None and type(raw_index) is int and 0 <= raw_index < len(result.get('rawModelMentions', [])):
            raw = result['rawModelMentions'][raw_index]
        if not isinstance(raw, dict): raw = {}
        quote = raw.get('source_text', ''); name = raw.get('section')
        if not isinstance(quote, str): quote = ''
        if not isinstance(name, str): name = None
        ids = []
        if item.get('sourceReportSpan'):
            ids = [span_id(item['sourceReportSpan'])]; quote = item['sourceReportSpan']['text']
        elif isinstance(quote, str) and quote and name in sections:
            start = sections[name].find(quote)
            # A repeated quote without a supplied offset is ambiguous, so leave it unlocated.
            if start >= 0 and sections[name].find(quote, start + 1) < 0:
                ids = [span_id({'reportSection': name, 'start': start, 'end': start + len(quote), 'text': quote})]
        rejected_items.append({'id': f'rejected-{index}', 'reason': str(item.get('reason') or 'unknown'), 'term': str(raw.get('term') or ''),
                               'category': str(raw.get('category_code') or ''), 'quote': quote, 'anatomy': str(raw.get('anatomy') or ''),
                               'evidenceIds': ids})
    counts = {'acceptedMentions': len(observations), 'rejectedMentions': len(rejected_items),
              'proposedLesions': len(findings), 'crossSectionCandidates': len(result.get('crossSectionCandidates', [])),
              'heldImpressionMentions': sum(o['heldImpression'] for o in observations)}
    if any(type(v) is not int for v in result['counts'].values()) or counts != result['counts']: invalid('模型结果计数与内容不一致。')
    return report, evidence, findings, {'runId': run_id, 'producer': result.get('modelName'),
        'processingVersion': result.get('processingVersion'), 'volumeName': source['name'],
        'sharedReportHash': result.get('sharedReportHash'), 'reportId': report['id'], 'counts': counts,
        'observations': observations, 'relations': relations, 'rejected': rejected_items,
        'terminologyMapping': result.get('terminologyMapping'),
        'inputSha256': hashlib.sha256(json.dumps({'source': source, 'result': result}, ensure_ascii=False, sort_keys=True).encode()).hexdigest()}


def import_result(case, payload, external_key=None):
    if case.get('reportExtraction'):
        domain.fail('REPORT_EXTRACTION_EXISTS', '此病例已有模型结果；本轮导入不覆盖已有结果或人工修改。', 409)
    report, evidence, findings, extraction = normalize_result(payload.get('reportSource'), payload.get('result'), payload.get('runId'))
    name = extraction['volumeName'].removesuffix('.nii.gz').removesuffix('.nii')
    if external_key is not None and external_key != name:
        domain.fail('REPORT_CASE_MISMATCH', '模型报告不属于当前清单病例。')
    case['reports'].append(report); case['evidence'].extend(evidence); case['findings'].extend(findings)
    case['reportExtraction'] = extraction


def observation_bindings(case, ids):
    if not isinstance(ids, list) or any(not isinstance(i, str) for i in ids) or len(ids) != len(set(ids)):
        domain.fail('INVALID_OBSERVATION_LINKS', '报告观察引用须为不重复的数组。')
    extraction = case.get('reportExtraction') or {}
    by_id = {o['id']: o for o in extraction.get('observations', [])}
    if any(oid not in by_id for oid in ids): domain.fail('INVALID_OBSERVATION_LINKS', '报告观察不属于当前病例。')
    return [{'observationId': oid, 'runId': extraction['runId'], 'term': by_id[oid]['term'],
             'anatomy': by_id[oid]['anatomy'], 'assertion': by_id[oid]['assertion']} for oid in ids]
