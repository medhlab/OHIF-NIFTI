"""Explicit ReXGroundingCT segmentation reader (F, X, Y, Z), not a time-series reader."""
import contextlib
import gzip
import hashlib
import math
import struct
import tempfile
from pathlib import Path

import numpy as np

BLOCK = 262144
MAX_REX_BYTES = 8 * 1024 ** 3


def validate_header(raw, record, dimensions):
    if len(raw) != 352:
        raise ValueError('Truncated ReX header')
    endian = '<' if struct.unpack_from('<i', raw)[0] == 348 else '>'
    if struct.unpack_from(endian + 'i', raw)[0] != 348:
        raise ValueError('Invalid NIfTI-1 header')
    if len(dimensions) != 3 or any(not isinstance(d, int) or d <= 0 for d in dimensions):
        raise ValueError('Invalid paired CT dimensions')
    dims = struct.unpack_from(endian + '8h', raw, 40)
    findings = record.get('findings', {})
    if not 1 <= len(findings) <= 256 or set(findings) != {str(i) for i in range(len(findings))}:
        raise ValueError('ReX Finding channels must be contiguous and zero-based (1–256)')
    categories = record.get('categories', {})
    codes = {f'1{x}' for x in 'abcdef'} | {f'2{x}' for x in 'abcdefgh'}
    if set(categories) != set(findings) or not set(categories.values()) <= codes:
        raise ValueError('Categories differ from ReX protocol')
    if any(not isinstance(t, str) or not t.strip() or len(t) > 10000 for t in findings.values()):
        raise ValueError('Invalid Finding text')
    if record.get('shape') != list(dimensions):
        raise ValueError('ReX metadata and paired CT dimensions differ')
    if raw[344:348] != b'n+1\0' or dims[0] != 4 or list(dims[1:5]) != [len(findings), *dimensions]:
        raise ValueError('Expected ReX (Finding, X, Y, Z) layout')
    if math.prod(dims[1:5]) > MAX_REX_BYTES:
        raise ValueError('ReX decompressed mask exceeds 8 GiB limit')
    if struct.unpack_from(endian + '2h', raw, 70) != (2, 8):
        raise ValueError('ReX mask must contain uint8 entity labels')
    slope, intercept = struct.unpack_from(endian + '2f', raw, 112)
    if slope == 0 or math.isnan(slope):
        slope, intercept = 1, 0
    if (slope, intercept) != (1, 0):
        raise ValueError('ReX entity labels cannot be scaled')
    offset = struct.unpack_from(endian + 'f', raw, 108)[0]
    if not math.isfinite(offset) or not offset.is_integer() or not 352 <= offset <= 1048576:
        raise ValueError('Invalid ReX voxel offset')
    return int(offset)


def read_rexgroundingct(path, record, source, directory):
    """Validate the full payload, then expose binary entity masks on the CT grid.

    ReX's affine describes the channel-first array, not a 3D physical grid. The
    dataset contract explicitly indexes the paired CT; never infer this format
    for generic four-dimensional NIfTI. No axis permutation or resampling.
    Equal binary payloads within this case share one entity, not merely labels.
    Temporary demultiplexed channels bound RAM; final files are raw binary gzip.
    """
    directory = Path(directory)
    directory.mkdir(parents=True, exist_ok=True)
    count, voxels = len(record['findings']), math.prod(source['dimensions'])
    findings, entities, by_hash, warnings = [], [], {}, []
    with Path(path).open('rb') as probe:
        compressed = probe.read(2) == b'\x1f\x8b'
    with tempfile.TemporaryDirectory(dir=directory, prefix='.channels-') as temp, contextlib.ExitStack() as stack:
        stream = stack.enter_context(gzip.open(path, 'rb') if compressed else Path(path).open('rb'))
        offset = validate_header(stream.read(352), record, source['dimensions'])
        if len(stream.read(offset - 352)) != offset - 352:
            raise ValueError('Truncated ReX extended header')
        hist = np.zeros((count, 256), dtype=np.int64)
        paths = [Path(temp) / str(i) for i in range(count)]
        writers = [stack.enter_context(p.open('wb')) for p in paths]
        remaining = voxels
        while remaining:
            n = min(BLOCK, remaining)
            raw = stream.read(n * count)
            if len(raw) != n * count:
                raise ValueError('Truncated ReX segmentation payload')
            block = np.frombuffer(raw, np.uint8).reshape(n, count)
            for i, writer in enumerate(writers):
                values = np.ascontiguousarray(block[:, i])
                writer.write(values.tobytes())
                hist[i] += np.bincount(values, minlength=256)
            remaining -= n
        if stream.read(1):
            raise ValueError('Unexpected trailing ReX mask data')
        for writer in writers:
            writer.close()
        for i, path in enumerate(paths):
            labels = (np.flatnonzero(hist[i, 1:]) + 1).tolist()
            foreground = int(hist[i, 1:].sum())
            if not labels:
                raise ValueError(f'Finding {i} has an empty mask')
            expected = record.get('pixels', {}).get(str(i))
            if expected is not None and expected != foreground:
                raise ValueError(f'Finding {i} voxel count differs: {foreground} != {expected}')
            declared = record.get('entity_counts', {}).get(str(i))
            if declared is not None and declared != len(labels):
                warnings.append({'finding': i, 'declaredEntities': declared, 'observedLabels': labels})
            finding = {'index': i, 'text': record['findings'][str(i)],
                       'category': record['categories'][str(i)], 'entityKeys': []}
            for label in labels:
                target = directory / f'f{i}-label{label}.bin.gz'
                h = hashlib.sha256()
                with path.open('rb') as f, gzip.open(target, 'wb', compresslevel=1) as out:
                    while raw := f.read(BLOCK):
                        binary = (np.frombuffer(raw, np.uint8) == label).astype(np.uint8).tobytes()
                        h.update(binary)
                        out.write(binary)
                key = h.hexdigest()
                origin = {'findingIndex': i, 'label': label}
                if key in by_hash:
                    by_hash[key]['origins'].append(origin)
                    target.unlink()
                else:
                    entity = {'key': key, 'maskFile': target.name,
                              'fileSha256': hashlib.sha256(target.read_bytes()).hexdigest(),
                              'voxelCount': int(hist[i, label]), 'origins': [origin]}
                    entities.append(entity)
                    by_hash[key] = entity
                finding['entityKeys'].append(key)
            findings.append(finding)
    return {'findings': findings, 'entities': entities, 'warnings': warnings,
            'geometryHash': source['geometryHash'], 'payloadValidated': True}
