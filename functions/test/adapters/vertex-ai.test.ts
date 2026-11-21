/**
 * The Vertex AI adapter (`functions/src/adapters/vertex-ai.ts`, `docs/research/M4-interfaces.md` §4.3) against the shared
 * fake Vertex AI: the pinned prompt as `generateContent` receives it, the answer's text, finish reason and token counts,
 * `countTokens` for the self-test, and Google's failures (a disabled API names itself). No network, no key.
 */
import { VERTEX_MODEL_ID, translationPrompt } from '@hcm/shared';
import { createFakeFetch, jsonResponse, route, routeTable } from '@hcm/test-support/fakes';
import { describe, expect, it } from 'vitest';

import { createVertexAi, generateBody, vertexModelUrl } from '../../src/adapters/vertex-ai.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { PROJECT_ID, SERVICE_TOKENS, m4Upstreams } from '../support/m4-upstreams.js';

const PROMPT = translationPrompt({ from: 'ro', to: 'en', field: 'title', text: 'Ateneul Român', cityName: 'Bucharest' });

describe('generate', () => {
    it('happyPath_thePinnedPromptGoesOutAndTheDraftComesBack', async () => {
        const { fakes, translator } = m4Upstreams();

        await expect(translator.generate(VERTEX_MODEL_ID, PROMPT)).resolves.toEqual({
            text: 'Ateneul Român (English draft)',
            finishReason: 'STOP',
            inputTokens: 96,
            outputTokens: 4,
        });
        expect(fakes.state.vertexAi.requests).toEqual([
            {
                model: VERTEX_MODEL_ID,
                systemInstruction: PROMPT.systemInstruction,
                userText: 'Ateneul Român',
                generationConfig: { temperature: 0.2, maxOutputTokens: 100, responseMimeType: 'text/plain', candidateCount: 1 },
            },
        ]);
        const [call] = fakes.callsTo('vertex-ai.generateContent');
        expect(call?.url).toBe(vertexModelUrl(PROJECT_ID, 'us-central1', VERTEX_MODEL_ID, 'generateContent'));
        expect(call?.headers['authorization']).toBe('Bearer test-service-account-token');
    });

    it('happyPath_theBodyHasOneUserTurnOnly', () => {
        expect(generateBody(PROMPT).contents).toEqual([{ role: 'user', parts: [{ text: 'Ateneul Român' }] }]);
    });

    it('badPath_aSafetyStopHasNoText', async () => {
        const { fakes, translator } = m4Upstreams();
        fakes.scenario('vertex-ai.safety');

        await expect(translator.generate(VERTEX_MODEL_ID, PROMPT)).resolves.toEqual({
            text: '',
            finishReason: 'SAFETY',
            inputTokens: 96,
            outputTokens: 0,
        });
    });

    it('badPath_anAnswerWithoutACandidateIsInvalid', async () => {
        const url = vertexModelUrl(PROJECT_ID, 'europe-west1', VERTEX_MODEL_ID, 'generateContent');
        const upstream = createFakeFetch(routeTable([route('POST', url, 'vertex.generate', () => jsonResponse({ candidates: [] }))]));
        const translator = createVertexAi({
            projectId: PROJECT_ID,
            tokens: SERVICE_TOKENS,
            fetch: upstream.fetch,
            location: 'europe-west1',
        });

        await expect(translator.generate(VERTEX_MODEL_ID, PROMPT)).rejects.toEqual(new UpstreamError('vertex-ai', 'invalid'));
    });

    it('badPath_aCandidateWithoutReasonOrUsageCountsNothing', async () => {
        const url = vertexModelUrl(PROJECT_ID, 'us-central1', VERTEX_MODEL_ID, 'generateContent');
        const body = {
            candidates: [{ content: { parts: [{ text: 'a' }, { inline: true }, { text: 'b' }] } }],
            usageMetadata: { promptTokenCount: -1 },
        };
        const upstream = createFakeFetch(routeTable([route('POST', url, 'vertex.generate', () => jsonResponse(body))]));
        const translator = createVertexAi({ projectId: PROJECT_ID, tokens: SERVICE_TOKENS, fetch: upstream.fetch });

        await expect(translator.generate(VERTEX_MODEL_ID, PROMPT)).resolves.toEqual({
            text: 'ab',
            finishReason: 'OTHER',
            inputTokens: 0,
            outputTokens: 0,
        });
    });

    it('badPath_aDisabledApiNamesItself', async () => {
        const { fakes, translator } = m4Upstreams();
        fakes.fail('vertex-ai', 'apiDisabled');

        await expect(translator.generate(VERTEX_MODEL_ID, PROMPT)).rejects.toMatchObject({
            service: 'vertex-ai',
            failure: 'forbidden',
            api: 'aiplatform.googleapis.com',
        });
    });

    it.each([
        ['unavailable', 'unavailable'],
        ['rateLimited', 'rateLimited'],
        ['forbidden', 'forbidden'],
    ] as const)('badPath_aFakeIn_%s_failsAs_%s', async (mode, failure) => {
        const { fakes, translator } = m4Upstreams();
        fakes.fail('vertex-ai', mode);

        await expect(translator.generate(VERTEX_MODEL_ID, PROMPT)).rejects.toMatchObject({ service: 'vertex-ai', failure, api: undefined });
    });
});

describe('countTokens', () => {
    it('happyPath_theSelfTestsCheckCostsNothing', async () => {
        const { fakes, translator } = m4Upstreams();

        await expect(translator.countTokens(VERTEX_MODEL_ID, 'test')).resolves.toBe(1);
        expect(fakes.state.vertexAi.countTokens).toBe(1);
        expect(fakes.callsTo('vertex-ai.generateContent')).toEqual([]);
    });

    it('badPath_anAnswerWithoutACountIsInvalid', async () => {
        const url = vertexModelUrl(PROJECT_ID, 'us-central1', VERTEX_MODEL_ID, 'countTokens');
        const upstream = createFakeFetch(routeTable([route('POST', url, 'vertex.count', () => jsonResponse({}))]));
        const translator = createVertexAi({ projectId: PROJECT_ID, tokens: SERVICE_TOKENS, fetch: upstream.fetch });

        await expect(translator.countTokens(VERTEX_MODEL_ID, 'test')).rejects.toEqual(new UpstreamError('vertex-ai', 'invalid'));
    });
});
