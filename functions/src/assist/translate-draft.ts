import '../global-options.js';

import {
    FIRESTORE_PATHS,
    VERTEX_DRAFTS_ROLE_ID,
    aiCostUsd,
    aiUsageDocSchema,
    draftKeepsLinks,
    estimateTokens,
    overAiCap,
    sanitizeDraft,
    translationPrompt,
    usageMonth,
    type AiUsageDoc,
    type AssistTranslateDraftRequest,
    type CallableResponse,
    type CityUsageDoc,
    type TranslationPrompt,
} from '@hcm/shared';

import { ApiError } from '../api/api-error.js';
import { defineCallable, type CallableDeps } from '../api/callable.js';
import { readCityUsage, shareOf, writeCityUsage, type CityShare } from '../api/city-usage.js';
import { withOfferedModel } from '../api/vertex-models.js';
import type { DocumentTransaction } from '../ports/documents.js';
import { UpstreamError, type UpstreamFailure } from '../ports/errors.js';
import type { Ports } from '../ports/index.js';
import { guardIsRed, requireCity, stampOf } from './records.js';

/**
 * `assist.translateDraft` (admin, App Check enforced; `docs/research/M4-interfaces.md` §4.3; S-A45-HAPPY-TRANSLATE,
 * S-A45-BAD-MARKUP-AND-LENGTH, S-A45-BAD-MONTHLY-CAP, S-A45-BAD-GUARD-PAUSED, S-A45-BAD-API-DISABLED, S-A09-BAD-AI-
 * UNAVAILABLE; M5: the city's share of AI requests, `docs/research/M5-interfaces.md` §1.8): a draft of one field's text
 * in the other language from Vertex AI Gemini, server-side only, the models and the prompt pinned (§67g: the first model
 * of `VERTEX_MODEL_IDS` the project is offered, `withOfferedModel`). A red budget guard refuses it first; then, in one
 * transaction on `usage/ai-YYYY-MM`, the month's
 * cap (`AI_MONTHLY_CAP`) refuses it or one request and its estimated cost are reserved; after the call the counters take
 * the tokens Vertex AI reports. The answer is sanitized plain text within the field's limit (`sanitizeDraft`), and a
 * draft that adds or changes a link address of the source is no draft (`apiError.assist.linksChanged`: text pasted into
 * the source may tell the model to add one, and the viewer renders a description's links); nothing is written to the
 * entity: the editor puts the draft into its own draft, and only the admin's Save publishes.
 */
export type TranslateDraftDeps = CallableDeps & Pick<Ports, 'documents' | 'clock' | 'translator'>;

type Response = CallableResponse<'assist.translateDraft'>;
type Generation = Awaited<ReturnType<Ports['translator']['generate']>>;
/** A generation and the model that made it. */
interface Drafted {
    readonly model: string;
    readonly value: Generation;
}

/** Answers that are no draft whatever their text: the model stopped for safety or recitation. */
const REFUSED_FINISH = new Set(['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII']);

type Counters = Pick<AiUsageDoc, 'requests' | 'inputTokens' | 'outputTokens' | 'usd'>;

/** A month nothing was asked in yet. */
const EMPTY_USAGE: Counters = { requests: 0, inputTokens: 0, outputTokens: 0, usd: 0 };

/** What a call of `prompt` may cost at most: its whole text in, every output token it allows out. */
export function estimateUsd(prompt: TranslationPrompt): number {
    return aiCostUsd({ inputTokens: estimateTokens(prompt.systemInstruction + prompt.userText), outputTokens: prompt.maxOutputTokens });
}

/** Changes the month's counters in one transaction; `change` may refuse (throw) after reading them. */
async function updateUsage(deps: TranslateDraftDeps, month: string, change: (spent: Counters) => Counters): Promise<void> {
    const path = FIRESTORE_PATHS.aiUsage(month);
    await deps.documents.transaction(async (transaction) => {
        const spent = (await transaction.get(path, aiUsageDocSchema)) ?? EMPTY_USAGE;
        await transaction.set(path, aiUsageDocSchema, { month, ...change(spent), ...stampOf(deps.clock.now()) });
    });
}

/** The city's counters when its share of AI requests has room left; `apiError.assist.monthlyCap` when it has none. */
async function cityRoom(
    transaction: DocumentTransaction,
    share: CityShare | undefined,
    month: string,
): Promise<{ readonly share: CityShare; readonly usage: CityUsageDoc } | undefined> {
    if (share === undefined) {
        return undefined;
    }
    const usage = await readCityUsage(transaction, share, month);
    if (usage.aiRequests >= share.limits.aiRequestsPerMonth) {
        throw new ApiError('apiError.assist.monthlyCap');
    }
    return { share, usage };
}

/**
 * Reserves one request and its estimate, or refuses with `apiError.assist.monthlyCap`: the project's cap, and (M5) the
 * city's share of AI requests counted in `cities/{city}/usage/{month}` in the same transaction.
 */
