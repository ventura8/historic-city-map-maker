/** The assists (M4, behaviour A45; docs/research/M4-interfaces.md §4): the geocoding cache, the AI cap, the prompt, drafts. */
import { describe, expect, it } from 'vitest';

import {
    AI_MONTHLY_CAP,
    aiCostUsd,
    aiUsageDocSchema,
    assistStateDocSchema,
    draftKeepsLinks,
    estimateTokens,
    geocodeCellCenter,
    geocodeCellDocSchema,
    geocodeCellKey,
    NOMINATIM_ATTRIBUTION,
    overAiCap,
    queuedOn,
    sanitizeDraft,
    TRANSLATION_PROMPT_VERSION,
    translationPrompt,
    utcDay,
} from '../../src/schemas/assist.js';
import { timestampFromDate } from '../../src/schemas/firestore-common.js';
import { GEOCODE_KEY_PATTERN } from '../../src/schemas/paths.js';
import { validate } from '../../src/schemas/validation.js';

const NOW = timestampFromDate(new Date('2026-10-24T08:00:00Z'));
/** Written by code point: an editor or a formatter must never turn them into invisible characters in the source. */
const RLO = String.fromCodePoint(0x202e);
const ZWSP = String.fromCodePoint(0x200b);
const COMMA_BELOW = String.fromCodePoint(0x0326);
const NUL = String.fromCodePoint(0);
const STAMP = { updatedBy: 'system:assist', updatedAt: NOW };

describe('the geocoding cache', () => {
    it.each([
        [44.426812, 26.102538, 'n444268_e261025'],
        [-33.86882, 151.20929, 's338688_e1512093'],
        [40.7128, -74.006, 'n407128_w740060'],
    ])('happyPath_%f_%f_isCell_%s', (lat, lng, key) => {
        expect(geocodeCellKey(lat, lng)).toBe(key);
        expect(GEOCODE_KEY_PATTERN.test(key)).toBe(true);
    });

    it('happyPath_aCellsCentreIsTheRoundedPlace', () => {
        expect(geocodeCellCenter('s338688_w1512093')).toEqual({ lat: -33.8688, lng: -151.2093 });
        expect(geocodeCellCenter(geocodeCellKey(44.426812, 26.102538))).toEqual({ lat: 44.4268, lng: 26.1025 });
    });

    it.each(['n444268', 'x444268_e261025', 'n444268_e26102500', ''])('badPath_%s_hasNoCentre', (key) => {
        expect(geocodeCellCenter(key)).toBeUndefined();
    });

    it('happyPath_aCellAndTheCoolDownValidate', () => {
        const cell = {
            state: 'ready',
            suggestions: [{ ro: 'Strada Lipscani', en: 'Lipscani Street' }, { ro: 'Centrul Vechi' }],
            attribution: NOMINATIM_ATTRIBUTION,
            requestedAt: NOW,
            answeredAt: NOW,
            expiresAt: NOW,
            ...STAMP,
        };

        expect(validate(geocodeCellDocSchema, cell).ok).toBe(true);
        expect(validate(geocodeCellDocSchema, { ...cell, state: 'failed', suggestions: [], error: 'apiError.assist.rateLimited' }).ok).toBe(
            true,
        );
        expect(validate(assistStateDocSchema, { nominatimCoolUntil: NOW, ...STAMP }).ok).toBe(true);
    });

    it('badPath_fourSuggestionsAreRefused', () => {
        const suggestions = ['a', 'b', 'c', 'd'].map((ro) => ({ ro }));

        expect(
            validate(geocodeCellDocSchema, { state: 'ready', suggestions, attribution: 'x', requestedAt: NOW, expiresAt: NOW, ...STAMP })
                .ok,
        ).toBe(false);
    });
});

describe('the monthly AI cap', () => {
    it('happyPath_theCostFollowsTheTokens', () => {
        expect(aiCostUsd({ inputTokens: 1_000_000, outputTokens: 1_000_000 })).toBeCloseTo(0.5);
        expect(estimateTokens('Strada Lipscani')).toBe(5);
    });

    it.each([
        [undefined, 0.001, false],
        [{ requests: AI_MONTHLY_CAP.requests - 1, usd: 0.1 }, 0.001, false],
        [{ requests: AI_MONTHLY_CAP.requests, usd: 0.1 }, 0.001, true],
        [{ requests: 3, usd: AI_MONTHLY_CAP.usd - 0.0001 }, 0.001, true],
    ])('happyPath_usage_%j_plus_%f_isOverTheCap_%s', (usage, estimate, over) => {
        expect(overAiCap(usage, estimate)).toBe(over);
    });

    it('badPath_aNegativeCountIsRefused', () => {
        expect(validate(aiUsageDocSchema, { month: '2026-10', requests: -1, inputTokens: 0, outputTokens: 0, usd: 0, ...STAMP }).ok).toBe(
            false,
        );
    });
});

