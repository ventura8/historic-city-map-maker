import { afterEach, describe, expect, it } from 'vitest';

import { BASELINE_THEME } from '../../src/theme/baseline.js';
import {
    ACCENT_PROPERTY,
    accentOf,
    accentTokens,
    chromaOf,
    deviceAccentState,
    exposesAccent,
    hexFromComputed,
    hueOf,
    readDeviceAccent,
    turnHue,
    withAccent,
} from '../../src/theme/device-accent.js';
import { CONTRAST_PAIRS, contrastRatio, relativeLuminance, tokenName } from '../../src/theme/dynamic-color.js';

const BLUE = '#0b57d0';
const GREEN = '#1e8e3e';
const ORANGE = '#e8710a';
const PRIMARY = '--md-sys-color-primary';

/** The angle between two hues, folded into 0 to π. */
function hueDistance(a: number, b: number): number {
    const turn = Math.abs(a - b) % (2 * Math.PI);
    return Math.min(turn, 2 * Math.PI - turn);
}

/** A window double for `exposesAccent`: whether `userAgentData` exists and the display mode matches. */
function fakeWindow(chromium: boolean, installed: boolean): Window {
    return { navigator: chromium ? { userAgentData: {} } : {}, matchMedia: () => ({ matches: installed }) } as unknown as Window;
}

/** A `CSS` double that supports `property:value` pairs. */
function fakeCss(...supports: readonly string[]): Pick<typeof CSS, 'supports'> {
    return { supports: (property: string, value?: string) => supports.includes(`${property}:${String(value)}`) };
}

const ACCENT = 'color:AccentColor';
const GECKO = '-moz-appearance:none';

describe('device accent: choices', () => {
    it('happyPath_theDeviceAccentIsTheDefault', () => {
        expect(accentOf(null)).toBe('device');
        expect(accentOf('device')).toBe('device');
        expect(accentOf('map')).toBe('map');
    });

    it('badPath_aStoredValueThatIsNoChoiceReadsAsTheDefault', () => {
        expect(accentOf('sepia')).toBe('device');
    });
});

describe('device accent: the tokens', () => {
    it('happyPath_aTurnedColourKeepsItsLuminanceAndTakesTheAccentHue', () => {
        const source = '#875329';
        const turned = turnHue(source, (hueOf(BLUE) ?? 0) - (hueOf(source) ?? 0));

        expect(Math.abs(relativeLuminance(turned) - relativeLuminance(source))).toBeLessThan(0.004);
        expect(hueDistance(hueOf(turned) ?? 0, hueOf(BLUE) ?? 0)).toBeLessThan(0.08);
    });

    it.each([BLUE, GREEN, ORANGE])('happyPath_everySchemeTakesTheAccent_%s_andKeepsItsContrast', (accent) => {
        const themed = withAccent(BASELINE_THEME, accent);

        for (const scheme of ['light', 'dark', 'highContrastLight', 'highContrastDark'] as const) {
            expect(hueDistance(hueOf(themed[scheme][PRIMARY] ?? '') ?? 9, hueOf(accent) ?? 0)).toBeLessThan(0.12);
            for (const [foreground, background] of CONTRAST_PAIRS) {
                const before = contrastRatio(
                    BASELINE_THEME[scheme][tokenName(foreground)] ?? '',
                    BASELINE_THEME[scheme][tokenName(background)] ?? '',
                );
                const after = contrastRatio(themed[scheme][tokenName(foreground)] ?? '', themed[scheme][tokenName(background)] ?? '');
                expect(Math.abs(after - before), `${scheme} ${foreground} on ${background}`).toBeLessThan(0.15);
            }
        }
    });

    it('happyPath_aMutedCityTakesTheVividAccentsColourfulness', () => {
        // The live Bucharest city: a muted lavender primary; GNOME's orange accent as Chrome 157 gives it on Linux.
        const muted = { ...BASELINE_THEME, light: { ...BASELINE_THEME.light, [PRIMARY]: '#505d8c' } };
        const gnomeOrange = '#ed5b00';
        const themed = withAccent(muted, gnomeOrange);

        expect(chromaOf(themed.light[PRIMARY] ?? '')).toBeGreaterThan(1.8 * chromaOf('#505d8c'));
        expect(Math.abs(relativeLuminance(themed.light[PRIMARY] ?? '') - relativeLuminance('#505d8c'))).toBeLessThan(0.004);
    });

    it('badPath_aMutedAccentNeverGreysAVividCity', () => {
        const vivid = { ...BASELINE_THEME, light: { ...BASELINE_THEME.light, [PRIMARY]: '#0b57d0' } };
        const sage = '#6d7f6a';
        const themed = withAccent(vivid, sage);

        expect(themed.light[PRIMARY]).toBe(turnHue('#0b57d0', (hueOf(sage) ?? 0) - (hueOf('#0b57d0') ?? 0)));
    });

    it('happyPath_aNearGreySurfaceStaysATintedNeutral', () => {
        const surface = turnHue('#eeedf6', 0, 4);

        expect(chromaOf(surface)).toBeLessThan(0.03);
        expect(chromaOf(surface)).toBeGreaterThan(chromaOf('#eeedf6'));
    });

    it('happyPath_errorShadowAndScrimKeepTheirOwnColours', () => {
        const themed = withAccent(BASELINE_THEME, BLUE);

        for (const role of ['error', 'on-error', 'error-container', 'on-error-container', 'shadow', 'scrim']) {
            expect(themed.dark[tokenName(role)]).toBe(BASELINE_THEME.dark[tokenName(role)]);
        }
    });

    it('happyPath_aValueThatIsNoHexColourIsKept', () => {
        const tokens = { ...BASELINE_THEME, light: { ...BASELINE_THEME.light, '--md-sys-color-outline': 'Canvas' } };

        expect(withAccent(tokens, BLUE).light['--md-sys-color-outline']).toBe('Canvas');
    });

    it.each([
        ['a grey accent', '#808080'],
        ['no accent', null],
        ['an accent that is no hex colour', 'blue'],
    ])('badPath_%sKeepsTheMapColours', (_case, accent) => {
        expect(withAccent(BASELINE_THEME, accent)).toBe(BASELINE_THEME);
    });

    it('badPath_aThemeWithoutAPrimaryKeepsItsColours', () => {
        const tokens = { ...BASELINE_THEME, light: {} };

        expect(withAccent(tokens, BLUE)).toBe(tokens);
    });

    it('happyPath_computedColoursAreReadAsHex', () => {
        expect(hexFromComputed('rgb(11, 87, 208)')).toBe(BLUE);
        expect(hexFromComputed(' rgb(0,0,0) ')).toBe('#000000');
    });

    it('badPath_aTransparentOrWideGamutColourIsNoAccent', () => {
        expect(hexFromComputed('rgba(0, 0, 0, 0)')).toBeNull();
        expect(hexFromComputed('color(display-p3 1 0 0)')).toBeNull();
    });
});