async function reserve(deps: TranslateDraftDeps, month: string, estimate: number, share: CityShare | undefined): Promise<void> {
    const path = FIRESTORE_PATHS.aiUsage(month);
    await deps.documents.transaction(async (transaction) => {
        const spent = (await transaction.get(path, aiUsageDocSchema)) ?? EMPTY_USAGE;
        if (overAiCap(spent, estimate)) {
            throw new ApiError('apiError.assist.monthlyCap');
        }
        const city = await cityRoom(transaction, share, month);
        const stamp = stampOf(deps.clock.now());
        await transaction.set(path, aiUsageDocSchema, {
            month,
            ...spent,
            requests: spent.requests + 1,
            usd: spent.usd + estimate,
            ...stamp,
        });
        if (city !== undefined) {
            await writeCityUsage(transaction, city.share, { ...city.usage, aiRequests: city.usage.aiRequests + 1 }, stamp);
        }
    });
}

/** Replaces the reservation by what the call reported (a failed call costs nothing: only its request stays counted). */
async function settle(deps: TranslateDraftDeps, month: string, estimate: number, generation: Generation | undefined): Promise<void> {
    const inputTokens = generation?.inputTokens ?? 0;
    const outputTokens = generation?.outputTokens ?? 0;
    await updateUsage(deps, month, (spent) => ({
        requests: spent.requests,
        inputTokens: spent.inputTokens + inputTokens,
        outputTokens: spent.outputTokens + outputTokens,
        usd: Math.max(0, spent.usd - estimate + aiCostUsd({ inputTokens, outputTokens })),
    }));
}

/** A refused call: the disabled API when Google named it, else the custom role the drafts need. */
function refusedDraft(error: UpstreamError): ApiError {
    return error.api === undefined
        ? new ApiError('apiError.cloud.permission', { role: VERTEX_DRAFTS_ROLE_ID })
        : new ApiError('apiError.cloud.apiDisabled', { api: error.api });
}

/** The failures with a message of their own; any other is `apiError.assist.unavailable`. */
const DRAFT_FAILURES: Partial<Readonly<Record<UpstreamFailure, (error: UpstreamError) => ApiError>>> = {
    forbidden: refusedDraft,
    rateLimited: () => new ApiError('apiError.rateLimited'),
};

/**
 * How a failed Vertex AI call reaches the admin; the field stays as it was in every case. M6 (finding 20,
 * S-A45-BAD-MODEL-UNAVAILABLE): no model of the list offered to the project is `withOfferedModel`'s
 * `apiError.assist.modelUnavailable` naming every model tried, said as the self-test says it (§67g).
 */
export function draftFailure(error: unknown): unknown {
    if (!(error instanceof UpstreamError)) {
        return error;
    }
    return DRAFT_FAILURES[error.failure]?.(error) ?? new ApiError('apiError.assist.unavailable');
}

async function generate(deps: TranslateDraftDeps, prompt: TranslationPrompt): Promise<Drafted> {
    try {
        return await withOfferedModel(deps.clock.now(), (model) => deps.translator.generate(model, prompt));
    } catch (error) {
        throw draftFailure(error);
    }
}

/**
 * The draft of a generation: `apiError.assist.noDraft` for a refused or empty answer, `apiError.assist.linksChanged` for
 * one with a link address the source does not have.
 */
function draftOf({ model, value: generation }: Drafted, data: Pick<AssistTranslateDraftRequest, 'field' | 'text'>): Response {
    const draft = REFUSED_FINISH.has(generation.finishReason) ? null : sanitizeDraft(generation.text, data.field);
    if (draft === null) {
        throw new ApiError('apiError.assist.noDraft');
    }
    if (!draftKeepsLinks(data.text, draft.text)) {
        throw new ApiError('apiError.assist.linksChanged');
    }
    return { draft: draft.text, truncated: draft.truncated, model };
}

async function translateDraft(deps: TranslateDraftDeps, data: AssistTranslateDraftRequest): Promise<Response> {
    if (await guardIsRed(deps.documents)) {
        throw new ApiError('apiError.guardPaused');
    }
    const city = await requireCity(deps.documents, data.cityId);
    const prompt = translationPrompt({ ...data, cityName: city.name[data.to] ?? city.name.ro });
    const month = usageMonth(deps.clock.now());
    const estimate = estimateUsd(prompt);
    await reserve(deps, month, estimate, shareOf(data.cityId, city));
    let drafted: Drafted | undefined;
    try {
        drafted = await generate(deps, prompt);
    } finally {
        await settle(deps, month, estimate, drafted?.value);
    }
    const { model, value } = drafted;
    deps.log.info('translation draft', { cityId: data.cityId, field: data.field, to: data.to, model, finish: value.finishReason });
    return draftOf(drafted, data);
}

export function translateDraftFunction(getDeps: () => TranslateDraftDeps) {
    return defineCallable('assist.translateDraft', (deps: TranslateDraftDeps, _caller, data) => translateDraft(deps, data), getDeps);
}
