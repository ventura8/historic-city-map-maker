import { VERTEX_MODEL_IDS } from '@hcm/shared';

import { fixtureBody, fixtureResponse } from '../api-fixtures/index.js';
import type { UpstreamRequest } from './fetch.js';
import { authenticated, googleError, googleFailure, type GoogleApi } from './google-common.js';
import { jsonResponse, requestObject, route } from './routes.js';
import type { ServiceFake } from './service.js';

/**
 * Vertex AI Gemini (`docs/research/M4-interfaces.md` §4.3, §8), which only the server calls (`assist.translateDraft` and
 * the setup self-test, with the functions' service account): `generateContent` answers a scripted draft per outcome and
 * records the model, the system instruction, the user's text and the generation config of every request; `countTokens`
 * answers one token. The outcome is `vertex-ai.ok` (a draft that names its language), `.markup` (markup, an invisible
 * character and a wrapping fence the server must strip to plain text), `.injected` (the draft plus a link the source does
 * not have, as text pasted into the source might ask for), `.empty` (blank text) or `.safety` (stopped by the safety
 * filters); `fail('vertex-ai', 'unavailable' | 'rateLimited' | 'apiDisabled' | 'forbidden')` answers Google's
 * error envelopes (`SERVICE_DISABLED` names `aiplatform.googleapis.com`). M6 (finding 20): `vertex-ai.modelUnavailable`
 * answers both verbs 404 `NOT_FOUND`, as Google does for a publisher model it retired or does not offer to the project.
 * §67g (the functions try the models of `VERTEX_MODEL_IDS` in order): `vertex-ai.firstModelUnavailable` answers 404 for
 * the first model only, so the next one answers; every request records the model it named.
 */

export const VERTEX_OUTCOMES = ['ok', 'markup', 'injected', 'empty', 'safety'] as const;

export type VertexOutcome = (typeof VERTEX_OUTCOMES)[number];

export interface VertexRequest {
    readonly model: string;
    readonly systemInstruction: string;
    readonly userText: string;
    readonly generationConfig: unknown;
}

export interface VertexAiState {
    outcome: VertexOutcome;
    /** M6: no model is served to the project (every call answers 404). */
    modelGone: boolean;
    /** §67g: the models not served to the project (their calls answer 404), the others answer. */
    gone: string[];
    /** The model each `countTokens` call named, in order. */
    readonly counted: string[];
    readonly requests: VertexRequest[];
    /** How many `countTokens` calls (the self-test's) were answered. */
    countTokens: number;
}

export function defaultVertexAiState(): VertexAiState {
    return { outcome: 'ok', modelGone: false, gone: [], counted: [], requests: [], countTokens: 0 };
}

const API: GoogleApi = { service: 'aiplatform.googleapis.com', title: 'Vertex AI API', permission: 'aiplatform.endpoints.predict' };

const BASE = 'https://us-central1-aiplatform.googleapis.com/v1/projects/{project}/locations/{location}/publishers/google/models';

/** The markup outcome's answer: a fence, markup, a control character and a zero-width space; the server keeps it as text. */
const MARKUP_ANSWER = '```html\n<b>Romanian</b>\u0007<script>alert(1)</script>\u200B Athenaeum\n```';

/** The link the injected outcome adds to the draft (the server refuses the draft for it). */
export const INJECTED_LINK = '[More](https://injected.example/offer)';

function record(value: unknown): Readonly<Record<string, unknown>> {
    return typeof value === 'object' && value !== null ? (value as Readonly<Record<string, unknown>>) : {};
}

/** The text of the first part of `content` (`{parts: [{text}]}`), or empty. */
function firstText(content: unknown): string {
    const parts = record(content)['parts'];
    const first: unknown = Array.isArray(parts) ? parts[0] : undefined;
    const text = record(first)['text'];
    return typeof text === 'string' ? text : '';
}

function requestOf(request: UpstreamRequest, model: string): VertexRequest {
    const body = requestObject(request);
    const contents = body['contents'];
    return {
        model,
        systemInstruction: firstText(body['systemInstruction']),
        userText: firstText(Array.isArray(contents) ? contents[0] : undefined),
        generationConfig: body['generationConfig'] ?? null,
    };
}

/** The ok outcome's draft: the admin's text with the language it was asked for, so a test sees which one. */
function draftOf(asked: VertexRequest): string {
    const english = asked.systemInstruction.includes('to English');
    return english ? `${asked.userText} (English draft)` : `${asked.userText} (ciornă în română)`;
}

const SCRIPTED: Partial<Readonly<Record<VertexOutcome, (asked: VertexRequest) => string>>> = {
    markup: () => MARKUP_ANSWER,
    injected: (asked) => `${draftOf(asked)} ${INJECTED_LINK}`,
    empty: () => '   ',
};

function candidateText(outcome: VertexOutcome, asked: VertexRequest): string {
    return (SCRIPTED[outcome] ?? draftOf)(asked);
}

function generated(state: VertexAiState, asked: VertexRequest): Response {
    if (state.outcome === 'safety') {
        return fixtureResponse('vertex-ai/generate.safety');
    }
    const candidate = { content: { role: 'model', parts: [{ text: candidateText(state.outcome, asked) }] }, finishReason: 'STOP' };
    return fixtureResponse('vertex-ai/generate.ok', { merge: { candidates: [candidate] } });
}

/** Google's answer for a publisher model it does not serve to the project (M6, finding 20). */
function modelNotFound(): Response {
    return googleError('google/error.not-found', API);
}

/** Whether the fake serves `model` to the project. */
function served(state: VertexAiState, model: string): boolean {
    return !state.modelGone && !state.gone.includes(model);
}

/** The model named by a `{model}:{verb}` segment. */
function modelOf(segment: string | undefined): string {
    return (segment ?? '').split(':')[0] ?? '';
}

export function createVertexAiFake(state: VertexAiState): ServiceFake {
    return {
        name: 'vertex-ai',
        routes: [
            route(
                'POST',
                `${BASE}/{model}:generateContent`,
                'vertex-ai.generateContent',
                authenticated(API, (request, params) => {
                    const asked = requestOf(request, modelOf(params['model']));
                    state.requests.push(asked);
                    return served(state, asked.model) ? generated(state, asked) : modelNotFound();
                }),
            ),
            route(
                'POST',
                `${BASE}/{model}:countTokens`,
                'vertex-ai.countTokens',
                authenticated(API, (_request, params) => {
                    const model = modelOf(params['model']);
                    state.countTokens += 1;
                    state.counted.push(model);
                    return served(state, model) ? jsonResponse(fixtureBody('vertex-ai/count-tokens.ok')) : modelNotFound();
                }),
            ),
        ],
        failure: (mode) => googleFailure(API, mode),
        scenarios: {
            ...Object.fromEntries(
                VERTEX_OUTCOMES.map((outcome) => [
                    outcome,
                    () => {
                        state.outcome = outcome;
                    },
                ]),
            ),
            modelUnavailable: () => {
                state.modelGone = true;
            },
            firstModelUnavailable: () => {
                state.gone = [VERTEX_MODEL_IDS[0]];
            },
        },
        snapshot: () => ({
            outcome: state.outcome,
            modelGone: state.modelGone,
            gone: state.gone,
            requests: state.requests,
            countTokens: state.countTokens,
            counted: state.counted,
        }),
    };
}
