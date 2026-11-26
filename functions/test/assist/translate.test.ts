/**
 * Translation drafts (`functions/src/assist/translate-draft.ts`, `docs/research/M4-interfaces.md` §4.3) against the fake
 * Vertex AI: the pinned model and prompt, the month's counters reserved then settled with the reported tokens, the
 * draft kept plain text within the field's limit, and every refusal (the budget guard, the monthly cap, a disabled API,
 * an outage, a safety stop) leaving the field as it was and nothing written but the counters.
 */
import {
    AI_MONTHLY_CAP,
    FIRESTORE_PATHS,
    VERTEX_MODEL_ID,
    VERTEX_MODEL_IDS,
    aiCostUsd,
    aiUsageDocSchema,
    timestampFromDate,
    translationPrompt,
    type AiUsageDoc,
} from '@hcm/shared';
import { INJECTED_LINK } from '@hcm/test-support/fakes';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { forgetModelChoice, ModelsNotOfferedError } from '../../src/api/vertex-models.js';
import { draftFailure, estimateUsd, translateDraftFunction } from '../../src/assist/translate-draft.js';
import { UpstreamError } from '../../src/ports/errors.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import { CITY, m4Deps, seedCity, seedGuard, type M4Deps } from './world.js';

const NOW = '2026-10-24T08:30:00.000Z';
const MONTH = '2026-10';

function draft(deps: M4Deps, overrides: Record<string, unknown> = {}) {
    const data = { cityId: CITY, field: 'title', from: 'ro', to: 'en', text: 'Ateneul Român', ...overrides };
    return translateDraftFunction(() => deps).run(adminCall(data));
}

function usage(deps: M4Deps, month = MONTH): Promise<AiUsageDoc | undefined> {
    return deps.documents.get(FIRESTORE_PATHS.aiUsage(month), aiUsageDocSchema);
}

async function world(): Promise<M4Deps> {
    const deps = m4Deps(NOW);
    await seedCity(deps);
    return deps;
}

async function seedUsage(deps: M4Deps, spent: Pick<AiUsageDoc, 'requests' | 'usd'>): Promise<void> {
    await deps.documents.set(FIRESTORE_PATHS.aiUsage(MONTH), aiUsageDocSchema, {
        month: MONTH,
        ...spent,
        inputTokens: 0,
        outputTokens: 0,
        updatedBy: 'system:assist',
        updatedAt: timestampFromDate(new Date(NOW)),
    });
}

// The model choice lives in the module (the functions project shares one module graph per worker): each test starts
// without one and leaves none behind.
beforeEach(() => {
    forgetModelChoice();
});
afterEach(() => {
    forgetModelChoice();
});

