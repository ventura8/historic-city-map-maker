/**
 * `<hcm-archive-join>` (finding of 2026-11-14, the owner's harti.zip maps): **Join with…** on an archive map's page, its buttons
 * for the year's other maps, the join started and linked, and nothing for a map the join cannot take.
 */
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { defineHcmButton } from '../../../src/components/button.js';
import { defineOnce } from '../../../src/components/internal.js';
import type { ArchiveJoinCandidatePort, ImageryIntentsPort, VersionViewPort } from '../../../src/admin/imagery/imagery-port.js';
import { HCM_ARCHIVE_JOIN_TAG, HcmArchiveJoin, archiveJoinOffered } from '../../../src/admin/imagery/join/hcm-archive-join.js';
import { cleanup, deep, deepAll, deepText, updated } from '../shell/fake-app.js';
import { click, versionView } from './fixtures.js';

const SOUTH: ArchiveJoinCandidatePort = { id: 'rg-south', layerId: 's', label: { ro: 'S' }, year: 1978, state: 'published' };

const NORTH = versionView({
    id: 'ar-north',
    layerId: 'n',
    year: 1978,
    origin: 'archive',
    state: 'published',
    archiveMap: true,
    partOf: null,
});

interface Asked {
    readonly candidates: string[];
    readonly joins: (readonly string[])[];
    readonly targets: (string | undefined)[];
}

function intents(asked: Asked, found: readonly ArchiveJoinCandidatePort[], joined: string | null): ImageryIntentsPort {
    const own: Pick<ImageryIntentsPort, 'archiveJoinCandidates' | 'joinArchive'> = {
        archiveJoinCandidates: (version) => {
            asked.candidates.push(version.id);
            return Promise.resolve(found);
        },
        joinArchive: (versionIds, targetLayerId) => {
            asked.joins.push(versionIds);
            asked.targets.push(targetLayerId);
            return Promise.resolve(joined);
        },
    };
    return own as ImageryIntentsPort;
}

async function mount(version: VersionViewPort, found: readonly ArchiveJoinCandidatePort[], joined: string | null = 'jn-n') {
    const asked: Asked = { candidates: [], joins: [], targets: [] };
    const element = document.createElement(HCM_ARCHIVE_JOIN_TAG);
    element.locale = 'en';
    element.intents = intents(asked, found, joined);
    element.version = version;
    element.hrefOf = (params) => `#/imagery/${params.join('/')}`;
    document.body.append(element);
    await updated(element);
    await updated(element);
    return { element, asked };
}

beforeAll(() => {
    defineHcmButton();
    defineOnce(customElements, HCM_ARCHIVE_JOIN_TAG, HcmArchiveJoin);
});

afterEach(cleanup);

