// `<hcm-admin-photo-editor>` over a scripted photos area: its states, every field as a patch of the draft, Save and its
// first problem, the conflict and gone banners, the image and its replacement, the place, the direction and the field
// of view, publishing.
import { axeViolations } from '@hcm/test-support/axe';
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { canSave, type HcmAdminPhotoEditor } from '../../../src/admin/photos/hcm-admin-photo-editor.js';
import { withLanguage } from '../../../src/admin/photos/editor-sections.js';
import type { PhotoEditorPort } from '../../../src/admin/photos/photos-port.js';
import { cleanup, deep, deepAll, deepText, defineAll, mount, updated } from '../shell/fake-app.js';
import { area, editor, files, photosState, VALUE, type PhotosArea } from './fixtures.js';

async function editorOf(
    state: PhotoEditorPort,
    options: { locale?: 'ro' | 'en'; mapReady?: boolean } = {},
): Promise<{ element: HcmAdminPhotoEditor; photos: PhotosArea }> {
    const photos = area(photosState({ editor: state }));
    const element = await mount<HcmAdminPhotoEditor>(
        html`<hcm-admin-photo-editor
            .editor=${state}
            .intents=${photos.intents}
            .locale=${options.locale ?? 'en'}
            ?map-ready=${options.mapReady === true}
        ></hcm-admin-photo-editor>`,
        900,
    );
    await updated(element);
    return { element, photos };
}

function type(element: HTMLElement, selector: string, value: string, event = 'input'): void {
    const field = deep(element, selector) as HTMLInputElement;
    field.value = value;
    field.dispatchEvent(new Event(event));
}

