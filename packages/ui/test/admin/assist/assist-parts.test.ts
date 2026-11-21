/**
 * The assists' slots (`packages/ui/src/admin/assist/assist-parts.ts`; `docs/research/M4-interfaces.md` §4.1, CR-M4-4):
 * Suggest a title, the suggestions as buttons with OpenStreetMap's attribution and licence link, what the queue is doing
 * and why there are none; the draft button of a pair with the model's note or why there is no draft. Text only.
 */
import { axeViolations } from '@hcm/test-support/axe';
import { html, type TemplateResult } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { AssistActionsPort, AssistViewPort } from '../../../src/admin/assist/assist-port.js';
import { OSM_COPYRIGHT_URL, draftAssist, draftTarget, titleAssist } from '../../../src/admin/assist/assist-parts.js';
import { cleanup, deep, deepAll, deepText, defineAll, mount } from '../shell/fake-app.js';

const IDLE: AssistViewPort = { titles: { status: 'idle', suggestions: [], attribution: null, error: null }, drafts: {} };

function actions(): AssistActionsPort & { readonly calls: string[] } {
    const calls: string[] = [];
    return {
        calls,
        suggestTitle: () => calls.push('suggestTitle'),
        useTitle: (index) => calls.push(`useTitle ${String(index)}`),
        draftText: (field, to) => calls.push(`draftText ${field} ${to}`),
    };
}

async function render(template: TemplateResult): Promise<HTMLElement> {
    return mount<HTMLElement>(html`<div class="slot">${template}</div>`, 800);
}

describe('the title slot', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_suggestionsAreButtonsNamedForWhatTheyDoWithTheAttribution', async () => {
        const recorded = actions();
        const view: AssistViewPort = {
            ...IDLE,
            titles: {
                status: 'ready',
                suggestions: [{ ro: '<b>Ateneul</b> Român', en: 'Romanian Athenaeum' }, { ro: 'Sector 1' }],
                attribution: 'x',
                error: null,
            },
        };
        const element = await render(titleAssist({ locale: 'en', view, actions: recorded, id: 'photo-title', readOnly: false }));

        const buttons = deepAll(element, '[data-assist-suggestions] hcm-button');
        expect(buttons.map((button) => deepText(button))).toEqual([
            'Use the title “<b>Ateneul</b> Român” <b>Ateneul</b> Român',
            'Use the title “Sector 1” Sector 1',
        ]);
        expect(deepAll(element, 'b')).toHaveLength(0);
        deep(buttons[1] ?? element, 'button').click();
        deep(deep(element, '.actions'), 'button').click();
        const link = deep(element, '[data-attribution] a');
        expect([link.getAttribute('href'), link.getAttribute('target'), link.getAttribute('rel')]).toEqual([
            OSM_COPYRIGHT_URL,
            '_blank',
            'noopener noreferrer',
        ]);
        expect(recorded.calls).toEqual(['useTitle 1', 'suggestTitle']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it.each([
        ['asking', 'Looking for titles in OpenStreetMap…'],
        ['queued', 'Looking for titles in OpenStreetMap…'],
        ['ready', 'OpenStreetMap has no name for this place.'],
    ] as const)('happyPath_%s_isAnnounced', async (status, text) => {
        const view: AssistViewPort = { ...IDLE, titles: { status, suggestions: [], attribution: null, error: null } };
        const element = await render(titleAssist({ locale: 'en', view, actions: actions(), id: 'photo-title', readOnly: false }));

        expect(deep(element, '[role="status"]').textContent).toBe(text);
    });

    it('badPath_aRefusalLeavesTheAdminTypingAndSaysWhy', async () => {
        const view: AssistViewPort = {
            ...IDLE,
            titles: { status: 'failed', suggestions: [], attribution: null, error: { key: 'apiError.assist.rateLimited' } },
        };
        const element = await render(titleAssist({ locale: 'ro', view, actions: actions(), id: 'photo-title', readOnly: true }));

        expect(deep(element, '[role="alert"]').textContent).not.toBe('');
        expect(deep(deep(element, '.actions'), 'hcm-button').hasAttribute('disabled')).toBe(true);
    });
});

describe('the draft slot', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_romanianTextOffersAnEnglishDraftAndADoneDraftNamesTheModel', async () => {
        const recorded = actions();
        const element = await render(
            draftAssist({ locale: 'en', view: IDLE, actions: recorded, field: 'title', text: { ro: 'Ateneul' }, readOnly: false }),
        );

        deep(deep(element, '.actions'), 'button').click();
        expect(deepText(element)).toContain('English draft');
        expect(recorded.calls).toEqual(['draftText title en']);

        // The draft filled English: the note stays, and no button offers to replace it.
        const view: AssistViewPort = {
            ...IDLE,
            drafts: { 'title.en': { status: 'done', model: 'gemini-3.5-flash-lite', truncated: true, error: null } },
        };
        const drafted = await render(
            draftAssist({
                locale: 'en',
                view,
                actions: actions(),
                field: 'title',
                text: { ro: 'Ateneul', en: 'Athenaeum' },
                readOnly: false,
            }),
        );
        expect(deepText(deep(drafted, '[data-draft-note]'))).toBe(
            'Automatic draft: check it before you save. The draft was shortened to fit the field.',
        );
        expect(deepAll(drafted, '.actions')).toHaveLength(0);
        expect(await axeViolations(drafted)).toEqual([]);
    });

    it('badPath_textTheAdminTypedInBothLanguagesIsNeverOfferedADraft', async () => {
        const element = await render(
            draftAssist({
                locale: 'en',
                view: IDLE,
                actions: actions(),
                field: 'title',
                text: { ro: 'Ateneul', en: 'Mine' },
                readOnly: false,
            }),
        );

        expect(deepAll(element, '.assist')).toHaveLength(0);
    });

    it('badPath_aFailedDraftSaysWhyAndAWorkingOneIsAnnounced', async () => {
        const failed: AssistViewPort = {
            ...IDLE,
            drafts: {
                'description.ro': { status: 'failed', model: null, truncated: false, error: { key: 'apiError.assist.unavailable' } },
            },
        };
        const element = await render(
            draftAssist({
                locale: 'ro',
                view: failed,
                actions: actions(),
                field: 'description',
                text: { ro: '', en: 'Hall' },
                readOnly: false,
            }),
        );
        expect(deepText(element)).toContain('Ciornă în română');
        expect(deep(element, '[role="alert"]').textContent).not.toBe('');

        const working: AssistViewPort = {
            ...IDLE,
            drafts: { 'label.en': { status: 'working', model: null, truncated: false, error: null } },
        };
        const busy = await render(
            draftAssist({ locale: 'en', view: working, actions: actions(), field: 'label', text: { ro: 'Planul' }, readOnly: false }),
        );
        expect(deep(busy, '[role="status"]').textContent).toBe('Writing the draft…');
        expect(deep(deep(busy, '.actions'), 'hcm-button').hasAttribute('disabled')).toBe(true);
    });

    it('badPath_anEmptyPairOffersNothing', async () => {
        const element = await render(
            draftAssist({ locale: 'en', view: IDLE, actions: actions(), field: 'title', text: undefined, readOnly: false }),
        );

        expect(deepAll(element, '.assist')).toHaveLength(0);
        expect([draftTarget({ ro: 'a' }), draftTarget({ ro: '', en: 'b' }), draftTarget({ ro: ' ', en: ' ' }), draftTarget({})]).toEqual([
            'en',
            'ro',
            null,
            null,
        ]);
        expect(draftTarget({ ro: 'a', en: 'b' })).toBeNull();
    });
});
