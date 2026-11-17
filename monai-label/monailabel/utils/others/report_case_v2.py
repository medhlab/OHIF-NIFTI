"""Lossless, additive case-v2 ingestion. No inference, label projection or masks."""
import copy
import json
from . import annotation_domain as domain
from .case_v2_contract.case_contract import VERSION, digest, validate_case

ADAPTER_VERSION = 'ohif.case-v2/read-only-v1'


def validate(source, result):
    try:
        validate_case(result)
        domain.text(result['volumeName'], 200)
        if not isinstance(source, dict) or source.get('name') != result['volumeName']:
            raise ValueError('Volume identity mismatch')
        for section, report in result['reports'].items():
            if source.get(section, '') != report['text'] or len(report['text']) > 100000:
                raise ValueError('Source report mismatch or too large')
        for key in ('evidence', 'observations', 'relations', 'labelAssignments', 'rejectedMentions', 'issues'):
            if not isinstance(result[key], list) or len(result[key]) > 10000:
                raise ValueError('Invalid collection: ' + key)
        if not isinstance(result['provenance'], dict) or not isinstance(result['legacyIdMap'], dict):
            raise ValueError('Invalid provenance or legacy ID map')
        for observation in result['observations']:
            for field in ('anatomy', 'attributes'):
                if not isinstance(observation[field], list) or any(
                        not isinstance(v.get('text'), str) for v in observation[field]):
                    raise ValueError('Invalid observation display fields')
        for relation in result['relations']:
            if any(not isinstance(relation[k], list) for k in ('sourceIds', 'targetIds', 'evidenceIds')):
                raise ValueError('Invalid relation reference arrays')
        # Upstream validates clinical contract; additionally constrain all IDs and
        # recursively check evidence references, including optional extensions.
        evidence = {e['id'] for e in result['evidence']}
        def walk(value):
            if isinstance(value, dict):
                if 'evidenceIds' in value:
                    ids = value['evidenceIds']
                    if not isinstance(ids, list) or any(not isinstance(i, str) or i not in evidence for i in ids):
                        raise ValueError('Dangling evidence reference')
                for v in value.values(): walk(v)
            elif isinstance(value, list):
                for v in value: walk(v)
        for key in ('observations', 'relations', 'temporalGroups', 'semanticDetails'):
            walk(result.get(key))
        for key in ('evidence', 'observations', 'relations', 'temporalGroups'):
            for value in result.get(key, []):
                if not isinstance(value['id'], str) or not value['id'] or len(value['id']) > 200:
                    raise ValueError('Invalid source ID')
        # Reject JSON values that cannot be persisted portably.
        json.dumps(result, allow_nan=False)
    except (ValueError, KeyError, TypeError, IndexError, AttributeError, OverflowError) as error:
        domain.fail('INVALID_CASE_V2', 'case-v2 校验失败：' + str(error))


