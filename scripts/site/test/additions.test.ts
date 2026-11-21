import { afterEach, describe, expect, it } from 'vitest';

import { joinAdditions } from '../src/additions.js';
import { nodeFileSystem, type SiteFileSystem } from '../src/files.js';
import { parseSiteSpec } from '../src/site-spec.js';
import { readRepositoryJson } from './manifests.js';
import { cleanup, temporaryDir } from './support.js';

type Json = Record<string, unknown>;

const KIT = readRepositoryJson('starter-kit/data/manifest.json');
const [MIHAI = {}, REALITATEA = {}] = KIT['photos'] as Json[];
const KIT_CITY = KIT['city'] as Json;

/** The seed: the starter kit's two photos under an authors line the migration would write (`Fotografii: Dan Vartanian`). */
const SEED: Json = {
    ...KIT,
    city: {
        ...KIT_CITY,
        credits: [{ label: { ro: 'Fotografii: Dan Vartanian', en: 'Photos: Dan Vartanian' } }, ...(KIT_CITY['credits'] as Json[])],
    },
};

const ADDED: Json = { ...MIHAI, id: 'strada-gradinarilor', author: 'Studiourile Buftea', bearing: 120 };

/** Realitatea's place as migrated, and the old site's later one with its cone. */
const CORRECTION = {
    location: { lat: 44.4477, lng: 26.1411 },
    bearing: 219.1,
    fov: 50,
    migrated: { location: REALITATEA['location'] },
    source: 'https://legacy.example/photos/realitatea.jpg',
};

function folder(files: SiteFileSystem, photos: readonly Json[], corrections?: unknown): void {
    files.write('seed/later/manifest.static.json', JSON.stringify({ ...KIT, photos }));
    if (corrections !== undefined) {
        files.write('seed/later/corrections.json', JSON.stringify(corrections));
    }
}

function fileSystem(): SiteFileSystem {
    return nodeFileSystem(temporaryDir());
}

afterEach(cleanup);

describe('joinAdditions', () => {
    it('happyPath_theAdditionsJoinAfterTheSeedCorrectedAndCredited', () => {
        const files = fileSystem();
        folder(files, [ADDED], { 'realitatea-ilustrata-1934-6-1': CORRECTION });

        const joined = joinAdditions(SEED, 'seed/derived', ['seed/later'], files);

        const manifest = joined.manifest as { photos: Json[]; city: { credits: { label: { ro: string } }[] } };
        expect(manifest.photos.map((photo) => photo['id'])).toEqual([
            'mihai-voda-1978',
            'realitatea-ilustrata-1934-6-1',
            'strada-gradinarilor',
        ]);
        expect(manifest.photos[1]).toMatchObject({ location: CORRECTION.location, bearing: 219.1, fov: 50 });
        expect(manifest.city.credits[0]?.label.ro).toBe('Fotografii: Dan Vartanian, Studiourile Buftea');
        expect([...joined.mediaOf]).toEqual([
            ['mihai-voda-1978', 'seed/derived'],
            ['realitatea-ilustrata-1934-6-1', 'seed/derived'],
            ['strada-gradinarilor', 'seed/later/derived'],
        ]);
    });

    it('happyPath_withoutAdditionsTheSeedIsServedAsItIs', () => {
        expect(joinAdditions(SEED, 'seed/derived', [], fileSystem())).toEqual({ manifest: SEED, mediaOf: new Map() });
    });

    it('happyPath_aPhotoThatNoLongerHoldsTheMigratedPlaceKeepsItsOwn', () => {
        const files = fileSystem();
        const moved = { ...CORRECTION, migrated: { location: { lat: 44.4, lng: 26.1 } } };
        folder(files, [ADDED], { 'realitatea-ilustrata-1934-6-1': moved });

        const manifest = joinAdditions(SEED, 'seed/derived', ['seed/later'], files).manifest as { photos: Json[] };

        expect(manifest.photos[1]).toEqual(REALITATEA);
    });

    it('badPath_aMissingAdditionFolderFailsTheBuild', () => {
        expect(() => joinAdditions(SEED, 'seed/derived', ['seed/later'], fileSystem())).toThrow(
            'seed/later/manifest.static.json is missing: site.json → additions names its folder',
        );
    });

    it('badPath_anIdTwiceFailsTheBuild', () => {
        const files = fileSystem();
        folder(files, [MIHAI]);

        expect(() => joinAdditions(SEED, 'seed/derived', ['seed/later'], files)).toThrow(
            'seed/later/derived: the photo id "mihai-voda-1978" is already the one of a photo before it',
        );
    });

    it('badPath_invalidCorrectionsFailTheBuild', () => {
        const files = fileSystem();
        folder(files, [ADDED], { 'realitatea-ilustrata-1934-6-1': { ...CORRECTION, bearing: 400 } });

        expect(() => joinAdditions(SEED, 'seed/derived', ['seed/later'], files)).toThrow(
            'seed/later/corrections.json: invalid corrections',
        );
    });

    it('badPath_anUnreadableOrInvalidAdditionFailsTheBuild', () => {
        const files = fileSystem();
        files.write('seed/later/manifest.static.json', '{');

        expect(() => joinAdditions(SEED, 'seed/derived', ['seed/later'], files)).toThrow('seed/later/manifest.static.json: not JSON');
        files.write('seed/later/manifest.static.json', JSON.stringify({ ...KIT, photos: 'none' }));
        expect(() => joinAdditions(SEED, 'seed/derived', ['seed/later'], files)).toThrow(
            'seed/later/manifest.static.json: invalid manifest',
        );
    });

    it('badPath_additionsWithoutASeedManifestAreRefused', () => {
        const spec = { lang: 'ro', title: 'T', description: 'D', themeColor: '#8B5E3C', noscript: { ro: 'x', en: 'y' } };

        expect(() => parseSiteSpec(JSON.stringify({ ...spec, publicManifest: true, additions: ['seed/later'] }))).toThrow(
            'site.json: invalid',
        );
    });
});
