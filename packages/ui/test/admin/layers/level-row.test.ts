import { render } from 'lit';
import { describe, expect, it } from 'vitest';

import { levelOf, levelRow } from '../../../src/admin/layers/level-row.js';

describe('levelOf', () => {
    it('happyPath_anOrderAndANameMakeALevel @S-A201-HAPPY-LEVEL', () => {
        expect(levelOf(' 0,5 ', 'Mezanin', undefined)).toEqual({ order: 0.5, label: { ro: 'Mezanin' } });
        expect(levelOf('-1', 'Subsol', 'Basement')).toEqual({ order: -1, label: { ro: 'Subsol', en: 'Basement' } });
    });

    it.each([
        ['', 'Parter'],
        ['x', 'Parter'],
        ['0', '  '],
    ])('badPath_%j_and_%j_makeNoLevel @S-A201-BAD-LEVEL', (order, name) => {
        expect(levelOf(order, name, undefined)).toBeUndefined();
    });
});

describe('levelRow', () => {
    function rendered(level: Parameters<typeof levelRow>[0]['level'], changes: unknown[]): HTMLElement {
        const host = document.createElement('div');
        render(levelRow({ locale: 'en', level, readOnly: false, change: (next) => changes.push(next) }), host);
        return host;
    }

    function type(host: HTMLElement, id: string, value: string): void {
        const field = host.querySelector<HTMLInputElement>(`#${id}`);
        if (field === null) {
            throw new Error(`no ${id}`);
        }
        field.value = value;
        field.dispatchEvent(new Event('change'));
    }

    it('happyPath_theOrderAndTheNameWriteTheLevelWhenLeft_keepingItsEnglishName @S-A201-HAPPY-LEVEL', () => {
        const changes: unknown[] = [];
        const host = rendered({ order: 0, label: { ro: 'Parter', en: 'Ground floor' } }, changes);
        expect(host.querySelector<HTMLInputElement>('#layer-level-order')?.value).toBe('0');

        type(host, 'layer-level-order', '1');
        type(host, 'layer-level-label', 'Etaj');

        expect(changes).toEqual([
            { order: 1, label: { ro: 'Parter', en: 'Ground floor' } },
            { order: 1, label: { ro: 'Etaj', en: 'Ground floor' } },
        ]);
    });

    it('badPath_aNameWithoutAnOrderWritesNoLevel @S-A201-BAD-LEVEL', () => {
        const changes: unknown[] = [];
        const host = rendered(undefined, changes);

        type(host, 'layer-level-label', 'Subsol');

        expect(changes).toEqual([undefined]);
    });
});
