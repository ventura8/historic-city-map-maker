// `<hcm-photos-page>` over a scripted photos area: the list (rows, chips, one-click actions, filters, search, bulk bar,
// uploads and the drop zone), the map's pane (created once it shows, or why there is none), and the dialogs.
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { PHOTO_ACCEPT, photoFiles, yearOf } from '../../../src/admin/photos/hcm-admin-photo-list.js';
import { stickyFrom } from '../../../src/admin/photos/photo-dialogs.js';
import { bulkAction, cleanup, deep, deepAll, deepText, defineAll, updated } from '../shell/fake-app.js';
import { area, editor, files, PhotosArea, photosPage, photosState, row, upload } from './fixtures.js';

describe('<hcm-photos-page>: the list', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_theRowsWithTheirChipsAndActionsInBothLanguages', async () => {
        const photos = area(
            photosState({
                list: {
                    ...photosState().list,
                    rows: [
                        row({ checkPlace: true, rightsReview: true, thumb: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' }),
                        row({
                            id: 'p2',
                            processing: 'failed',
                            error: 'apiError.photo.duplicate',
                            duplicateOf: 'p1',
                            published: false,
                            yearEnd: 1940,
                        }),
                        row({ id: 'p3', processing: 'pending', published: false }),
                    ],
                    loaded: 3,
                },
            }),
        );
        const { element } = await photosPage(photos);

        const links = deepAll(element, 'a.photo');
        expect(links.map((link) => link.getAttribute('href'))).toEqual(['#/photos/p1', '#/photos/p2', '#/photos/p3']);
        expect(links[0]?.textContent).toContain('Victory Avenue');
        expect(links[1]?.textContent).toContain('1936–1940');
        const text = deepText(element);
        expect(text).toContain('Rights to check');
        expect(text).toContain('Check the place');
        expect(text).toContain('This photo has already been uploaded.');
        expect(text).toContain('Processing');
        expect(text).toContain('Photos shown: 3');
        expect(deepAll(element, 'a.external').map((link) => link.getAttribute('href'))).toContain('#/photos/p1');
        expect(photos.named('open')).toEqual(['open []']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_oneClickActionsReachTheArea', async () => {
        const photos = area(
            photosState({
                list: {
                    ...photosState().list,
                    rows: [row({ checkPlace: true, rightsReview: true }), row({ id: 'p2', error: 'apiError.photo.unsupportedType' })],
                },
            }),
        );
        const { element } = await photosPage(photos, { locale: 'ro' });

        const buttons = deepAll(element, '.row-actions hcm-button');
        for (const button of buttons) {
            deep(button, 'button').click();
        }
        deep(element, '.select input').click();

        expect(photos.calls.filter((call) => !call.startsWith('open') && !call.startsWith('attachMap'))).toEqual([
            'confirmPlace "p1"',
            'confirmRights "p1"',
            'requestDelete ["p2"]',
            'toggleSelected "p1"',
        ]);
        expect(deepText(element)).toContain('Confirmă locul');
    });

    it('happyPath_theFiltersAndTheSearch', async () => {
        const photos = area(photosState({ list: { ...photosState().list, hasMore: true } }));
        const { element } = await photosPage(photos);

        const chips = deepAll(element, 'hcm-chip');
        expect(chips).toHaveLength(6);
        deep(chips[5] ?? element, 'button').click();
        deep(chips[0] ?? element, 'button').click();
        const search = deep(element, '#search-text') as HTMLInputElement;
        search.value = 'piata';
        search.dispatchEvent(new Event('input'));
        const from = deep(element, '#search-yearFrom') as HTMLInputElement;
        from.value = '1930';
        from.dispatchEvent(new Event('input'));
        deep(deepAll(element, '.actions hcm-button').at(-1) ?? element, 'button').click();

        expect(photos.calls.filter((call) => !call.startsWith('open') && !call.startsWith('attachMap'))).toEqual([
            'setFilter "rightsReview"',
            'setFilter "all"',
            'search {"text":"piata","yearFrom":null,"yearTo":null}',
            'search {"text":"piata","yearFrom":1930,"yearTo":null}',
            'more',
        ]);
        expect((chips[0] as HTMLElement & { selected: boolean }).selected).toBe(true);
    });

    it('happyPath_selectAllIsOfferedBeforeAnythingIsSelected', async () => {
        const photos = area(photosState());
        const { element } = await photosPage(photos);
        expect(deepAll(element, '.bulk')).toEqual([]);

        const selectAll = deepAll(element, 'hcm-button').find((button) => button.textContent.includes('Select all'));
        deep(selectAll ?? element, 'button').click();

        expect(photos.named('selectAll')).toEqual(['selectAll']);
    });

    it('badPath_anEmptyListOffersNoSelectAll', async () => {
        const photos = area(photosState({ list: { ...photosState().list, rows: [], loaded: 0 } }));
        const { element } = await photosPage(photos);

        expect(deepAll(element, 'hcm-button').filter((button) => button.textContent.includes('Select all'))).toEqual([]);
    });

    it('happyPath_theBulkBarActsOnTheSelection', async () => {
        const photos = area(photosState({ list: { ...photosState().list, selection: ['p1', 'p2'] } }));
        const { element } = await photosPage(photos);

        const bar = deep(element, '.bulk-bar');
        expect(deepText(bar)).toContain('Selected: 2');
        deep(deep(bar, 'hcm-button.select-all'), 'button').click();
        deep(deep(bar, 'hcm-icon-button.clear'), 'button').click();
        for (const id of ['publish', 'unpublish', 'confirmRights', 'delete', 'setFields']) {
            await bulkAction(element, id);
        }

        expect(photos.calls.filter((call) => !call.startsWith('open') && !call.startsWith('attachMap'))).toEqual([
            'selectAll',
            'clearSelection',
            'bulk {"kind":"publish"}',
            'bulk {"kind":"unpublish"}',
            'bulk {"kind":"confirmRights"}',
            'requestDelete ["p1","p2"]',
        ]);
        expect((deep(element, 'hcm-dialog.set-fields') as HTMLElement & { open: boolean }).open).toBe(true);
        expect(await axeViolations(element)).toEqual([]);
    });
});

