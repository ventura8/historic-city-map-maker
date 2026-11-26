/**
 * Batch 4 (`docs/research/M20-import-local.md` §5.1): a grid series placed from its sheets' names without a proof shows its seams and its
 * checks against OpenStreetMap on the approval card, and only the city's owner sees **Approve the sheet-name placement**.
 */
import type { ArchiveReport } from '@hcm/shared';
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { cleanup, deep, deepAll, updated } from '../shell/fake-app.js';
import { button, click, defineImagery, imageryPage, imageryState, versionPage, versionView } from './fixtures.js';

const VERSION = { kind: 'version' as const, id: 'job-1966' };

const BY_NAMES: ArchiveReport = {
    method: 'grid-names',
    encoding: 'lineart',
    paperTransparent: true,
    scaleDenominator: 2000,
    checkpointRmseM: 22.4,
    checkpointCount: 9,
    checksDropped: 1,
    measuredPct: 40,
    rivalClean: false,
    seamScore: 0.81,
};

function placedByNames() {
    return imageryState({ detail: VERSION, version: versionPage({}, versionView({ georef: null, archive: BY_NAMES, origin: 'archive' })) });
}

describe('<hcm-imagery-page>: a placement from sheet names', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_theOwnerSeesTheSeamsAndApprovesTheSheetNamePlacement @S-A120-HAPPY-GRID-NAMES', async () => {
        const { element, area } = await imageryPage(placedByNames(), { params: ['version', VERSION.id] });

        const note = deep(element, '[data-state="grid-names"]').textContent;
        expect(note).toContain('0.81');
        expect(note).toContain('9 checks');
        expect(deep(element, '[data-rmse="over"]').textContent).toContain('22.4 m');
        click(button(element, 'Approve the sheet-name placement'));
        await updated(element);

        expect(area.calls).toContain('approve');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_anEditorIsToldTheOwnerApproves_noApproveButton @S-A120-BAD-GRID-NAMES-EDITOR', async () => {
        const editor = { cities: [{ id: 'bucharest', role: 'editor' as const, name: { ro: 'București', en: 'Bucharest' } }] };
        const { element } = await imageryPage(placedByNames(), { params: ['version', VERSION.id], state: editor });

        expect(deep(element, '[data-state="grid-names-owner"]').textContent).toContain("Only the city's owner");
        const labels = deepAll(element, 'hcm-button').map((target) => target.textContent.trim());
        expect(labels).not.toContain('Approve the sheet-name placement');
        expect(labels).not.toContain('Approve and publish');
    });

    it('badPath_aProvedSeriesHasNoNamesNote', async () => {
        const proved = versionView({ georef: null, archive: { ...BY_NAMES, method: 'grid' }, origin: 'archive' });
        const { element } = await imageryPage(imageryState({ detail: VERSION, version: versionPage({}, proved) }), {
            params: ['version', VERSION.id],
        });

        expect(deepAll(element, '[data-state="grid-names"]')).toEqual([]);
        button(element, 'Approve and publish');
    });
});
