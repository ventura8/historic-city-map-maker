import type { Gcp } from '@hcm/shared';
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import type { GeorefIntentsPort, GeorefViewState } from '../../../src/admin/georef/georef-port.js';
import { drawScan } from '../../../src/admin/georef/scan-draw.js';
import type { SuggestionRowPort, SuggestionsViewPort } from '../../../src/admin/georef/suggestions-port.js';
import type { FakeArea } from '../editing/fake-area.js';
import { button, click, defineImagery, georefPage, georefState, georefVersion } from '../imagery/fixtures.js';
import { cleanup, deep, deepAll, deepText, updated } from '../shell/fake-app.js';

/** A suggestion as the matcher stored it: its own `residualM` (of the matcher's fit at the time) is never shown. */
function suggestion(id: string, score: number): Gcp {
    return { id, pixel: { x: 500, y: 400 }, geo: { lat: 44.42, lng: 26.1 }, enabled: true, origin: 'auto', score, residualM: 99 };
}

const ROWS: readonly SuggestionRowPort[] = [
    { label: 'a1', pair: suggestion('a001', 0.58), level: 'medium', offsetM: 3.24 },
    { label: 'a2', pair: suggestion('a002', 0.41), level: 'low', offsetM: null },
    { label: 'a4', pair: suggestion('a004', 0.62), level: 'high', offsetM: 12 },
];

function view(overrides: Partial<SuggestionsViewPort> = {}): SuggestionsViewPort {
    return { matched: true, total: 4, pending: ROWS, selected: null, confident: '2', noSpread: false, outsideCity: false, ...overrides };
}

function withSuggestions(overrides: Partial<SuggestionsViewPort> = {}, state: Partial<GeorefViewState> = {}): GeorefViewState {
    return georefState({ suggestions: view(overrides), ...state });
}

function suggestionCalls(area: FakeArea<GeorefViewState, GeorefIntentsPort>): readonly string[] {
    return area.calls.filter((call) => call.includes('Suggestion'));
}

/** The name button of suggestion row `index`. */
function rowName(element: HTMLElement, index: number): HTMLButtonElement {
    const found = deepAll(element, 'button.suggestion')[index];
    if (found === undefined) {
        throw new Error(`no suggestion row ${String(index)}`);
    }
    return found as HTMLButtonElement;
}

/** Accept and Reject take the suggestion out of the list at once, as the store does. */
function deciding(area: FakeArea<GeorefViewState, GeorefIntentsPort>): void {
    const recording = area.intents;
    const decided = (id: string): void => {
        const suggestions = area.state.suggestions;
        area.set({ suggestions: { ...suggestions, pending: suggestions.pending.filter((row) => row.pair.id !== id) } });
    };
    const intents = new Proxy(recording, {
        get: (target, name) => {
            const intent = Reflect.get(target, name) as ((id: string) => void) | undefined;
            const decides = name === 'acceptSuggestion' || name === 'rejectSuggestion';
            return decides && intent !== undefined
                ? (id: string) => {
                      intent(id);
                      decided(id);
                  }
                : intent;
        },
    });
    Object.defineProperty(area, 'intents', { value: intents });
}

function press(target: HTMLElement, key: string): void {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, composed: true, cancelable: true }));
}