describe('assist.translateDraft', () => {
    it('happyPath_thePinnedModelAndPromptAndTheCountersTakeTheReportedTokens @S-A45-HAPPY-TRANSLATE', async () => {
        const deps = await world();

        await expect(draft(deps)).resolves.toEqual({ draft: 'Ateneul Român (English draft)', truncated: false, model: VERTEX_MODEL_ID });

        const prompt = translationPrompt({ from: 'ro', to: 'en', field: 'title', text: 'Ateneul Român', cityName: 'Bucharest' });
        expect(deps.upstream.state.vertexAi.requests).toEqual([
            {
                model: VERTEX_MODEL_ID,
                systemInstruction: prompt.systemInstruction,
                userText: 'Ateneul Român',
                generationConfig: { temperature: 0.2, maxOutputTokens: 100, responseMimeType: 'text/plain', candidateCount: 1 },
            },
        ]);
        expect(prompt.systemInstruction).toContain('history of Bucharest');
        await expect(usage(deps)).resolves.toEqual({
            month: MONTH,
            requests: 1,
            inputTokens: 96,
            outputTokens: 4,
            usd: aiCostUsd({ inputTokens: 96, outputTokens: 4 }),
            updatedBy: 'system:assist',
            updatedAt: timestampFromDate(new Date(NOW)),
        });
    });

    it('happyPath_aRomanianDraftNamesTheCityInRomanianAndADescriptionKeepsItsParagraphs', async () => {
        const deps = await world();
        await seedCity(deps, { name: { ro: 'București' } });

        await expect(
            draft(deps, { field: 'description', from: 'en', to: 'ro', text: 'First.\n\nSee [the plan](https://example.test/p).' }),
        ).resolves.toEqual({
            draft: 'First.\n\nSee [the plan](https://example.test/p). (ciornă în română)',
            truncated: false,
            model: VERTEX_MODEL_ID,
        });
        expect(deps.upstream.state.vertexAi.requests[0]?.systemInstruction).toContain('history of București');
    });

    it('badPath_markupControlCharactersAndLengthStayPlainTextWithinTheLimit @S-A45-BAD-MARKUP-AND-LENGTH', async () => {
        const deps = await world();
        deps.upstream.scenario('vertex-ai.markup');

        await expect(draft(deps)).resolves.toEqual({
            draft: '<b>Romanian</b> <script>alert(1)</script> Athenaeum',
            truncated: false,
            model: VERTEX_MODEL_ID,
        });

        deps.upstream.scenario('vertex-ai.ok');
        const long = await draft(deps, { text: `${'Palatul '.repeat(24)}Regal` });
        expect(long.truncated).toBe(true);
        expect(long.draft.length).toBeLessThanOrEqual(200);
    });

    it.each(['empty', 'safety'] as const)('badPath_anAnswer_%s_givesNoDraft', async (scenario) => {
        const deps = await world();
        deps.upstream.scenario(`vertex-ai.${scenario}`);

        await expect(failureOf(draft(deps))).resolves.toMatchObject({ details: { code: 'apiError.assist.noDraft' } });
        await expect(usage(deps)).resolves.toMatchObject({ requests: 1 });
    });

    it('badPath_pastTheMonthsCapNoModelIsCalled @S-A45-BAD-MONTHLY-CAP', async () => {
        const deps = await world();
        await seedUsage(deps, { requests: AI_MONTHLY_CAP.requests, usd: 0.01 });

        await expect(failureOf(draft(deps))).resolves.toMatchObject({
            code: 'failed-precondition',
            details: { code: 'apiError.assist.monthlyCap' },
        });
        await seedUsage(deps, { requests: 3, usd: AI_MONTHLY_CAP.usd });
        await expect(failureOf(draft(deps))).resolves.toMatchObject({ details: { code: 'apiError.assist.monthlyCap' } });
        expect(deps.upstream.callsTo('vertex-ai')).toEqual([]);

        deps.clock.set('2026-11-01T00:00:00.000Z');
        await expect(draft(deps)).resolves.toMatchObject({ model: VERTEX_MODEL_ID });
        await expect(usage(deps, '2026-11')).resolves.toMatchObject({ requests: 1 });
    });

    it('badPath_aRedGuardPausesTheDraftsBeforeAnything @S-A45-BAD-GUARD-PAUSED', async () => {
        const deps = await world();
        await seedGuard(deps, 'red');

        await expect(failureOf(draft(deps))).resolves.toMatchObject({ details: { code: 'apiError.guardPaused' } });
        expect(deps.upstream.callsTo('vertex-ai')).toEqual([]);
        await expect(usage(deps)).resolves.toBeUndefined();
    });

    it('happyPath_aGreenGuardLetsTheDraftThrough', async () => {
        const deps = await world();
        await seedGuard(deps, 'green');

        await expect(draft(deps)).resolves.toMatchObject({ truncated: false });
    });

    it('badPath_vertexAiNotEnabledNamesTheApi @S-A45-BAD-API-DISABLED', async () => {
        const deps = await world();
        deps.upstream.fail('vertex-ai', 'apiDisabled');

        await expect(failureOf(draft(deps))).resolves.toMatchObject({
            details: { code: 'apiError.cloud.apiDisabled', params: { api: 'aiplatform.googleapis.com' } },
        });
        await expect(usage(deps)).resolves.toMatchObject({ requests: 1, usd: 0, inputTokens: 0, outputTokens: 0 });
    });

    it('badPath_anOutageGivesNoDraftAndCostsNothing', async () => {
        const deps = await world();
        deps.upstream.fail('vertex-ai', 'unavailable');

        await expect(failureOf(draft(deps))).resolves.toMatchObject({
            code: 'unavailable',
            details: { code: 'apiError.assist.unavailable' },
        });
        await expect(usage(deps)).resolves.toMatchObject({ usd: 0 });
    });

    it('badPath_aCityWithoutAnEnglishNameIsNamedInRomanian', async () => {
        const deps = await world();
        await seedCity(deps, { name: { ro: 'București' } });

        await draft(deps);

        expect(deps.upstream.state.vertexAi.requests[0]?.systemInstruction).toContain('history of București');
    });

    it('badPath_anUnknownCityAndTheSameLanguageTwiceAreRefused', async () => {
        const deps = await world();

        await expect(failureOf(draft(deps, { cityId: 'nowhere' }))).resolves.toMatchObject({ details: { code: 'apiError.notFound' } });
        await expect(failureOf(draft(deps, { to: 'ro' }))).resolves.toMatchObject({ details: { code: 'apiError.invalidRequest' } });
        await expect(failureOf(draft(deps, { field: 'dateText', text: 'x'.repeat(101) }))).resolves.toMatchObject({
            details: { code: 'apiError.invalidRequest' },
        });
    });
});

