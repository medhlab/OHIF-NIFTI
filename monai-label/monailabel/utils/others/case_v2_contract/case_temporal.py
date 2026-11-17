"""Preserve targetless comparison evidence without inventing comparison objects.

A statement is an observation-owned temporal attribute, not an observation
relation. Keep its wording; do not infer a change direction from measurements
or rewrite a time scope. Ambiguous ownership remains an explicit proposal.
"""
from .case_contract import digest, require

POLICY = 'lesion-harvest.targetless-comparison/v1'


def attach_comparisons(case, raw, quote_span, evidence):
    edges = raw.get('relations', [])
    if not isinstance(edges, list):
        return
    by_raw = {o['rawMentionIndex']: o for o in case['observations']}
    for n, edge in enumerate(edges):
        if not (isinstance(edge, dict) and edge.get('relation_type') == 'compared_to'
                and isinstance(edge.get('target_mentions'), list) and edge['target_mentions'] == []):
            continue
        try:
            source = edge.get('source_mention')
            require(type(source) is int and source in by_raw, 'invalid_comparison_source')
            owner = by_raw[source]
            require(isinstance(edge.get('evidence'), list) and bool(edge['evidence']), 'missing_comparison_evidence')
            refs = list(dict.fromkeys(quote_span(e['section'], e['source_text']) for e in edge['evidence']))
            primary = evidence[owner['evidenceIds'][0]]
            def contains(span, part):
                return span['section'] == part['section'] and span['start'] <= part['start'] and part['end'] <= span['end']
            in_owner = all(contains(primary, evidence[e]) for e in refs)
            competitors = [o['id'] for o in case['observations'] if o['id'] != owner['id']
                and any(contains(evidence[o['evidenceIds'][0]], evidence[e]) for e in refs)]
            reasons = []
            if not in_owner:
                reasons.append('comparison_evidence_outside_owner_mention')
            if competitors:
                reasons.append('comparison_evidence_shared_by_observations')
            statement = {'id': 'time-' + digest([POLICY, owner['id'], n, refs])[:24],
                'text': ' / '.join(evidence[e]['text'] for e in refs), 'evidenceIds': refs,
                'status': 'ambiguous' if reasons else 'proposed', 'reasons': reasons,
                'competingObservationIds': competitors, 'sourceRelationIndex': n,
                'provenance': 'targetless_compared_to_model_owner', 'humanConfirmed': False}
            owner['temporal'].setdefault('statements', []).append(statement)
            if 'fieldStatus' in owner:
                state = owner['fieldStatus']['temporal']
                if state['state'] != 'failed':
                    state.update(state='ambiguous' if reasons or state['state'] == 'ambiguous' else 'extracted',
                                 reason='Targetless comparison retained; ownership is not independently verified',
                                 evidenceIds=list(dict.fromkeys(state['evidenceIds'] + refs)), provenance=POLICY)
        except (KeyError, TypeError, ValueError) as error:
            case['issues'].append({'field': 'temporal', 'index': n, 'reason': str(error)})
    case['provenance']['temporalComparisonPolicy'] = POLICY


def validate_statements(case, observation, evidence):
    statements = observation['temporal'].get('statements', [])
    require(isinstance(statements, list), 'Invalid temporal statements')
    require(len({s['id'] for s in statements}) == len(statements), 'Duplicate temporal statement')
    for s in statements:
        require(isinstance(s['id'], str) and bool(s['id']), 'Invalid temporal statement identity')
        refs = s['evidenceIds']
        require(isinstance(refs, list) and bool(refs) and all(e in evidence for e in refs), 'Missing temporal statement evidence')
        require(s['text'] == ' / '.join(evidence[e]['text'] for e in refs), 'Nonverbatim temporal statement')
        require(s['status'] in {'proposed', 'ambiguous'} and s['humanConfirmed'] is False, 'Invalid temporal statement status')
        require(isinstance(s['reasons'], list) and bool(s['reasons']) == (s['status'] == 'ambiguous'), 'Invalid temporal ambiguity')
        require(isinstance(s['competingObservationIds'], list) and all(
            oid != observation['id'] and any(o['id'] == oid for o in case['observations'])
            for oid in s['competingObservationIds']), 'Dangling temporal competitor')
        require(type(s['sourceRelationIndex']) is int and s['sourceRelationIndex'] >= 0,
                'Invalid temporal source relation')
        require(s['provenance'] == 'targetless_compared_to_model_owner', 'Invalid temporal provenance')
        raw_edges = case['rawModelOutput'].get('relations', [])
        require(isinstance(raw_edges, list) and s['sourceRelationIndex'] < len(raw_edges), 'Missing temporal source relation')
        source_owner = observation
        if 'sourceObservationId' in s:
            source_owner = next((o for o in case['observations'] if o['id'] == s['sourceObservationId']), None)
            require(source_owner is not None and s.get('ownershipResolution') == 'lesion-harvest.reviewed-temporal/v1', 'Missing original temporal owner')
            require(any(c.get('targetOwnerId') == observation['id'] and any(
                b['observationId'] == source_owner['id'] and b['statement']['id'] == s['id']
                for b in c['before']) for c in case.get('temporalResolution', {}).get('changes', [])), 'Missing temporal ownership audit')
        edge = raw_edges[s['sourceRelationIndex']]
        require(edge['relation_type'] == 'compared_to' and edge['target_mentions'] == []
                and type(edge['source_mention']) is int
                and edge['source_mention'] == source_owner['rawMentionIndex'], 'Temporal source relation mismatch')
