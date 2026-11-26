/**
 * The cloud estimate (`functions/src/imagery/cloud-estimate.ts`, `cloud-record.ts`; the owner's report of 2026-11-13): a small grey
 * copy of the browse image, placed on the ground through the frame's corners, and the share of the city's pixels that are bright
 * and flat. Measured when `imagery.browse` copies or first reads a browse image, stored on the scene with a new rank, and the plan
 * then warns of the cloudy frame.
 */
import { FIRESTORE_PATHS, RASTER_PATHS, datePlanDocSchema, type UsgsSceneDoc } from '@hcm/shared';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

import { browseFunction } from '../../src/imagery/browse.js';
import { measureClouds } from '../../src/imagery/cloud-record.js';
import { estimateClouds, frameQuad } from '../../src/imagery/cloud-estimate.js';
import type { GreyImage } from '../../src/ports/image-processor.js';
import { adminCall } from '../publish/fakes.js';
import { EAST, F039, F040, frameFields } from './join-world.js';
import { BOUNDS, CITY, readScene, readyWorld, seedScene, type ImageryWorld } from './world.js';

const SIZE = 64;
/** The frame exactly over the city, north up. */
const OVER_THE_CITY: Pick<UsgsSceneDoc, 'corners' | 'footprint'> = {
    footprint: [
        { lat: BOUNDS.north, lng: BOUNDS.west },
        { lat: BOUNDS.north, lng: BOUNDS.east },
        { lat: BOUNDS.south, lng: BOUNDS.east },
        { lat: BOUNDS.south, lng: BOUNDS.west },
    ],
};

/** A `SIZE` square: dark textured ground, and flat white cloud where `cloudy(x, y)`. */
function greyImage(cloudy: (x: number, y: number) => boolean): GreyImage {
    const pixels = Uint8Array.from({ length: SIZE * SIZE }, (_, index) => {
        const [x, y] = [index % SIZE, Math.floor(index / SIZE)];
        return cloudy(x, y) ? 235 : 40 + ((x * 7 + y * 13) % 30);
    });
    return { pixels, width: SIZE, height: SIZE };
}

async function jpegOf(image: GreyImage): Promise<Uint8Array> {
    const raw = { width: image.width, height: image.height, channels: 1 as const };
    return new Uint8Array(await sharp(Buffer.from(image.pixels), { raw }).jpeg({ quality: 90 }).toBuffer());
}

describe('estimateClouds', () => {
    it('happyPath_theWesternHalfClouded_isAboutHalfTheCity', () => {
        // 32 of 64 columns are cloud; the one at its edge is not flat, so 31.
        expect(
            estimateClouds(
                greyImage((x) => x < SIZE / 2),
                OVER_THE_CITY,
                BOUNDS,
            ),
        ).toEqual({ percent: 48, version: 1 });
    });

    it('happyPath_aClearFrameIsNoCloud_aRoadsGlintIsNotCloud', () => {
        // A one-pixel bright line on dark ground: bright but not flat.
        expect(
            estimateClouds(
                greyImage((x) => x === 20),
                OVER_THE_CITY,
                BOUNDS,
            )?.percent,
        ).toBe(0);
    });

    it('happyPath_onlyTheCitysPartOfTheFrameCounts', () => {
        // The frame is twice the city's width, the city its western half; the eastern half (outside) is all cloud.
        const wide = {
            footprint: OVER_THE_CITY.footprint.map((point) => ({ ...point, lng: point.lng === BOUNDS.east ? 26.7 : point.lng })),
        };

        expect(
            estimateClouds(
                greyImage((x) => x >= SIZE / 2),
                wide,
                BOUNDS,
            )?.percent,
        ).toBe(0);
    });

    it('badPath_aFrameThatBarelyReachesTheCityIsUnmeasured', () => {
        // A corner of a hundredth of a degree each way: about three of the 4,096 pixels.
        const far = { footprint: OVER_THE_CITY.footprint.map((point) => ({ lat: point.lat + 0.29, lng: point.lng + 0.39 })) };

        expect(
            estimateClouds(
                greyImage(() => true),
                far,
                BOUNDS,
            ),
        ).toBeUndefined();
    });

    it('happyPath_cornersFromTheMetadataWin_aLongFootprintFallsBackToItsBox', () => {
        const [nw, ne, se, sw] = OVER_THE_CITY.footprint as [
            UsgsSceneDoc['footprint'][number],
            UsgsSceneDoc['footprint'][number],
            UsgsSceneDoc['footprint'][number],
            UsgsSceneDoc['footprint'][number],
        ];
        expect(frameQuad({ corners: { nw: se, ne: sw, se: nw, sw: ne }, footprint: OVER_THE_CITY.footprint })[0]).toEqual(se);
        const ring = [...OVER_THE_CITY.footprint, { lat: 44.45, lng: 25.8 }];
        expect(frameQuad({ footprint: ring })).toEqual([
            { lat: BOUNDS.north, lng: 25.8 },
            { lat: BOUNDS.north, lng: BOUNDS.east },
            { lat: BOUNDS.south, lng: BOUNDS.east },
            { lat: BOUNDS.south, lng: 25.8 },
        ]);
    });

    it('happyPath_aCounterClockwiseFootprintStartsFromItsNorthWesternCorner', () => {
        const reversed = { footprint: [...OVER_THE_CITY.footprint].reverse() };

        expect(frameQuad(reversed)[0]).toEqual({ lat: BOUNDS.north, lng: BOUNDS.west });
        // The northern quarter (16 rows) is cloud, its last row an edge: 15 of 64.
        expect(
            estimateClouds(
                greyImage((_x, y) => y < SIZE / 4),
                reversed,
                BOUNDS,
            )?.percent,
        ).toBe(23);
    });
});

