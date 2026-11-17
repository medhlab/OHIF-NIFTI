"""Evidence-bound semantic details extension for case-v2; no task taxonomy."""
from .case_contract import digest, require
from .studio_contract import split_sentences

VERSION = 'lesion-harvest.semantic-details/v1'
ATTRIBUTE_KINDS = {'size', 'shape', 'density', 'distribution', 'severity', 'count', 'pathology', 'extension', 'status'}
FIELD_NAMES = ('anatomy', 'attributes', 'temporal', 'relations')
STATES = {'extracted', 'not_mentioned', 'not_extracted', 'ambiguous', 'failed'}
CHANGES = {'new', 'increased', 'decreased', 'stable', 'resolved', 'persistent', 'unchanged'}

PROMPT = '''
SEMANTIC DETAILS CONTRACT (required): set semantic_version="core/1".
Do not reduce an observation to a concept/location pair. For EACH mention:
- attributes: extract all explicitly attached modifiers, with kind one of size, shape, density, distribution, severity, count, pathology, extension, status; source_text is verbatim. E.g. an irregular 18 mm soft-tissue-density nodule has shape, size and density attributes. Do not copy group modifiers onto unrelated observations. Section defaults to the observation section; set section explicitly for cross-sentence evidence.
- temporal remains current|historical|comparison|unknown (time scope). Separately add temporal_change: {value: new|increased|decreased|stable|resolved|persistent|unchanged, source_text, section} ONLY for an explicit change statement. When no identifiable comparison object is stated, use this attribute instead of a compared_to edge with empty targets. Never invent a historical observation. Do not equate sequela with resolved. Attach stability statements only to observations with a clear antecedent; mark ambiguous otherwise.
- field_status: {anatomy, attributes, temporal, relations}, each {state: extracted|not_mentioned|ambiguous, reason: short explanation}. not_mentioned means you inspected the relevant source and it does not specify that field, NOT you omitted extraction. Unresolved scope/antecedents are ambiguous. Attributes includes all nine modifier kinds. For relations, extracted requires a returned edge; do not say extracted if no edge exists.
- anatomies/attributes may specify section when their evidence is in another sentence/section. Never silently fill a missing anatomical antecedent. Keep modifier evidence verbatim including units, comparators and qualifiers. Do not infer physical entity count from plural terms.
Return contexts: [{key: unique string, kind: context|device, text: short verbatim phrase, section, source_text: full verbatim supporting clause}]. This is for stated prior-exam/clinical background and devices, NOT extra lesion observations. Empty is valid.
Return context_relations: [{source_key: context key, target_mention: zero-based observation index, relation_type: compared_to|context_for, evidence:[{section,source_text}]}]. Add only report-supported links, not knowledge-based diagnosis assumptions.
Return sentence_audit for EVERY numbered sentence supplied: [{section, sentence_index, disposition: observations|normal|context|recommendation|ambiguous, mention_indices:[zero-based mention indices], reason: short explanation}]. Mixed sentences with abnormalities must be observations. Only reference observations actually supported by that sentence. Context-only sentences should have a contexts node. Do not label an unprocessed abnormal sentence normal. This is a model coverage claim, not human confirmation.
Overall output: {semantic_version:"core/1", mentions:[...], relations:[...], contexts:[...], context_relations:[...], sentence_audit:[...]}.
'''


