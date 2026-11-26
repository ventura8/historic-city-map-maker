/**
 * What `locate` measured on a version's page (`packages/ui/src/admin/imagery/calibration-card.ts`,
 * `docs/research/M9-calibration.md` §8): how the frame was found and what proves it, a frame nothing found, and why a frame waits.
 */
import type { CalibrationAlignment } from '@hcm/shared';
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { VersionViewPort } from '../../../src/admin/imagery/imagery-port.js';
import { JOIN_CARD_CHUNK } from '../../../src/admin/imagery/join/lazy-card.js';
import { cleanup, deep, deepAll, deepText } from '../shell/fake-app.js';
import { defineImagery, imageryPage, imageryState, versionPage, versionView } from './fixtures.js';

const VERSION = { kind: 'version' as const, id: 'job-1966' };
const PROVED: VersionViewPort['calibration'] = { how: 'votes', tiles: { agreed: 712, tried: 946 }, crossValidatedM: 16.3, coveredPct: 62 };

function page(view: VersionViewPort, locale?: 'ro' | 'en') {
    const state = imageryState({ detail: VERSION, version: versionPage({}, view) });
    return locale === undefined ? imageryPage(state) : imageryPage(state, { locale });
}

function output(coveragePct: number | null): VersionViewPort['output'] {
    const shown = versionView().output;
    return shown === null ? null : { ...shown, coveragePct };
}

describe('<hcm-imagery-page>: what calibration measured', () => {
    beforeAll(async () => {
        await defineImagery();
        await JOIN_CARD_CHUNK.load();
    });
    afterEach(cleanup);

    it('happyPath_howItWasFoundTheAreasTheErrorAndTheCityItCovers', async () => {
        const { element } = await page(versionView({ calibration: PROVED }));
        const block = deep(element, '[data-calibration="votes"]');

        expect(block.textContent).toContain('Found automatically');
        expect(block.textContent).toContain('712 of 946 areas agree');
        expect(block.textContent).toContain('Measured error 16.3 m');
        expect(block.textContent).toContain('Covers 62 % of the city');
        await expect(axeViolations(block)).resolves.toEqual([]);
    });

    it.each([
        ['pass', 'Found from a neighbouring frame'],
        ['points', 'Refined from your points'],
        ['matcher', 'Found automatically'],
        ['local-ai', 'Found automatically'],
    ] as const)('happyPath_%sSaysHowInWords', async (how, words) => {
        const { element } = await page(versionView({ calibration: { how } }));

        expect(deep(element, '[data-how]').textContent).toBe(words);
        expect(deepAll(deep(element, `[data-calibration="${how}"]`), '.note')).toEqual([]);
    });

    it.each([
        [
            'local-ai',
            { name: 'aliked-lightglue', device: 'gpu', deviceName: 'NVIDIA RTX 3080', seconds: 31, support: 46 },
            'NVIDIA RTX 3080',
        ],
        ['local-ai', { name: 'aliked-lightglue', device: 'cpu', seconds: 900, support: 46, fallback: 'no-gpu' }, 'processor'],
        [
            'matcher',
            { name: 'aliked-lightglue', device: 'gpu', deviceName: 'NVIDIA RTX 3080', seconds: 31, support: 46 },
            'NVIDIA RTX 3080',
        ],
    ] as const)('happyPath_%sSaysTheAiProposedOn_%j @S-A68-HAPPY-DEVICE-SHOWN', async (how, proposer, device) => {
        const { element } = await page(versionView({ calibration: { how, proposer } }));

        expect(deep(element, '[data-how]').textContent).toBe(`Proposed by the AI on your computer (${device}), then checked`);
    });

    it('badPath_aMatchersCountIsNeverShownAsTilesThatAgree @S-P07-BAD-FALSE-PROPOSAL', async () => {
        const proposer = { name: 'aliked-lightglue', device: 'gpu', seconds: 31, support: 99_999 } as const;
        const { element } = await page(versionView({ calibration: { how: 'local-ai', proposer } }));

        expect(deep(element, '[data-calibration="local-ai"]').textContent).not.toContain('99');
    });

    it('happyPath_pointsThatReplacedAProposalSayPoints', async () => {
        const proposer = { name: 'aliked-lightglue', device: 'gpu', seconds: 31, support: 46 } as const;
        const { element } = await page(versionView({ calibration: { how: 'points', proposer } }));

        expect(deep(element, '[data-how]').textContent).toBe('Refined from your points');
    });

    it('happyPath_theRendersFigureBeatsWhatLocateWorkedOut', async () => {
        const { element } = await page(versionView({ calibration: PROVED, output: output(94.2) }));

        expect(deep(element, '[data-calibration="votes"]').textContent).toContain('Covers 94 % of the city');
    });

    describe('a frame lined up with earlier ones (M15)', () => {
        const alignment: CalibrationAlignment = {
            partners: [
                { versionId: 'v-1972', year: 1972, ties: 1420, tried: 1643, status: 'used', offsetM: 1.4 },
                { versionId: 'v-1977', year: 1977, ties: 810, tried: 1961, status: 'used', offsetM: 0.2 },
                { versionId: 'v-1966', year: 1966, ties: 78, tried: 124, status: 'few' },
                { versionId: 'v-1978', year: 1978, ties: 900, tried: 1500, status: 'disagrees', offsetM: 9.24 },
            ],
        };

        it('happyPath_itSaysWhichPhotosHeldItAndThatTheyStayed @S-A67-HAPPY-ALIGNED', async () => {
            const { element } = await page(versionView({ calibration: { ...PROVED, alignment } }));
            const block = deep(element, '[data-calibration="votes"]');

            expect(block.textContent).toContain('Lined up with your photos of 1972, 1977 at 2230 shared points');
            expect(block.textContent).toContain('Those photos stay where they are; lining them up with this one is your choice');
            expect(block.textContent).not.toContain('1966');
            await expect(axeViolations(block)).resolves.toEqual([]);
        });

        it('badPath_aPhotoWhoseStreetsSatOffIsNamedAndNotUsed @S-A67-BAD-ALIGNED-LEFT-OUT', async () => {
            const { element } = await page(versionView({ calibration: { ...PROVED, alignment } }), 'ro');

            expect(deepText(element)).toContain('Nepotrivită cu 1978: străzile lor erau la peste 6 m de celelalte');
            expect(deepText(element)).toContain('Potrivită cu fotografiile tale din 1972, 1977 în 2230 puncte comune');
        });

        it('badPath_onlyTooFewSharedPointsSaysNothing', async () => {
            const few: CalibrationAlignment = { partners: alignment.partners.filter(({ status }) => status === 'few') };
            const { element } = await page(versionView({ calibration: { ...PROVED, alignment: few } }));

            expect(deep(element, '[data-calibration="votes"]').textContent).not.toContain('Lined up');
        });
    });

    it('happyPath_inRomanian', async () => {
        const { element } = await page(versionView({ calibration: PROVED }), 'ro');

        expect(deepText(element)).toContain('712 din 946 zone se potrivesc');
        expect(deepText(element)).toContain('Acoperă 62 % din oraș');
    });

    it('badPath_aFrameNothingFoundAsksForAFewRoughPoints', async () => {
        const none = { how: 'none' } as const;
        const { element } = await page(versionView({ state: 'needs_gcps', calibration: none, georef: null, output: null }));

        expect(deep(element, '[data-calibration="none"]').textContent.trim()).toBe(
            'Not found: place a few rough points, the rest is automatic',
        );
    });

    it('badPath_onceItHasItsPointsTheFrameNoLongerAsks', async () => {
        const none = { how: 'none' } as const;
        const { element } = await page(versionView({ calibration: none }));

        expect(deepAll(element, '[data-calibration]')).toEqual([]);
    });

    it('happyPath_aVersionItNeverSawShowsNoBlock', async () => {
        const { element } = await page(versionView({ entityId: null }));

        expect(deepAll(element, '[data-calibration]')).toEqual([]);
        expect(deepAll(element, '[data-waits]')).toEqual([]);
    });
});

