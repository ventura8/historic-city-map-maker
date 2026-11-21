import { describe, expect, it, vi } from 'vitest';

import { browserServices, isDenied, resolveAssetUrl, shareMessage, sharePage, type ViewerServices } from '../../src/viewer/services.js';

function services(change: Partial<ViewerServices> = {}): ViewerServices {
    return {
        share: null,
        copyText: () => Promise.resolve(),
        watchPosition: () => () => undefined,
        pageUrl: () => 'https://example.org/map/#14/44.43/26.1',
        matchMedia: (query) => window.matchMedia(query),
        openPage: () => undefined,
        ...change,
    };
}

/** A browser's geolocation that answers each watch at once with `answer`, and records the watches cleared. */
class FakeGeolocation {
    readonly cleared: number[] = [];
    readonly #answer: (success: PositionCallback, failure: PositionErrorCallback) => void;

    constructor(answer: (success: PositionCallback, failure: PositionErrorCallback) => void) {
        this.#answer = answer;
    }

    watchPosition(success: PositionCallback, failure: PositionErrorCallback): number {
        this.#answer(success, failure);
        return 7;
    }

    clearWatch(id: number): void {
        this.cleared.push(id);
    }
}

function position(coords: Partial<GeolocationCoordinates>): GeolocationPosition {
    return { coords: { longitude: 26.1, latitude: 44.43, accuracy: 12, heading: null, ...coords } } as GeolocationPosition;
}

function fakeWindow(navigator: Record<string, unknown>): Window {
    return {
        navigator,
        location: { href: 'https://example.org/city/#15/44.4/26.1' },
        matchMedia: (query: string) => window.matchMedia(query),
    } as unknown as Window;
}

describe('browserServices', () => {
    it('happyPath_usesTheWindowsShareClipboardAndGeolocation', async () => {
        const share = vi.fn(() => Promise.resolve());
        const writeText = vi.fn(() => Promise.resolve());
        const geolocation = new FakeGeolocation((success) => {
            success(position({ heading: 90 }));
            success(position({ heading: Number.NaN, accuracy: 30 }));
        });
        const real = browserServices(fakeWindow({ share, clipboard: { writeText }, geolocation }));
        const fixes: unknown[] = [];

        await real.share?.({ title: 'Hartă', url: 'https://example.org/' });
        await real.copyText('https://example.org/');

        expect(share).toHaveBeenCalledWith({ title: 'Hartă', url: 'https://example.org/' });
        expect(writeText).toHaveBeenCalledWith('https://example.org/');
        const stop = real.watchPosition(
            (fix) => fixes.push(fix),
            () => undefined,
        );
        stop();
        expect(fixes).toEqual([
            { center: [26.1, 44.43], accuracy: 12, heading: 90 },
            { center: [26.1, 44.43], accuracy: 30, heading: null },
        ]);
        expect(geolocation.cleared).toEqual([7]);
        expect(real.pageUrl()).toBe('https://example.org/city/#15/44.4/26.1');
        expect(real.matchMedia('(min-width: 1px)').matches).toBe(true);
    });

    it('badPath_noWebShareApiAndNoGeolocation', async () => {
        const real = browserServices(fakeWindow({ clipboard: { writeText: () => Promise.resolve() } }));

        expect(real.share).toBeNull();
        const onError = vi.fn();
        real.watchPosition(() => undefined, onError)();
        expect(onError).not.toHaveBeenCalled();
        await vi.waitFor(() => {
            expect(onError).toHaveBeenCalledWith(expect.any(Error));
        });
    });

    it('badPath_deniedGeolocationFailsWithItsCode', () => {
        const geolocation = new FakeGeolocation((_success, failure) => {
            failure({ code: 1 } as GeolocationPositionError);
        });
        const errors: unknown[] = [];
        browserServices(fakeWindow({ geolocation })).watchPosition(
            () => undefined,
            (error) => errors.push(error),
        );
        expect(errors).toEqual([{ code: 1 }]);
        expect(errors.map(isDenied)).toEqual([true]);
    });
});

describe('sharePage', () => {
    it('happyPath_webShareShares', async () => {
        const share = vi.fn(() => Promise.resolve());

        await expect(sharePage(services({ share }), 'Hartă')).resolves.toBe('shared');
        expect(share).toHaveBeenCalledWith({ title: 'Hartă', url: 'https://example.org/map/#14/44.43/26.1' });
    });

    it('happyPath_withoutWebShareTheLinkIsCopied', async () => {
        const copyText = vi.fn(() => Promise.resolve());

        await expect(sharePage(services({ copyText }), 'Hartă')).resolves.toBe('copied');
        expect(copyText).toHaveBeenCalledWith('https://example.org/map/#14/44.43/26.1');
    });

    it('badPath_closingTheShareSheetIsNotAnError', async () => {
        const share = () => Promise.reject(new DOMException('closed', 'AbortError'));

        await expect(sharePage(services({ share }), 'Hartă')).resolves.toBe('cancelled');
    });

    it('badPath_aFailingShareFallsBackToTheClipboard', async () => {
        const share = () => Promise.reject(new Error('not allowed'));

        await expect(sharePage(services({ share }), 'Hartă')).resolves.toBe('copied');
    });

    it('badPath_aFailingClipboardFails', async () => {
        const copyText = () => Promise.reject(new DOMException('denied', 'NotAllowedError'));

        await expect(sharePage(services({ copyText }), 'Hartă')).resolves.toBe('failed');
    });
});

describe('shareMessage', () => {
    it('happyPath_copiedAndFailedHaveMessages', () => {
        expect(shareMessage('copied')).toBe('share.copied');
        expect(shareMessage('failed')).toBe('share.failed');
    });

    it('badPath_sharedOrCancelledNeedNoMessage', () => {
        expect(shareMessage('shared')).toBeNull();
        expect(shareMessage('cancelled')).toBeNull();
    });
});

describe('isDenied', () => {
    it('happyPath_aRefusalHasCodeOne', () => {
        expect(isDenied({ code: 1 })).toBe(true);
    });

    it('badPath_otherErrorsAreNoRefusal', () => {
        expect([{ code: 2 }, new Error('x'), null, 'denied'].map(isDenied)).toEqual([false, false, false, false]);
    });
});

describe('resolveAssetUrl', () => {
    it('happyPath_relativeToTheManifest', () => {
        expect(resolveAssetUrl('derived/a/thumb.webp', 'https://bucket.example.org/cities/b/manifest.json', 'https://example.org/')).toBe(
            'https://bucket.example.org/cities/b/derived/a/thumb.webp',
        );
    });

    it('happyPath_inlineManifestResolvesAgainstThePage', () => {
        expect(resolveAssetUrl('derived/a/thumb.webp', '', 'https://example.org/city/index.html')).toBe(
            'https://example.org/city/derived/a/thumb.webp',
        );
        expect(resolveAssetUrl('https://cdn.example.org/a.webp', 'manifest.json', 'https://example.org/')).toBe(
            'https://cdn.example.org/a.webp',
        );
    });

    it('badPath_unresolvableAddressGivesNull', () => {
        expect(resolveAssetUrl('a.webp', '', 'not a url')).toBeNull();
    });
});