describe('<hcm-photos-page>: the list by role (M13)', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_aRowInTheQueueSaysWhereItStandsWithTheReviewersNote', async () => {
        const rows = [
            row({ reviewStatus: 'pending', published: false }),
            row({ id: 'p2', reviewStatus: 'refused', reviewNote: 'Not Bucharest', published: false }),
        ];
        const { element } = await photosPage(area(photosState({ list: { ...photosState().list, rows } })));

        const chips = deepAll(element, '.tag').map((chip) => [chip.getAttribute('data-tone'), chip.textContent.trim()]);
        expect(chips).toContainEqual(['wait', 'Waiting for review']);
        expect(chips).toContainEqual(['error', 'Refused: Not Bucharest']);
        expect(chips.map(([, text]) => text)).not.toContain('Unpublished');
    });

    it('badPath_anUploaderIsOfferedNoPublishingAndAModeratorNoDelete', async () => {
        const selection = { ...photosState().list, selection: ['p1'] };
        const uploader = await photosPage(area(photosState({ role: 'uploader', list: selection })));
        const uploaderBar = deep(uploader.element, '.bulk-bar');
        expect(deepAll(uploaderBar, 'hcm-button.publish')).toEqual([]);
        expect(deepAll(uploaderBar, '[data-action="confirmRights"]')).toEqual([]);
        expect(deepAll(uploaderBar, '[data-action="delete"]')).toHaveLength(1);
        cleanup();

        const moderator = await photosPage(area(photosState({ role: 'moderator', list: selection })));
        const moderatorBar = deep(moderator.element, '.bulk-bar');
        expect(deepAll(moderatorBar, 'hcm-button.publish')).toHaveLength(1);
        expect(deepAll(moderatorBar, '[data-action="confirmRights"]')).toHaveLength(1);
        expect(deepAll(moderatorBar, '[data-action="delete"]')).toEqual([]);
    });
});

describe('<hcm-photos-page>: the list states', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('badPath_theListsStates', async () => {
        const photos = area(photosState({ list: { ...photosState().list, rows: [], loaded: 0, status: 'loading' } }));
        const { element } = await photosPage(photos);
        expect(deep(element, 'hcm-loading-indicator')).toBeTruthy();

        photos.set({ list: { ...photos.state.list, status: 'ready' } });
        await updated(element);
        expect(deepText(element)).toContain('No photos yet. Add the first ones with Add photos.');

        photos.set({ list: { ...photos.state.list, loaded: 3, reconnecting: true } });
        await updated(element);
        expect(deepText(element)).toContain('No loaded photo matches the search.');
        expect(deepText(element)).toContain('Reconnecting');

        photos.set({ list: { ...photos.state.list, status: 'error', failure: { kind: 'failed', code: 'internal' } } });
        await updated(element);
        deep(deep(element, '.alert').parentElement ?? element, 'hcm-button').click();
        expect(photos.named('retry')).toEqual(['retry']);
    });
});

