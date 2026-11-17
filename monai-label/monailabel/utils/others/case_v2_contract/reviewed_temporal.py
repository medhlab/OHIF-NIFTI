"""Explicit, hash-bound offline corrections. Never enabled by model extraction.

The ledger records case review conclusions, not general medical heuristics or
human clinical confirmation. Output is a new artifact; raw answers stay intact.
"""
import copy
from .case_contract import digest, require, validate_case

VERSION = 'lesion-harvest.reviewed-temporal/v1'


def apply_reviewed_temporal(original, ledger):
    validate_case(original)
    require(ledger['schemaVersion'] == VERSION, 'Unsupported temporal ledger')
    case = copy.deepcopy(original)
    fingerprint = digest(ledger)
    if 'temporalResolution' in case:
        require(case['temporalResolution']['ledgerSha256'] == fingerprint, 'Temporal ledger changed')
        return case
    reports = {s:r['sha256'] for s,r in case['reports'].items()}
    matches = [r for r in ledger['reports'] if r['reportSha256'] == reports]
    require(len(matches) <= 1, 'Duplicate temporal ledger report')
    if not matches:
        return case
    record = matches[0]
    require(record['rawSha256'] == digest(case['rawModelOutput']), 'Temporal review raw answer drift')
    by_raw = {o['rawMentionIndex']:o for o in case['observations'] if type(o['rawMentionIndex']) is int}
    changes = []
    for action in record['actions']:
        originals = []
        for relation in action['relationIndices']:
            found = [(o,s) for o in case['observations'] for s in o['temporal'].get('statements', [])
                     if s['sourceRelationIndex'] == relation]
            require(len(found) == 1, 'Temporal review statement missing or duplicated')
            o,s = found[0]
            originals.append({'observationId':o['id'], 'rawMentionIndex':o['rawMentionIndex'], 'statement':copy.deepcopy(s)})
        refs = list(dict.fromkeys(e for b in originals for e in b['statement']['evidenceIds']))
        audit = {'action':action['action'], 'reason':action['reason'], 'before':originals,
                 'humanConfirmed':False}
        for b in originals:
            old = by_raw[b['rawMentionIndex']]['temporal']['statements']
            old[:] = [s for s in old if s['id'] != b['statement']['id']]
            if not old:
                del by_raw[b['rawMentionIndex']]['temporal']['statements']
        if action['action'] == 'group':
            members = [by_raw[i]['id'] for i in action['memberIndices']]
            require(len(members) > 1 and len(set(members)) == len(members), 'Invalid group members')
            gid = 'timegroup-' + digest([case['caseId'], members, refs])[:24]
            case.setdefault('temporalGroups', []).append({'id':gid, 'observationIds':members,
                'evidenceIds':refs, 'sourceRelationIndices':action['relationIndices'],
                'scope':'group_only_no_member_change', 'status':'proposed', 'humanConfirmed':False,
                'provenance':'explicit_report_review'})
            audit['groupId'] = gid
            audit['memberIds'] = members
        elif action['action'] == 'owner':
            require(len(originals) == 1, 'Owner review requires one statement')
            owner = by_raw[action['ownerIndex']]
            statement = copy.deepcopy(originals[0]['statement'])
            statement.update(status='proposed', reasons=[], competingObservationIds=[],
                             sourceObservationId=originals[0]['observationId'], ownershipResolution=VERSION)
            owner['temporal'].setdefault('statements', []).append(statement)
            audit['targetOwnerId'] = owner['id']
        else:
            raise ValueError('Unsupported temporal review action')
        changes.append(audit)
    case['temporalResolution'] = {'schemaVersion':VERSION,'ledgerSha256':fingerprint,
        'reportSha256':reports,'rawSha256':record['rawSha256'],'changes':changes,'humanConfirmed':False}
    validate_case(case)
    return case


def validate_review(case):
    groups = case.get('temporalGroups', [])
    audit = case.get('temporalResolution')
    if not audit:
        require(not groups, 'Temporal groups require review provenance')
        return
    require(audit['schemaVersion'] == VERSION and audit['humanConfirmed'] is False, 'Invalid temporal review')
    require(audit['reportSha256'] == {s:r['sha256'] for s,r in case['reports'].items()}
            and audit['rawSha256'] == digest(case['rawModelOutput']), 'Temporal review input drift')
    by_id = {o['id']:o for o in case['observations']}
    ev = {e['id']:e for e in case['evidence']}
    require(len({g['id'] for g in groups}) == len(groups), 'Duplicate temporal group')
    for g in groups:
        require(len(g['observationIds']) > 1 and len(set(g['observationIds'])) == len(g['observationIds'])
                and all(i in by_id for i in g['observationIds']), 'Invalid temporal group members')
        require(g['evidenceIds'] and all(e in ev for e in g['evidenceIds']), 'Invalid temporal group evidence')
        require(g['scope'] == 'group_only_no_member_change' and g['status'] == 'proposed'
                and g['humanConfirmed'] is False, 'Invalid temporal group scope')
        records = [c for c in audit['changes'] if c.get('groupId') == g['id']]
        require(len(records) == 1, 'Missing temporal group audit')
        record = records[0]
        require(g['observationIds'] == record['memberIds']
                and g['sourceRelationIndices'] == [b['statement']['sourceRelationIndex'] for b in record['before']]
                and g['evidenceIds'] == list(dict.fromkeys(e for b in record['before'] for e in b['statement']['evidenceIds'])), 'Temporal group audit drift')
    from .case_temporal import validate_statements
    for change in audit['changes']:
        require(change['humanConfirmed'] is False and bool(change['reason']), 'Invalid review decision')
        for old in change['before']:
            require(old['observationId'] in by_id, 'Missing original temporal owner')
            original_owner = copy.deepcopy(by_id[old['observationId']])
            require(original_owner['rawMentionIndex'] == old['rawMentionIndex'], 'Original owner index drift')
            original_owner['temporal']['statements'] = [old['statement']]
            validate_statements(case, original_owner, ev)
        if change['action'] == 'owner':
            require(change['targetOwnerId'] in by_id and len(change['before']) == 1, 'Missing reviewed owner')
            require(any(s['id'] == change['before'][0]['statement']['id'] for s in
                by_id[change['targetOwnerId']]['temporal'].get('statements', [])), 'Missing reviewed statement')
        else:
            require(change['action'] == 'group' and any(g['id'] == change['groupId'] for g in groups), 'Missing reviewed group')
