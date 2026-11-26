import { describe, expect, it } from 'vitest';

import { clientLabel, crashNoiseOf } from '../../src/index.js';

/** An error with a given stack, as the browsers build them. */
function errorWith(name: string, message: string, stack: string): Error {
    const error = new Error(message);
    error.name = name;
    error.stack = stack;
    return error;
}

describe('crashNoiseOf', () => {
    it('badPath_firefoxForIosReaderScriptIsInjected', () => {
        // The Crashes groups of 2026-11-11, as Firefox for iOS (WebKit) sent them.
        const variable = errorWith(
            'ReferenceError',
            "Can't find variable: __firefox__",
            'global code@https://bucurestiul-disparut.web.app/:1:12',
        );
        const reader = errorWith(
            'TypeError',
            "undefined is not an object (evaluating 'window.__firefox__.reader')",
            'global code@https://bucurestiul-disparut.web.app/:1:19',
        );
        expect(crashNoiseOf(variable)).toBe('injected');
        expect(crashNoiseOf(reader)).toBe('injected');
    });

    it('badPath_aScriptAtLineOneOfThePageIsInjectedWhateverItsMessage', () => {
        expect(
            crashNoiseOf(errorWith('TypeError', 'x is null', 'f@https://example.org/admin/index.html:1:40\n@https://example.org/:1:2')),
        ).toBe('injected');
        expect(crashNoiseOf('ReferenceError: __gCrWeb is not defined')).toBe('injected');
    });

    it('badPath_anExtensionFrameAndAnAbortedFetchAreNoise', () => {
        const extension = errorWith('TypeError', 'boom', 'TypeError: boom\n    at x (chrome-extension://abc/content.js:3:9)');
        expect(crashNoiseOf(extension)).toBe('extension');
        expect(crashNoiseOf(errorWith('AbortError', 'The operation was aborted.', ''))).toBe('aborted');
    });

    it('happyPath_ourOwnErrorsAreCrashes', () => {
        const ours = errorWith(
            'TypeError',
            'Cannot convert undefined or null to object',
            'TypeError: Cannot convert undefined or null to object\n    at Object.keys (<anonymous>)\n    at jn.load (https://api.mapbox.com/mapbox-gl-js/v3.34.1/mapbox-gl.js:42:100)',
        );
        expect(crashNoiseOf(ours)).toBeNull();
        expect(crashNoiseOf(errorWith('Error', 'no frames', 'Error: no frames'))).toBeNull();
        expect(crashNoiseOf(42)).toBeNull();
        expect(crashNoiseOf(null)).toBeNull();
        expect(crashNoiseOf({ name: 3, message: 4, stack: 5 })).toBeNull();
    });
});

describe('clientLabel', () => {
    it('happyPath_familyMajorVersionAndDeviceClassOnly', () => {
        const fxios =
            'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/145.0 Mobile/15E148 Safari/605.1.15';
        const chrome = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36';
        const safariPad =
            'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1';
        const edge =
            'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.1';
        const androidTablet =
            'Mozilla/5.0 (Linux; Android 14; SM-X200) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/27.0 Chrome/125 Safari/537.36';
        expect(clientLabel(fxios)).toBe('Firefox 145 mobile');
        expect(clientLabel(chrome)).toBe('Chrome 142 desktop');
        expect(clientLabel(safariPad)).toBe('Safari 18 tablet');
        expect(clientLabel(edge)).toBe('Edge 142 desktop');
        expect(clientLabel(androidTablet)).toBe('Samsung Internet 27 tablet');
    });

    it('badPath_anUnknownBrowserIsOther', () => {
        expect(clientLabel('curl/8.0')).toBe('Other desktop');
        expect(clientLabel('Mozilla/5.0 (Linux; Android 14; Pixel 8) Mobile')).toBe('Other mobile');
    });
});