describe('device accent: what the browser gives', () => {
    afterEach(() => {
        document.documentElement.style.removeProperty(ACCENT_PROPERTY);
    });

    it('happyPath_firefoxAndAnInstalledChromiumAppGiveTheDevicesAccent', () => {
        expect(exposesAccent(fakeWindow(false, false), fakeCss(ACCENT, GECKO))).toBe(true);
        expect(exposesAccent(fakeWindow(true, true), fakeCss(ACCENT))).toBe(true);
    });

    it('badPath_aChromiumTabSafariOrAnOlderBrowserGiveNoAccent', () => {
        // Chrome gives a tab a constant blue and Safari a constant: neither is the device's.
        expect(exposesAccent(fakeWindow(true, false), fakeCss(ACCENT))).toBe(false);
        expect(exposesAccent(fakeWindow(false, true), fakeCss(ACCENT))).toBe(false);
        expect(exposesAccent(fakeWindow(false, false), fakeCss(GECKO))).toBe(false);
    });

    it('happyPath_thePageCanNameTheAccent', () => {
        document.documentElement.style.setProperty(ACCENT_PROPERTY, 'rgb(11, 87, 208)');

        expect(readDeviceAccent(document, CSS)).toBe(BLUE);
        expect(accentTokens(BASELINE_THEME, 'device', document)).not.toBe(BASELINE_THEME);
        expect(accentTokens(BASELINE_THEME, 'map', document)).toBe(BASELINE_THEME);
        expect(document.documentElement.querySelector('span')).toBeNull();
    });

    it('badPath_aChromiumTabWithoutANamedAccentKeepsTheMapColours', () => {
        // The test browser is a Chromium tab, not an installed app.
        expect(readDeviceAccent(document, CSS)).toBeNull();
        expect(accentTokens(BASELINE_THEME, 'device', document)).toBe(BASELINE_THEME);
    });

    it('badPath_forcedColoursOrNoWindowGiveNoAccent', () => {
        const forced = { defaultView: { matchMedia: () => ({ matches: true }) } } as unknown as Document;

        expect(readDeviceAccent(forced, CSS)).toBeNull();
        expect(readDeviceAccent({ defaultView: null } as unknown as Document, CSS)).toBeNull();
    });

    it('happyPath_anAccentWhereTheBrowserExposesItIsRead', () => {
        const win = {
            matchMedia: (query: string) => ({ matches: query.includes('display-mode') }),
            navigator: { userAgentData: {} },
            getComputedStyle: (element: Element) => window.getComputedStyle(element),
        };
        const doc = {
            defaultView: win,
            documentElement: document.documentElement,
            createElement: (tag: string) => document.createElement(tag),
        };

        expect(readDeviceAccent(doc as unknown as Document, fakeCss(ACCENT))).toMatch(/^#[0-9a-f]{6}$/);
    });

    it('happyPath_aColouredAccentIsShared', () => {
        document.documentElement.style.setProperty(ACCENT_PROPERTY, GREEN);

        expect(deviceAccentState(document)).toBe('shared');
    });

    it('badPath_aChromiumTabHidesTheAccentAndAGreyOneHasNoHue', () => {
        // The test browser is a Chromium tab: Chrome gives it a constant blue, not the device's accent.
        expect(deviceAccentState(document)).toBe('hidden');
        document.documentElement.style.setProperty(ACCENT_PROPERTY, '#808080');
        expect(deviceAccentState(document)).toBe('grey');
    });
});