describe('<hcm-admin-photo-editor>: states', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theFormWithItsHeadingSaveStateAndSections', async () => {
        const { element } = await editorOf(editor(), { mapReady: true });

        expect(deep(element, 'h2[data-detail-heading]').textContent.trim()).toBe('Photo “Calea Victoriei”');
        expect(deepText(element)).toContain('Saved');
        expect(deepAll(element, 'legend').map((legend) => legend.textContent)).toEqual([
            'Image',
            'Improved and colorized versions',
            'Texts',
            'Date',
            'Author and rights',
            'Source',
            'Links',
            'Place and direction',
            'Publishing',
        ]);
        expect(deep(element, 'img.image').getAttribute('alt')).toBe('Image of the photo “Calea Victoriei”');
        // History is a button of the same style as the editor's other actions (no link-styled History); the page opens it.
        const opened: string[] = [];
        element.addEventListener('hcm-history', () => opened.push('history'));
        deep(deep(element, 'hcm-button.history'), 'button').click();
        expect(deepAll(element, 'a.external')).toEqual([]);
        expect(opened).toEqual(['history']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aRevokedAdminsEditorIsReadOnly', async () => {
        const { element, photos } = await editorOf(editor({ dirty: ['author'], touched: true }), { mapReady: true });
        element.readOnly = true;
        await updated(element);
        const disabled = (target: HTMLElement): boolean => (target as HTMLElement & { disabled: boolean }).disabled;

        expect(deepText(element)).toContain('Read only: your access was removed.');
        expect(disabled(deep(element, '.editor-head hcm-button'))).toBe(true);
        expect(deepAll(element, '.form > .actions hcm-button').map(disabled)).toEqual([false, true, true]);
        expect(deepAll(element, 'input:not([type="file"]), textarea').every((field) => (field as HTMLInputElement).readOnly)).toBe(true);
        expect(deepAll(element, 'select, hcm-switch, hcm-slider').every(disabled)).toBe(true);
        expect(deepAll(element, 'fieldset hcm-button').every(disabled)).toBe(true);
        expect(photos.calls).toEqual([]);
    });

    it('happyPath_romanianTexts', async () => {
        const { element } = await editorOf(editor({ dirty: ['author'], touched: true }), { locale: 'ro' });

        expect(deepText(element)).toContain('Modificări nesalvate');
        expect(deepText(element)).toContain('Locul și direcția');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_loadingErrorAndNotFound', async () => {
        const loading = await editorOf(editor({ status: 'loading', value: null }));
        expect(deep(loading.element, 'hcm-loading-indicator')).toBeTruthy();
        cleanup();

        const failed = await editorOf(editor({ status: 'error', failure: { kind: 'failed', code: 'internal' } }));
        deep(deep(failed.element, '.pane hcm-button'), 'button').click();
        expect(failed.photos.named('retryPhoto')).toEqual(['retryPhoto']);
        cleanup();

        const missing = await editorOf(editor({ status: 'notFound', value: null }));
        expect(deepText(missing.element)).toContain('This photo does not exist.');
        expect(deep(missing.element, 'a').getAttribute('href')).toBe('#/history/photo/p1');
    });

    it('badPath_noEditorRendersNothing', async () => {
        const element = await mount<HTMLElement>(html`<hcm-admin-photo-editor></hcm-admin-photo-editor>`);

        expect(element.shadowRoot?.childElementCount).toBe(0);
    });

    it('badPath_goneAndConflictBanners', async () => {
        const gone = await editorOf(editor({ status: 'gone' }));
        expect(deepText(gone.element)).toContain('The photo was deleted meanwhile.');
        expect((deep(gone.element, '.editor-head hcm-button') as HTMLElement & { disabled: boolean }).disabled).toBe(true);
        cleanup();

        const { element, photos } = await editorOf(
            editor({ dirty: ['author'], conflict: { by: 'x', at: '2026-10-17T12:02:00.000Z', fields: ['author', 'year'] } }),
        );
        expect(deepText(element)).toContain('Saved by another admin on');
        expect(deepText(element)).toContain('Someone else changed meanwhile: Author, Year.');
        element.who = { self: 'x', people: {} };
        await updated(element);
        expect(deepText(element)).toContain('Saved by you on');
        const buttons = deepAll(deep(element, '.banner'), 'hcm-button');
        deep(buttons[0] ?? element, 'button').click();
        deep(buttons[1] ?? element, 'button').click();
        expect(photos.calls).toEqual(['keepMine', 'takeTheirs']);
    });

    it('badPath_saveIsOffWithAProblemAndNamesIt', async () => {
        const { element } = await editorOf(
            editor({ dirty: ['sourceUrl'], touched: true, issues: [{ path: 'sourceUrl', code: 'validation.httpsOnly' }] }),
        );

        const save = deep(element, '.editor-head hcm-button') as HTMLElement & { disabled: boolean };
        expect(save.disabled).toBe(true);
        expect(save.getAttribute('aria-describedby')).toBe('save-why');
        expect(deep(element, '#save-why').textContent).toBe('Cannot save: Source address: only https:// addresses are allowed.');
        expect(deep(element, '#photo-sourceUrl').getAttribute('aria-invalid')).toBe('true');
        expect(deep(element, '#photo-sourceUrl-error').textContent).toBe('Only https:// addresses are allowed.');
    });

    it('happyPath_saveDiscardAndDelete', async () => {
        const { element, photos } = await editorOf(editor({ dirty: ['author'], touched: true, saving: false }));

        deep(deep(element, '.editor-head hcm-button'), 'button').click();
        for (const button of deepAll(element, '.form > .actions hcm-button')) {
            deep(button, 'button').click();
        }
        await updated(element);

        // History first: it opens the page's History (an event), no call of the area.
        expect(photos.calls).toEqual(['save', 'discard', 'requestDelete']);
    });

    it('happyPath_canSave', () => {
        expect(canSave(editor({ dirty: ['author'] }))).toBe(true);
        expect(canSave(editor())).toBe(false);
        expect(canSave(editor({ dirty: ['author'], saving: true }))).toBe(false);
        expect(canSave(editor({ dirty: ['author'], issues: [{ path: 'x', code: 'validation.value' }] }))).toBe(false);
    });

    it('happyPath_savingShowsItself', async () => {
        const { element } = await editorOf(editor({ dirty: ['author'], saving: true }));

        expect(deepText(element)).toContain('Saving…');
    });
});

