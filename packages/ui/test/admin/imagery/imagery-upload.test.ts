import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { ImageryIntentsPort, ImageryViewState, UploadStatePort } from '../../../src/admin/imagery/imagery-port.js';
import type { FakeArea } from '../editing/fake-area.js';
import { cleanup, deep, deepAll, deepText, updated } from '../shell/fake-app.js';
import { button, click, defineImagery, imageryPage, imageryState } from './fixtures.js';

function calls(area: FakeArea<ImageryViewState, ImageryIntentsPort>): readonly string[] {
    // M20: the Upload view registers the `archive` chunk's elements (Import local files) once, which is no upload intent.
    const quiet = new Set(['close', 'archiveElements']);
    return area.calls.filter((call) => !call.startsWith('open [') && !call.startsWith('attachMap') && !quiet.has(call));
}

function upload(overrides: Partial<UploadStatePort>): UploadStatePort {
    return { ...imageryState().upload, fileName: 'Plan 1911.tif', bytes: 1000, ...overrides };
}

function tiff(): File {
    return new File([new Uint8Array([0x49, 0x49, 0x2a, 0])], 'Plan 1911.tif', { type: 'image/tiff' });
}

describe('<hcm-imagery-page>: Upload', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_aChosenOrDroppedFileGoesToTheUploader', async () => {
        const { element, area } = await imageryPage(imageryState({ tab: 'upload' }));
        const input = deep(element, '.drop input[type="file"]') as HTMLInputElement;
        let opened = 0;
        input.addEventListener('click', (event) => {
            event.preventDefault();
            opened += 1;
        });

        click(button(element, 'Choose a GeoTIFF'));
        const files = new DataTransfer();
        files.items.add(tiff());
        input.files = files.files;
        input.dispatchEvent(new Event('change'));
        const dragged = new DataTransfer();
        dragged.items.add(tiff());
        const drop = deep(element, '.drop');
        drop.dispatchEvent(new DragEvent('dragover', { dataTransfer: dragged, cancelable: true }));
        const over = drop.hasAttribute('data-over');
        drop.dispatchEvent(new DragEvent('dragleave'));
        drop.dispatchEvent(new DragEvent('dragover', { dataTransfer: dragged, cancelable: true }));
        drop.dispatchEvent(new DragEvent('drop', { dataTransfer: dragged, cancelable: true }));
        input.dispatchEvent(new Event('change'));

        expect([opened, over, drop.hasAttribute('data-over')]).toEqual([1, true, false]);
        expect(calls(area).filter((call) => call.startsWith('chooseFile'))).toHaveLength(2);
        expect(deepText(element)).toContain('Drop a TIFF file here or choose it.');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aNameWithoutAYearAsksForItAndUploads', async () => {
        const { element, area } = await imageryPage(
            imageryState({ tab: 'upload', upload: upload({ phase: 'ready', needsYear: true, year: '' }) }),
        );
        const disabled = (button(element, 'Upload') as HTMLElement & { disabled: boolean }).disabled;
        const field = deep(element, '#imagery-upload-year') as HTMLInputElement;
        field.value = '1911';
        field.dispatchEvent(new Event('input'));
        area.set({ upload: upload({ phase: 'ready', needsYear: true, year: '1911' }) });
        await updated(element);
        click(button(element, 'Upload'));

        expect(disabled).toBe(true);
        expect(calls(area)).toEqual(['setYear "1911"', 'startUpload']);
        expect(deep(element, '[data-file]').textContent).toBe('File: Plan 1911.tif');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_theUploadsProgressWithStopThenTheCheck', async () => {
        const { element, area } = await imageryPage(
            imageryState({ tab: 'upload', upload: upload({ phase: 'uploading', progress: 0.42 }) }),
        );

        click(button(element, 'Stop the upload'));
        const uploading = [deepText(element), deepAll(element, '.drop').length];
        area.set({ upload: upload({ phase: 'checking', progress: 1 }) });
        await updated(element);

        expect(uploading[0]).toContain('Uploading: 42%');
        expect(uploading[1]).toBe(0);
        expect(calls(area)).toEqual(['cancelUpload']);
        expect(deepText(element)).toContain('Uploaded. The server is checking the file…');
    });

    it('badPath_aRefusedFileSaysWhyAndAFailedUploadTriesAgain', async () => {
        const { element, area } = await imageryPage(
            imageryState({ tab: 'upload', upload: upload({ phase: 'refused', refusal: { key: 'apiError.imagery.notTiff' } }) }),
        );
        const refused = [
            deep(element, '[data-phase="refused"] .alert').getAttribute('role'),
            deepAll(element, '[data-phase="refused"] hcm-button').length,
        ];
        click(button(element, 'Start over'));
        area.set({ upload: upload({ phase: 'failed', refusal: { key: 'adminContent.imagery.upload.interrupted' } }) });
        await updated(element);
        click(button(element, 'Try again'));

        expect(refused).toEqual(['alert', 2]);
        expect(deepText(element)).toContain('The connection dropped too often.');
        expect(calls(area)).toEqual(['resetUpload', 'startUpload']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aRevokedAdminCannotChooseAFileOrDropOne', async () => {
        const { element, area } = await imageryPage(
            imageryState({ tab: 'upload', upload: upload({ phase: 'ready', needsYear: true, year: '1911' }) }),
            {
                state: { revoked: true },
            },
        );
        const files = new DataTransfer();
        files.items.add(tiff());

        deep(element, '.drop').dispatchEvent(new DragEvent('drop', { dataTransfer: files, cancelable: true }));
        const empty = new DataTransfer();
        deep(element, '.drop').dispatchEvent(new DragEvent('drop', { dataTransfer: empty, cancelable: true }));

        expect((button(element, 'Choose a GeoTIFF') as HTMLElement & { disabled: boolean }).disabled).toBe(true);
        expect((button(element, 'Upload') as HTMLElement & { disabled: boolean }).disabled).toBe(true);
        expect(calls(area)).toEqual([]);
    });
    it('happyPath_replaceImageSaysItReplacesTheLayersImage', async () => {
        const { element } = await imageryPage(imageryState({ tab: 'upload', replaceLayer: 'kh-4a-1966' }));

        expect(deep(element, '[data-view="upload"] h3').textContent).toBe("Replace the layer's image");
    });
});

describe('<hcm-imagery-page>: Import local files (M20)', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_anArchivesAddressShowsItsReportAndAnArrivingArchiveOpensIt @S-A121-HAPPY-BUDGET', async () => {
        const detail = { kind: 'archive' as const, id: 'ar-0123456789abcdef' };
        const { element, area, app } = await imageryPage(imageryState({ detail }), { params: ['archive', detail.id] });
        const report = deep(element, 'hcm-archive-report');

        expect(report.getAttribute('archive')).toBe(detail.id);
        expect(area.calls.filter((call) => call === 'archiveElements')).toEqual(['archiveElements']);
        area.set({ tab: 'upload' });
        await updated(element);
        deep(element, 'hcm-archive-panel').dispatchEvent(
            new CustomEvent('hcm-archive-arrived', { detail: { id: 'ar-ffffffffffffffff' }, bubbles: true, composed: true }),
        );

        expect(area.calls.filter((call) => call === 'archiveElements')).toHaveLength(1);
        expect(app.named('navigate')).toEqual(['navigate {"id":"imagery","params":["archive","ar-ffffffffffffffff"]}']);
    });

    it('badPath_theFindViewWithNoDetailAsksForNoArchiveElements', async () => {
        const { area } = await imageryPage(imageryState());

        expect(area.calls).not.toContain('archiveElements');
    });
});
