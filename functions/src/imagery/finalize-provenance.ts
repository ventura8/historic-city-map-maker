/**
 * What a published layer records of where its tiles came from (`finalize.ts`): the USGS frame or a join's frames, the georeference's
 * method, points and error, and (batch 4) how an archive series was placed.
 */
import { enabledGcps, type Georef, type JoinPart, type LayerDoc, type LayerVersionDoc } from '@hcm/shared';

import { compact, omit } from '../api/objects.js';

type Provenance = NonNullable<LayerDoc['provenance']>;

function georefProvenance(georef: Georef): NonNullable<Provenance['georef']> {
    return compact<NonNullable<Provenance['georef']>>({
        method: georef.method,
        gcpCount: georef.method === 'embedded' ? undefined : enabledGcps(georef.gcps),
        checkpointRmseM: georef.checkpointRmseM,
    });
}

type UsgsProvenance = Pick<Provenance, 'usgsEntityId' | 'usgsDataset' | 'usgsParts'>;

/** M8: a join's first frame stands for it (`rasterExportable` reads `usgsEntityId`), with every frame in `usgsParts`. */
function joinProvenance([first, ...rest]: readonly JoinPart[]): UsgsProvenance {
    if (first === undefined) {
        return {};
    }
    return { usgsEntityId: first.entityId, usgsDataset: first.dataset, usgsParts: [first, ...rest].map((part) => part.entityId) };
}

function usgsProvenance(version: LayerVersionDoc): UsgsProvenance {
    const source = version.source;
    if (source?.kind === 'join') {
        return joinProvenance(source.parts);
    }
    return source?.kind === 'usgs' ? { usgsEntityId: source.entityId, usgsDataset: source.dataset } : {};
}

/**
 * Batch 4 (`docs/research/M20-import-local.md` §5.1): how an archive series was placed; a grid placed from its sheets' names only ever
 * publishes by its owner's approval (`approve.ts`), so its layer says `grid-names` approved by the owner.
 */
function archiveProvenance(version: LayerVersionDoc): Pick<Provenance, 'archive'> {
    const method = version.archive?.method;
    if (method === undefined) {
        return {};
    }
    return { archive: method === 'grid-names' ? { method, approvedBy: 'owner' } : { method } };
}

/** Where the tiles came from, kept on the layer: the USGS frame (the layer's own when the version has no source). */
export function provenanceOf(version: LayerVersionDoc, before: LayerDoc | undefined): Provenance {
    const kept = omit(before?.provenance ?? {}, ['georef', 'archive']);
    const georef = version.georef === undefined ? {} : { georef: georefProvenance(version.georef) };
    return { ...kept, ...usgsProvenance(version), ...georef, ...archiveProvenance(version) };
}