describe('the translation prompt', () => {
    it('happyPath_thePinnedPromptOfVersion1', () => {
        expect(TRANSLATION_PROMPT_VERSION).toBe(1);
        expect(translationPrompt({ from: 'ro', to: 'en', field: 'title', text: 'Casa Capșa', cityName: 'Bucharest' })).toEqual({
            systemInstruction:
                'You translate the title of a place or a photograph on a public map of the history of Bucharest, from Romanian to English. ' +
                'Answer with the translation only, as plain text: no quotes, no notes, no explanations, no HTML. ' +
                'Keep proper names, street names, numbers, years and dates as they are; keep every Markdown link and its address exactly. ' +
                'If the text is already in English, answer with it unchanged.',
            userText: 'Casa Capșa',
            maxOutputTokens: 100,
            temperature: 0.2,
        });
    });

    it('happyPath_aDescriptionMayAnswerAtLength', () => {
        expect(translationPrompt({ from: 'en', to: 'ro', field: 'description', text: 'x', cityName: 'București' }).maxOutputTokens).toBe(
            2048,
        );
        expect(translationPrompt({ from: 'en', to: 'ro', field: 'dateText', text: 'x', cityName: 'București' }).maxOutputTokens).toBe(64);
    });
});

describe('a draft is plain text', () => {
    it.each([
        ['quotes around the answer', '“Capșa House”', 'title', 'Capșa House'],
        ['a code fence with a language', '```text\nCapșa House\n```', 'title', 'Capșa House'],
        ['a bare code fence', '```Capșa House```', 'title', 'Capșa House'],
        ['invisible bidirectional marks', `Cap${RLO}șa${ZWSP} House`, 'title', 'Capșa House'],
        ['a line feed in a title', 'Capșa\nHouse', 'title', 'Capșa House'],
        ['control characters', 'Capșa\u0007 House\u0000', 'title', 'Capșa House'],
        ['paragraphs of a description', 'One.\r\n\n\n\nTwo  words.\u0085', 'description', 'One.\n\nTwo words.'],
        ['markup, kept as text', '<b>Capșa</b>', 'title', '<b>Capșa</b>'],
        ['decomposed letters', `Caps${COMMA_BELOW}a`, 'title', 'Capșa'],
    ] as const)('happyPath_%s', (_name, raw, field, text) => {
        expect(sanitizeDraft(raw, field)).toEqual({ text, truncated: false });
    });

    it('badPath_aLongDraftIsCutAtASpace', () => {
        const draft = sanitizeDraft(`${'word '.repeat(30)}end`, 'dateText');

        expect(draft?.truncated).toBe(true);
        expect(draft?.text).toBe('word '.repeat(20).trim());
    });

    it('badPath_aLongWordIsCutAtTheLimit', () => {
        expect(sanitizeDraft('x'.repeat(150), 'dateText')).toEqual({ text: 'x'.repeat(100), truncated: true });
    });

    it.each(['', '   ', '""', '```\n```', `${ZWSP}${NUL}`])('badPath_%j_isNoDraft', (raw) => {
        expect(sanitizeDraft(raw, 'title')).toBeNull();
    });
});

describe('draftKeepsLinks', () => {
    const SOURCE = 'Sala.\n\nVezi [Arhiva](https://arhiva.example/ateneu) și **[planul](https://arhiva.example/plan)**.';

    it('happyPath_aDraftWithTheSourcesLinksOrNoneKeepsThem', () => {
        expect(draftKeepsLinks(SOURCE, 'Hall.\n\nSee [the archive](https://arhiva.example/ateneu).')).toBe(true);
        expect(draftKeepsLinks(SOURCE, '_[Plan](https://arhiva.example/plan)_ and [archive](https://arhiva.example/ateneu)')).toBe(true);
        expect(draftKeepsLinks('Ateneul Român', 'Romanian Athenaeum')).toBe(true);
    });

    it.each([
        ['adds a link', 'Hall. [More](https://injected.example/offer)'],
        ['changes an address', 'See [the archive](https://arhiva.example/other)'],
        ['adds an address it keeps as text', 'See [the archive](http://arhiva.example/ateneu)'],
    ])('badPath_aDraftThat_%s_doesNotKeepThem', (_name, draft) => {
        expect(draftKeepsLinks(SOURCE, draft)).toBe(false);
    });
});

describe('the daily cap of title suggestions', () => {
    it('happyPath_theDaysCountIsTheStatesOnItsOwnDay', () => {
        const day = utcDay(new Date('2026-10-24T23:59:59.000Z'));

        expect(day).toBe('2026-10-24');
        expect(queuedOn({ queuedDay: '2026-10-24', queuedToday: 12 }, day)).toBe(12);
        expect(validate(assistStateDocSchema, { queuedDay: day, queuedToday: 12, ...STAMP }).ok).toBe(true);
    });

    it('badPath_anotherDayNoStateOrNoCountIsZeroAndAMalformedDayIsRefused', () => {
        expect(queuedOn({ queuedDay: '2026-10-23', queuedToday: 300 }, '2026-10-24')).toBe(0);
        expect(queuedOn(undefined, '2026-10-24')).toBe(0);
        expect(queuedOn({ queuedDay: '2026-10-24' }, '2026-10-24')).toBe(0);
        expect(validate(assistStateDocSchema, { queuedDay: '2026-13-01', queuedToday: 1, ...STAMP }).ok).toBe(false);
    });
});