describe('<hcm-photos-page>: uploads', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_chosenAndDroppedFilesAreUploaded', async () => {
        const photos = area();
        const { element } = await photosPage(photos);
        const list = deep(element, 'hcm-admin-photo-list');

        const input = deep(list, '.file-input') as HTMLInputElement;
        let opened = false;
        input.addEventListener('click', (event) => {
            opened = true;
            event.preventDefault();
        });
        deep(deep(list, '.toolbar hcm-button'), 'button').click();
        expect(opened).toBe(true);
        input.files = files('a.jpg', 'b.heic');
        input.dispatchEvent(new Event('change'));
        input.files = files();
        input.dispatchEvent(new Event('change'));

        const transfer = new DataTransfer();
        transfer.items.add(new File(['x'], 'c.jpg'));
        list.dispatchEvent(new DragEvent('dragover', { dataTransfer: transfer, bubbles: true, cancelable: true }));
        await updated(element);
        expect(deep(list, '.drop').hasAttribute('data-over')).toBe(true);
        expect(deepText(element)).toContain('Drop the photos here to upload them.');
        list.dispatchEvent(new DragEvent('dragleave', { relatedTarget: null }));
        list.dispatchEvent(new DragEvent('dragover', { dataTransfer: new DataTransfer(), cancelable: true }));
        list.dispatchEvent(new DragEvent('dragleave', { relatedTarget: deep(list, '.drop') }));
        list.dispatchEvent(new DragEvent('drop', { dataTransfer: transfer, cancelable: true }));
        list.dispatchEvent(new DragEvent('drop', { cancelable: true }));
        await updated(element);

        expect(photos.named('upload')).toEqual([
            'upload [{"name":"a.jpg","size":1,"data":{}},{"name":"b.heic","size":1,"data":{}}]',
            'upload [{"name":"c.jpg","size":1,"data":{}}]',
        ]);
        expect(deep(list, '.drop').hasAttribute('data-over')).toBe(false);
    });

    it('happyPath_theUploadsWithTheirProgressAndActions', async () => {
        const photos = area(
            photosState({
                sticky: { author: 'Ion', license: 'CC-BY-4.0', sourceLabel: 'Arhiva', rightsHolder: 'Muzeul' },
                uploads: [
                    upload(),
                    upload({ key: 2, name: 'b.jpg', phase: 'interrupted', error: 'adminContent.photos.upload.interrupted', photoId: 'p9' }),
                    upload({ key: 3, name: 'c.jpg', phase: 'failed', error: 'apiError.photo.duplicate', duplicateOf: 'p1', photoId: 'p8' }),
                    upload({ key: 4, name: 'd.jpg', phase: 'done', photoId: 'p7' }),
                    upload({ key: 5, name: 'e.jpg', phase: 'queued' }),
                    upload({ key: 6, name: 'big.jpg', phase: 'refused', error: 'adminContent.photos.tooBig', params: { size: '60' } }),
                ],
            }),
        );
        const { element } = await photosPage(photos);

        const text = deepText(element);
        expect(text).toContain('New photos get: Ion, Arhiva, CC BY 4.0, Muzeul');
        expect(text).toContain('Uploading: 40 %');
        expect(text).toContain('The file is over 60 MB.');
        expect(deepAll(element, '.uploads a').map((link) => link.getAttribute('href'))).toEqual(['#/photos/p1', '#/photos/p7']);
        for (const button of deepAll(element, '.upload hcm-icon-button')) {
            deep(button, 'button').click();
        }
        deep(deep(element, '.drop > div.actions hcm-button'), 'button').click();

        expect(photos.calls.filter((call) => /Upload|Uploads/.test(call))).toEqual([
            'cancelUpload 1',
            'retryUpload 2',
            'dismissUpload 2',
            'dismissUpload 3',
            'dismissUpload 4',
            'cancelUpload 5',
            'dismissUpload 6',
            'clearUploads',
        ]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_theHelpers', () => {
        expect(PHOTO_ACCEPT).toContain('.heic');
        expect(photoFiles(null)).toEqual([]);
        expect([yearOf('1936'), yearOf(''), yearOf('12')]).toEqual([1936, null, null]);
    });
});

