"""Hash-bound terminology versions, independent of manual and spatial objects."""
import copy
import json
import re
from . import annotation_domain as domain
from .case_v2_contract.case_contract import digest

VERSION = 'lesion-harvest.ontology-overlay/v1'
VERSION_V2 = 'lesion-harvest.ontology-overlay/v2'


def require(condition):
    if not condition:
        raise ValueError('Invalid ontology overlay')


def validate_mapping(mapping, candidates, overlay):
    require(mapping['system'] == 'SNOMED_CT' and mapping['status'] == 'candidate')
    candidate = candidates.get(mapping['code'])
    require(candidate is not None and mapping['label'] == candidate['label'])
    require(mapping['humanConfirmed'] is False and mapping['indexValidated'] is True)
    require(mapping['indexSha256'] == overlay['indexSha256'])


def import_ontology(case, payload):
    overlay = payload.get('ontology')
    extraction = case.get('caseV2Extraction')
    if not extraction:
        domain.fail('CASE_V2_REQUIRED', '请先导入原 case-v2 快照。', 409)
    try:
        require(isinstance(overlay, dict) and overlay['schemaVersion'] in {VERSION, VERSION_V2})
        v2 = overlay['schemaVersion'] == VERSION_V2
        require(overlay['sourceSha256'] == digest(extraction['sourcePayload']))
        require(re.fullmatch('[0-9a-f]{64}', overlay['indexSha256']))
        require(len(json.dumps(overlay, allow_nan=False)) < 5000000)
        expected = {}
        for obs in extraction['sourcePayload']['observations']:
            expected[obs['id']] = dict(text=obs['concept']['text'], kind='observation',
                                       sentence=obs['text'], evidenceIds=obs['evidenceIds'])
            for i, anatomy in enumerate(obs['anatomy']):
                expected[obs['id'] + '/anatomy/' + str(i)] = dict(text=anatomy['text'], kind='anatomy',
                    sentence=obs['text'], evidenceIds=anatomy['evidenceIds'])
        items = overlay['items']
        require(isinstance(items, list) and len(items) == len(expected))
        require(len({x['key'] for x in items}) == len(items))
        for item in items:
            require(item['key'] in expected)
            source = expected[item['key']]
            require(item['text'] == source['text'])
            require(item['state'] in ({'candidate', 'partial', 'unmapped'} if v2 else {'candidate', 'unmapped'}))
            require(isinstance(item['reason'], str) and 0 < len(item['reason']) <= 4000)
            require(isinstance(item['candidates'], list) and len(item['candidates']) <= 20)
            candidates = {}
            for candidate in item['candidates']:
                require(isinstance(candidate['code'], str) and candidate['code'].isdigit())
                require(isinstance(candidate['label'], str) and candidate['label'])
                require(candidate['code'] not in candidates)
                candidates[candidate['code']] = candidate
            require(isinstance(item['mappings'], list) and len(item['mappings']) <= 1)
            require(bool(item['mappings']) == (item['state'] == 'candidate'))
            for mapping in item['mappings']:
                validate_mapping(mapping, candidates, overlay)
                if v2:
                    require(mapping['semanticAssessment']['relation'] == 'equivalent')
            if v2:
                require(item['kind'] == source['kind'] and item['sentence'] == source['sentence'])
                require(item['evidenceIds'] == source['evidenceIds'])
                partials = item['partialMappings']
                require(isinstance(partials, list) and len(partials) <= 6)
                require(bool(partials) == (item['state'] == 'partial'))
                seen = set()
                for mapping in partials:
                    validate_mapping(mapping, candidates, overlay)
                    require(mapping['semanticAssessment']['relation'] == 'partial')
                    coverage = mapping['coverage']
                    start, end = coverage['start'], coverage['end']
                    require(type(start) is int and type(end) is int and 0 <= start < end <= len(item['text']))
                    require(coverage['offsetUnit'] == 'unicode_codepoint' and coverage['textScope'] == 'item.text')
                    require(item['text'][start:end] == coverage['coveredText'])
                    require(coverage['uncoveredText'] == item['text'][:start] + item['text'][end:])
                    require(bool(coverage['uncoveredText'].strip(' ,;')))
                    require(coverage['role'] == ('anatomic_component' if source['kind'] == 'anatomy' else 'finding_component'))
                    identity = (mapping['code'], start, end)
                    require(identity not in seen)
                    seen.add(identity)
        require(overlay['humanConfirmed'] is False)
        require(isinstance(overlay['provenance'], dict))
    except (AssertionError, KeyError, TypeError, ValueError, AttributeError, OverflowError):
        domain.fail('INVALID_ONTOLOGY_OVERLAY', 'Ontology 输入、来源指纹或对象引用校验失败。')
    fingerprint = digest(overlay)
    prior = case.get('caseV2Ontology')
    if prior:
        if prior['inputSha256'] == fingerprint:
            return False
        # Explicit compare-and-swap is required in addition to the case revision.
        if not v2 or payload.get('expectedOntologySha256') != prior['inputSha256']:
            domain.fail('ONTOLOGY_UPDATE_CONFLICT', '已有映射版本；须指定当前版本指纹并审阅差异，未覆盖人工标注。', 409)
        if overlay['provenance'].get('baselineOverlaySha256') != prior['inputSha256']:
            domain.fail('ONTOLOGY_BASELINE_CONFLICT', '新结果不是基于当前映射生成，请重新比较。', 409)
        if prior['sourcePayload'].get('humanConfirmed') is not False or any(
            m.get('humanConfirmed') is not False for item in prior['sourcePayload']['items']
            for m in item.get('mappings', []) + item.get('partialMappings', [])):
            domain.fail('ONTOLOGY_HUMAN_CONFLICT', '现有映射包含人工确认，须先单独处理冲突。', 409)
        case.setdefault('caseV2OntologyHistory', []).append(copy.deepcopy(prior))
    case['caseV2Ontology'] = dict(inputSha256=fingerprint, sourceInputSha256=extraction['inputSha256'],
                                  sourcePayload=copy.deepcopy(overlay))
    return True