describe('<hcm-archive-join>', () => {
    it('happyPath_theYearsOtherMapIsOfferedAndOneClickStartsTheJoinWhichIsLinked @S-A65-HAPPY-ARCHIVE-OFFER', async () => {
        const { element, asked } = await mount(NORTH, [SOUTH]);

        expect(asked.candidates).toEqual(['ar-north']);
        expect(deepText(element)).toContain('Join with S');
        click(deep(element, '[data-join-with="rg-south"]'));
        await updated(element);

        expect(asked.joins).toEqual([['ar-north', 'rg-south']]);
        expect(deep(element, '[data-state="archive-join-started"] a').getAttribute('href')).toBe('#/imagery/version/jn-n');
    });

    it('badPath_aRefusedJoinKeepsTheButtons', async () => {
        const { element } = await mount(NORTH, [SOUTH], null);

        click(deep(element, '[data-join-with="rg-south"]'));
        await updated(element);

        expect(deepAll(element, '[data-state="archive-join-started"]')).toEqual([]);
        expect(deepAll(element, '[data-join-with]')).toHaveLength(1);
    });

    it('happyPath_aMapAFailedJoinStampedIsOfferedAgain @S-A65-HAPPY-ARCHIVE-OFFER', () => {
        expect(archiveJoinOffered({ ...NORTH, partOf: 'jn-old' }, false)).toBe(true);
        expect(archiveJoinOffered({ ...NORTH, partOf: 'jn-old' }, true)).toBe(false);
    });

    it.each([
        ['a USGS frame', versionView({ archiveMap: false })],
        ['a map with no points', { ...NORTH, georef: null }],
        ['a map a join holds', { ...NORTH, partOf: 'jn-other' }],
        ['a map waiting for points', { ...NORTH, state: 'needs_gcps' as const }],
    ])('badPath_%sIsOfferedNothing @S-A65-BAD-ARCHIVE-OFFER', async (_name, version) => {
        const { element, asked } = await mount(version, [SOUTH]);

        expect(archiveJoinOffered(version)).toBe(false);
        expect(asked.candidates).toEqual([]);
        expect(deepAll(element, '[data-archive-join]')).toEqual([]);
    });

    it('happyPath_aPublishedJoinAddsASheetWithAllItsParts @S-A65-HAPPY-ARCHIVE-ADD-SHEETS', async () => {
        const parts = [
            { versionId: 'ar-north', layerId: 'n', entityId: 'ar-north' },
            { versionId: 'rg-west', layerId: 'w', entityId: 'rg-west' },
        ];
        const joined = versionView({ id: 'jn-n', layerId: 'n', year: 1978, origin: 'join', state: 'published', parts, partOf: null });
        const { element, asked } = await mount(joined, [SOUTH]);

        expect(deepText(element)).toContain('Add sheets to this join');
        expect(deepText(element)).toContain('Add S');
        click(deep(element, '[data-join-with="rg-south"]'));
        await updated(element);

        expect(asked.joins).toEqual([['ar-north', 'rg-west', 'rg-south']]);
    });

    it('happyPath_aPublishedJoinsSheetsAreReplacedByTheTickedOnesOnItsLayer @S-A65-HAPPY-JOIN-TARGET', async () => {
        const parts = [
            { versionId: 'ar-north', layerId: 'n', entityId: 'ar-north' },
            { versionId: 'rg-west', layerId: 'w', entityId: 'rg-west' },
        ];
        const east: ArchiveJoinCandidatePort = { id: 'rg-east', layerId: 'e', label: { ro: 'E' }, year: 1978, state: 'awaiting_approval' };
        const joined = versionView({ id: 'jn-n', layerId: 'n', year: 1978, origin: 'join', state: 'published', parts, partOf: null });
        const { element, asked } = await mount(joined, [SOUTH, east]);
        const run = () => deep(element, '[data-replace-run]') as HTMLElement & { disabled: boolean };

        expect(deepText(element)).toContain('Replace the sheets of this join');
        for (const id of ['rg-south', 'rg-east', 'rg-east']) {
            const box = deep(element, `[data-replace-with="${id}"]`) as HTMLInputElement;
            box.checked = !box.checked;
            box.dispatchEvent(new Event('change'));
            await updated(element);
        }
        expect(run().disabled).toBe(true);
        const east2 = deep(element, '[data-replace-with="rg-east"]') as HTMLInputElement;
        east2.checked = true;
        east2.dispatchEvent(new Event('change'));
        await updated(element);
        click(run());
        await updated(element);

        expect(asked.joins).toEqual([['rg-south', 'rg-east']]);
        expect(asked.targets).toEqual(['n']);
        expect(deep(element, '[data-state="archive-join-started"]')).not.toBeNull();
    });

    it('badPath_aRefusedReplacementKeepsTheChoice @S-A65-BAD-JOIN-TARGET', async () => {
        const parts = [
            { versionId: 'ar-north', layerId: 'n', entityId: 'ar-north' },
            { versionId: 'rg-west', layerId: 'w', entityId: 'rg-west' },
        ];
        const east: ArchiveJoinCandidatePort = { id: 'rg-east', layerId: 'e', label: { ro: 'E' }, year: 1978, state: 'published' };
        const joined = versionView({ id: 'jn-n', layerId: 'n', year: 1978, origin: 'join', state: 'published', parts, partOf: null });
        const { element, asked } = await mount(joined, [SOUTH, east], null);
        for (const id of ['rg-south', 'rg-east']) {
            const box = deep(element, `[data-replace-with="${id}"]`) as HTMLInputElement;
            box.checked = true;
            box.dispatchEvent(new Event('change'));
            await updated(element);
        }
        click(deep(element, '[data-replace-run]'));
        await updated(element);
        await updated(element);

        expect(asked.targets).toEqual(['n']);
        expect(deep(element, '[data-replace-run]')).not.toBeNull();
    });

    it('badPath_aJoinOfCameraFramesOrNotPublishedIsOfferedNoSheets @S-A65-BAD-ARCHIVE-ADD-SHEETS', () => {
        const frames = [{ versionId: 'v1', layerId: 'a', entityId: 'DS1' }];
        expect(archiveJoinOffered(versionView({ origin: 'join', state: 'published', parts: frames, archiveMap: false }))).toBe(false);
        const parts = [{ versionId: 'v1', layerId: 'a', entityId: 'v1' }];
        expect(archiveJoinOffered(versionView({ origin: 'join', state: 'awaiting_approval', parts, archiveMap: false }))).toBe(false);
    });

    it('happyPath_aJoinRunsAgainWithItsSameParts @S-A65-HAPPY-ARCHIVE-JOIN-AGAIN', async () => {
        const parts = [
            { versionId: 'ar-north', layerId: 'n', entityId: 'ar-north' },
            { versionId: 'rg-west', layerId: 'w', entityId: 'rg-west' },
        ];
        const joined = versionView({ id: 'jn-n', layerId: 'n', year: 1978, origin: 'join', state: 'published', parts, partOf: null });
        const { element, asked } = await mount(joined, []);

        expect(deepText(element)).toContain('Join again');
        click(deep(element, '[data-join-again]'));
        await updated(element);

        expect(asked.joins).toEqual([['ar-north', 'rg-west']]);
        expect(deep(element, '[data-state="archive-join-started"] a').getAttribute('href')).toBe('#/imagery/version/jn-n');
    });

    it('badPath_aJoinOnItsWayIsNotRunAgain @S-A65-BAD-ARCHIVE-JOIN-AGAIN', async () => {
        const parts = [{ versionId: 'ar-north', layerId: 'n', entityId: 'ar-north' }];
        const { element } = await mount(versionView({ origin: 'join', state: 'awaiting_approval', parts, archiveMap: false }), []);

        expect(deepAll(element, '[data-join-again]')).toEqual([]);
    });

    it('badPath_withNoOtherMapOfItsYearNothingShows', async () => {
        const { element } = await mount(NORTH, []);

        expect(deepAll(element, '[data-archive-join]')).toEqual([]);
    });
});
