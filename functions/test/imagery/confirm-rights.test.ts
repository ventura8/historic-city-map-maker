/**
 * M20 (`docs/research/M20-import-local.md` §7; S-A120-*-CONFIRM-*): `imagery.confirmRights` clears a version whose rights
 * wait, so Approve is never stranded on `needs-confirmation`. Empty words and a wrong state are refused.
 */
import type { LayerVersionDoc, Rights } from '@hcm/shared';
import { describe, expect, it } from 'vitest';

import { confirmRightsFunction } from '../../src/imagery/confirm-rights.js';
import { failureOf } from '../admin/world.js';
import { adminCall } from '../publish/fakes.js';
import { CLEAR, UNCONFIRMED, archiveJob, archiveVersion } from './archive-world.js';
import { CITY, NOW, at, readVersion, readyWorld, seedJob, seedVersion } from './world.js';

const SERIES = 'ar-1';
const BY = 'Idei Urbane – DocuBucurești';

async function confirm(version: LayerVersionDoc, confirmedBy: string) {
    const world = await readyWorld();
    await seedVersion(world, SERIES, version);
    await seedJob(world, SERIES, archiveJob());
    const call = confirmRightsFunction(() => world.deps).run(adminCall({ cityId: CITY, versionId: SERIES, confirmedBy }));
    return { world, call };
}

describe('imagery.confirmRights', () => {
    it('happyPath_needsConfirmationBecomesClearWithPermission @S-A120-HAPPY-CONFIRM-RIGHTS', async () => {
        const { world, call } = await confirm(archiveVersion({ rights: UNCONFIRMED }), BY);

        await expect(call).resolves.toEqual({ state: 'clear', confirmedAt: NOW });
        expect(await readVersion(world, SERIES)).toMatchObject({
            rights: {
                state: 'clear',
                licence: 'permission',
                confirmedBy: BY,
                note: UNCONFIRMED.note,
                year: UNCONFIRMED.year,
            } satisfies Partial<Rights>,
            updatedBy: 'u-admin',
        });
        expect((await readVersion(world, SERIES))?.rights?.confirmedAt).toEqual(at(NOW));
    });

    it('badPath_emptyConfirmedByRefuses @S-A120-BAD-CONFIRM-EMPTY', async () => {
        const { world, call } = await confirm(archiveVersion({ rights: UNCONFIRMED }), '   ');

        await expect(failureOf(call)).resolves.toMatchObject({
            details: { code: 'apiError.imagery.rightsUnconfirmed' },
        });
        expect((await readVersion(world, SERIES))?.rights).toEqual(UNCONFIRMED);
    });

    it('badPath_aMissingVersionIsNotFound @S-A120-BAD-CONFIRM-STATE', async () => {
        const world = await readyWorld();
        const call = confirmRightsFunction(() => world.deps).run(adminCall({ cityId: CITY, versionId: SERIES, confirmedBy: BY }));

        await expect(failureOf(call)).resolves.toMatchObject({ details: { code: 'apiError.notFound' } });
    });

    it.each<[string, LayerVersionDoc]>([
        ['already clear', archiveVersion({ rights: CLEAR })],
        ['do not publish', archiveVersion({ rights: { ...UNCONFIRMED, state: 'do-not-publish' } })],
        ['no rights', archiveVersion({ rights: undefined })],
        ['rejected', archiveVersion({ state: 'rejected', rights: UNCONFIRMED })],
    ])('badPath_%sRefuses @S-A120-BAD-CONFIRM-STATE', async (_name, version) => {
        const { world, call } = await confirm(version, BY);
        const code = version.state === 'awaiting_approval' ? 'apiError.imagery.rightsUnconfirmed' : 'apiError.imagery.versionState';

        await expect(failureOf(call)).resolves.toMatchObject({ details: { code } });
        expect((await readVersion(world, SERIES))?.rights).toEqual(version.rights);
    });
});
