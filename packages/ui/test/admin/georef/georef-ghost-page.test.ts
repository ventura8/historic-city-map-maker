// The pending pair on the georeferencer's page (2026-11-12): the ghost goes to the scan pane and the hint says where the dashed ring
// is (S-A16-HAPPY-GEOREF-GHOST); without one the hint is the plain one (S-A16-BAD-GEOREF-GHOST-NO-PAIRS); the sharper scan reaches
// the scan pane (S-A16-HAPPY-GEOREF-FULL-RES).
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { defineImagery, georefPage, georefState } from '../imagery/fixtures.js';
import { cleanup, deep, deepAll } from '../shell/fake-app.js';

type Viewer = HTMLElement & { ghost: unknown; detail: unknown };

/** The hint under the tools (the status line). */
function hint(element: HTMLElement): string {
    return deepAll(element, 'p[role="status"]')
        .map((node) => node.textContent.trim())
        .join(' | ');
}

describe('the ghost of a pending pair on the page', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_aPairBegunOnTheMapShowsItsGhostOnTheScanAndSaysSo @S-A16-HAPPY-GEOREF-GHOST', async () => {
        const detail = { file: new Blob(['tiles']), scale: 1 };
        const { element } = await georefPage(
            georefState({
                adding: true,
                half: { geo: { lat: 44.45, lng: 26.1 } },
                ghost: { pixel: { x: 900, y: 400 } },
                scanDetail: detail,
            }),
        );
        const viewer = deep(element, 'hcm-scan-viewer') as Viewer;

        expect([viewer.ghost, viewer.detail]).toEqual([{ x: 900, y: 400 }, detail]);
        expect(hint(element)).toContain('Click the same place on the scan; the dashed ring is where it is expected.');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aPairBegunOnTheScanSaysTheMapsRingInRomanian @S-A16-HAPPY-GEOREF-GHOST', async () => {
        const { element } = await georefPage(
            georefState({ adding: true, half: { pixel: { x: 10, y: 10 } }, ghost: { geo: { lat: 44.45, lng: 26.1 } } }),
            { locale: 'ro' },
        );

        expect((deep(element, 'hcm-scan-viewer') as Viewer).ghost).toBeNull();
        expect(hint(element)).toContain('Fă clic pe același loc pe hartă; cercul punctat arată unde e așteptat.');
    });

    it('badPath_withoutAGhostTheHintIsThePlainOne @S-A16-BAD-GEOREF-GHOST-NO-PAIRS', async () => {
        const { element } = await georefPage(georefState({ adding: true, half: { pixel: { x: 10, y: 10 } }, ghost: null }));

        expect(hint(element)).toContain('Now click the same place on the map. Esc cancels.');
        expect(hint(element)).not.toContain('dashed ring');
    });
});
