/**
 * Export the city as a chunk of its own (M5, `docs/research/M5-interfaces.md` §5.6; the admin's `export-card-<hash>.js`,
 * its budget in `scripts/ci/check_bundle_budget.py`): Settings keeps its budget, and the card is fetched the first time
 * its section opens. Until the chunk is in, the section says Loading; a failed fetch says so with Try again; once it is
 * in, every render is synchronous. The page renders again when a fetch settles (`refresh`).
 */
import type { TemplateResult } from 'lit';

import { lazyCard } from '../cities/lazy-budget.js';
import { chunkLoader, type ChunkLoader } from '../imagery/orders/lazy-card.js';
import { contentText } from '../shell/text.js';
import type { exportCard, ExportCardContext } from './export-card.js';

/** What the chunk gives the settings page: the card's template. */
export interface ExportCardChunk {
    readonly exportCard: typeof exportCard;
}

/** The card's chunk: one dynamic `import()`, so the bundler splits it. */
export const EXPORT_CARD_CHUNK: ChunkLoader<ExportCardChunk> = chunkLoader(async () => import('./export-card.js'));

/** What the settings page gives the lazy card: the card's own context and a way to render the page again. */
export interface LazyExportContext extends Omit<ExportCardContext, 'save'> {
    readonly refresh: () => void;
}

/**
 * Saves a ready export: a link to its signed address, followed once and dropped, so the browser downloads it (the
 * server's `Content-Disposition` names the file) and the address never shows on the page.
 */
export function saveFrom(scope: { readonly document: Document }): ExportCardContext['save'] {
    return (target) => {
        const link = scope.document.createElement('a');
        link.href = target.url;
        link.download = target.fileName;
        link.rel = 'noopener';
        link.hidden = true;
        scope.document.body.append(link);
        link.click();
        link.remove();
    };
}

/** The section's card, fetched on first need (`lazyCard`: Loading, or the failed fetch with Try again, until then). */
export function lazyExportCard(
    context: LazyExportContext,
    chunk: ChunkLoader<ExportCardChunk> = EXPORT_CARD_CHUNK,
    scope: { readonly document: Document } = globalThis,
): TemplateResult {
    return lazyCard(context, chunk, contentText(context.locale, 'adminContent.export.title'), (loaded) =>
        loaded.exportCard({ ...context, save: saveFrom(scope) }),
    );
}
