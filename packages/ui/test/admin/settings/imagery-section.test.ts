import type { CityDoc } from '@hcm/shared';
import { axeViolations } from '@hcm/test-support/axe';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { userEvent } from 'vitest/browser';

import type { SettingsIntentsPort, SettingsViewState } from '../../../src/admin/settings/settings-port.js';
import { FakeArea } from '../editing/fake-area.js';
import { cityDoc, draftOf, page, settingsState } from '../layers/fixtures.js';
import { cleanup, deep, deepAll, deepText, defineAll, updated } from '../shell/fake-app.js';

function area(state: SettingsViewState): FakeArea<SettingsViewState, SettingsIntentsPort> {
    return new FakeArea<SettingsViewState, SettingsIntentsPort>(state, { saveSection: Promise.resolve({ ok: true }) });
}

function calls(store: FakeArea<SettingsViewState, SettingsIntentsPort>): readonly string[] {
    return store.calls.filter((call) => !call.startsWith('open [') && !call.startsWith('attachMap'));
}

function imageryState(city: CityDoc = cityDoc(), more: Partial<SettingsViewState['citySection']> = {}): SettingsViewState {
    const base = settingsState();
    return { ...base, section: 'imagery', citySection: { ...base.citySection, section: 'imagery', draft: draftOf(city), ...more } };
}

const BUCHAREST = cityDoc({ imagery: { autoPublish: true, rmseThresholdM: 15, targetYears: [1966, 1980] } });