describe('<hcm-admin-photo-editor>: fields', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_textsAndDatesArePatchesOfTheDraft', async () => {
        const { element, photos } = await editorOf(
            editor({ value: { ...VALUE, title: { ro: 'Calea', en: 'Avenue' }, description: { ro: 'Desc' }, year: 1936 } }),
        );

        type(element, '#photo-title-ro', 'Calea Victoriei');
        type(element, '#photo-title-en', '');
        type(element, '#photo-description-en', 'English');
        type(element, '#photo-description-ro', '');
        type(element, '#photo-dateText-ro', 'Iulie 1936');
        type(element, '#photo-year', '1937');
        type(element, '#photo-yearEnd', '');

        expect(photos.calls).toEqual([
            'edit {"title":{"ro":"Calea Victoriei","en":"Avenue"}}',
            'edit {"title":{"ro":"Calea"}}',
            'edit {"description":{"ro":"Desc","en":"English"}}',
            'edit {}',
            'edit {"dateText":{"ro":"Iulie 1936"}}',
            'edit {"year":1937}',
            'edit {}',
        ]);
    });

    it('happyPath_creditsAndLinks', async () => {
        const { element, photos } = await editorOf(
            editor({ value: { ...VALUE, links: [{ url: 'https://a.example', label: 'A' }], author: 'Ion' } }),
        );

        type(element, '#photo-author', '  ');
        type(element, '#photo-permissionNote', 'Permis');
        const license = deep(element, '#photo-license') as HTMLSelectElement;
        license.value = 'CC0';
        license.dispatchEvent(new Event('change'));
        type(element, '#photo-link-label-0', 'Arhiva');
        type(element, '#photo-link-url-0', 'https://b.example');
        deep(deep(element, '.link-row hcm-icon-button'), 'button').click();
        deep(deep(deepAll(element, 'fieldset')[6] ?? element, '.actions hcm-button'), 'button').click();

        expect(photos.calls).toEqual([
            'edit {}',
            'edit {"permissionNote":"Permis"}',
            'edit {"license":"CC0"}',
            'edit {"links":[{"url":"https://a.example","label":"Arhiva"}]}',
            'edit {"links":[{"url":"https://b.example","label":"A"}]}',
            'edit {}',
            'edit {"links":[{"url":"https://a.example","label":"A"},{"url":"https://","label":""}]}',
        ]);
    });

    it('happyPath_theKindStreetOrAerial', async () => {
        const { element, photos } = await editorOf(editor({ value: { ...VALUE, kind: 'aerial' } }));
        const kind = deep(element, '#photo-kind') as HTMLSelectElement;

        expect(kind.value).toBe('aerial');
        kind.value = 'ground';
        kind.dispatchEvent(new Event('change'));
        kind.value = 'aerial';
        kind.dispatchEvent(new Event('change'));

        expect(photos.calls).toEqual(['edit {}', 'edit {"kind":"aerial"}']);
    });

    it('badPath_atMostFiveLinks', async () => {
        const links = Array.from({ length: 5 }, (_value, index) => ({ url: `https://${String(index)}.example`, label: String(index) }));
        const { element } = await editorOf(editor({ value: { ...VALUE, links } }));

        expect(deepText(element)).toContain('At most 5 links.');
        expect(
            (deep(deepAll(element, 'fieldset')[6] ?? element, '.actions hcm-button') as HTMLElement & { disabled: boolean }).disabled,
        ).toBe(true);
    });
});

