// The photo editor's improved and colorized versions (the owner 2026-11-09; A140): Add a file per version, its upload's
// banner, Remove as an edit of the draft, the credit, and no section for an uploader.
import { html } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { HcmAdminPhotoEditor } from '../../../src/admin/photos/hcm-admin-photo-editor.js';
import type { PhotoEditorPort } from '../../../src/admin/photos/photos-port.js';
import { cleanup, deep, deepAll, deepText, defineAll, mount, updated } from '../shell/fake-app.js';
import { area, editor, files, photosState, VALUE } from './fixtures.js';

const IMAGE = { web: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=', thumb: 'data:image/gif;base64,R0lGODlhAQABAAAAACw=' };

async function editorOf(state: PhotoEditorPort, locale: 'ro' | 'en' = 'en') {
    const photos = area(photosState({ editor: state }));
    const element = await mount<HcmAdminPhotoEditor>(
        html`<hcm-admin-photo-editor .editor=${state} .intents=${photos.intents} .locale=${locale}></hcm-admin-photo-editor>`,
        900,
    );
    await updated(element);
    return { element, photos };
}

function section(element: HTMLElement, kind: 'improved' | 'colorized'): HTMLElement {
    return deep(element, `[data-version="${kind}"]`);
}

describe('<hcm-admin-photo-editor>: versions', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_addAFileForAVersion', async () => {
        const { element, photos } = await editorOf(editor());
        const input = deep(element, '.version-input') as HTMLInputElement;
        input.addEventListener('click', (event) => {
            event.preventDefault();
        });

        expect(deepText(element)).toContain('Improved and colorized versions');
        deep(deep(section(element, 'colorized'), 'hcm-button'), 'button').click();
        input.files = files('color.jpg');
        input.dispatchEvent(new Event('change'));
        input.files = files();
        input.dispatchEvent(new Event('change'));

        expect(photos.calls).toEqual(['uploadVersion "colorized" {"name":"color.jpg","size":1,"data":{}}']);
    });

    it('happyPath_removeAndTheCreditAreEditsOfTheDraft', async () => {
        const value = {
            ...VALUE,
            versions: { improved: { image: IMAGE }, colorized: { image: IMAGE } },
            versionCredits: { improved: 'Ion' },
        };
        const { element, photos } = await editorOf(editor({ value }), 'ro');

        expect(deepText(element)).toContain('Versiunea colorizată');
        const remove = deepAll(section(element, 'improved'), 'hcm-button')[1];
        deep(remove ?? element, 'button').click();
        const credit = deep(element, '#photo-version-colorized-credit') as HTMLInputElement;
        credit.value = 'Ana Pop';
        credit.dispatchEvent(new Event('input'));
        const improved = deep(element, '#photo-version-improved-credit') as HTMLInputElement;
        improved.value = '  ';
        improved.dispatchEvent(new Event('input'));

        expect(photos.calls).toEqual([
            `edit {"versions":{"colorized":{"image":${JSON.stringify(IMAGE)}}}}`,
            'edit {"versionCredits":{"improved":"Ion","colorized":"Ana Pop"}}',
            'edit {}',
        ]);
    });

    it('badPath_removingTheLastVersionAndClearingTheOnlyCreditLeaveNeither', async () => {
        const { element, photos } = await editorOf(editor({ value: { ...VALUE, versions: { colorized: { image: IMAGE } } } }));

        deep(deepAll(section(element, 'colorized'), 'hcm-button')[1] ?? element, 'button').click();
        const credit = deep(element, '#photo-version-improved-credit') as HTMLInputElement;
        credit.value = 'Ion';
        credit.dispatchEvent(new Event('input'));

        expect(photos.calls).toEqual(['edit {}', 'edit {"versionCredits":{"improved":"Ion"}}']);
    });

    it('badPath_aRefusedFileSaysWhyAndClosesItsMessage', async () => {
        const refused = { phase: 'refused', percent: 0, error: 'apiError.photo.unsupportedType', params: null, duplicateOf: null } as const;
        const uploading = { phase: 'uploading', percent: 20, error: null, params: null, duplicateOf: null } as const;
        const { element, photos } = await editorOf(editor({ versionUploads: { improved: refused, colorized: uploading } }));

        expect(deepText(section(element, 'improved'))).toContain('The new image was refused');
        deep(deep(deep(section(element, 'improved'), '.banner'), 'hcm-button'), 'button').click();
        deep(deep(deep(section(element, 'colorized'), '.banner'), 'hcm-button'), 'button').click();

        expect(photos.calls).toEqual(['dismissVersion "improved"', 'cancelVersion "colorized"']);
    });

    it('badPath_anUploaderHasNoVersions', async () => {
        const { element } = await editorOf(editor({ role: 'uploader' }));

        expect(deepAll(element, '[data-version]')).toEqual([]);
    });
});
