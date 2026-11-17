"""Prepare an existing 1028 deployment without mutating containers or state."""
import argparse
import copy
import hashlib
import json
import re
import subprocess
from pathlib import Path


def run(*args):
    return subprocess.check_output(args, text=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--revision', required=True)
    parser.add_argument('--release-dir', required=True, type=Path)
    args = parser.parse_args()
    if not re.fullmatch(r'[0-9a-f]{40}', args.revision):
        parser.error('revision must be a full Git commit SHA')
    source = Path(__file__).resolve().parents[2]
    release = args.release_dir.resolve()
    if source != release / 'source':
        parser.error('run from the fixed GitHub archive at <release>/source')
    manifest = json.loads((Path(__file__).parent / 'runtime-source-sha256.json').read_text())
    for path, expected in manifest.items():
        if hashlib.sha256((source / path).read_bytes()).hexdigest() != expected:
            raise ValueError('Runtime source mismatch: ' + path)
    bases = {
        'ohif-prompt-test-builder:20261013': 'sha256:3b993ba2a2a2bceaa79fa63f184646b13e0b3a801051edec74c054849f6f9193',
        'webapp:latest': 'sha256:14c77ca0e20b173fbdcf63e6b51d173c10ad505693038e7eddda9a8f078573b0',
        'ohif-nifti-rtx4500-backend:ontology-refinement-20261020': 'sha256:a16a9914eca6f4d2961cba01e261958a9af299c38e59a9f986f2aab4bb73a13c',
    }
    for name, expected in bases.items():
        if run('docker', 'image', 'inspect', name, '--format', '{{.Id}}').strip() != expected:
            raise ValueError('Base image changed: ' + name)
    names = ['ohif-finding-real-100-backend-1', 'ohif-finding-real-100-viewer-1']
    containers = json.loads(run('docker', 'inspect', *names))
    files = set()
    for container in containers:
        labels = container['Config']['Labels']
        if labels.get('com.docker.compose.project') != 'ohif-finding-real-100':
            raise ValueError('Unexpected Compose project')
        files.add(labels['com.docker.compose.project.config_files'])
    if len(files) != 1 or ',' in next(iter(files)):
        raise ValueError('Expected one existing Compose file')
    prior = json.loads(run('docker', 'compose', '-f', next(iter(files)), 'config', '--format', 'json'))
    if set(prior['services']) != {'backend', 'viewer'}:
        raise ValueError('Unexpected services')
    rollback = copy.deepcopy(prior)
    for container in containers:
        service = container['Config']['Labels']['com.docker.compose.service']
        rollback['services'][service]['image'] = container['Config']['Image']
    updated = copy.deepcopy(rollback)
    tag = 'github-' + args.revision[:12]
    commands = []
    for service, filename in [('backend', 'backend.Dockerfile'), ('viewer', 'frontend.Dockerfile')]:
        image = 'ohif-nifti-rtx4500-' + service + ':' + tag
        updated['services'][service]['image'] = image
        commands.append(['docker', 'build', '--pull=false', '--build-arg', 'SOURCE_REVISION=' + args.revision,
                         '-f', str(source / 'deploy/rtx4500-preview' / filename), '-t', image, str(source)])
    outputs = {'before-containers.json': containers, 'rollback.compose.json': rollback,
               'compose.preview.json': updated, 'build-commands.json': commands,
               'source-revision.json': {'repository': 'medhlab/OHIF-NIFTI', 'revision': args.revision, 'base_images': bases}}
    if any((release / name).exists() for name in outputs):
        raise FileExistsError('Refusing to overwrite an existing deployment record')
    for name, value in outputs.items():
        (release / name).write_text(json.dumps(value, indent=2) + '\n')
    print('Prepared 1028 deployment; containers and state unchanged')


if __name__ == '__main__':
    main()