def import_case_v2(case, payload, external_key=None):
    source, result = payload.get('reportSource'), payload.get('result')
    validate(source, result)
    run_id = domain.text(payload.get('runId'), 200)
    name = result['volumeName'].removesuffix('.nii.gz').removesuffix('.nii')
    if external_key is not None and external_key != name:
        domain.fail('REPORT_CASE_MISMATCH', '模型报告不属于当前清单病例。')
    fingerprint = digest({'source': source, 'result': result})
    prior = case.get('caseV2Extraction')
    if prior:
        if prior['inputSha256'] == fingerprint:
            return False
        domain.fail('CASE_V2_UPDATE_CONFLICT', '已有 case-v2 快照。报告或提取更新须显式对齐与审阅；未覆盖人工修改。', 409)
    legacy = case.get('reportExtraction')
    report = None
    if legacy:
        report = next((r for r in case['reports'] if r['id'] == legacy['reportId']), None)
        actual = {s['name'].lower(): s['text'] for s in report['sections']} if report else {}
        if actual != {k: v['text'] for k, v in result['reports'].items()} or legacy['volumeName'] != result['volumeName']:
            domain.fail('CASE_V2_REPORT_CONFLICT', '现有报告与 case-v2 原文不同；需审阅报告版本对齐。', 409)
    new_report = report is None
    if new_report:
        report = {'id': domain.identity(), 'version': 1, 'name': 'case-v2 原始报告', 'sections': [
            {'id': domain.identity(), 'name': key.title(), 'text': value['text'], 'textSha256': value['sha256']}
            for key in ('findings', 'impressions') for value in [result['reports'][key]]]}
    sections = {s['name'].lower(): s['id'] for s in report['sections']}
    evidence, evidence_map = [], {}
    for span in result['evidence']:
        eid = domain.identity()
        evidence_map[span['id']] = eid
        evidence.append({'id': eid, 'sourceEvidenceId': span['id'], 'reportId': report['id'],
            'reportVersion': report['version'], 'sectionId': sections[span['section']],
            'start': span['start'], 'end': span['end'], 'quote': span['text'], 'offsetUnit': 'unicode-code-point'})
    by_evidence = {e['id']: e for e in result['evidence']}
    def order(o):
        e = by_evidence[o['sentenceEvidenceId']]
        return (('findings', 'impressions').index(e['section']), e['start'], e['end'])
    observations, bindings = [], {}
    for o in sorted(result['observations'], key=order):
        old_ids = [old for old, new in result['legacyIdMap'].items() if new == o['id']]
        # Only explicit legacy identities may link an existing Finding. No new
        # Finding, category, physical instance or spatial linkage is inferred.
        fids = [f['id'] for f in case['findings'] if legacy and f.get('extractionRunId') == legacy['runId']
                and set(f.get('observationIds', [])).intersection(old_ids)]
        bindings[o['id']] = {'sourceObservationId': o['id'], 'sourceRevision': o['revision'],
                            'legacyMentionIds': old_ids, 'findingIds': fids}
        observations.append({'id': o['id'], 'term': o['concept']['text'], 'text': o['text'], 'category': None,
            'anatomy': ' · '.join(a['text'] for a in o['anatomy']), 'assertion': o['assertion']['value'],
            'observationType': o['observationType'], 'section': by_evidence[o['sentenceEvidenceId']]['section'],
            'evidenceIds': [evidence_map[i] for i in dict.fromkeys([o['sentenceEvidenceId']] + o['evidenceIds'])],
            'findingId': fids[0] if len(fids) == 1 else None, 'findingIds': fids,
            'groundingDecision': {'status': 'semantic_only'}, 'heldImpression': False,
            'temporal': copy.deepcopy(o['temporal']), 'source': copy.deepcopy(o)})
    relations = [dict(copy.deepcopy(r), evidenceIds=[evidence_map[i] for i in r['evidenceIds']], warnings=[], signals=[])
                 for r in result['relations']]
    groups = [dict(copy.deepcopy(g), evidenceIds=[evidence_map[i] for i in g['evidenceIds']])
              for g in result.get('temporalGroups', [])]
    extraction = {'schemaVersion': VERSION, 'adapterVersion': ADAPTER_VERSION, 'runId': run_id,
        'sourceCaseId': result['caseId'], 'volumeName': result['volumeName'], 'reportId': report['id'],
        'inputSha256': fingerprint, 'offsetUnit': 'unicode-code-point', 'observations': observations,
        'relations': relations, 'temporalGroups': groups, 'rejected': [],
        'counts': {'observations': len(observations), 'temporalGroups': len(groups),
                   'relations': len(relations), 'newFindings': 0},
        'sourceIdMap': {'evidence': evidence_map, 'observations': bindings},
        'retention': {'mode': 'complete-source-snapshot', 'automaticFindingProjection': False,
                      'additionalSemantics': 'preserved-read-only-not-applied-to-spatial-entities'},
        'sourcePayload': copy.deepcopy(result), 'reportSource': copy.deepcopy(source)}
    # All validation and projection precedes mutation; existing objects untouched.
    if new_report: case['reports'].append(report)
    case['evidence'].extend(evidence)
    case['caseV2Extraction'] = extraction
    return True
