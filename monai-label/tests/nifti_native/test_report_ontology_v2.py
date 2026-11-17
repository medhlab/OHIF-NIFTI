"""Structural v2 contract tests; synthetic codes are not semantic ground truth."""
import copy
import hashlib
import numpy as np
import pytest
from fastapi import HTTPException
from monailabel.utils.others.report_ontology import import_ontology, VERSION_V2
from monailabel.utils.others.case_v2_contract.case_contract import digest
from test_report_ontology import seeded, overlay
from test_report_case_v2 import fixture
from test_annotation import client, setup_case, op, state, save


def version2(case):
    result = overlay(case)
    result['schemaVersion'] = VERSION_V2
    result['provenance']['baselineOverlaySha256'] = case.get('caseV2Ontology', {}).get('inputSha256')
    sources = {}
    for obs in case['caseV2Extraction']['sourcePayload']['observations']:
        sources[obs['id']] = dict(kind='observation', sentence=obs['text'], evidenceIds=obs['evidenceIds'])
        for i, anatomy in enumerate(obs['anatomy']):
            sources[obs['id'] + '/anatomy/' + str(i)] = dict(kind='anatomy', sentence=obs['text'], evidenceIds=anatomy['evidenceIds'])
    for item in result['items']:
        item.update(sources[item['key']], partialMappings=[])
        item['mappings'][0]['semanticAssessment'] = dict(relation='equivalent')
    item = result['items'][0]
    mapping = item['mappings'].pop()
    mapping['semanticAssessment']['relation'] = 'partial'
    start, end = 0, item['text'].index(' ')
    mapping['coverage'] = dict(start=start, end=end, coveredText=item['text'][start:end],
        uncoveredText=item['text'][end:], offsetUnit='unicode_codepoint', textScope='item.text', role='finding_component')
    item.update(state='partial', partialMappings=[mapping])
    return result


def test_explicit_update_archives_old_version_and_rejects_stale_baseline():
    case = seeded()
    import_ontology(case, dict(ontology=overlay(case)))
    original = copy.deepcopy(case)
    next_version = version2(case)
    with pytest.raises(HTTPException) as error:
        import_ontology(case, dict(ontology=next_version))
    assert error.value.status_code == 409 and case == original
    assert import_ontology(case, dict(ontology=next_version, expectedOntologySha256=case['caseV2Ontology']['inputSha256']))
    assert case['caseV2OntologyHistory'] == [original['caseV2Ontology']]
    assert {k: v for k, v in case.items() if k not in {'caseV2Ontology', 'caseV2OntologyHistory'}} == {
        k: v for k, v in original.items() if k != 'caseV2Ontology'}
    after = copy.deepcopy(case)
    assert import_ontology(case, dict(ontology=next_version)) is False and case == after
    next_version['provenance']['change'] = True
    with pytest.raises(HTTPException):
        import_ontology(case, dict(ontology=next_version, expectedOntologySha256=case['caseV2Ontology']['inputSha256']))
    assert case == after


@pytest.mark.parametrize('bad', ['state', 'code', 'offset', 'unit', 'uncovered', 'relation', 'evidence', 'sentence', 'role'])
def test_invalid_partial_is_atomic(bad):
    case = seeded()
    value = version2(case)
    item = value['items'][0]
    partial = item['partialMappings'][0]
    if bad == 'state': item['state'] = 'candidate'
    if bad == 'code': partial['code'] = '222'
    if bad == 'offset': partial['coverage']['end'] += 1
    if bad == 'unit': partial['coverage']['offsetUnit'] = 'utf16'
    if bad == 'uncovered': partial['coverage']['uncoveredText'] = ''
    if bad == 'relation': partial['semanticAssessment']['relation'] = 'equivalent'
    if bad == 'evidence': item['evidenceIds'] = ['invented']
    if bad == 'sentence': item['sentence'] = 'invented context'
    if bad == 'role': partial['coverage']['role'] = 'spatial_entity'
    before = copy.deepcopy(case)
    with pytest.raises(HTTPException): import_ontology(case, dict(ontology=value))
    assert before == case


def test_human_mapping_is_not_replaced():
    case = seeded()
    import_ontology(case, dict(ontology=overlay(case)))
    case['caseV2Ontology']['sourcePayload']['items'][0]['mappings'][0]['humanConfirmed'] = True
    case['caseV2Ontology']['inputSha256'] = digest(case['caseV2Ontology']['sourcePayload'])
    before = copy.deepcopy(case)
    with pytest.raises(HTTPException) as error:
        import_ontology(case, dict(ontology=version2(case), expectedOntologySha256=case['caseV2Ontology']['inputSha256']))
    assert error.value.status_code == 409 and case == before


def test_api_update_reopen_retains_manual_edits_links_and_saved_mask(client, tmp_path):
    source, case, _ = setup_case(client, tmp_path)
    case = op(client, case, 'finding', text='人工修改不得丢失', category='2d').json()['data']
    case = op(client, case, 'entity', name='保留原实体', findingIds=[case['findings'][0]['id']]).json()['data']
    seed = np.zeros(source['count'], dtype=np.uint8)
    seed[5:9] = 1
    assert save(client, source, case, case['entities'][0], seed).status_code == 200
    case = state(client, case)
    case = op(client, case, 'reportExtraction', **fixture()).json()['data']
    case = op(client, case, 'ontologyMapping', ontology=overlay(case)).json()['data']
    case = op(client, case, 'updateFinding', findingId=case['findings'][0]['id'], text='导入后再次人工修改').json()['data']
    before = copy.deepcopy(case)
    def masks():
        return {str(p): hashlib.sha256(p.read_bytes()).hexdigest() for p in (tmp_path / 'state').rglob('*')
                if p.is_file() and '/masks/' in str(p)}
    mask_hashes = masks()
    new = version2(case)
    response = op(client, case, 'ontologyMapping', ontology=new, expectedOntologySha256=case['caseV2Ontology']['inputSha256'])
    assert response.status_code == 200, response.text
    case = response.json()['data']
    assert state(client, case) == case
    for key in ['findings', 'entities', 'links', 'reports', 'evidence', 'caseV2Extraction']:
        assert case[key] == before[key]
    assert mask_hashes and masks() == mask_hashes
    assert case['caseV2OntologyHistory'] == [before['caseV2Ontology']]
    assert op(client, before, 'ontologyMapping', key='stale-case', ontology=new,
              expectedOntologySha256=before['caseV2Ontology']['inputSha256']).status_code == 409
