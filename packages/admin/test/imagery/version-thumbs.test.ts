import { describe, expect, it } from 'vitest';

import type { VersionItem } from '../../src/imagery/model.js';
import { VersionThumbs } from '../../src/imagery/version-thumbs.js';
import { settle } from '../app/fakes.js';
import { FakeFiles, FakePictures } from './world.js';

/** An answer the test gives when it chooses. */
function deferred<T>(): { readonly promise: Promise<T>; resolve(value: T): void } {
    const answers: ((value: T) => void)[] = [];
    const promise = new Promise<T>((resolve) => {
        answers.push(resolve);
    });
    return {
        promise,
        resolve: (value) => {
            answers[0]?.(value);
        },
    };
}

function row(id: string, overrides: Partial<VersionItem> = {}): VersionItem {
    return {
        ...{
            id,
            layerId: 'l',
            label: { ro: id },
            year: 1966,
            origin: 'usgs',
            state: 'awaiting_approval',
            updatedAt: '2026-10-20T09:00:00Z',
        },
        ...{ needsYou: true, checkpointRmseM: null, partOf: null, entityIds: [], basedOn: null, thumbPath: `rasters/${id}/thumb.webp`, tooCoarse: false },
        ...overrides,
    };
}

function thumbs(pictures: FakePictures | null = new FakePictures()) {
    const files = new FakeFiles();
    const shown: Readonly<Record<string, string>>[] = [];
    const subject = new VersionThumbs({ files, pictures, changed: (next) => shown.push(next) });
    return { subject, files, shown, pictures };
}

describe("Work's small pictures", () => {
    it('happyPath_aWaitingRowsPictureIsMadeOnceAndGoesWithTheArea @S-A75-HAPPY-THUMBS', async () => {
        const { subject, files, shown, pictures } = thumbs();
        files.put('rasters/a/thumb.webp');

        subject.show([row('a')]);
        subject.show([row('a')]);
        await settle();

        const url = shown.at(-1)?.['a'];
        expect(url).toBeDefined();
        expect(pictures?.shrunk).toEqual([128]);

        subject.clear();
        expect(files.released).toEqual([url]);
        expect(shown.at(-1)).toEqual({});
    });

    it('badPath_aRowInProgressOrWithoutAPictureReadsNothing @S-A75-BAD-NO-THUMB', async () => {
        const { subject, shown, pictures } = thumbs();

        subject.show([row('a', { needsYou: false }), row('b', { thumbPath: null })]);
        await settle();

        expect(pictures?.shrunk).toEqual([]);
        expect(shown).toEqual([]);
    });

    it('badPath_aFileTheBucketRefusesOrNoDecoderLeavesTheRowItsIcon @S-A75-BAD-NO-THUMB', async () => {
        const missing = thumbs();
        missing.subject.show([row('a')]);
        const blind = thumbs(null);
        blind.files.put('rasters/a/thumb.webp');
        blind.subject.show([row('a')]);
        await settle();

        expect(missing.shown).toEqual([]);
        expect(blind.shown).toEqual([]);
    });

    it('badPath_aPictureArrivingAfterTheAreaClosedIsReleased', async () => {
        const late = deferred<string>();
        const pictures = new FakePictures();
        pictures.thumbnail = () => late.promise;
        const held = thumbs(pictures);

        held.subject.show([row('a')]);
        held.subject.clear();
        late.resolve('blob:late');
        await settle();

        expect(held.files.released).toEqual(['blob:late']);
        expect(held.shown.at(-1)).toEqual({});
    });

    it('happyPath_aPageOfWorkNeverEveryVersion', async () => {
        const { subject, files, pictures } = thumbs();
        const rows = Array.from({ length: 30 }, (_, index) => row(`v${String(index)}`));
        for (const version of rows) {
            files.put(String(version.thumbPath));
        }

        subject.show(rows);
        await settle();

        expect(pictures?.shrunk).toHaveLength(24);
    });
});