describe('<hcm-admin-photo-editor>: place, direction and publishing', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_thePlaceTheDirectionAndTheFieldOfView', async () => {
        const { element, photos } = await editorOf(editor({ value: { ...VALUE, bearing: 90, fov: 50 } }), { mapReady: true });

        type(element, '#photo-lat', '44.5');
        type(element, '#photo-lng', 'x');
        type(element, '#photo-bearing', '');
        const actions = deepAll(deepAll(element, 'fieldset')[7] ?? element, '.actions hcm-button');
        deep(actions[0] ?? element, 'button').click();
        deep(actions[1] ?? element, 'button').click();
        const slider = deep(element, 'hcm-slider');
        slider.dispatchEvent(new CustomEvent('hcm-input', { detail: { value: 75 } }));

        expect(photos.calls).toEqual([
            'edit {"location":{"lat":44.5,"lng":26.1}}',
            'edit {"location":{"lat":44.43,"lng":null}}',
            'edit {}',
            'setDirection',
            'pointAtCentre',
            'edit {"fov":75}',
        ]);
        expect(deepText(element)).toContain('50°');
    });

    it('badPath_withoutAMapTheDirectionButtonsAreOff', async () => {
        const { element } = await editorOf(editor());

        const actions = deepAll(deepAll(element, 'fieldset')[7] ?? element, '.actions hcm-button') as (HTMLElement & {
            disabled: boolean;
        })[];
        expect(actions.map((button) => button.disabled)).toEqual([true, true]);
        expect(deepText(element)).toContain('60°');
    });

    it('happyPath_pickingTheDirectionCanBeCancelled', async () => {
        const { element, photos } = await editorOf(editor({ picking: true }), { mapReady: true });

        expect(deepText(element)).toContain('Click on the map where the camera looked.');
        deep(deep(deepAll(element, 'fieldset')[7] ?? element, '.banner hcm-button'), 'button').click();

        expect(photos.calls).toEqual(['cancelDirection']);
    });

    it('happyPath_suggestionsAndThePlaceToCheck', async () => {
        const { element, photos } = await editorOf(
            editor({
                checkPlace: true,
                block: 'place',
                suggestions: [
                    { field: 'location', text: '47, 27', outside: true },
                    { field: 'year', text: '1936', outside: false },
                    { field: 'bearing', text: '90', outside: false },
                    { field: 'title', text: 'Calea', outside: false },
                ],
            }),
        );

        const text = deepText(element);
        expect(text).toContain("The photo file's place is outside the city, so it cannot be applied.");
        expect(text).toContain('Year from the photo file: 1936');
        expect(text).toContain('Check or confirm the place to publish it.');
        const fieldset = deepAll(element, 'fieldset')[7] ?? element;
        deep(deep(fieldset, '.banner hcm-button'), 'button').click();
        for (const button of deepAll(fieldset, 'li hcm-button')) {
            deep(button, 'button').click();
        }

        expect(photos.calls).toEqual([
            'confirmPlace "p1"',
            'applySuggestion "year"',
            'applySuggestion "bearing"',
            'applySuggestion "title"',
        ]);
        expect((deepAll(element, 'hcm-switch')[0] as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    });

    it('happyPath_publishing', async () => {
        const { element, photos } = await editorOf(editor({ value: { ...VALUE, published: true, rightsReview: true } }));

        const switches = deepAll(element, 'hcm-switch');
        switches[0]?.dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: false } }));
        switches[1]?.dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: false } }));

        expect(photos.calls).toEqual(['edit {"published":false}', 'edit {"rightsReview":false}']);
    });

    it('badPath_everyKindOfFieldShowsItsProblem', async () => {
        const { element } = await editorOf(
            editor({
                value: { ...VALUE, description: { ro: 'x' } },
                issues: [
                    { path: 'year', code: 'validation.yearRange' },
                    { path: 'license', code: 'validation.value' },
                    { path: 'description.ro', code: 'validation.markdownLink' },
                ],
            }),
        );

        // A number says its problem once it has been left (DECISIONS-for-review.md §35d): half a year is no year yet.
        const year = deep(element, '#photo-year');
        expect(year.getAttribute('aria-invalid')).toBe('false');
        expect(deepAll(element, '#photo-year-error')).toEqual([]);
        year.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
        await updated(element);
        expect(year.getAttribute('aria-invalid')).toBe('true');
        expect(year.getAttribute('aria-describedby')).toBe('photo-year-error');
        expect(deep(element, '#photo-year-error').textContent).not.toBe('');
        expect(deep(element, '#photo-license').getAttribute('aria-describedby')).toBe('photo-license-error');
        expect(deep(element, '#photo-description-ro').getAttribute('aria-invalid')).toBe('true');
        expect(deep(element, '#photo-title-en').getAttribute('aria-describedby')).toBe('photo-title-en-hint');
        expect(deep(element, '#photo-lat').getAttribute('aria-invalid')).toBe('false');
    });

    it('happyPath_withLanguage', () => {
        expect(withLanguage(undefined, 'en', 'Only English')).toEqual({ ro: '', en: 'Only English' });
        expect(withLanguage({ ro: 'Ro', en: 'En' }, 'en', ' ')).toEqual({ ro: 'Ro' });
        expect(withLanguage({ ro: 'Ro' }, 'ro', '')).toBeUndefined();
    });
});