describe('<hcm-settings-page> imagery', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_publishThroughMapboxIsOffByDefaultAndItsSaveKeepsTheRest', async () => {
        const settings = area(imageryState(BUCHAREST));
        const { element } = await page('settings', settings, { params: ['imagery'] });
        const [, through] = deepAll(element, 'hcm-switch') as [HTMLElement, HTMLElement & { checked: boolean }];

        const off = through.checked;
        through.dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: true } }));

        expect(off).toBe(false);
        expect(calls(settings)).toEqual([
            'editCity {"imagery":{"autoPublish":true,"rmseThresholdM":15,"targetYears":[1966,1980],"publishThroughMapbox":true}}',
        ]);
        expect(deepText(element)).toContain('Mapbox charges nothing');
    });

    it('happyPath_autoPublishTheThresholdAndTheTargetYears', async () => {
        const settings = area(imageryState(BUCHAREST));
        const { element } = await page('settings', settings, { params: ['imagery'] });

        const threshold = deep(element, '#imagery-threshold') as HTMLInputElement;
        const shown = [threshold.value, deepAll(element, '.year-row span').map((year) => year.textContent)];
        deep(element, 'hcm-switch').dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: false } }));
        threshold.value = '9';
        threshold.dispatchEvent(new Event('input'));
        threshold.value = '';
        threshold.dispatchEvent(new Event('input'));
        deep(deepAll(element, '.year-row hcm-icon-button')[0] ?? element, 'button').click();
        await userEvent.type(deep(element, '#imagery-new-year'), '1977');
        deep(deep(element, '.actions hcm-button[icon="add"]'), 'button').click();

        expect(shown).toEqual(['15', ['1966', '1980']]);
        expect(calls(settings)).toEqual([
            'editCity {"imagery":{"autoPublish":false,"rmseThresholdM":15,"targetYears":[1966,1980]}}',
            'editCity {"imagery":{"autoPublish":true,"rmseThresholdM":9,"targetYears":[1966,1980]}}',
            'editCity {"imagery":{"autoPublish":true,"rmseThresholdM":null,"targetYears":[1966,1980]}}',
            'editCity {"imagery":{"autoPublish":true,"rmseThresholdM":15,"targetYears":[1980]}}',
            'editCity {"imagery":{"autoPublish":true,"rmseThresholdM":15,"targetYears":[1966,1977,1980]}}',
        ]);
        expect((deep(element, '#imagery-new-year') as HTMLInputElement).value).toBe('');
        expect(deepText(element)).toContain('15 m is about the width of a street.');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('happyPath_drawnMapsPublishThemselvesUnderSixtyMetresByDefaultAndBothChange', async () => {
        const settings = area(imageryState(cityDoc()));
        const { element } = await page('settings', settings, { params: ['imagery'] });
        const group = deep(element, '[data-maps]');
        const field = deep(group, '#imagery-map-threshold') as HTMLInputElement;
        const toggle = deep(group, 'hcm-switch') as HTMLElement & { checked: boolean };

        const shown = [field.value, toggle.checked];
        toggle.dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: false } }));
        field.value = '40';
        field.dispatchEvent(new Event('input'));

        expect(shown).toEqual(['60', true]);
        expect(calls(settings)).toEqual(['editCity {"imagery":{"mapAutoPublish":false}}', 'editCity {"imagery":{"mapThresholdMaxM":40}}']);
        expect(deepText(element)).toContain('No scale: never on its own.');
        expect(await axeViolations(element)).toEqual([]);
    });

    it('badPath_aMapCapOutsideItsRangeIsSaidAtItsField', async () => {
        const issues = [{ path: 'imagery.mapThresholdMaxM', code: 'validation.tooBig' as const }];
        const city = cityDoc({ imagery: { mapThresholdMaxM: 200 } });
        const settings = area(imageryState(city, { draft: draftOf(city, { issues }) }));
        const { element } = await page('settings', settings, { params: ['imagery'], locale: 'ro' });

        expect(deep(element, '#imagery-map-threshold').closest('.field')?.hasAttribute('data-invalid')).toBe(true);
        expect(deepText(element)).toContain('Între 15 și 200.');
    });

    it('badPath_aYearThatIsNoYearOrAlreadyListedIsRefusedAndAnInvalidThresholdIsSaid', async () => {
        const issues = [
            { path: 'imagery.rmseThresholdM', code: 'validation.tooSmall' as const },
            { path: 'imagery.targetYears', code: 'validation.duplicateId' as const },
        ];
        const settings = area(imageryState(BUCHAREST, { draft: draftOf(BUCHAREST, { issues }) }));
        const { element } = await page('settings', settings, { params: ['imagery'], locale: 'ro' });

        for (const typed of ['19', '1966']) {
            const field = deep(element, '#imagery-new-year') as HTMLInputElement;
            field.value = typed;
            deep(deep(element, '.actions hcm-button[icon="add"]'), 'button').click();
        }
        await updated(element);

        expect(calls(settings)).toEqual([]);
        expect(deepText(element)).toContain('Scrie un an între 1800 și 2099 care nu e încă în listă (cel mult 20 de ani).');
        expect(deep(element, '#imagery-threshold').closest('.field')?.hasAttribute('data-invalid')).toBe(true);
        expect(deep(element, '[role="alert"]').textContent).toContain('Anii doriți trebuie să fie ani diferiți');
    });

    it('badPath_aThresholdBeingTypedShowsEmptyAndAddWithoutItsFieldDoesNothing', async () => {
        const settings = area(imageryState(cityDoc({ imagery: { rmseThresholdM: Number.NaN } })));
        const { element } = await page('settings', settings, { params: ['imagery'] });
        const empty = (deep(element, '#imagery-threshold') as HTMLInputElement).value;
        deep(element, '#imagery-new-year').remove();
        deep(deep(element, '.actions hcm-button[icon="add"]'), 'button').click();

        expect(empty).toBe('');
        expect(calls(settings)).toEqual([]);
    });

    it('happyPath_aCityWithoutImagerySettingsShowsTheDefaultsAndNoYears', async () => {
        const settings = area(imageryState(cityDoc()));
        const { element } = await page('settings', settings, { params: ['imagery'] });

        expect((deep(element, '#imagery-threshold') as HTMLInputElement).value).toBe('15');
        expect((deep(element, 'hcm-switch') as HTMLElement & { checked: boolean }).checked).toBe(true);
        expect(deep(element, '[data-state="no-years"]').textContent).toContain('every year counts the same');
    });

    it('badPath_aRevokedAdminChangesNothingAndAListOfTwentyTakesNoMore', async () => {
        const full = cityDoc({ imagery: { targetYears: Array.from({ length: 20 }, (_, index) => 1960 + index) } });
        const settings = area(imageryState(full));
        const { element } = await page('settings', settings, { params: ['imagery'] });
        const field = deep(element, '#imagery-new-year') as HTMLInputElement;
        field.value = '1999';
        deep(deep(element, '.actions hcm-button[icon="add"]'), 'button').click();
        const revoked = await page('settings', area(imageryState(full)), { params: ['imagery'], revoked: true });

        expect(calls(settings)).toEqual([]);
        expect((deep(revoked.element, '#imagery-new-year') as HTMLInputElement).readOnly).toBe(true);
        expect((deep(revoked.element, '.actions hcm-button[icon="add"]') as HTMLElement & { disabled: boolean }).disabled).toBe(true);
    });

    it('badPath_theSectionBeforeTheCityIsReadShowsItsHeadAlone', async () => {
        const base = imageryState();
        const settings = area({ ...base, citySection: { ...base.citySection, draft: { ...base.citySection.draft, value: null } } });
        const { element } = await page('settings', settings, { params: ['imagery'] });

        expect(deep(element, '[data-detail-heading]').textContent).toBe('Historical imagery');
        expect(deepAll(element, '#imagery-threshold')).toHaveLength(0);
    });
});

