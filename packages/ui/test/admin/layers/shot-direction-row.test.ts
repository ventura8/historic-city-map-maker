import { FakeMap } from '@hcm/test-support/fake-map';
import { render } from 'lit';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { wholeBearing } from '../../../src/admin/layers/bearing.js';
import { bearingAt, type HcmDirectionDial } from '../../../src/admin/layers/hcm-direction-dial.js';
import { defineHcmShotDirection, shotDirectionOf, type ShotDirectionRowInput } from '../../../src/admin/layers/hcm-shot-direction.js';
import { shotDirectionRow } from '../../../src/admin/layers/shot-direction-row.js';

/** The layer editor's shot direction (scenario V93): the compass dial, the degrees typed, Clear and the USGS direction. */
beforeAll(() => {
    defineHcmShotDirection();
});

afterEach(() => {
    document.body.replaceChildren();
});

async function mounted(input: Partial<ShotDirectionRowInput>, changes: unknown[]): Promise<HTMLElement> {
    const host = document.createElement('div');
    document.body.append(host);
    render(
        shotDirectionRow({
            locale: 'en',
            layer: { kind: 'satellite' },
            suggestion: undefined,
            readOnly: false,
            change: (value) => changes.push(value),
            ...input,
        }),
        host,
    );
    await host.querySelector('hcm-shot-direction')?.updateComplete;
    return host;
}

async function dialOf(host: HTMLElement): Promise<{ dial: HcmDirectionDial; svg: SVGElement }> {
    const dial = host.querySelector('hcm-direction-dial');
    if (dial === null) {
        throw new Error('no dial');
    }
    await dial.updateComplete;
    const svg = dial.shadowRoot?.querySelector('svg');
    if (svg === null || svg === undefined) {
        throw new Error('no slider');
    }
    return { dial, svg };
}

describe('shotDirectionOf and the dial geometry', () => {
    it('happyPath_degreesAsTypedAndPointsAroundTheCentre @S-A233-HAPPY-SHOT-DIAL', () => {
        expect([shotDirectionOf(' 90 '), shotDirectionOf('359,6'), shotDirectionOf('360'), shotDirectionOf('')]).toEqual([
            90,
            0,
            0,
            undefined,
        ]);
        expect([bearingAt(50, 0, 50, 50), bearingAt(100, 50, 50, 50), bearingAt(50, 100, 50, 50), bearingAt(0, 50, 50, 50)]).toEqual([
            0, 90, 180, 270,
        ]);
        expect([wholeBearing(-15), wholeBearing(725)]).toEqual([345, 5]);
    });

    it.each(['x', '-1', '361'])('badPath_%j_isNoDirection @S-A233-BAD-SHOT-DIAL', (text) => {
        expect(shotDirectionOf(text)).toBeNaN();
    });
});

describe('setting the direction from the map', () => {
    it('follows a turning preview and resets the camera independently of the layer draft', async () => {
        const map = new FakeMap();
        const changes: unknown[] = [];
        const host = await mounted({ compassMap: map, mapReady: true }, changes);
        const compass = host.querySelector('hcm-compass');
        map.flyTo({ bearing: -45 });
        await compass?.updateComplete;
        expect(compass?.camera.bearing).toBe(315);
        compass?.shadowRoot?.querySelector('button')?.click();
        await compass?.updateComplete;
        expect(map.getView().bearing).toBe(0);
        expect(compass?.north).toBe(true);
        expect(changes).toEqual([]);
    });

    it('sets a rounded, normalized bearing and announces it @S-A233-HAPPY-SHOT-VIEW', async () => {
        const changes: unknown[] = [];
        const messages: string[] = [];
        const host = await mounted({ mapReady: true, bearing: () => -237.4, announce: (message) => messages.push(message) }, changes);
        host.querySelector<HTMLElement>('[data-shot-from-view]')?.click();
        expect(changes).toEqual([123]);
        expect(messages).toEqual(['Direction set to 123° from the view.']);
    });

    it('explains when the map is unavailable @S-A233-BAD-SHOT-VIEW', async () => {
        const host = await mounted({ mapReady: false }, []);
        expect(host.querySelector('[data-shot-from-view]')?.hasAttribute('disabled')).toBe(true);
        expect(host.querySelector('hcm-compass')).toBeNull();
        expect(host.textContent).toContain('The preview map is not ready.');
    });

    it('does not set a missing or invalid map bearing', async () => {
        const changes: unknown[] = [];
        for (const bearing of [null, Number.NaN]) {
            const host = await mounted({ mapReady: true, bearing: () => bearing }, changes);
            host.querySelector<HTMLElement>('[data-shot-from-view]')?.click();
        }
        expect(changes).toEqual([]);
    });
});