describe('<hcm-admin-photo-editor>: the image', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_replaceImageChoosesAFile', async () => {
        const { element, photos } = await editorOf(editor());
        const input = deep(element, '.file-input') as HTMLInputElement;
        let opened = false;
        input.addEventListener('click', (event) => {
            opened = true;
            event.preventDefault();
        });

        deep(deep(deepAll(element, 'fieldset')[0] ?? element, 'hcm-button'), 'button').click();
        input.files = files('new.jpg');
        input.dispatchEvent(new Event('change'));
        input.files = files();
        input.dispatchEvent(new Event('change'));

        expect(opened).toBe(true);
        expect(photos.calls).toEqual(['replaceImage {"name":"new.jpg","size":1,"data":{}}']);
    });

    it.each([
        ['uploading', 'Uploading the new image: 30 %', 'cancelReplace'],
        ['processing', 'The public map still shows the old one.', null],
        ['replaced', 'The image was replaced.', 'dismissReplace'],
        ['same', 'It is the same image: nothing changed.', 'dismissReplace'],
        ['failed', 'The new image could not be uploaded.', 'dismissReplace'],
    ] as const)('happyPath_aReplacement %s', async (phase, text, action) => {
        const { element, photos } = await editorOf(
            editor({ replace: { phase, percent: 30, error: null, params: null, duplicateOf: null } }),
        );

        expect(deepText(element)).toContain(text);
        const button = deepAll(deep(element, '.banner'), 'hcm-button')[0];
        if (button !== undefined) {
            deep(button, 'button').click();
        }
        expect(photos.calls).toEqual(action === null ? [] : [action]);
    });

    it('badPath_aRefusedReplacementSaysWhyAndLinksTheRepeatedPhoto', async () => {
        const { element } = await editorOf(
            editor({ replace: { phase: 'refused', percent: 100, error: 'apiError.photo.duplicate', params: null, duplicateOf: 'p0' } }),
        );

        expect(deepText(element)).toContain('This photo has already been uploaded.');
        expect(deep(deep(element, '.banner'), 'a').getAttribute('href')).toBe('#/photos/p0');
    });

    it.each([
        [{ image: null, processing: 'pending' as const }, 'The image is being processed…'],
        [
            { image: null, processing: 'failed' as const, processingError: 'apiError.photo.heicUnsupported' as const, duplicateOf: 'p0' },
            'HEIC photos cannot be converted.',
        ],
        [{ image: null, processing: 'done' as const }, 'The photo has no image yet.'],
    ])('badPath_noImageYet', async (overrides, text) => {
        const { element } = await editorOf(editor(overrides));

        expect(deepText(element)).toContain(text);
    });
});

