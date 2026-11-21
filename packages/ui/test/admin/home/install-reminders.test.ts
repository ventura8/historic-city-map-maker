/**
 * Home's installation tile (M6 installer, `docs/research/M6-interfaces.md` §1.7; A55–A57, `home.update-tile`): an update
 * of the map ready, or its last installation stopped, each with a link to the Setup step whose card acts on it.
 */
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { HomeIntentsPort, HomeViewState } from '../../../src/admin/home/home-port.js';
import { isBundledIcon } from '../../../src/icons.js';
import { FakeArea } from '../editing/fake-area.js';
import { homeState, page } from '../ops/fixtures.js';
import { cleanup, deepAll, deepText, defineAll } from '../shell/fake-app.js';

describe('<hcm-home-page> installation tile', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_anUpdateIsReadyWithTheLinkToItsStep', async () => {
        const home = new FakeArea<HomeViewState, HomeIntentsPort>(homeState({ reminders: [{ kind: 'installUpdate', step: 'deploy' }] }));
        const { element } = await page('home', home);

        expect(deepAll(element, 'li.reminder').map((tile) => tile.dataset['reminder'])).toEqual(['installUpdate']);
        expect(deepText(element)).toContain('An update of the map is ready to install.');
        const [link] = deepAll(element, 'li.reminder a.action');
        expect(link?.getAttribute('href')).toBe('#/setup/deploy');
        expect(link?.textContent).toContain('Open its step in Setup');
        // In the icon font's subset: an unbundled name draws nothing (the tile's icon was one).
        const [icon] = deepAll(element, 'li.reminder hcm-icon').map((shown) => shown.getAttribute('name'));
        expect(isBundledIcon(icon ?? '')).toBe(true);
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aStoppedInstallationSaysSoAndOpensItsStep', async () => {
        const home = new FakeArea<HomeViewState, HomeIntentsPort>(homeState({ reminders: [{ kind: 'installFailed', step: 'site' }] }));
        const { element } = await page('home', home);

        expect(deepText(element)).toContain('The last installation of the map stopped; its step in Setup says why.');
        expect(deepAll(element, 'li.reminder a.action').map((link) => link.getAttribute('href'))).toEqual(['#/setup/site']);
        expect(deepAll(element, 'li.reminder hcm-icon').map((icon) => icon.getAttribute('name'))).toEqual(['error']);
    });
});
