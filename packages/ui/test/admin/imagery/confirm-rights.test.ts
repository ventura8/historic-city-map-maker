/**
 * M20 (`docs/research/M20-import-local.md` §7): the approval card asks the city's owner to Confirm the rights before
 * Approve can publish a version whose rights wait (`needs-confirmation`).
 */
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { cleanup, deep, deepAll, updated } from '../shell/fake-app.js';
import { button, click, defineImagery, imageryPage, imageryState, versionPage, versionView } from './fixtures.js';

const VERSION = { kind: 'version' as const, id: 'job-1966' };

const WAITING = {
    state: 'needs-confirmation' as const,
    licence: 'unknown' as const,
    year: '1977',
    note: 'Confirm where it came from.',
    confirmedBy: null,
    allowPublish: false,
};

function waitingRights() {
    return imageryState({
        detail: VERSION,
        version: versionPage({}, versionView({ origin: 'archive', rights: WAITING, georef: null })),
    });
}

describe('<hcm-imagery-page>: confirm rights before Approve', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_theOwnerConfirmsAndApproveStaysOffUntilThen @S-A120-HAPPY-CONFIRM-RIGHTS', async () => {
        const { element, area } = await imageryPage(waitingRights(), { params: ['version', VERSION.id] });

        expect(deep(element, '[data-rights="needs-confirmation"]').textContent).toContain('Confirm the source');
        expect(deep(element, '[data-rights-note]').textContent).toBe('Confirm where it came from.');
        const approve = button(element, 'Approve and publish') as HTMLElement & { disabled: boolean };
        expect(approve.disabled).toBe(true);

        (deep(element, '#rights-by-job-1966') as HTMLInputElement).value = 'Idei Urbane – DocuBucurești';
        click(deep(element, '[data-confirm-rights]'));
        await updated(element);

        expect(area.calls).toContain('confirmRights "Idei Urbane – DocuBucurești"');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_anEditorSeesNoConfirmAndApproveStaysOff @S-A120-BAD-CONFIRM-STATE', async () => {
        const editor = { cities: [{ id: 'bucharest', role: 'editor' as const, name: { ro: 'București', en: 'Bucharest' } }] };
        const { element } = await imageryPage(waitingRights(), { params: ['version', VERSION.id], state: editor });

        expect(deep(element, '[data-rights="owner"]').textContent).toContain("Only the city's owner");
        expect(deepAll(element, '[data-confirm-rights]')).toEqual([]);
        expect((button(element, 'Approve and publish') as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    });

    it('happyPath_clearedRightsEnableApprove', async () => {
        const cleared = {
            state: 'clear' as const,
            licence: 'permission' as const,
            year: '1977',
            note: null,
            confirmedBy: 'Idei Urbane',
            allowPublish: true,
        };
        const { element } = await imageryPage(
            imageryState({
                detail: VERSION,
                version: versionPage({}, versionView({ origin: 'archive', rights: cleared, georef: null })),
            }),
            { params: ['version', VERSION.id] },
        );

        expect(deepAll(element, '[data-rights="needs-confirmation"]')).toEqual([]);
        expect((button(element, 'Approve and publish') as HTMLElement & { disabled: boolean }).disabled).toBe(false);
    });
});
