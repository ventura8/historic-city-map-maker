import { VERTEX_LOCATION, type TranslationPrompt } from '@hcm/shared';

import { UpstreamError } from '../ports/errors.js';
import type { TokenProvider } from '../ports/token-provider.js';
import type { Translator } from '../ports/translator.js';
import { googleError, googleSend } from './google-call.js';
import { at, list, readJson, stringAt, type Fetch } from './upstream-http.js';

/**
 * Vertex AI Gemini (`docs/research/M4-interfaces.md` §4.3) over REST with the functions' own service account
 * (`fn-admin@`, the custom role `hcmVertexDrafts`): no API key anywhere, never called from a browser (security review §0.9).
 * `generateContent` sends the pinned prompt (`translationPrompt`: the system instruction, the admin's text as the only
 * user turn, one candidate of plain text); `countTokens` proves the API, the role and the model for the setup self-test
 * without a charge.
 *
 * Failures (`UpstreamError('vertex-ai', …)`, `google-call.ts`): a disabled API → `forbidden` with `api`
 * (`aiplatform.googleapis.com`), a missing role → `forbidden`, a quota → `rateLimited`, 5xx and the 20 s timeout →
 * `unavailable`, an answer without a candidate → `invalid`. The model's text is returned as it is; `sanitizeDraft` makes
 * the draft.
 */
type Generation = Awaited<ReturnType<Translator['generate']>>;

const SERVICE = 'vertex-ai';

export interface VertexAiOptions {
    readonly projectId: string;
    readonly tokens: TokenProvider;
    readonly fetch: Fetch;
    /** `VERTEX_LOCATION` unless a test says otherwise. */
    readonly location?: string;
}

/** `https://us-central1-aiplatform.googleapis.com/v1/projects/p/locations/us-central1/publishers/google/models/m:verb`. */
export function vertexModelUrl(projectId: string, location: string, model: string, verb: 'generateContent' | 'countTokens'): string {
    const path = [
        'v1/projects',
        encodeURIComponent(projectId),
        'locations',
        encodeURIComponent(location),
        'publishers/google/models',
        `${encodeURIComponent(model)}:${verb}`,
    ].join('/');
    return `https://${location}-aiplatform.googleapis.com/${path}`;
}

function userTurn(text: string) {
    return [{ role: 'user', parts: [{ text }] }];
}

/** The request body of `generateContent` for the pinned prompt. */
export function generateBody(prompt: TranslationPrompt) {
    return {
        systemInstruction: { parts: [{ text: prompt.systemInstruction }] },
        contents: userTurn(prompt.userText),
        generationConfig: {
            temperature: prompt.temperature,
            maxOutputTokens: prompt.maxOutputTokens,
            responseMimeType: 'text/plain',
            candidateCount: 1,
        },
    };
}

function count(value: unknown): number {
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

/** Every text part of the first candidate, joined (a long answer may come in several parts). */
function textOf(candidate: unknown): string {
    return list(at(candidate, 'content', 'parts'))
        .map((part) => stringAt(part, 'text') ?? '')
        .join('');
}

function generationOf(body: unknown): Generation {
    const candidate = list(at(body, 'candidates'))[0];
    if (candidate === undefined) {
        throw new UpstreamError(SERVICE, 'invalid');
    }
    return {
        text: textOf(candidate),
        finishReason: stringAt(candidate, 'finishReason') ?? 'OTHER',
        inputTokens: count(at(body, 'usageMetadata', 'promptTokenCount')),
        outputTokens: count(at(body, 'usageMetadata', 'candidatesTokenCount')),
    };
}

export function createVertexAi(options: VertexAiOptions): Translator {
    const location = options.location ?? VERTEX_LOCATION;
    const post = async (model: string, verb: 'generateContent' | 'countTokens', body: unknown): Promise<unknown> => {
        const accessToken = await options.tokens.accessToken();
        const url = vertexModelUrl(options.projectId, location, model, verb);
        const response = await googleSend(options.fetch, SERVICE, url, { method: 'POST', accessToken, body });
        if (!response.ok) {
            throw await googleError(SERVICE, response);
        }
        return readJson(response);
    };
    return {
        generate: async (model, prompt) => generationOf(await post(model, 'generateContent', generateBody(prompt))),
        countTokens: async (model, text) => {
            const total = at(await post(model, 'countTokens', { contents: userTurn(text) }), 'totalTokens');
            if (typeof total !== 'number') {
                throw new UpstreamError(SERVICE, 'invalid');
            }
            return total;
        },
    };
}
