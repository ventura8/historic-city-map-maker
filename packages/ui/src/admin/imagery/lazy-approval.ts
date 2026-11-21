/**
 * What only a version going through Mapbox needs, as a chunk of its own (`docs/research/M12-own-tiles.md`; after `orders/lazy-card.ts`): the
 * admin's `mapbox-choices-<hash>.js`, which a city on its own bucket, the default, never fetches.
 */
import type { TemplateResult } from 'lit';

import type { ImageryContext } from './context.js';
import type { costText, guarded } from './mapbox-choices.js';
import { chunkLoader, chunkTemplate, type ChunkLoader } from './orders/lazy-card.js';

export interface MapboxChoicesChunk {
    readonly costText: typeof costText;
    readonly guarded: typeof guarded;
}

export const MAPBOX_CHOICES_CHUNK: ChunkLoader<MapboxChoicesChunk> = chunkLoader(async () => import('./mapbox-choices.js'));

export function lazyMapboxChoices(context: ImageryContext, render: (chunk: MapboxChoicesChunk) => TemplateResult): TemplateResult {
    return chunkTemplate(context, MAPBOX_CHOICES_CHUNK, render);
}
