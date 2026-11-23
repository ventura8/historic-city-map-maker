/**
 * Side-by-side Street View opener: opens a positioned split window on wide desktop browsers and falls back to native
 * new-tab navigation on narrow/touch devices, modified clicks, or when popups are blocked.
 */
import { describe, expect, it, vi } from 'vitest';

import {
    MIN_SPLIT_WIDTH,
    STREET_VIEW_WINDOW,
    canOpenSplitView,
    isPlainPrimaryClick,
    openStreetView,
    splitWindowFeatures,
    type SplitWindowHost,
} from '../../src/viewer/street-view-opener.js';

const URL = 'https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=44.43,26.1';

function desktopHost(popup: Window | null = { opener: window, focus: vi.fn() } as unknown as Window): {
    host: SplitWindowHost;
    open: ReturnType<typeof vi.fn>;
} {
    const open = vi.fn().mockReturnValue(popup);
    const host: SplitWindowHost = {
        screen: { availWidth: 1600, availHeight: 900, availLeft: 100, availTop: 20 },
        matchMedia: () => ({ matches: false }),
        open,
    };
    return { host, open };
}

describe('street-view-opener', () => {
    it('happyPath_opensSideBySideWindowAndPreventsDefaultOnDesktop', () => {
        const focus = vi.fn();
        const popup = { opener: window, focus } as unknown as Window;
        const { host, open } = desktopHost(popup);
        const event = new MouseEvent('click', { button: 0, cancelable: true });

        const opened = openStreetView(URL, event, host);

        expect(opened).toBe(true);
        expect(event.defaultPrevented).toBe(true);
        expect(open).toHaveBeenCalledWith(
            URL,
            STREET_VIEW_WINDOW,
            'popup=yes,width=800,height=900,left=900,top=20,resizable=yes,scrollbars=yes',
        );
        expect(popup.opener).toBeNull();
        expect(focus).toHaveBeenCalledTimes(1);
    });

    it('happyPath_defaultsScreenOffsetsToZeroAndWorksWithoutClickEvent', () => {
        expect(splitWindowFeatures({ availWidth: 1200, availHeight: 800 })).toBe(
            'popup=yes,width=600,height=800,left=600,top=0,resizable=yes,scrollbars=yes',
        );
        const { host } = desktopHost();
        expect(openStreetView(URL, undefined, host)).toBe(true);
    });

    it('badPath_fallsBackWhenPopupIsBlocked', () => {
        const { host } = desktopHost(null);
        const event = new MouseEvent('click', { button: 0, cancelable: true });

        expect(openStreetView(URL, event, host)).toBe(false);
        expect(event.defaultPrevented).toBe(false);
    });

    it('badPath_fallsBackOnNarrowOrCoarseDevicesOrMissingOpen', () => {
        expect(canOpenSplitView({ screen: { availWidth: MIN_SPLIT_WIDTH - 1, availHeight: 800 }, open: vi.fn() })).toBe(false);
        expect(
            canOpenSplitView({
                screen: { availWidth: 1440, availHeight: 900 },
                matchMedia: () => ({ matches: true }),
                open: vi.fn(),
            }),
        ).toBe(false);
        expect(canOpenSplitView({ screen: { availWidth: 1440, availHeight: 900 } })).toBe(false);
        expect(canOpenSplitView({ open: vi.fn() })).toBe(false);
    });

    it('badPath_ignoresModifiedOrNonPrimaryClicks', () => {
        const { host, open } = desktopHost();
        const clicks = [
            new MouseEvent('click', { button: 1, cancelable: true }),
            new MouseEvent('click', { button: 0, ctrlKey: true, cancelable: true }),
            new MouseEvent('click', { button: 0, metaKey: true, cancelable: true }),
            new MouseEvent('click', { button: 0, shiftKey: true, cancelable: true }),
            new MouseEvent('click', { button: 0, altKey: true, cancelable: true }),
        ];

        for (const click of clicks) {
            expect(isPlainPrimaryClick(click)).toBe(false);
            expect(openStreetView(URL, click, host)).toBe(false);
            expect(click.defaultPrevented).toBe(false);
        }
        expect(open).not.toHaveBeenCalled();
    });
});
