// Removing the selected pair from beside the panes and from the map's keyboard (S-A16-HAPPY-GEOREF-REMOVE-UNDO); with no pair
// selected, or on a version that takes no points, nothing is removed (S-A16-BAD-GEOREF-REMOVE-NOTHING).
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { defineImagery, georefPage, georefState, georefVersion } from '../imagery/fixtures.js';
import { cleanup, deep, deepAll } from '../shell/fake-app.js';

const BUTTON = '[data-action="delete-selected"]';

describe('removing the selected pair on the page', () => {
    beforeAll(defineImagery);
    afterEach(cleanup);

    it('happyPath_theSelectedPairHasADeleteButtonBesideThePanesAndDeleteOnTheMapRemovesIt @S-A16-HAPPY-GEOREF-REMOVE-UNDO', async () => {
        const { element, area } = await georefPage(georefState({ selected: 'g2' }));
        const button = deep(element, BUTTON);

        expect(button.textContent.trim()).toBe('Delete pair 2');
        button.click();
        deep(element, 'hcm-admin-map').dispatchEvent(new CustomEvent('hcm-map-delete', { detail: {} }));

        expect(area.calls.filter((call) => call.startsWith('remove'))).toEqual(['remove "g2"', 'remove "g2"']);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_theButtonIsNamedInRomanian @S-A16-HAPPY-GEOREF-REMOVE-UNDO', async () => {
        const { element } = await georefPage(georefState({ selected: 'g3' }), { locale: 'ro' });

        expect(deep(element, BUTTON).textContent.trim()).toBe('Șterge perechea 3');
    });

    it('badPath_withNoPairSelectedOrAVersionThatTakesNoPointsNothingIsRemoved @S-A16-BAD-GEOREF-REMOVE-NOTHING', async () => {
        const none = await georefPage(georefState({ selected: null }));
        expect(deepAll(none.element, BUTTON)).toEqual([]);
        deep(none.element, 'hcm-admin-map').dispatchEvent(new CustomEvent('hcm-map-delete', { detail: {} }));
        expect(none.area.calls.filter((call) => call.startsWith('remove'))).toEqual([]);
        cleanup();

        const version = { ...georefVersion(), editable: false };
        const locked = await georefPage(georefState({ selected: 'g2', version }));
        expect(deep(locked.element, BUTTON).hasAttribute('disabled')).toBe(true);
        deep(locked.element, 'hcm-admin-map').dispatchEvent(new CustomEvent('hcm-map-delete', { detail: {} }));
        expect(locked.area.calls.filter((call) => call.startsWith('remove'))).toEqual([]);
    });
});