function browse(world: ImageryWorld, entityId: string) {
    return browseFunction(() => world.deps).run(adminCall({ cityId: CITY, entityId }));
}

describe('the estimate recorded by imagery.browse', () => {
    it('happyPath_aCloudyPaidScanIsFlaggedRankedDownAndWarnedInThePlan @S-A152-BAD-CLOUDY', async () => {
        const world = await readyWorld();
        const source = `https://ims.cr.usgs.gov/browse/declass1/${F040}.jpg`;
        await seedScene(world, F039, frameFields());
        await seedScene(
            world,
            F040,
            frameFields({ footprint: EAST, downloadAvailable: false, browse: { state: 'none', sourceUrl: source } }),
        );
        world.remote.serve(source, await jpegOf(greyImage(() => true)));

        await browse(world, F040);

        const scene = await readScene(world, F040);
        expect(scene?.cloudEstimate).toEqual({ percent: 100, version: 1 });
        expect(scene?.rank.reasons.slice(0, 2)).toContainEqual({ code: 'cloudCity', params: { percent: '100' } });
        expect(scene?.rank.score).toBe(0);
        const plan = await world.deps.documents.get(FIRESTORE_PATHS.imageryPlan(CITY), datePlanDocSchema);
        expect(plan?.rows[0]?.cloudyFrames).toEqual([{ entityId: F040, percent: 100 }]);
    });

    it('happyPath_aCopyMadeBeforeIsMeasuredOnceWhenRead', async () => {
        const world = await readyWorld();
        const path = RASTER_PATHS.browse('declassiii', F039);
        await seedScene(world, F039, frameFields({ footprint: OVER_THE_CITY.footprint, browse: { state: 'copied', path } }));
        world.deps.blobs.put('private', path, await jpegOf(greyImage(() => false)), { contentType: 'image/jpeg' });

        await browse(world, F039);
        await browse(world, F039);

        expect((await readScene(world, F039))?.cloudEstimate).toEqual({ percent: 0, version: 1 });
        expect(world.deps.blobs.recorder.argsOf('read')).toHaveLength(1);
    });

    it('badPath_aFrameBesideTheCityIsLeftUnmeasured_theCopyStands', async () => {
        const world = await readyWorld();
        const path = RASTER_PATHS.browse('declassiii', F039);
        const beside = OVER_THE_CITY.footprint.map((point) => ({ lat: point.lat + 1, lng: point.lng }));
        await seedScene(world, F039, frameFields({ footprint: beside, browse: { state: 'copied', path } }));
        world.deps.blobs.put('private', path, await jpegOf(greyImage(() => true)), { contentType: 'image/jpeg' });

        await expect(browse(world, F039)).resolves.toEqual({ path, contentType: 'image/jpeg' });
        expect(await readScene(world, F039)).not.toHaveProperty('cloudEstimate');
    });

    it('badPath_anUnreadableBrowseImageLeavesTheSceneUnmeasured_theCopyStands', async () => {
        const world = await readyWorld();
        const path = RASTER_PATHS.browse('declassiii', F039);
        await seedScene(world, F039, frameFields({ browse: { state: 'copied', path } }));
        world.deps.blobs.put('private', path, new Uint8Array([0xff, 0xd8, 0xff, 0x00]), { contentType: 'image/jpeg' });

        await expect(browse(world, F039)).resolves.toEqual({ path, contentType: 'image/jpeg' });
        expect(await readScene(world, F039)).not.toHaveProperty('cloudEstimate');
    });
});

describe('measureClouds', () => {
    /** The seeded scene over the city, read back, then `gone` deleted before the clouded browse image is measured. */
    async function measuredAfter(gone: (world: ImageryWorld) => string): Promise<ImageryWorld> {
        const world = await readyWorld();
        await seedScene(world, F039, frameFields({ footprint: OVER_THE_CITY.footprint }));
        const scene = await readScene(world, F039);
        if (scene === undefined) {
            throw new Error('the scene was not seeded');
        }
        await world.deps.documents.delete(gone(world));
        const bytes = await jpegOf(greyImage(() => true));
        await measureClouds(world.deps, { cityId: CITY, scene, bytes: () => Promise.resolve(bytes), rewritePlan: true });
        return world;
    }

    it('badPath_aCityRemovedMeanwhileLeavesTheSceneUnmeasured', async () => {
        const world = await measuredAfter(() => FIRESTORE_PATHS.city(CITY));

        expect(await readScene(world, F039)).not.toHaveProperty('cloudEstimate');
    });

    it('badPath_aSceneRemovedMeanwhileIsNotWrittenBack', async () => {
        const world = await measuredAfter(() => FIRESTORE_PATHS.usgsScene(CITY, F039));

        expect(await readScene(world, F039)).toBeUndefined();
    });
});