def attach_details(case, raw, quote_span, evidence):
    """Optional extension: malformed fields remain explicit failed/issue records."""
    if raw.get('semantic_version') != 'core/1':
        return
    by_raw = {o['rawMentionIndex']: o for o in case['observations']}
    nodes, edges = [], []

    def problem(subject, field, reason):
        case['issues'].append({'subjectId': subject, 'field': field, 'reason': reason})

    for i, o in by_raw.items():
        source = raw['mentions'][i]
        section = evidence[o['sentenceEvidenceId']]['section']
        change = source.get('temporal_change')
        if change is not None:
            try:
                require(isinstance(change, dict) and change.get('value') in CHANGES, 'invalid_temporal_change')
                eid = quote_span(change.get('section', section), change.get('source_text'),
                                 evidence[o['sentenceEvidenceId']] if change.get('section', section) == section else None)
                o['temporal']['change'] = {'value': change['value'], 'evidenceIds': [eid], 'status': 'model_proposal'}
            except (ValueError, TypeError) as error:
                problem(o['id'], 'temporal', str(error))
        fields = source.get('field_status', {})
        if not isinstance(fields, dict):
            fields = {}
        states = {}
        for name in FIELD_NAMES:
            proposal = fields.get(name, {})
            state = proposal.get('state', 'not_extracted') if isinstance(proposal, dict) else 'failed'
            reason = proposal.get('reason', '') if isinstance(proposal, dict) else ''
            if state not in STATES or not isinstance(reason, str):
                state, reason = 'failed', 'Invalid field coverage claim'
            has_value = {'anatomy': bool(o['anatomy']), 'attributes': bool(o['attributes']),
                         'temporal': o['temporal']['value'] != 'unknown' or 'change' in o['temporal'],
                         'relations': any(o['id'] in r['sourceIds'] + r['targetIds'] for r in case['relations'])}[name]
            if name != 'relations' and ((state == 'extracted' and not has_value) or (state == 'not_mentioned' and has_value)):
                state, reason = 'failed', 'Coverage claim contradicts extracted values'
            if any(issue.get('subjectId') == o['id'] and issue.get('field') in {name, 'attributes' if name == 'attributes' else name}
                   for issue in case['issues']):
                state = 'failed'
            states[name] = {'state': state, 'reason': reason, 'evidenceIds': [o['sentenceEvidenceId']],
                            'provenance': 'model_coverage_claim', 'humanConfirmed': False}
        o['fieldStatus'] = states
        for a in o['attributes']:
            if a['kind'] not in ATTRIBUTE_KINDS:
                o['fieldStatus']['attributes']['state'] = 'failed'
                problem(o['id'], 'attributes', 'unknown_attribute_kind')
        # Graph is a projection over shared observation/evidence IDs, not new
        # spatial objects. Locations and attributes keep their owner explicitly.
        for kind, values, relation in [('anatomy', o['anatomy'], 'located_in'), ('attribute', o['attributes'], 'modify')]:
            for value in values:
                if not value['evidenceIds']:
                    o['fieldStatus']['anatomy' if kind == 'anatomy' else 'attributes']['state'] = 'failed'
                    problem(o['id'], kind, 'missing_semantic_evidence')
                    continue
                nid = 'sem-' + digest([o['id'], kind, value])[:24]
                nodes.append({'id': nid, 'kind': kind, 'text': value['text'], 'evidenceIds': value['evidenceIds']})
                edges.append({'id': 'edge-' + digest([o['id'], relation, nid])[:24], 'sourceId': o['id'],
                              'targetId': nid, 'type': relation, 'modifierType': value.get('kind'),
                              'evidenceIds': value['evidenceIds'], 'status': 'proposed'})
    context_ids = {}
    contexts = raw.get('contexts', [])
    if not isinstance(contexts, list):
        contexts = []; problem(None, 'contexts', 'contexts_not_list')
    for item in contexts:
        try:
            require(isinstance(item, dict) and item.get('kind') in {'context', 'device'}, 'invalid_context_type')
            key = item.get('key'); require(isinstance(key, str) and bool(key) and key not in context_ids, 'invalid_context_key')
            eid = quote_span(item.get('section'), item.get('source_text'))
            require(isinstance(item.get('text'), str) and bool(item['text']) and item['text'] in evidence[eid]['text'], 'nonverbatim_context_text')
            nid = 'sem-' + digest([case['caseId'], item['kind'], eid, item['text']])[:24]
            require(nid not in {n['id'] for n in nodes}, 'duplicate_context')
            nodes.append({'id': nid, 'kind': item['kind'], 'text': item['text'], 'evidenceIds': [eid]})
            context_ids[key] = nid
        except (ValueError, TypeError) as error:
            problem(None, 'contexts', str(error))
    context_relations = raw.get('context_relations', [])
    if not isinstance(context_relations, list):
        context_relations = []; problem(None, 'context_relations', 'relations_not_list')
    for item in context_relations:
        try:
            require(isinstance(item, dict) and item.get('relation_type') in {'compared_to', 'context_for'}, 'invalid_context_relation')
            require(type(item.get('target_mention')) is int, 'invalid_context_target')
            source, target = context_ids[item['source_key']], by_raw[item['target_mention']]['id']
            refs = [quote_span(e['section'], e['source_text']) for e in item['evidence']]
            require(bool(refs), 'missing_context_evidence')
            edges.append({'id': 'edge-' + digest([source, target, item['relation_type'], refs])[:24],
                          'sourceId': source, 'targetId': target, 'type': item['relation_type'],
                          'evidenceIds': refs, 'status': 'proposed'})
        except (ValueError, KeyError, TypeError) as error:
            problem(None, 'context_relations', str(error))
    for o in case['observations']:
        state = o['fieldStatus']['relations']
        linked = any(o['id'] in r['sourceIds'] + r['targetIds'] for r in case['relations']) or any(
            o['id'] == e['targetId'] for e in edges if e['type'] in {'compared_to', 'context_for'})
        if state['state'] == 'extracted' and not linked or state['state'] == 'not_mentioned' and linked:
            state.update(state='failed', reason='Coverage claim contradicts extracted relations')
    audit_rows = raw.get('sentence_audit', [])
    if not isinstance(audit_rows, list):
        audit_rows = []
    audits = {}
    for row in audit_rows:
        if not isinstance(row, dict) or row.get('section') not in case['reports'] or type(row.get('sentence_index')) is not int:
            problem(None, 'sentence_audit', 'invalid_sentence_key'); continue
        key = (row['section'], row['sentence_index'])
        if key in audits:
            audits[key] = {}; problem(None, 'sentence_audit', 'duplicate_sentence_key')
        else:
            audits[key] = row
    coverage = []
    for section, report in case['reports'].items():
        for span in split_sentences(report['text'], section):
            row = audits.pop((section, span.index), None)
            ids, status = [], 'not_extracted'
            disposition, reason = None, ''
            if row is not None:
                disposition, reason = row.get('disposition'), row.get('reason', '')
                status = 'model_checked'
                indices = row.get('mention_indices', [])
                if disposition not in {'observations', 'normal', 'context', 'recommendation', 'ambiguous'} or not isinstance(indices, list):
                    status = 'failed'; indices = []
                for idx in indices:
                    if type(idx) is not int or idx not in by_raw:
                        status = 'failed'; continue
                    o = by_raw[idx]
                    refs = [evidence[e] for e in o['evidenceIds']]
                    if not any(e['section'] == section and e['start'] < span.end and e['end'] > span.start for e in refs):
                        status = 'failed'
                    else:
                        ids.append(o['id'])
                if disposition == 'observations' and not ids or disposition == 'ambiguous':
                    status = 'ambiguous'
                actual = [o['id'] for o in case['observations'] if any(
                    evidence[e]['section'] == section and evidence[e]['start'] < span.end and evidence[e]['end'] > span.start
                    for e in o['evidenceIds'])]
                if disposition in {'normal', 'recommendation'} and actual:
                    status = 'failed'
                if disposition == 'observations' and not set(actual) <= set(ids):
                    status = 'failed'
            coverage.append({'section': section, 'sentenceIndex': span.index, 'start': span.start,
                             'end': span.end, 'text': span.text, 'status': status, 'disposition': disposition,
                             'observationIds': list(dict.fromkeys(ids)), 'reason': str(reason),
                             'humanConfirmed': False})
    if audits:
        problem(None, 'sentence_audit', 'out_of_range_sentence_keys')
    case['semanticDetails'] = {'schemaVersion': VERSION, 'nodes': list({n['id']: n for n in nodes}.values()),
                               'edges': list({e['id']: e for e in edges}.values()), 'sentenceCoverage': coverage,
                               'coverageStatus': 'model_checked' if all(r['status'] == 'model_checked' for r in coverage) else 'incomplete',
                               'independentlyVerified': False}


