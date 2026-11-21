// Link the views on the georeferencer's page (S-A16-HAPPY-GEOREF-LINKED, S-A16-BAD-GEOREF-LINKED-NO-FIT): on and pressed once a fit
// exists, the scan pane's moves go to the store and the linked map's place to the pane; without a fit it is off and says when it
// will work.
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { button, click, defineImagery, georefPage, georefState, georefVersion } from '../imagery/fixtures.js';
import { cleanup, deep, deepAll, updated } from '../shell/fake-app.js';

/** The toggle's own button (where `aria-pressed` and `disabled` are). */
function inner(element: HTMLElement): HTMLButtonElement {
    return deep(button(element, 'Link the views'), 'button') as HTMLButtonElement;
}

describe('Link the views', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_onWithAFitPassingTheScansMovesAndTheMapsPlace @S-A16-HAPPY-GEOREF-LINKED', async () => {
        const follow = { centre: { x: 500, y: 300 }, scale: 0.5 };
        const { element, area } = await georefPage(georefState({ scanFollow: follow }));
        const viewer = deep(element, 'hcm-scan-viewer') as HTMLElement & { follow: unknown };

        expect([inner(element).getAttribute('aria-pressed'), inner(element).disabled]).toEqual(['true', false]);
        expect(deepAll(element, '[data-state="link-no-fit"]')).toHaveLength(0);
        expect(viewer.follow).toEqual(follow);
        viewer.dispatchEvent(new CustomEvent('hcm-view', { detail: { centre: { x: 10, y: 20 }, scale: 2 } }));
        click(button(element, 'Link the views'));

        expect(area.calls.filter((call) => /^(scanMoved|setLinked)/.test(call))).toEqual([
            'scanMoved {"centre":{"x":10,"y":20},"scale":2}',
            'setLinked false',
        ]);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_offStaysOffAndAReadOnlyVersionLinksToo @S-A16-HAPPY-GEOREF-LINKED', async () => {
        const { element, area } = await georefPage(georefState({ linked: false, version: georefVersion({ editable: false }) }));

        expect([inner(element).getAttribute('aria-pressed'), inner(element).disabled]).toEqual(['false', false]);
        click(button(element, 'Link the views'));
        expect(area.calls.filter((call) => call.startsWith('setLinked'))).toEqual(['setLinked true']);
    });

    it('badPath_withoutAFitItIsOffAndSaysWhenItWillWork @S-A16-BAD-GEOREF-LINKED-NO-FIT', async () => {
        const state = georefState();
        const { element, area } = await georefPage(georefState({ fit: { ...state.fit, refusal: 'too-few' } }));
        await updated(element);

        expect([inner(element).getAttribute('aria-pressed'), inner(element).disabled]).toEqual(['false', true]);
        expect(deep(element, '[data-state="link-no-fit"]').textContent).toBe(
            'The views link once the pairs give a fit: moving one then moves the other to the same place.',
        );
        click(button(element, 'Link the views'));
        expect(area.calls.filter((call) => call.startsWith('setLinked'))).toEqual([]);
        expect(await axeViolations(element)).toEqual([]);
    });
});
