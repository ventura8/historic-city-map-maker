import { describe, expect, it } from 'vitest';

import { manifestSchema } from '../../src/schemas/manifest.js';
import { storySchema } from '../../src/schemas/story.js';
import { parseStory, storyFigureIds, storyRejectedLinks } from '../../src/text/story.js';
import { decodeHash, encodeHash } from '../../src/url/hash.js';
import { validManifest } from '../fixtures/manifest.js';

const TEXT = 'Teatrul a ars în **1944**.\n\n![Fațada](photo:p1)\n\nApoi [o sursă](https://example.org).\r\n\r\n![](photo:p2)';

function story(changes: Record<string, unknown> = {}): Record<string, unknown> {
    return { id: 's1', title: { ro: 'Teatrul' }, body: { ro: TEXT }, photoIds: ['mihai-voda-1978'], poiIds: ['casa-uranus'], ...changes };
}

describe('parseStory (M17 §3)', () => {
    it('happyPath_paragraphsAndFiguresInOrder', () => {
        const blocks = parseStory(TEXT);
        expect(blocks.map((block) => block.type)).toEqual(['paragraph', 'figure', 'paragraph', 'figure']);
        expect(blocks[1]).toEqual({ type: 'figure', photoId: 'p1', caption: 'Fațada' });
        expect(blocks[3]).toEqual({ type: 'figure', photoId: 'p2', caption: '' });
        expect(storyFigureIds(`${TEXT}\n\n![Din nou](photo:p1)`)).toEqual(['p1', 'p2']);
    });

    it('badPath_anyOtherImageStaysText', () => {
        const source = 'Vezi ![x](photo:p1) aici.\n\n![x](https://evil.example/a.png)\n\n![x](photo:bad id)';
        const blocks = parseStory(source);
        expect(blocks.every((block) => block.type === 'paragraph')).toBe(true);
        expect(storyFigureIds(source)).toEqual([]);
    });

    it('badPath_nonHttpsLinksAreReportedButNotFigures', () => {
        const plain = ['http', '//x.org'].join(':');
        expect(storyRejectedLinks(`![a](photo:p1)\n\n[b](javascript:alert(1)) [c](${plain})`)).toEqual(['javascript:alert(1', plain]);
        expect(storyRejectedLinks(TEXT)).toEqual([]);
    });
});

describe('storySchema and the manifest (M17 §4)', () => {
    it('happyPath_aStoryWithLinksThatResolveIsValid', () => {
        expect(storySchema.safeParse(story()).success).toBe(true);
        expect(manifestSchema.safeParse({ ...validManifest(), stories: [story()] }).success).toBe(true);
    });

    it('happyPath_aStoryMayNameAPhotoWithNoPlace', () => {
        const manifest = validManifest();
        const [photo] = manifest['photos'] as Record<string, unknown>[];
        const placeless = Object.entries(photo ?? {}).filter(([key]) => !['location', 'bearing', 'fov'].includes(key));
        const unplaced = { ...Object.fromEntries(placeless), id: 'lost' };
        const result = manifestSchema.safeParse({ ...manifest, unplaced: [unplaced], stories: [story({ photoIds: ['lost'] })] });
        expect(result.success).toBe(true);
    });

    it.each([
        ['an http link', story({ body: { ro: `[x](${['http', '//example.org'].join(':')})` } })],
        ['an inverted span', story({ yearStart: 1950, yearEnd: 1900 })],
        ['21 photos', story({ photoIds: Array.from({ length: 21 }, (_, index) => `p${String(index)}`) })],
        ['a text too long', story({ body: { ro: 'x'.repeat(10_001) } })],
    ])('badPath_refuses %s', (_name, value) => {
        expect(storySchema.safeParse(value).success).toBe(false);
    });

    it('badPath_theManifestRefusesUnknownLinksAndRepeatedIds', () => {
        const result = manifestSchema.safeParse({
            ...validManifest(),
            stories: [story({ photoIds: ['gone'], poiIds: ['gone'] }), story()],
        });
        expect(result.success).toBe(false);
        const paths = result.error?.issues.map((issue) => issue.path.join('.'));
        expect(paths).toEqual(['stories.1.id', 'stories.0.photoIds.0', 'stories.0.poiIds.0']);
    });

    it('happyPath_aFigureOfAPhotoTheManifestDoesNotListIsNoError', () => {
        expect(manifestSchema.safeParse({ ...validManifest(), stories: [story({ body: { ro: '![x](photo:elsewhere)' } })] }).success).toBe(
            true,
        );
    });
});

describe('the hash: story= (M17 §5)', () => {
    it('happyPath_aStoryRoundTrips', () => {
        expect(encodeHash({ story: 'teatrul-national' })).toBe('#story=teatrul-national');
        expect(decodeHash('#14/44.4/26.1&story=teatrul-national')).toMatchObject({ story: 'teatrul-national' });
    });

    it('badPath_anIdThatIsNoIdIsDropped', () => {
        expect(decodeHash('#story=<script>')).toEqual({ legacy: false });
        expect(encodeHash({ story: 'a b' })).toBe('');
    });
});
