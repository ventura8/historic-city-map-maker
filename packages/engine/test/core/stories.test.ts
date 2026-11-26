/** M17's stories in the viewer's store (`docs/research/M17-stories.md` §5; V50): the list, a story at its year, its link. */
import { decodeHash } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { initialState, withManifest, withStory } from '../../src/core/state.js';
import { applyDecodedHash, encodeViewerHash, hashLimits, unknownToast } from '../../src/core/url-sync.js';
import { manifest, omit, STORY } from './fixtures.js';
import { loaded } from './harness.js';

const city = manifest({ stories: [STORY, { ...omit(STORY, 'yearStart'), id: 'fara-an' }] });
const ready = withManifest(initialState('ro', 'system', 'unknown'), city);

describe('stories in the viewer state @S-V50-HAPPY-OPEN', () => {
    it('happyPath_aStoryOpensAtItsYearAndItsLinkSaysSo', () => {
        const state = withStory({ ...ready, selectedPhotoId: 'mihai-voda-1978', sheet: 'photo' }, 'teatrul');
        expect(state).toMatchObject({ sheet: 'stories', selectedStoryId: 'teatrul', selectedPhotoId: null, year: 1966 });
        expect(encodeViewerHash(state ?? ready, 'ro')).toContain('&story=teatrul');
    });

    it('happyPath_theListAndAStoryWithNoYear', () => {
        expect(withStory(ready, null)).toMatchObject({ sheet: 'stories', selectedStoryId: null, year: ready.year });
        expect(withStory(ready, 'fara-an')?.year).toBe(ready.year);
    });

    it('happyPath_aSharedLinkOpensTheStory', () => {
        const applied = applyDecodedHash(ready, decodeHash('#story=teatrul', hashLimits(city)));
        expect(applied.state).toMatchObject({ sheet: 'stories', selectedStoryId: 'teatrul' });
        expect(unknownToast(applied)).toBeNull();
    });

    it('happyPath_aLinkWithItsOwnLayersKeepsThemWithTheStoryOpen @S-V50-BAD-TIMELINE-LINK-LAYERS', () => {
        const applied = applyDecodedHash(ready, decodeHash('#layers=kh9-1980&story=teatrul', hashLimits(city)));
        expect(applied.state).toMatchObject({ sheet: 'stories', selectedStoryId: 'teatrul', year: 1980 });
        const visible = applied.state.overlays
            .filter((overlay) => overlay.kind === 'raster' && overlay.visible)
            .map((overlay) => overlay.id);
        expect(visible).toEqual(['kh9-1980']);
        expect(encodeViewerHash(applied.state, 'ro')).toContain('layers=kh9-1980');
    });
});

describe('stories in the viewer state: refusals @S-V50-BAD-UNKNOWN', () => {
    it('badPath_anUnknownStoryOpensNothingAndSaysSo', () => {
        expect(withStory(ready, 'nope')).toBeNull();
        expect(withStory(withManifest(initialState('ro', 'system', 'unknown'), manifest()), 'teatrul')).toBeNull();
        const applied = applyDecodedHash(ready, decodeHash('#story=nope', hashLimits(city)));
        expect(applied.state).toBe(ready);
        expect(unknownToast(applied)).toBe('error.unknownStory');
        expect(unknownToast({ state: ready, unknownPhoto: 'x' })).toBe('error.unknownPhoto');
    });

    it('badPath_theStoreSaysAnUnknownStoryAndOpensAKnownOne', async () => {
        const { store, telemetry } = await loaded({ manifest: city, hash: '#story=nope' });
        expect(store.getState().toast).toEqual({ key: 'error.unknownStory' });
        store.openStory('nope');
        expect(store.getState().sheet).toBe('none');
        store.openStory('teatrul');
        expect(store.getState()).toMatchObject({ sheet: 'stories', selectedStoryId: 'teatrul', year: 1966 });
        store.openStory(null);
        expect(store.getState()).toMatchObject({ sheet: 'stories', selectedStoryId: null });
        expect(telemetry.events.filter((event) => event.name === 'story_open')).toEqual([{ name: 'story_open', storyId: 'teatrul' }]);
    });
});