describe('<hcm-admin-photo-editor>: the date at its precision, the source', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_monthAppearsWithAYearAndDayWithAMonth', async () => {
        const none = await editorOf(editor({ value: { ...VALUE, year: undefined } }));
        expect(deepAll(none.element, '#photo-month')).toEqual([]);
        expect(deepAll(none.element, '#photo-day')).toEqual([]);

        const year = await editorOf(editor({ value: { ...VALUE, year: 1936 } }));
        expect(deepAll(year.element, '#photo-month')).toHaveLength(1);
        expect(deepAll(year.element, '#photo-day')).toEqual([]);
        expect((deep(year.element, '#photo-month') as HTMLSelectElement).options[7]?.textContent).toBe('July');
        const month = deep(year.element, '#photo-month') as HTMLSelectElement;
        month.value = '7';
        month.dispatchEvent(new Event('change'));
        expect(year.photos.calls).toEqual(['edit {"month":7}']);

        const full = await editorOf(editor({ value: { ...VALUE, year: 1936, month: 7, day: 12 } }));
        expect((deep(full.element, '#photo-month') as HTMLSelectElement).value).toBe('7');
        expect((deep(full.element, '#photo-day') as HTMLInputElement).value).toBe('12');
        type(full.element, '#photo-day', '13');
        expect(full.photos.calls).toEqual(['edit {"day":13}']);
    });

    it('happyPath_clearingAPartClearsThePartsBelowIt', async () => {
        const edits: string[][] = [];
        const { element, photos } = await editorOf(editor({ value: { ...VALUE, year: 1936, month: 7, day: 12 } }));
        element.intents = new Proxy(photos.intents, {
            get: (target, name, receiver): unknown =>
                name === 'edit'
                    ? (patch: object): void => {
                          edits.push(Object.keys(patch));
                      }
                    : (Reflect.get(target, name, receiver) as unknown),
        });
        await updated(element);

        const month = deep(element, '#photo-month') as HTMLSelectElement;
        month.value = '';
        month.dispatchEvent(new Event('change'));
        type(element, '#photo-year', '');

        expect(edits).toEqual([
            ['month', 'day'],
            ['year', 'month', 'day'],
        ]);
    });

    it('badPath_aRangeHidesTheMonthUnlessThereIsOneToClear', async () => {
        const range = await editorOf(editor({ value: { ...VALUE, year: 1936, yearEnd: 1940 } }));
        expect(deepAll(range.element, '#photo-month')).toEqual([]);

        const oneYear = await editorOf(editor({ value: { ...VALUE, year: 1936, yearEnd: 1936 } }));
        expect(deepAll(oneYear.element, '#photo-month')).toHaveLength(1);

        const both = await editorOf(
            editor({
                value: { ...VALUE, year: 1936, yearEnd: 1940, month: 7 },
                issues: [{ path: 'month', code: 'validation.dateRange' }],
            }),
        );
        expect(deep(both.element, '#photo-month-error').textContent).toBe(
            'A month or a day goes with one year: clear the end year or the month.',
        );
    });

    it('badPath_anImpossibleDayIsNamedOnceLeft', async () => {
        const { element } = await editorOf(
            editor({
                value: { ...VALUE, year: 1937, month: 2, day: 29 },
                issues: [{ path: 'day', code: 'validation.dateImpossible' }],
            }),
        );

        expect(deep(element, '#save-why').textContent).toBe('Cannot save: Day: that day does not exist in that month.');
        const day = deep(element, '#photo-day');
        day.dispatchEvent(new FocusEvent('focusout', { bubbles: true, composed: true }));
        await updated(element);
        expect(deep(element, '#photo-day-error').textContent).toBe('That day does not exist in that month.');
    });

    it('happyPath_theSourceHasItsOwnSection', async () => {
        const { element, photos } = await editorOf(editor({ value: { ...VALUE, sourceUrl: 'https://a.example', sourceLabel: 'Arhiva' } }));
        const section =
            deepAll(element, 'fieldset').find((fieldset) => fieldset.querySelector('legend')?.textContent === 'Source') ?? element;

        expect((deep(section, '#photo-sourceUrl') as HTMLInputElement).value).toBe('https://a.example');
        expect(deep(section, '#photo-sourceUrl').getAttribute('maxlength')).toBe('2048');
        expect((deep(section, '#photo-sourceLabel') as HTMLInputElement).value).toBe('Arhiva');
        type(element, '#photo-sourceUrl', 'https://b.example');
        type(element, '#photo-sourceLabel', 'Muzeul');
        expect(photos.calls).toEqual(['edit {"sourceUrl":"https://b.example"}', 'edit {"sourceLabel":"Muzeul"}']);
    });

    it.each([
        ['#photo-dateText-ro', 'When filled in, visitors read this text instead of the date above.'],
        ['#photo-dateText-en', 'When filled in, visitors read this text instead of the date above.'],
        ['#photo-sourceLabel', 'Shown as the link. Without an address, visitors see nothing.'],
    ])('happyPath_aNoteAboutAFieldIsTiedToIt_%s', async (selector, note) => {
        const { element } = await editorOf(editor());

        const described = deep(element, selector).getAttribute('aria-describedby');

        expect(described).not.toBeNull();
        expect(deep(element, `#${String(described)}`).textContent.trim()).toBe(note);
    });
});