describe('<hcm-imagery-page>: why a frame under the threshold waits', () => {
    beforeAll(async () => {
        await defineImagery();
        await JOIN_CARD_CHUNK.load();
    });
    afterEach(cleanup);

    function kind(checkpointKind: 'held-out' | 'leave-one-out'): VersionViewPort['georef'] {
        const georef = versionView().georef;
        return georef === null ? null : { ...georef, checkpointKind };
    }

    it('badPath_itCoversPartOfTheCity', async () => {
        const { element } = await page(versionView({ output: output(62) }));

        expect(deep(element, '[data-waits="coverage"]').textContent.trim()).toBe('Covers under 90 % of the city: add a frame or approve');
    });

    it('badPath_itWasCheckedOnlyOnItsOwnPoints', async () => {
        const { element } = await page(versionView({ georef: kind('leave-one-out'), output: output(96) }));

        expect(deep(element, '[data-waits="not-proved"]').textContent.trim()).toBe('Check the fit on the map before approving');
        expect(deepAll(element, '[data-waits="coverage"]')).toEqual([]);
    });

    it.each([
        ['nothing proved it', { how: 'none', refusal: 'gross' }, 'not-proved', 'Check the fit on the map before approving'],
        ['the matcher fitted it', { how: 'matcher' }, 'not-proved', 'Check the fit on the map before approving'],
        [
            'a check went as gross',
            { how: 'votes', checksDropped: 2, measuredPct: 85 },
            'not-proved',
            'Check the fit on the map before approving',
        ],
        ['its tiles span too little', { how: 'votes', measuredPct: 53 }, 'not-proved', 'Check the fit on the map before approving'],
    ] as const)('badPath_%s', async (_case, calibration, name, text) => {
        const { element } = await page(versionView({ georef: kind('held-out'), output: output(96), calibration }));

        expect(deep(element, `[data-waits="${name}"]`).textContent.trim()).toBe(text);
    });

    it('happyPath_aWholeCityOnChecksHeldOutHasNothingToSay_andAnUploadIsNoFrame', async () => {
        const whole = await page(
            versionView({ georef: kind('held-out'), output: output(90), calibration: { how: 'votes', measuredPct: 85 } }),
        );
        const upload = await page(versionView({ entityId: null, georef: kind('held-out'), output: output(10) }));

        expect(deepAll(whole.element, '[data-waits]')).toEqual([]);
        expect(deepAll(upload.element, '[data-waits]')).toEqual([]);
    });
});
