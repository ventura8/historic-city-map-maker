import { describe, expect, it } from 'vitest';

import { prepareManifest } from '../src/manifest.js';
import { readRepositoryJson, readRepositoryManifest } from './manifests.js';

const TOKEN = 'pk.e2e-fake-token';

describe('prepareManifest', () => {
    it('happyPath_movesEveryBucharestPhotoUnderMediaAndSetsTheToken', () => {
        const seed = readRepositoryManifest('seed/bucharest/manifest.static.json');

        const { manifest, media } = prepareManifest(seed, TOKEN);

        expect(manifest.city.mapbox.publicToken).toBe(TOKEN);
        expect(manifest.photos).toHaveLength(seed.photos.length);
        expect(media).toHaveLength(seed.photos.length * 2);
        const [photo] = manifest.photos;
        expect(photo?.image.web).toBe(`media/${String(photo?.id)}/web.webp`);
        expect(photo?.image.thumb).toBe(`media/${String(photo?.id)}/thumb.webp`);
        expect(media[0]).toEqual({ photoId: photo?.id, from: `${String(photo?.id)}/web.webp`, to: `media/${String(photo?.id)}/web.webp` });
    });

    it('happyPath_theStarterKitKeepsItsMediaPaths', () => {
        const source = readRepositoryManifest('starter-kit/data/manifest.json');

        const { manifest, media } = prepareManifest(source, TOKEN);

        expect(manifest.photos.map((photo) => photo.image.web)).toEqual(source.photos.map((photo) => photo.image.web));
        expect(media.map((copy) => copy.to)).toEqual(source.photos.flatMap((photo) => [photo.image.web, photo.image.thumb]));
    });

    it('happyPath_httpsImagesStayWhereTheyAre', () => {
        const seed = readRepositoryJson('seed/bucharest/manifest.static.json');
        const photos = (seed['photos'] as Record<string, unknown>[]).slice(0, 1).map((photo) => ({
            ...photo,
            image: { web: 'https://photos.example/a/web.webp', thumb: 'https://photos.example/a/thumb.webp', w: 10, h: 10 },
        }));

        const { manifest, media } = prepareManifest({ ...seed, photos }, TOKEN);

        expect(manifest.photos[0]?.image.web).toBe('https://photos.example/a/web.webp');
        expect(media).toEqual([]);
    });

    it('badPath_anInvalidSourceNamesItsIssues', () => {
        const seed = readRepositoryJson('seed/bucharest/manifest.static.json');

        expect(() => prepareManifest({ ...seed, version: 2 }, TOKEN, 'seed/x.json')).toThrow(/^seed\/x\.json: invalid manifest\nversion: /);
    });

    it('badPath_aSecretTokenNeverReachesThePage', () => {
        const seed = readRepositoryManifest('seed/bucharest/manifest.static.json');

        expect(() => prepareManifest(seed, 'sk.secret-token')).toThrow(
            /with the build's token\): invalid manifest\ncity\.mapbox\.publicToken: /,
        );
    });
});
