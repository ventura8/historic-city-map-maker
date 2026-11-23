/**
 * The city roles' helpers and role field of the admins page (M5, `docs/research/M5-interfaces.md` §1.7; behaviour A51):
 * the current city's name in each language (its id until the session named it), whether the signed-in admin owns it,
 * the role text, the row detail, and the native `<select>` role field.
 */
import { render } from 'lit';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
    currentCityName,
    ownsCurrentCity,
    roleField,
    roleText,
    rowDetail,
    type RoleFieldContext,
} from '../../../src/admin/admins/roles.js';
import { adminState } from '../shell/fake-app.js';

const hosts: HTMLElement[] = [];

afterEach(() => {
    for (const host of hosts.splice(0)) {
        host.remove();
    }
});

/** Renders `roleField(context)` into a fresh host and returns its `<label>` and `<select>`. */
function renderRoleField(context: RoleFieldContext): { label: HTMLLabelElement; select: HTMLSelectElement } {
    const host = document.body.appendChild(document.createElement('div'));
    hosts.push(host);
    render(roleField(context), host);
    const label = host.querySelector('label');
    const select = host.querySelector('select');
    if (label === null || select === null) {
        throw new Error('the role field was not rendered');
    }
    return { label, select };
}

describe('the city roles', () => {
    it('happyPath_theCitysNameInEachLanguageAndItsOwner', () => {
        const cluj = adminState({ cities: [{ id: 'cluj', role: 'owner', name: { ro: 'Cluj-Napoca' } }], cityId: 'cluj' });

        expect([currentCityName(adminState(), 'en'), currentCityName(adminState(), 'ro'), currentCityName(cluj, 'en')]).toEqual([
            'Bucharest',
            'București',
            'Cluj-Napoca',
        ]);
        expect(ownsCurrentCity(cluj)).toBe(true);
        expect(roleText('en', 'uploader')).toBeTruthy();
        expect(rowDetail('en', { role: 'owner', projectOwner: true, self: true })).toBe('Owner · The project’s owner · You');
    });

    it('badPath_aCityTheSessionDidNotNameShowsItsIdAndNoStateNothing', () => {
        const unnamed = adminState({ cities: [], cityId: 'bacau' });
        const withoutCities = { ...adminState({ cityId: 'iasi' }) };
        delete withoutCities.cities;
        const editorCity = adminState({ cities: [{ id: 'cluj', role: 'editor', name: { ro: 'Cluj-Napoca' } }], cityId: 'cluj' });

        expect([
            currentCityName(unnamed, 'ro'),
            currentCityName(withoutCities, 'en'),
            currentCityName(null, 'en'),
            currentCityName(adminState({ cities: [], cityId: null }), 'en'),
        ]).toEqual(['bacau', 'iasi', '', '']);
        expect([ownsCurrentCity(unnamed), ownsCurrentCity(withoutCities), ownsCurrentCity(editorCity), ownsCurrentCity(null)]).toEqual([
            false,
            false,
            false,
            false,
        ]);
        expect(rowDetail('ro', { role: 'editor', projectOwner: false, self: false })).toBe('Editor');
    });

    it('happyPath_roleFieldRendersAllRolesAndReportsChanges', () => {
        const onChange = vi.fn();
        const { label, select } = renderRoleField({
            locale: 'en',
            id: 'admin-role',
            label: 'Role',
            value: 'moderator',
            disabled: false,
            change: onChange,
        });

        expect(label.htmlFor).toBe('admin-role');
        expect(label.textContent).toBe('Role');
        expect(select.id).toBe('admin-role');
        expect(select.disabled).toBe(false);
        expect(select.value).toBe('moderator');
        expect(Array.from(select.options, (option) => option.value)).toEqual(['uploader', 'moderator', 'editor', 'owner']);

        select.value = 'owner';
        select.dispatchEvent(new Event('change'));
        expect(onChange).toHaveBeenCalledWith('owner');
    });

    it('badPath_roleFieldHandlesDisabledStateAndOmittedChangeHandler', () => {
        const { select } = renderRoleField({
            locale: 'ro',
            id: 'invite-role',
            label: 'Rol',
            value: 'editor',
            disabled: true,
        });

        expect(select.disabled).toBe(true);
        expect(select.value).toBe('editor');

        select.value = 'uploader';
        expect(() => select.dispatchEvent(new Event('change'))).not.toThrow();
    });
});