describe('<hcm-photos-page>: the map and the dialogs', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_onAWideWindowTheMapShowsAndAClickOnAPhotoOpensIt', async () => {
        const photos = area(photosState({ map: 'ready' }));
        const { element, app } = await photosPage(photos, { width: 1300 });

        expect(photos.named('attachMap')).toHaveLength(1);
        expect(deepText(element)).toContain('Choose a photo in the list or on the map.');
        await updated(element);
        expect(photos.named('attachMap')).toHaveLength(1);
        expect(app.named('navigate')).toEqual([]);
        // The admin map's box (CR-M2c-22): the kit's zoom buttons reach the area.
        for (const button of deepAll(deep(element, 'hcm-admin-map'), '.controls hcm-icon-button')) {
            deep(button, 'button').click();
        }
        expect(photos.named('zoomBy')).toEqual(['zoomBy 1', 'zoomBy -1']);
    });

    it('badPath_onACompactWindowWithoutAPhotoNoMapIsCreated', async () => {
        const photos = area();
        await photosPage(photos, { width: 400 });

        expect(photos.named('attachMap')).toEqual([]);
    });

    it.each([
        ['loading', 'Loading the map…'],
        ['unavailable', 'The map is not available here yet'],
        ['no-token', 'The map appears once Mapbox is set up.'],
        ['no-webgl', 'WebGL 2 is missing'],
        ['failed', 'The map could not load.'],
    ] as const)('badPath_theMap %s says why', async (map, text) => {
        const { element } = await photosPage(area(photosState({ map })));

        expect(deepText(element)).toContain(text);
        expect(deepAll(element, 'a[href="#/setup/mapbox"]')).toHaveLength(map === 'no-token' ? 1 : 0);
    });

    it.each(['unavailable', 'no-token', 'no-webgl', 'failed'] as const)(
        'badPath_withoutAMap %s the box is only as tall as its note',
        async (map) => {
            // The visual audit of 2026-10-18: the page's 45vh box stayed an empty block above the editor without a map.
            const { element } = await photosPage(area(photosState({ map })), { width: 1300 });
            const box = deep(element, 'hcm-admin-map');
            const note = deep(box, '.note').getBoundingClientRect().height;

            expect(note).toBeGreaterThan(0);
            expect(box.getBoundingClientRect().height).toBeCloseTo(note, 0);
        },
    );

    it.each([
        [1300, 'ready', false],
        [2560, 'ready', true],
        [2560, 'no-token', false],
    ] as const)('happyPath_onA %d px page with the map %s the editor sits beside it: %s', async (width, map, beside) => {
        // The review of the 2560 × 1440 screenshots: on an extra-large page the map is a supporting pane beside the form.
        const { element } = await photosPage(area(photosState({ editor: editor(), map })), { params: ['p1'], width });
        const box = deep(element, 'hcm-admin-map').getBoundingClientRect();
        const form = deep(element, 'hcm-admin-photo-editor').getBoundingClientRect();

        expect(form.left >= box.right).toBe(beside);
        expect(beside ? form.width : 0).toBe(beside ? 480 : 0);
    });

    it('happyPath_theOpenPhotosEditorAndBackToTheList', async () => {
        const photos = area(photosState({ editor: editor(), map: 'ready' }));
        const { element, app } = await photosPage(photos, { params: ['p1'], width: 400 });

        expect(deep(element, 'hcm-admin-photo-editor')).toBeTruthy();
        expect(photos.named('attachMap')).toHaveLength(1);
        expect(deep(element, 'a.photo[aria-current="page"]').getAttribute('href')).toBe('#/photos/p1');
        deep(deep(element, 'hcm-list-detail'), '.back hcm-button').click();
        expect(app.named('navigate')).toEqual(['navigate {"id":"photos","params":[]}']);
    });
});

