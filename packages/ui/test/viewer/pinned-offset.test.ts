import { afterEach, describe, expect, it } from 'vitest';

import { PINNED_HEIGHT_PROPERTY, pinnedOffset, revealLayers, syncPinnedOffset } from '../../src/viewer/pinned-offset.js';

function pane(position: string): HTMLElement {
    const host = document.createElement('div');
    const body = document.createElement('div');
    body.className = 'body';
    const strip = document.createElement('div');
    strip.className = 'pinned';
    strip.style.position = position;
    strip.style.height = '96px';
    body.append(strip);
    host.append(body);
    document.body.append(host);
    return host;
}

describe('pinned-offset', () => {
    afterEach(() => {
        document.body.replaceChildren();
    });

    it('happyPath_aStickyStripsHeightIsTheRowsOffsetAndTheRevealUsesIt', () => {
        const host = pane('sticky');
        const asked: (readonly string[])[] = [];
        const list = Object.assign(document.createElement('hcm-overlay-list'), {
            reveal: (ids: readonly string[]): boolean => asked.push(ids) > 0,
        });
        host.append(list);
        expect(pinnedOffset(host)).toBe(96);
        revealLayers(host, host, ['kh9-1977']);
        expect(host.style.getPropertyValue(PINNED_HEIGHT_PROPERTY)).toBe('96px');
        expect(asked).toEqual([['kh9-1977']]);
    });

    it('badPath_aStripThatScrollsWithTheListOrNoStripGivesNoOffset', () => {
        const host = pane('static');
        syncPinnedOffset(host, host);
        expect(host.style.getPropertyValue(PINNED_HEIGHT_PROPERTY)).toBe('0px');
        expect(pinnedOffset(document.createElement('div'))).toBe(0);
    });
});