describe('the georeferencer’s suggestions', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_eachSuggestionShowsItsConfidenceItsResidualAndItsButtons', async () => {
        const { element } = await georefPage(withSuggestions());

        const text = deepText(element);
        expect(deep(element, '#suggestions-heading').textContent).toBe('Suggested pairs');
        expect(text).toContain('Reliable pairs found automatically: 2, too few for a fit.');
        expect(text).toContain('Confidence medium: 58 %');
        expect(text).toContain('3.2 m from the current fit');
        expect(text).toContain('No fit to compare it with yet');
        expect(text).not.toContain('99 m');
        expect(text).toContain('Confidence high: 62 %');
        expect(deepAll(element, 'button.suggestion').map((name) => name.textContent.trim())).toEqual([
            'Suggestion a1',
            'Suggestion a2',
            'Suggestion a4',
        ]);
        expect(() => button(element, 'Accept a2')).not.toThrow();
        expect(() => button(element, 'Reject a4')).not.toThrow();
        expect(deep(element, '[data-suggestion="a001"] .fill').style.getPropertyValue('--confidence')).toBe('0.58');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_suggestionsThatWouldPutTheMapOutsideTheCityAreDoubtfulWithNoAcceptAll @S-A44-BAD-OUTSIDE-CITY', async () => {
        const doubtful = ROWS.map((row) => ({ ...row, pair: { ...row.pair, score: 0.98 }, level: 'doubtful' as const }));
        const { element, area } = await georefPage(withSuggestions({ outsideCity: true, pending: doubtful }));

        const text = deepText(element);
        expect(deep(element, '[data-state="outside-city"]').textContent).toContain('would put the map outside the city');
        expect(text).toContain('Doubtful: the map would land outside the city');
        expect(text).not.toContain('98 %');
        expect(() => button(element, 'Accept all')).toThrow();
        expect(deep(element, '[data-suggestion="a001"] .fill').style.getPropertyValue('--confidence')).toBe('0');
        click(button(element, 'Accept a2'));
        expect(suggestionCalls(area)).toEqual(['acceptSuggestion "a002"']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_acceptRejectAndAcceptAllCallTheirIntents', async () => {
        const { element, area } = await georefPage(withSuggestions());

        click(button(element, 'Accept all'));
        click(button(element, 'Accept a2'));
        await updated(element);
        click(button(element, 'Reject a4'));
        await updated(element);
        rowName(element, 0).click();

        // After Accept or Reject the keyboard's place moves to the row now at that place (unchanged here: a fake store).
        expect(suggestionCalls(area)).toEqual([
            'acceptAllSuggestions',
            'acceptSuggestion "a002"',
            'selectSuggestion "a002"',
            'rejectSuggestion "a004"',
            'selectSuggestion "a004"',
            'selectSuggestion "a001"',
        ]);
    });

    it('happyPath_theKeyboardAcceptsWithEnterRejectsWithDeleteAndStaysInTheList', async () => {
        const { element, area } = await georefPage(withSuggestions());
        deciding(area);

        rowName(element, 1).focus();
        press(rowName(element, 1), 'Enter');
        await updated(element);
        press(rowName(element, 1), 'Delete');
        await updated(element);
        press(rowName(element, 0), 'Escape');
        press(rowName(element, 0), 'Backspace');
        await updated(element);

        expect(suggestionCalls(area)).toEqual([
            'selectSuggestion "a002"',
            'acceptSuggestion "a002"',
            'selectSuggestion "a004"',
            'rejectSuggestion "a004"',
            'selectSuggestion "a001"',
            'rejectSuggestion "a001"',
        ]);
        expect(element.shadowRoot?.activeElement?.id).toBe('suggestions-heading');
        expect(deepText(element)).toContain('You have decided on every suggestion.');
    });

    it('happyPath_theSelectedSuggestionIsMarkedAndItsMarkerIsTheScanViewers', async () => {
        const { element } = await georefPage(withSuggestions({ selected: 'a002' }));

        const viewer = deep(element, 'hcm-scan-viewer') as HTMLElement & { suggestions: readonly { label: string }[] };
        expect(deep(element, '[data-suggestion="a002"]').hasAttribute('data-selected')).toBe(true);
        expect(rowName(element, 1).getAttribute('aria-current')).toBe('true');
        expect(viewer.suggestions.map((marker) => marker.label)).toEqual(['a1', 'a2', 'a4']);
        expect((viewer as unknown as { selectedSuggestion: string }).selectedSuggestion).toBe('a002');
    });

    it('badPath_aLockedVersionDecidesNothingAndKeysDoNothing', async () => {
        const { element, area } = await georefPage(withSuggestions({}, { version: georefVersion({ editable: false }) }));

        press(rowName(element, 0), 'Enter');

        expect(deepAll(element, '.suggestions hcm-button').every((found) => found.hasAttribute('disabled'))).toBe(true);
        expect(suggestionCalls(area)).toEqual([]);
    });

    it('badPath_aVersionLeftWithoutSuggestionsSaysWhyAndNoMatcherMeansNoPanel', async () => {
        const { element, area } = await georefPage(withSuggestions({ pending: [], total: 0, confident: '0' }));

        expect(deepText(element)).toContain('Reliable pairs found automatically: 0, too few for a fit.');
        expect(deepText(element)).toContain('No pair to suggest: add pairs by hand.');
        expect(deepAll(element, 'button.suggestion')).toHaveLength(0);
        area.set({ suggestions: view({ pending: [], total: 0, confident: '7', noSpread: true }) });
        await updated(element);
        expect(deepText(element)).toContain('Reliable pairs found automatically: 7, but almost in a line');
        area.set({ suggestions: view({ matched: false, pending: [], confident: null }) });
        await updated(element);
        expect(deepAll(element, '.suggestions')).toHaveLength(0);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aSuggestionWithoutAScoreReadsAsNone', async () => {
        const unscored: Gcp = { id: 'a009', pixel: { x: 5, y: 5 }, geo: { lat: 44.42, lng: 26.1 }, enabled: true, origin: 'auto' };
        const { element } = await georefPage(withSuggestions({ pending: [{ label: 'a9', pair: unscored, level: 'low', offsetM: null }] }));

        expect(deepText(element)).toContain('Confidence low: 0 %');
        expect(deep(element, '[data-suggestion="a009"] .fill').style.getPropertyValue('--confidence')).toBe('0');
    });

    it('happyPath_romanianTexts', async () => {
        const { element } = await georefPage(withSuggestions(), { locale: 'ro' });

        expect(deepText(element)).toContain('Încredere medie: 58 %');
        expect(() => button(element, 'Acceptă toate')).not.toThrow();
        expect(deepText(element)).toContain('La 3,2 m de potrivirea de acum');
    });
});

