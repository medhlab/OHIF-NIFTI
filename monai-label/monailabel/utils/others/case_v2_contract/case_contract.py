"""Protocol-independent report observations. No task taxonomy imports.

    python pipeline/case_contract.py path/to/case.json

Validates a persisted case without terminology indexes, models or Studio.
"""
from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path

VERSION = 'lesion-harvest.case-semantics/v2'


def digest(value):
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True,
                                     separators=(',', ':')).encode()).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def validate_case(case: dict) -> None:
    try:
        _validate_case(case)
    except (KeyError, TypeError, IndexError, AttributeError) as error:
        raise ValueError('Malformed case contract: ' + str(error)) from error


def _validate_case(case: dict) -> None:
    require(isinstance(case, dict) and case.get('schemaVersion') == VERSION, 'Unsupported case schema')
    require({'caseId', 'volumeName', 'reports', 'evidence', 'observations', 'relations', 'labelAssignments',
             'legacyIdMap', 'rawModelOutput', 'rejectedMentions', 'issues', 'provenance'} <= set(case), 'Missing root fields')
    require(isinstance(case.get('caseId'), str) and bool(case['caseId']), 'Missing case ID')
    reports = case['reports']
    require(set(reports) == {'findings', 'impressions'}, 'Invalid report sections')
    for item in reports.values():
        require(isinstance(item['text'], str), 'Invalid report text')
        require(hashlib.sha256(item['text'].encode()).hexdigest() == item['sha256'], 'Report hash mismatch')
    evidence = {e['id']: e for e in case['evidence']}
    require(len(evidence) == len(case['evidence']), 'Duplicate evidence ID')
    for span in evidence.values():
        require(span['section'] in reports, 'Invalid evidence section')
        text = reports[span['section']]['text']
        require(type(span['start']) is int and type(span['end']) is int
                and 0 <= span['start'] < span['end'] <= len(text), 'Invalid evidence offsets')
        require(text[span['start']:span['end']] == span['text'], 'Nonverbatim evidence')
    observations = {o['id']: o for o in case['observations']}
    require(len(observations) == len(case['observations']), 'Duplicate observation ID')

    def refs(ids, required=True):
        require(isinstance(ids, list) and (bool(ids) or not required)
                and all(i in evidence for i in ids), 'Missing evidence reference')

    for item in observations.values():
        require(isinstance(item['id'], str) and bool(item['id']), 'Invalid observation ID')
        require(type(item['revision']) is int and item['revision'] >= 1, 'Invalid observation revision')
        require('categoryCode' not in item and 'category_code' not in item, 'Task category leaked into observation')
        require(item['observationType'] in {'finding', 'visual_feature', 'diagnosis'}, 'Invalid observation type')
        refs(item['evidenceIds'])
        refs(item['assertion']['evidenceIds'])
        require(item['text'] == evidence[item['sentenceEvidenceId']]['text'], 'Display is not original sentence')
        require(item['assertion']['value'] in {'definite', 'uncertain', 'negated', 'unresolved'}, 'Invalid assertion')
        require(isinstance(item['concept']['text'], str) and bool(item['concept']['text'].strip()), 'Missing concept')
        require(isinstance(item['concept']['mappings'], list), 'Invalid mappings')
        for mapping in item['concept']['mappings']:
            require(isinstance(mapping['system'], str) and isinstance(mapping['code'], str)
                    and bool(mapping['code']) and mapping['status'] == 'candidate', 'Invalid concept mapping')
        require(item['temporal']['value'] in {'current', 'historical', 'comparison', 'unknown'}, 'Invalid temporal')
        from .case_temporal import validate_statements
        validate_statements(case, item, evidence)
        require(item['targetEligibility']['imageVerified'] is False, 'Report extraction cannot verify image')
        require(item['targetEligibility']['status'] in {'candidate', 'not_target', 'unresolved'}, 'Invalid target status')
        if item['assertion']['value'] in {'negated', 'unresolved'}:
            require(item['targetEligibility']['status'] != 'candidate', 'Unsafe assertion promoted to target')
        for location in item['anatomy']:
            refs(location['evidenceIds'], required=location['provenance'] != 'legacy_model_location')
        for attribute in item['attributes']:
            refs(attribute['evidenceIds'])
    require(len({r['id'] for r in case['relations']}) == len(case['relations']), 'Duplicate relation ID')
    for relation in case['relations']:
        require(relation['type'] in {'same_observation', 'summarizes', 'suggestive_of', 'adjacent_to', 'anatomy_reference', 'compared_to'}, 'Invalid relation type')
        require(relation['status'] == 'proposed', 'New relation cannot be human-confirmed')
        require(relation['sourceIds'] and relation['targetIds'], 'Missing relation endpoints')
        require(all(i in observations for i in relation['sourceIds'] + relation['targetIds']), 'Dangling relation')
        require(not set(relation['sourceIds']).intersection(relation['targetIds']), 'Self relation')
        refs(relation['evidenceIds'])
    for label in case['labelAssignments']:
        require(label['subjectId'] in observations, 'Dangling label assignment')
        require(all(isinstance(label[k], str) and label[k] for k in ('labelSetId', 'labelId', 'status')), 'Invalid label')
        require(label['status'] == 'legacy_unverified', 'Legacy labels are not new confirmed assignments')
    for old, new in case['legacyIdMap'].items():
        require(isinstance(old, str) and new in observations, 'Dangling legacy ID mapping')
    for alignment in case.get('evidenceAlignment', []):
        require(alignment['subjectId'] in observations and alignment['evidenceId'] in evidence, 'Invalid alignment references')
        observation = observations[alignment['subjectId']]
        require(observation['rawMentionIndex'] == alignment['rawMentionIndex'], 'Invalid alignment owner')
        raw_quote = case['rawModelOutput']['mentions'][alignment['rawMentionIndex']]['source_text']
        require(raw_quote == alignment['rawQuote'], 'Invalid alignment audit')
        span = evidence[alignment['evidenceId']]
        if alignment['method'] == 'initial_capitalization_restored/v1':
            from .report_alignment import initial_capitalization_span
            require(initial_capitalization_span(reports[span['section']]['text'], raw_quote) == (span['start'], span['end']), 'Invalid alignment repair')
        else:
            require(alignment['method'] == 'reviewed_verbatim_span/v1'
                    and alignment['humanConfirmed'] is False and bool(alignment['reason'])
                    and alignment['rawSha256'] == digest(case['rawModelOutput'])
                    and alignment['reportSha256'] == reports[span['section']]['sha256'], 'Invalid reviewed alignment')
    from .reviewed_temporal import validate_review
    validate_review(case)
    from .case_semantic_details import validate_details
    validate_details(case)
    from .ontology_projection_contract import validate_projection
    validate_projection(case)
    resolution = case.get('reportResolution')
    if resolution is not None:
        require(resolution['schemaVersion'] == 'lesion-harvest.report-resolution/v1'
                and resolution['caseId'] == case['caseId'], 'Invalid report resolution version or case')
        grouped, group_ids = set(), set()
        for group in resolution['groups']:
            ids = group['observationIds']
            require(isinstance(ids, list) and len(ids) == 2 and len(set(ids)) == 2
                    and all(i in observations for i in ids), 'Invalid report group endpoints')
            require(group['id'] not in group_ids and not grouped.intersection(ids), 'Duplicate report group')
            group_ids.add(group['id'])
            grouped.update(ids)
            require(group['primaryObservationId'] in ids and group['status'] == 'machine_linked'
                    and group['humanConfirmed'] is False
                    and group['scope'] == 'report_observation_not_physical_entity', 'Unsafe report group status')
            primary = observations[group['primaryObservationId']]
            require(evidence[primary['sentenceEvidenceId']]['section'] == 'findings'
                    and {evidence[observations[i]['sentenceEvidenceId']]['section'] for i in ids}
                    == {'findings', 'impressions'}, 'Invalid report group sections')
            refs(group['evidenceIds'])
            require(all(set(observations[i]['evidenceIds']) <= set(group['evidenceIds']) for i in ids),
                    'Report group lost source evidence')
        for decision in resolution['decisions']:
            ids = decision['sourceIds'] + decision['targetIds']
            require(len(ids) == 2 and len(set(ids)) == 2 and all(i in observations for i in ids),
                    'Invalid resolution endpoints')
            require(decision['status'] in {'machine_linked', 'unresolved'}
                    and decision['type'] == 'same_observation', 'Invalid resolution status')
            require(isinstance(decision['reasons'], list)
                    and bool(decision['reasons']) == (decision['status'] == 'unresolved'),
                    'Resolution reasons disagree with status')
            refs(decision['evidenceIds'])


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('case', type=Path)
    args = parser.parse_args()
    validate_case(json.loads(args.case.read_text()))
    print('Case contract valid')


if __name__ == '__main__':
    main()
