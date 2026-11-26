/**
 * Settings → Wikipedia as a chunk of its own (`wikipedia-section`, fetched the first time its section opens; M31), so the
 * settings chunk stays within its budget: Loading until then, a failed fetch with Try again (`lazyCard`).
 */
import type { TemplateResult } from 'lit';

import { lazyCard } from '../cities/lazy-budget.js';
import { chunkLoader, type ChunkLoader } from '../imagery/orders/lazy-card.js';
import type { wikipediaSection } from './wikipedia-section.js';
import { sectionRowTexts, type SectionContext } from './section-parts.js';

export interface WikipediaCardChunk {
    readonly wikipediaSection: typeof wikipediaSection;
}

export const WIKIPEDIA_CARD_CHUNK: ChunkLoader<WikipediaCardChunk> = chunkLoader(async () => import('./wikipedia-section.js'));

/** The card, or its heading with Loading (or the failed fetch's Try again) until its chunk is in. */
export function lazyWikipediaCard(context: SectionContext, chunk: ChunkLoader<WikipediaCardChunk> = WIKIPEDIA_CARD_CHUNK): TemplateResult {
    return lazyCard(context, chunk, sectionRowTexts(context.locale, 'wikipedia').title, (loaded) => loaded.wikipediaSection(context));
}
