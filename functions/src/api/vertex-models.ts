import { VERTEX_MODEL_IDS } from '@hcm/shared';

import { UpstreamError } from '../ports/errors.js';
import { ApiError } from './api-error.js';

/**
 * Which Gemini model of `VERTEX_MODEL_IDS` the project is offered (`DECISIONS-for-review.md` §67g, the user's decision
 * of 2026-11-01): Google retires a model id on its lifecycle's dates, and a retired or unoffered id answers 404. The
 * assists and the setup self-test call through {@link withOfferedModel}: the models in order (the instance's last
 * choice first while it is fresh), a 404 moving to the next, anything else being the answer. The choice is kept in the
 * instance's memory for `MODEL_CHOICE_TTL_MS`, so a draft does not probe again each time; a 404 of the kept model
 * probes the list again.
 */

/** How long an instance keeps the model it found offered before probing again: 10 minutes. */
const MODEL_CHOICE_TTL_MS = 10 * 60 * 1000;

/**
 * No model of the list is offered to the project: `apiError.assist.modelUnavailable` naming every model tried, with the
 * last 404 kept so a log line can say what Google answered (never its message).
 */
export class ModelsNotOfferedError extends ApiError {
    readonly upstream: UpstreamError;

    constructor(tried: readonly string[], upstream: UpstreamError) {
        super('apiError.assist.modelUnavailable', { model: tried.join(', ') });
        this.upstream = upstream;
    }
}

interface Choice {
    readonly model: string;
    readonly until: number;
}

let choice: Choice | undefined;

/** Forgets the instance's choice (a test's fresh start). */
export function forgetModelChoice(): void {
    choice = undefined;
}

/** The models to try at `now`: the kept choice first while it is fresh, then the rest in the list's order. */
function modelsAt(now: number): readonly [string, ...string[]] {
    const kept = choice !== undefined && choice.until > now ? choice.model : undefined;
    return kept === undefined ? VERTEX_MODEL_IDS : [kept, ...VERTEX_MODEL_IDS.filter((model) => model !== kept)];
}

const notOffered = (error: unknown): error is UpstreamError => error instanceof UpstreamError && error.failure === 'notFound';

/** What one model answered: its value, or the 404 that says it is not offered (anything else is thrown). */
type Attempt<T> = { readonly model: string; readonly value: T } | { readonly missing: UpstreamError };

async function attemptOne<T>(model: string, attempt: (model: string) => Promise<T>): Promise<Attempt<T>> {
    try {
        return { model, value: await attempt(model) };
    } catch (error) {
        if (notOffered(error)) {
            return { missing: error };
        }
        throw error;
    }
}

/** `model`, then each of `rest` while the one before was not offered; the last 404 when none was. */
async function firstOffered<T>(model: string, rest: readonly string[], attempt: (model: string) => Promise<T>): Promise<Attempt<T>> {
    const answer = await attemptOne(model, attempt);
    const [next, ...others] = rest;
    return 'missing' in answer && next !== undefined ? firstOffered(next, others, attempt) : answer;
}

/**
 * Calls `attempt` with the first model the project is offered and keeps that choice; `ModelsNotOfferedError` when every
 * model answered 404 (the choice forgotten), any other failure unchanged.
 */
export async function withOfferedModel<T>(
    now: Date,
    attempt: (model: string) => Promise<T>,
): Promise<{ readonly model: string; readonly value: T }> {
    const [first, ...rest] = modelsAt(now.getTime());
    const answer = await firstOffered(first, rest, attempt);
    if ('missing' in answer) {
        choice = undefined;
        throw new ModelsNotOfferedError(VERTEX_MODEL_IDS, answer.missing);
    }
    choice = { model: answer.model, until: now.getTime() + MODEL_CHOICE_TTL_MS };
    return answer;
}