def validate_details(case):
    details = case.get('semanticDetails')
    if details is None:
        return
    require(details['schemaVersion'] == VERSION and details['independentlyVerified'] is False, 'Invalid semantic details version/status')
    evidence = {e['id']: e for e in case['evidence']}
    observations = {o['id']: o for o in case['observations']}
    nodes = {n['id']: n for n in details['nodes']}
    require(len(nodes) == len(details['nodes']) and not set(nodes).intersection(observations), 'Duplicate semantic nodes')
    def refs(values):
        require(isinstance(values, list) and bool(values) and all(e in evidence for e in values), 'Missing semantic evidence')
    for o in observations.values():
        if 'fieldStatus' in o:
            require(set(o['fieldStatus']) == set(FIELD_NAMES), 'Missing field coverage')
            for field in o['fieldStatus'].values():
                require(field['state'] in STATES and field['humanConfirmed'] is False, 'Invalid coverage state')
                refs(field['evidenceIds'])
        if 'change' in o['temporal']:
            require(o['temporal']['change']['value'] in CHANGES, 'Invalid temporal change')
            refs(o['temporal']['change']['evidenceIds'])
    for n in nodes.values():
        require(n['kind'] in {'anatomy', 'attribute', 'context', 'device'}, 'Invalid semantic node')
        refs(n['evidenceIds'])
    require(len({e['id'] for e in details['edges']}) == len(details['edges']), 'Duplicate semantic edges')
    for edge in details['edges']:
        require(edge['sourceId'] in (set(observations) | set(nodes)) and edge['targetId'] in nodes.keys() | observations.keys(), 'Dangling semantic edge')
        require(edge['type'] in {'located_in', 'modify', 'compared_to', 'context_for'} and edge['status'] == 'proposed', 'Invalid semantic relation')
        refs(edge['evidenceIds'])
    expected = [(s, span.index, span.start, span.end, span.text) for s, r in case['reports'].items() for span in split_sentences(r['text'], s)]
    rows = details['sentenceCoverage']
    require([(r['section'], r['sentenceIndex'], r['start'], r['end'], r['text']) for r in rows] == expected, 'Sentence coverage mismatch')
    for row in rows:
        require(row['status'] in {'model_checked', 'not_extracted', 'ambiguous', 'failed'} and row['humanConfirmed'] is False, 'Invalid sentence coverage status')
        require(all(i in observations for i in row['observationIds']), 'Dangling coverage observation')