describe('<hcm-admin-photo-editor>: M13', () => {
    beforeAll(() => {
        defineAll();
    });

    afterEach(() => {
        cleanup();
    });

    it('badPath_anUploaderIsNotOfferedPublishing @S-A90-BAD-OTHERS-HIDDEN', async () => {
        const { element } = await editorOf(editor({ role: 'uploader' }));

        expect(deepAll(element, 'hcm-switch')).toEqual([]);
        expect(deepText(element)).toContain('once a moderator approves it');
    });

    it('badPath_aModeratorIsNotOfferedDelete @S-A91-BAD-NOT-ALLOWED', async () => {
        const { element } = await editorOf(editor({ role: 'moderator' }));

        expect(deepAll(element, 'hcm-button').map((button) => button.getAttribute('icon'))).not.toContain('delete');
    });

    it('happyPath_aPhotoWithNoPlaceSaysSoAndIsGivenOne', async () => {
        const entries = Object.entries(VALUE).filter(([key]) => key !== 'location' && key !== 'bearing' && key !== 'fov');
        const value = Object.fromEntries(entries) as typeof VALUE;
        const { element, photos } = await editorOf(editor({ value }));

        expect(deepText(element)).toContain('Where was this taken?');
        expect(deepAll(element, '#photo-bearing')).toEqual([]);
        deepAll(element, 'hcm-button')
            .find((button) => button.getAttribute('icon') === 'place')
            ?.click();
        expect(photos.calls).toContain('placeAtCentre');
    });
});

describe('<hcm-admin-photo-editor>: the viewed area of an aerial photo', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_anAerialPhotoDrawsResetsAndRemovesItsViewedArea', async () => {
        const iconButton = (element: HTMLElement, icon: string) =>
            deepAll(deep(element, '[data-area]'), 'hcm-button').find((button) => button.getAttribute('icon') === icon);
        const fresh = await editorOf(editor({ value: { ...VALUE, kind: 'aerial', bearing: 0, fov: 60 } }));
        expect(deepText(fresh.element)).toContain('This aerial photo has no viewed area yet.');
        iconButton(fresh.element, 'crop_free')?.click();
        const call = fresh.photos.calls.at(-1) ?? '';
        expect(call).toMatch(/^edit \{"viewedArea":\[/);
        expect((JSON.parse(call.slice(5)) as { viewedArea: unknown[] }).viewedArea).toHaveLength(4);
        cleanup();

        const corners = [
            { lat: 44.43, lng: 26.1 },
            { lat: 44.44, lng: 26.09 },
            { lat: 44.44, lng: 26.11 },
            { lat: 44.43, lng: 26.105 },
        ];
        const drawn = await editorOf(editor({ value: { ...VALUE, kind: 'aerial', viewedArea: corners } }), { locale: 'ro' });
        expect(deepText(drawn.element)).toContain('Zona văzută');
        iconButton(drawn.element, 'refresh')?.click();
        iconButton(drawn.element, 'delete')?.click();
        expect(drawn.photos.calls.at(-1)).toBe('edit {}');
        expect(drawn.photos.calls).toHaveLength(2);
    });

    it('badPath_aBrokenAreaSaysWhyAndAStreetPhotoHasNoAreaSection', async () => {
        const broken = await editorOf(
            editor({
                value: { ...VALUE, kind: 'aerial', viewedArea: [] },
                issues: [{ path: 'viewedArea', code: 'validation.viewedArea' }],
            }),
        );
        expect(deep(broken.element, '[data-area] [role="alert"]').textContent).toContain('rectangle or a trapezoid');
        cleanup();

        const street = await editorOf(editor());
        expect(deepAll(street.element, '[data-area]')).toEqual([]);
    });
});
