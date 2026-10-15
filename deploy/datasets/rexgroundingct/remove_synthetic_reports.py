"""Remove only the old importer-generated ReX report, preserving revision history.

Run inside the backend environment, with explicit case IDs. Defaults to dry run.
"""
import argparse
import copy
import json
from pathlib import Path


def clean(case):
    result = copy.deepcopy(case)
    targets = [r for r in case['reports'] if r['name'] == 'ReXGroundingCT · 标注原文']
    if not targets:
        return result, 0
    for report in targets:
        if (len(report['sections']) != 1 or report['sections'][0]['name'] != 'Annotated Findings'
                or report['sections'][0]['text'] != '\n'.join(f['text'] for f in case['findings'])):
            raise ValueError('Report was edited or is not an exact importer-generated copy; review required')
    ids = {r['id'] for r in targets}
    removed = {e['id'] for e in case['evidence'] if e['reportId'] in ids}
    # This repair is scoped to the original ReX importer, not model extraction.
    if case.get('observations') or case.get('reportExtractions'):
        raise ValueError('Additional report consumers require review')
    result['reports'] = [r for r in result['reports'] if r['id'] not in ids]
    result['evidence'] = [e for e in result['evidence'] if e['id'] not in removed]
    for finding in result['findings']:
        finding['evidenceIds'] = [i for i in finding['evidenceIds'] if i not in removed]
    return result, len(targets)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--case', action='append', required=True)
    parser.add_argument('--backup', type=Path, required=True)
    parser.add_argument('--apply', action='store_true')
    args = parser.parse_args()
    from monailabel.endpoints.nifti_images import database
    from monailabel.utils.others import annotation_domain as domain
    with database() as db:
        db.execute('BEGIN IMMEDIATE'); domain.schema(db)
        before = [domain.read(db, cid) for cid in dict.fromkeys(args.case)]
        changes = [(old, *clean(old)) for old in before]
        if args.apply and any(count for _, _, count in changes):
            # Exclusive backup creation prevents accidentally overwriting recovery evidence.
            with args.backup.open('x') as f:
                json.dump(before, f, ensure_ascii=False, indent=2)
            for old, new, count in changes:
                if count:
                    domain.persist(db, new)
        print(json.dumps([{'caseId': old['caseId'], 'removedReports': count, 'applied': args.apply,
                           'reportsRemaining': len(new['reports']), 'entities': len(new['entities'])}
                          for old, new, count in changes]))


if __name__ == '__main__':
    main()
