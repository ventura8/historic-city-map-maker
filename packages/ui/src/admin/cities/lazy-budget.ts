/**
 * The city's budget card as a chunk of its own (M5, `docs/research/M5-interfaces.md` §1.8; the admin's
 * `city-budget-<hash>.js`, its budget in `scripts/ci/check_bundle_budget.py`): fetched the first time its section opens,
 * Loading until then, a failed fetch with Try again; the page renders again when a fetch settles (`refresh`).
 */
import type { UiLocale } from '@hcm/shared';
import { html, type TemplateResult } from 'lit';

import { errorTemplate, loadingTemplate } from '../editing/states.js';
import { chunkLoader, type ChunkLoader } from '../imagery/orders/lazy-card.js';
import { contentText } from '../shell/text.js';
import type { budgetCard, BudgetCardContext } from './city-budget.js';

export interface BudgetCardChunk {
    readonly budgetCard: typeof budgetCard;
}

export const BUDGET_CARD_CHUNK: ChunkLoader<BudgetCardChunk> = chunkLoader(async () => import('./city-budget.js'));

const CHUNK_FAILURE = { kind: 'unavailable', code: 'network' } as const;

export interface LazyBudgetContext extends BudgetCardContext {
    readonly refresh: () => void;
}

/** What a lazy card of Settings needs of its section: the language, and a way to render the page again. */
interface LazyCardContext {
    readonly locale: UiLocale;
    readonly refresh: () => void;
}

/**
 * A Settings card whose chunk is fetched on first need (the budget's, the export's, the browser tab icon's): the card once its chunk
 * is in; until then the section's heading with Loading, or the failed fetch with Try again. The page renders again
 * when a fetch settles.
 */
export function lazyCard<Chunk>(
    context: LazyCardContext,
    chunk: ChunkLoader<Chunk>,
    title: string,
    card: (loaded: Chunk) => TemplateResult,
): TemplateResult {
    const loaded = chunk.loaded();
    if (loaded !== undefined) {
        return card(loaded);
    }
    const heading = html`<h2 tabindex="-1" data-detail-heading>${title}</h2>`;
    const fetchChunk = (): void => {
        chunk.load().then(context.refresh, context.refresh);
    };
    if (chunk.failed()) {
        return html`${heading}${errorTemplate(context.locale, CHUNK_FAILURE, () => {
            fetchChunk();
            context.refresh();
        })}`;
    }
    fetchChunk();
    return html`${heading}${loadingTemplate(context.locale)}`;
}

/** The section's card, fetched on first need. */
export function lazyBudgetCard(context: LazyBudgetContext, chunk: ChunkLoader<BudgetCardChunk> = BUDGET_CARD_CHUNK): TemplateResult {
    return lazyCard(context, chunk, contentText(context.locale, 'adminContent.budgets.title'), (loaded) => loaded.budgetCard(context));
}
