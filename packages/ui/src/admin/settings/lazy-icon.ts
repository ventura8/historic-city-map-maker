/**
 * Settings → Browser tab icon as a chunk of its own (`icon-card`, fetched the first time its section opens; its budget in
 * `scripts/ci/check_bundle_budget.py`), so the settings chunk stays within its 20 KB: Loading until then, a failed fetch
 * with Try again; the page renders again when a fetch settles (`context.refresh`).
 */
import type { TemplateResult } from 'lit';

import { lazyCard } from '../cities/lazy-budget.js';
import { chunkLoader, type ChunkLoader } from '../imagery/orders/lazy-card.js';
import type { iconSection } from './icon-section.js';
import { sectionRowTexts, type SectionContext } from './section-parts.js';

export interface IconCardChunk {
    readonly iconSection: typeof iconSection;
}

export const ICON_CARD_CHUNK: ChunkLoader<IconCardChunk> = chunkLoader(async () => import('./icon-section.js'));

/** The card, or its heading with Loading (or the failed fetch's Try again) until its chunk is in (`lazyCard`). */
export function lazyIconCard(context: SectionContext, chunk: ChunkLoader<IconCardChunk> = ICON_CARD_CHUNK): TemplateResult {
    return lazyCard(context, chunk, sectionRowTexts(context.locale, 'icon').title, (loaded) => loaded.iconSection(context));
}