describe('assist.translateDraft: the models (§67g)', () => {
    it('happyPath_theFirstModelNotOfferedTheNextOneDraftsAndIsKept @S-A45-HAPPY-FALLBACK-MODEL', async () => {
        const deps = await world();
        deps.upstream.scenario('vertex-ai.firstModelUnavailable');

        await expect(draft(deps)).resolves.toEqual({
            draft: 'Ateneul Român (English draft)',
            truncated: false,
            model: VERTEX_MODEL_IDS[1],
        });
        await expect(draft(deps)).resolves.toMatchObject({ model: VERTEX_MODEL_IDS[1] });

        // The second draft asks the kept model at once; the first model was tried once only.
        expect(deps.upstream.state.vertexAi.requests.map((request) => request.model)).toEqual([...VERTEX_MODEL_IDS, VERTEX_MODEL_IDS[1]]);
        await expect(usage(deps)).resolves.toMatchObject({ requests: 2 });
    });

    it('happyPath_aKeptChoiceExpiresAndTheFirstModelIsAskedAgain', async () => {
        const deps = await world();
        deps.upstream.scenario('vertex-ai.firstModelUnavailable');
        await draft(deps);
        deps.upstream.state.vertexAi.gone = [];

        deps.clock.set('2026-10-24T08:45:00.000Z');
        await expect(draft(deps)).resolves.toMatchObject({ model: VERTEX_MODEL_ID });
    });

    it('badPath_noModelOfferedNamesEveryModelTriedAndKeepsTheField @S-A45-BAD-MODEL-UNAVAILABLE', async () => {
        const deps = await world();
        deps.upstream.scenario('vertex-ai.modelUnavailable');

        await expect(failureOf(draft(deps))).resolves.toMatchObject({
            code: 'failed-precondition',
            details: { code: 'apiError.assist.modelUnavailable', params: { model: VERTEX_MODEL_IDS.join(', ') } },
        });
        expect(deps.upstream.state.vertexAi.requests.map((request) => request.model)).toEqual([...VERTEX_MODEL_IDS]);
        await expect(usage(deps)).resolves.toMatchObject({ requests: 1, inputTokens: 0, outputTokens: 0 });
    });
});

describe('assist.translateDraft: links', () => {
    it('badPath_aDraftThatAddsALinkTheSourceDoesNotHaveIsNoDraft @S-A45-BAD-LINKS-CHANGED', async () => {
        const deps = await world();
        deps.upstream.scenario('vertex-ai.injected');
        const text = 'Sala de concerte.\n\nVezi [Arhiva](https://arhiva.example/ateneu).';

        await expect(failureOf(draft(deps, { field: 'description', text }))).resolves.toMatchObject({
            details: { code: 'apiError.assist.linksChanged' },
        });
        // The request is counted: the model answered, only its draft is refused.
        await expect(usage(deps)).resolves.toMatchObject({ requests: 1 });
        expect(INJECTED_LINK).toContain('https://injected.example/');
    });
});

describe('draftFailure', () => {
    it.each([
        [new UpstreamError('vertex-ai', 'rateLimited'), 'apiError.rateLimited', undefined],
        [new UpstreamError('vertex-ai', 'forbidden'), 'apiError.cloud.permission', { role: 'hcmVertexDrafts' }],
        [new UpstreamError('vertex-ai', 'invalid'), 'apiError.assist.unavailable', undefined],
        // M6 (finding 20), §67g: no model of the list offered to the project names every model tried.
        [
            new ModelsNotOfferedError(VERTEX_MODEL_IDS, new UpstreamError('vertex-ai', 'notFound', { status: 404 })),
            'apiError.assist.modelUnavailable',
            { model: 'gemini-3.5-flash-lite, gemini-3.1-flash-lite' },
        ],
        [new UpstreamError('vertex-ai', 'notFound', { status: 404 }), 'apiError.assist.unavailable', undefined],
    ])('%s', (error, code, params) => {
        expect(draftFailure(error)).toMatchObject({ code, params });
    });

    it('happyPath_anythingElsePassesThrough', () => {
        const error = new Error('boom');

        expect(draftFailure(error)).toBe(error);
    });
});

describe('estimateUsd', () => {
    it('happyPath_theEstimateCountsEveryAllowedOutputToken', () => {
        const prompt = translationPrompt({ from: 'ro', to: 'en', field: 'description', text: 'x'.repeat(300), cityName: 'Bucharest' });

        expect(estimateUsd(prompt)).toBeGreaterThan(aiCostUsd({ inputTokens: 100, outputTokens: prompt.maxOutputTokens }));
    });
});
