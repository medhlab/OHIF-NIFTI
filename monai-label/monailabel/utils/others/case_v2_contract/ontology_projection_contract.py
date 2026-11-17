"""Index-free validation of the optional migrated ontology audit projection."""
from .case_contract import require


def validate_projection(case):
    value = case.get('ontologyProjection')
    if value is None:
        return
    require(value['schemaVersion'] == 'lesion-harvest.ontology-case-adapter/v1'
            and value['scope'] == 'text_concept_graph_not_entity_masks', 'Invalid ontology projection')
    nodes = {o['id'] for o in case['observations']} | {n['id'] for n in case['semanticDetails']['nodes']}
    evidence = {e['id'] for e in case['evidence']}
    indices = set()
    for item in value['mentions']:
        i = item['rawConceptIndex']
        require(type(i) is int and 0 <= i < value['rawConceptCount'] and i not in indices,
                'Invalid/duplicate raw concept reference')
        indices.add(i)
        require(item['nodeId'] in nodes and item['evidenceIds']
                and set(item['evidenceIds']) <= evidence, 'Dangling ontology mention')
        require(item['mappingState'] in {'candidate', 'unmapped', 'invalid_code', 'wrong_domain', 'not_applicable'},
                'Invalid terminology state')
        for mapping in item['mappings']:
            require(mapping['system'] == 'SNOMED_CT' and mapping['status'] == 'candidate'
                    and mapping['humanConfirmed'] is False and mapping['indexValidated'] is True,
                    'Unsafe ontology mapping status')
        processed = item['postprocessedIndex']
        require(processed is None or type(processed) is int and 0 <= processed < value['processedConceptCount'],
                'Invalid processed concept reference')