describe('the georeferencer’s suggestions: Accept all', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_acceptAllLeavesTheKeyboardOnThePanelsHeading', async () => {
        const { element, area } = await georefPage(withSuggestions());
        const intents = area.intents;
        Object.defineProperty(area, 'intents', {
            value: new Proxy(intents, {
                get: (target, name): unknown =>
                    name === 'acceptAllSuggestions'
                        ? () => {
                              area.set({ suggestions: { ...area.state.suggestions, pending: [] } });
                          }
                        : (Reflect.get(target, name) as unknown),
            }),
        });
        rowName(element, 0).focus();

        click(button(element, 'Accept all'));
        await updated(element);
        await updated(element);

        expect(deepText(element)).toContain('You have decided on every suggestion.');
        expect(element.shadowRoot?.activeElement?.id).toBe('suggestions-heading');
    });
});

describe('the scan drawing of the suggestions', () => {
    afterEach(cleanup);

    it('happyPath_suggestionsAreDashedRingsTheSelectedOneLarger', () => {
        const canvas = document.createElement('canvas');
        canvas.style.inlineSize = '200px';
        canvas.style.blockSize = '100px';
        document.body.append(canvas);
        const context = canvas.getContext('2d');
        if (context === null) {
            throw new Error('no 2D context');
        }
        const dashes = vi.spyOn(context, 'setLineDash');
        const arcs = vi.spyOn(context, 'arc');

        drawScan(canvas, {
            ...{ image: null, view: { scale: 1, offset: { x: 0, y: 0 } }, previewScale: 1, markers: [], selected: null },
            ...{ half: null, crosshair: false, dragged: null, selectedSuggestion: 'a002' },
            suggestions: [
                { id: 'a001', label: 'a1', pixel: { x: 20, y: 20 }, enabled: true },
                { id: 'a002', label: 'a2', pixel: { x: 60, y: 40 }, enabled: true },
            ],
        });

        expect(dashes.mock.calls).toEqual([[[4, 3]], [[]], [[4, 3]], [[]]]);
        expect(arcs.mock.calls.map((call) => call[2])).toEqual([11, 15]);
    });
});