describe('<hcm-photos-page>: the dialogs', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_deletingTheOpenPhotoGoesBackToTheList', async () => {
        const photos = area(photosState({ editor: editor(), confirm: { ids: ['p1'], title: 'Calea Victoriei' } }));
        const { element, app } = await photosPage(photos, { params: ['p1'] });

        const dialog = deep(element, 'hcm-confirm-dialog') as HTMLElement & { open: boolean };
        expect(dialog.open).toBe(true);
        expect(deepText(dialog)).toContain('Delete the photo “Calea Victoriei”?');
        deep(dialog, '.confirm').click();
        await updated(element);

        expect(photos.named('confirmDelete')).toEqual(['confirmDelete']);
        expect(app.named('navigate')).toEqual(['navigate {"id":"photos","params":[]}']);
    });

    it('badPath_aRefusedDeleteOfTheOpenPhotoStaysOnIt', async () => {
        const photos = new PhotosArea(photosState({ editor: editor(), confirm: { ids: ['p1'], title: 'Calea Victoriei' } }), {
            confirmDelete: Promise.resolve(false),
        });
        const { element, app } = await photosPage(photos, { params: ['p1'] });

        deep(deep(element, 'hcm-confirm-dialog'), '.confirm').click();
        await updated(element);

        expect(photos.named('confirmDelete')).toEqual(['confirmDelete']);
        expect(app.named('navigate')).toEqual([]);
    });

    it('happyPath_deletingAPhotoWithNoneOpenStaysOnTheList', async () => {
        const photos = area(photosState({ confirm: { ids: ['p2'], title: 'Piața Romană' } }));
        const { element, app } = await photosPage(photos, { width: 1300 });

        deep(deep(element, 'hcm-confirm-dialog'), '.confirm').click();
        await updated(element);

        expect(photos.named('confirmDelete')).toEqual(['confirmDelete']);
        expect(app.named('navigate')).toEqual([]);
    });

    it('badPath_cancellingTheDeleteChangesNothingAndASelectionsDeleteStaysOnTheList', async () => {
        const photos = area(photosState({ confirm: { ids: ['p1', 'p2'], title: null } }));
        const { element, app } = await photosPage(photos);
        const dialog = deep(element, 'hcm-confirm-dialog');
        expect(deepText(dialog)).toContain('Delete the selected photos (2)?');

        deep(dialog, '.cancel').click();
        await updated(element);
        photos.set({ confirm: { ids: ['p1', 'p2'], title: null } });
        await updated(element);
        deep(deep(element, 'hcm-confirm-dialog'), '.confirm').click();
        await updated(element);

        expect(photos.named('cancelConfirm')).toEqual(['cancelConfirm']);
        expect(app.named('navigate')).toEqual([]);
    });

    it('happyPath_theSkippedPhotosOfABulkAction', async () => {
        const report = {
            kind: 'publish' as const,
            done: 1,
            skipped: [
                { id: 'p2', title: 'Piața Romană', reason: 'license' },
                { id: 'p3', title: 'Lipscani', reason: 'mystery' },
            ],
        };
        const photos = area(photosState({ report }));
        const { element } = await photosPage(photos);

        const dialog = deep(element, 'hcm-dialog.report');
        expect(deepAll(dialog, 'li').map((item) => item.textContent.trim())).toEqual([
            '“Piața Romană”: the licence is unknown',
            '“Lipscani”: it has a value that is not valid',
        ]);
        deep(deep(dialog, 'hcm-icon-button'), 'button').click();
        expect(photos.named('closeReport')).toEqual(['closeReport']);
    });

    it('happyPath_authorSourceAndLicenceForTheSelection', async () => {
        const photos = area(photosState({ list: { ...photosState().list, selection: ['p1'] } }));
        const { element } = await photosPage(photos);
        await bulkAction(element, 'setFields');
        const dialog = deep(element, 'hcm-dialog.set-fields');

        (deep(dialog, '#bulk-author') as HTMLInputElement).value = 'Ion';
        (deep(dialog, '#bulk-license') as HTMLSelectElement).value = 'CC0';
        (deep(dialog, '#bulk-sourceUrl') as HTMLInputElement).value = ' ';
        deep(dialog.querySelectorAll('hcm-button')[1] as HTMLElement, 'button').click();
        await updated(element);

        expect(photos.named('bulk')).toEqual(['bulk {"kind":"setFields","fields":{"author":"Ion","license":"CC0"}}']);
        expect((dialog as HTMLElement & { open: boolean }).open).toBe(false);
    });

    it('badPath_closingTheFieldsDialogChangesNothing', async () => {
        const photos = area(photosState({ list: { ...photosState().list, selection: ['p1'] } }));
        const { element } = await photosPage(photos);
        await bulkAction(element, 'setFields');
        const dialog = deep(element, 'hcm-dialog.set-fields');
        (deep(dialog, '#bulk-license') as HTMLSelectElement).value = 'keep';

        deep(dialog.querySelectorAll('hcm-button')[0] as HTMLElement, 'button').click();
        await updated(element);

        expect(photos.named('bulk')).toEqual([]);
        expect((deep(element, 'hcm-dialog.set-fields') as HTMLElement & { open: boolean }).open).toBe(false);
    });

    it('badPath_aFormWithoutALicenceOrWithAFileLeavesThemOut', () => {
        const form = document.createElement('form');
        const author = document.createElement('input');
        author.name = 'author';
        author.value = 'Ion';
        const upload = document.createElement('input');
        upload.type = 'file';
        upload.name = 'sourceLabel';
        upload.files = files('a.jpg');
        form.append(author, upload);

        expect(stickyFrom(form)).toEqual({
            author: 'Ion',
            sourceLabel: undefined,
            sourceUrl: undefined,
            rightsHolder: undefined,
            license: undefined,
        });
    });

    it('badPath_withoutAStoreThePageIsEmpty', async () => {
        const { element } = await photosPage(null);

        expect(element.shadowRoot?.childElementCount ?? 0).toBe(0);
    });
});
