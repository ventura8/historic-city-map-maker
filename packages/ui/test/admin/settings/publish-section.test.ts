import type { CityDoc } from '@hcm/shared';
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import type { SettingsIntentsPort, SettingsViewState } from '../../../src/admin/settings/settings-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { cityDoc, draftOf, page, settingsState } from '../layers/fixtures.js';
import { cleanup, deep, deepAll, defineAll } from '../shell/fake-app.js';

function area(state: SettingsViewState): FakeArea<SettingsViewState, SettingsIntentsPort> {
    return new FakeArea<SettingsViewState, SettingsIntentsPort>(state, { saveSection: Promise.resolve({ ok: true }) });
}

function calls(store: FakeArea<SettingsViewState, SettingsIntentsPort>): readonly string[] {
    return store.calls.filter((call) => !call.startsWith('open [') && !call.startsWith('attachMap'));
}

function publishState(city: CityDoc | null): SettingsViewState {
    const base = settingsState();
    const draft = city === null ? { ...draftOf(cityDoc()), value: null } : draftOf(city);
    return { ...base, section: 'publish', citySection: { ...base.citySection, section: 'publish', draft } };
}

function switchOf(element: HTMLElement): HTMLElement & { checked: boolean; disabled: boolean } {
    return deep(element, 'hcm-switch') as HTMLElement & { checked: boolean; disabled: boolean };
}

describe('<hcm-settings-page> publishing', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_aNewCityIsSwitchedOnForItsSave', async () => {
        const settings = area(publishState(cityDoc({ published: false })));
        const { element } = await page('settings', settings, { params: ['publish'] });

        const shown = [switchOf(element).checked, deep(element, '[data-published]').textContent.trim()];
        switchOf(element).dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: true } }));

        expect(shown).toEqual([false, 'The city is not public yet. Switched on and saved, its public map appears within about a minute.']);
        // M6 (CR-M6-17): the city's public map is on the admin's own Hosting site; no developer step is named any more.
        expect(deep(element, '[data-publish-site]').textContent).not.toContain('site:add');
        expect(deep(element, 'a[data-public-address]').getAttribute('href')).toBe(new URL('/bucharest/', document.baseURI).href);
        expect(calls(settings)).toEqual(['editCity {"published":true}']);
        expect(deep(element, '[data-detail-heading]').textContent).toBe('Publishing');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_aPublicCityIsSaidSoInRomanianAndCanBeTakenDown', async () => {
        const settings = area(publishState(cityDoc({ published: true })));
        const { element } = await page('settings', settings, { params: ['publish'], locale: 'ro' });

        switchOf(element).dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: false } }));

        expect(switchOf(element).checked).toBe(true);
        expect(deep(element, '[data-published="true"]').textContent).toContain('Vizitatorii văd harta orașului.');
        expect(calls(settings)).toEqual(['editCity {"published":false}']);
    });

    it('badPath_aRevokedAdminCannotSwitchItAndTheSectionBeforeTheCityIsReadShowsItsHeadAlone', async () => {
        const revoked = await page('settings', area(publishState(cityDoc({ published: false }))), {
            params: ['publish'],
            revoked: true,
        });
        const unread = await page('settings', area(publishState(null)), { params: ['publish'] });

        expect(switchOf(revoked.element).disabled).toBe(true);
        expect(deep(unread.element, '[data-detail-heading]').textContent).toBe('Publishing');
        expect(deepAll(unread.element, 'hcm-switch')).toHaveLength(0);
    });
});