describe('shotDirectionRow', () => {
    it('happyPath_theDialTheDegreesAndClearChangeTheDirection @S-A233-HAPPY-SHOT-DIAL', async () => {
        const changes: unknown[] = [];
        const host = await mounted({ layer: { kind: 'aerial', shotDirection: 45 } }, changes);
        const { svg } = await dialOf(host);
        expect([svg.getAttribute('role'), svg.getAttribute('aria-valuenow'), svg.getAttribute('aria-label')]).toEqual([
            'slider',
            '45',
            'Shot direction',
        ]);

        svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', shiftKey: true, bubbles: true }));
        svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true }));
        const field = host.querySelector<HTMLInputElement>('#layer-shot-degrees');
        if (field === null) {
            throw new Error('no field');
        }
        field.value = '270';
        field.dispatchEvent(new Event('change'));
        host.querySelector<HTMLElement>('[data-shot-clear]')?.click();

        expect(changes).toEqual([46, 31, 0, 270, undefined]);
    });

    it('happyPath_aDragPointsTheNeedleWhereThePointerIs @S-A233-HAPPY-SHOT-DIAL', async () => {
        const changes: unknown[] = [];
        const { svg } = await dialOf(await mounted({}, changes));
        const box = svg.getBoundingClientRect();
        const at = (x: number, y: number): PointerEventInit => ({
            clientX: box.left + x * box.width,
            clientY: box.top + y * box.height,
            pointerId: 1,
        });

        svg.dispatchEvent(new PointerEvent('pointerdown', at(1, 0.5)));
        svg.dispatchEvent(new PointerEvent('pointermove', at(0.5, 1)));
        svg.dispatchEvent(new PointerEvent('pointerup', at(0.5, 1)));
        svg.dispatchEvent(new PointerEvent('pointermove', at(0, 0.5)));

        expect(changes).toEqual([180]);
    });

    it('happyPath_theUsgsDirectionIsOffered @S-A233-HAPPY-SHOT-USGS', async () => {
        const changes: unknown[] = [];
        const host = await mounted({ suggestion: 172 }, changes);
        const button = host.querySelector<HTMLElement>('[data-shot-suggestion]');

        expect(button?.textContent).toBe('Use the USGS direction (172°)');
        button?.click();
        expect(changes).toEqual([172]);
    });

    it('badPath_aDrawnMapHasNoDialAndAKeptSuggestionIsNotOfferedAgain @S-A233-BAD-SHOT-DIAL', async () => {
        expect((await mounted({ layer: { kind: 'map' } }, [])).querySelector('[data-shot-direction]')).toBeNull();
        const kept = await mounted({ layer: { kind: 'satellite', shotDirection: 172 }, suggestion: 172 }, []);
        expect(kept.querySelector('[data-shot-suggestion]')).toBeNull();
    });

    it('badPath_readOnlyTheDialDoesNotTurnAndNoneSaysSo @S-A233-BAD-SHOT-DIAL', async () => {
        const changes: unknown[] = [];
        const { dial, svg } = await dialOf(await mounted({ readOnly: true }, changes));

        svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
        svg.dispatchEvent(new PointerEvent('pointerdown', { clientX: 0, clientY: 0, pointerId: 1 }));
        svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));

        expect(changes).toEqual([]);
        expect(dial.value).toBeNull();
        expect([svg.getAttribute('aria-valuetext'), svg.getAttribute('tabindex')]).toEqual(['No shot direction', '-1']);
    });

    it('happyPath_aLivePointerIsCapturedAndEveryArrowTurns @S-A233-HAPPY-SHOT-DIAL', async () => {
        const changes: unknown[] = [];
        const { svg } = await dialOf(await mounted({ layer: { kind: 'satellite', shotDirection: 10 } }, changes));
        const captured: number[] = [];
        svg.setPointerCapture = (id: number) => {
            captured.push(id);
        };
        const box = svg.getBoundingClientRect();

        svg.dispatchEvent(
            new PointerEvent('pointerdown', { clientX: box.left + box.width / 2, clientY: box.top, pointerId: 7, isPrimary: true }),
        );
        svg.dispatchEvent(new PointerEvent('pointerup', { pointerId: 7 }));
        svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', bubbles: true }));
        svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowUp', shiftKey: true, bubbles: true }));
        svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
        svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true, bubbles: true }));
        svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', shiftKey: true, bubbles: true }));

        expect([captured, changes]).toEqual([[7], [0, 1, 16, 15, 0, 15]]);
    });

    it('badPath_anUnknownKeyDoesNothing', async () => {
        const changes: unknown[] = [];
        const { svg } = await dialOf(await mounted({}, changes));

        svg.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        svg.dispatchEvent(new PointerEvent('pointerup', { pointerId: 1 }));

        expect(changes).toEqual([]);
    });
});