// M25 (docs/research/M25-landsat.md §4): the tick's own Landsat imports.
describe('<hcm-settings-page> imagery: Landsat', () => {
    beforeAll(defineAll);
    afterEach(cleanup);

    it('happyPath_landsatImportsItselfFrom1984ToThisYearByDefaultAndAllThreeChange @S-A130-HAPPY-AUTO', async () => {
        const settings = area(imageryState(cityDoc()));
        const { element } = await page('settings', settings, { params: ['imagery'] });
        const group = deep(element, '[data-landsat]');
        const from = deep(group, '#imagery-landsatFrom') as HTMLInputElement;
        const to = deep(group, '#imagery-landsatTo') as HTMLInputElement;
        const toggle = deep(group, 'hcm-switch') as HTMLElement & { checked: boolean };

        const shown = [from.value, to.value, toggle.checked];
        toggle.dispatchEvent(new CustomEvent('hcm-change', { detail: { checked: false } }));
        from.value = '1986';
        from.dispatchEvent(new Event('input'));
        to.value = '1999';
        to.dispatchEvent(new Event('input'));

        to.value = '';
        to.dispatchEvent(new Event('input'));

        expect(shown).toEqual(['1984', '', true]);
        expect(calls(settings)).toEqual([
            'editCity {"imagery":{"landsatAuto":false}}',
            'editCity {"imagery":{"landsatFrom":1986}}',
            'editCity {"imagery":{"landsatTo":1999}}',
            'editCity {"imagery":{}}',
        ]);
        expect(deepText(group)).toContain('within the daily limit');
        expect(await axeViolations(group)).toEqual([]);
    });

    it('badPath_aLandsatYearTheCityRefusesIsSaidAtItsField @S-A130-BAD-AUTO-OFF', async () => {
        const issues = [{ path: 'imagery.landsatFrom', code: 'validation.tooSmall' as const }];
        const city = cityDoc({ imagery: { landsatAuto: false } });
        const settings = area(imageryState(city, { draft: draftOf(city, { issues }) }));
        const { element } = await page('settings', settings, { params: ['imagery'], locale: 'ro' });

        expect(deep(element, '#imagery-landsatFrom').closest('.field')?.hasAttribute('data-invalid')).toBe(true);
        expect((deep(deep(element, '[data-landsat]'), 'hcm-switch') as HTMLElement & { checked: boolean }).checked).toBe(false);
        expect(deepText(element)).toContain('Din anul');
    });
});
