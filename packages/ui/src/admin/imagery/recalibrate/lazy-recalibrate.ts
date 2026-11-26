/**
 * M16 (`docs/research/M16-recalibrate.md` §7): a version's Calibrate again block as a chunk of its own (the admin's `recalibrate-card-<hash>.js`,
 * after `orders/lazy-card.ts`), fetched only on a page that offers it or shows a recalibration's figures, so the version's page chunk keeps its
 * budget.
 */
import type { TemplateResult } from 'lit';

import { EMPTY } from '../../shell/empty.js';
import type { ImageryContext } from '../context.js';
import type { VersionPagePort, VersionViewPort } from '../imagery-port.js';
import { chunkLoader, chunkTemplate, type ChunkLoader } from '../orders/lazy-card.js';
import type { recalibrateCard } from './recalibrate-card.js';

export interface RecalibrateChunk {
    readonly recalibrateCard: typeof recalibrateCard;
}

export const RECALIBRATE_CHUNK: ChunkLoader<RecalibrateChunk> = chunkLoader(async () => import('./recalibrate-card.js'));

const FROM: ReadonlySet<VersionViewPort['state']> = new Set(['published', 'awaiting_approval']);

/** Published or waiting, with a scan and a fit of pairs; a join (no scan) is refined frame by frame (the server's check: `recalibrate.ts`). */
function recalibratable(version: VersionViewPort): boolean {
    const pairs = version.georef !== null && version.georef.method !== 'embedded';
    return FROM.has(version.state) && version.hasScan && pairs;
}

/** The block, when the version may be calibrated again or is a recalibration; else nothing, unfetched. */
export function lazyRecalibrate(
    context: ImageryContext,
    page: VersionPagePort,
    version: VersionViewPort,
    chunk: ChunkLoader<RecalibrateChunk> = RECALIBRATE_CHUNK,
): TemplateResult {
    const offered = recalibratable(version);
    const shown = version.recalibration !== null || offered;
    return shown ? chunkTemplate(context, chunk, (loaded) => loaded.recalibrateCard(context, page, version, offered)) : EMPTY;
}
