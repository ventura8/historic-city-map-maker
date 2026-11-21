/**
 * The default tab icon in the chosen theme (`packages/shared/src/kit/tab-icon.ts`), with a page made of plain objects:
 * what is drawn and into which link, what is left alone, and when a viewer page paints again. The real canvas is
 * exercised in `packages/ui/test/admin/shell/tab-icon.test.ts` and by the e2e rows S-V55-*.
 */
import { describe, expect, it } from 'vitest';

import { MAP_GLYPH_PATH, MAP_ICON_GEOMETRY } from '../../src/kit/map-icon.js';
import { followViewerTheme, paintTabIcon, type TabIconContext, type TabIconScope } from '../../src/kit/tab-icon.js';

const GLYPH = { path: MAP_GLYPH_PATH, ...MAP_ICON_GEOMETRY };

interface Link {
    href: string;
    media: string | null;
    removed: boolean;
    content?: string | undefined;
    removeAttribute(name: string): void;
    setAttribute(name: string, value: string): void;
    remove(): void;
}

function link(href: string, media: string | null = null): Link {
    return {
        href,
        media,
        removed: false,
        removeAttribute(name) {
            this.media = name === 'media' ? null : this.media;
        },
        setAttribute(name, value) {
            this.content = name === 'content' ? value : this.content;
        },
        remove() {
            this.removed = true;
        },
    };
}

interface Host {
    readonly primary: string;
    readonly onPrimary: string;
    readonly surface?: string;
}

function page(links: Link[], canvas = true, metas: Link[] = []): TabIconScope<Host> & { readonly calls: string[] } {
    const calls: string[] = [];
    const context: TabIconContext = {
        fillStyle: '',
        scale: (x, y) => calls.push(`scale ${x.toFixed(4)} ${y.toFixed(4)}`),
        translate: (x, y) => calls.push(`translate ${String(x)} ${String(y)}`),
        beginPath: () => calls.push('beginPath'),
        roundRect: (...box) => calls.push(`roundRect ${box.join(' ')}`),
        fill(path) {
            calls.push(`fill ${String(this.fillStyle)} ${path === undefined ? 'square' : String((path as { path: string }).path.length)}`);
        },
    };
    return {
        calls,
        document: {
            querySelectorAll: (selector) => (selector === 'link[rel="icon"]' ? links.filter((item) => !item.removed) : metas),
            createElement: () => ({
                width: 0,
                height: 0,
                getContext: () => (canvas ? context : null),
                toDataURL: (type) => `data:${type};base64,${calls.filter((call) => call.startsWith('fill')).join('|')}`,
            }),
        },
        getComputedStyle: (host) => ({
            getPropertyValue: (name) =>
                ({ '--md-sys-color-primary': ` ${host.primary}`, '--md-sys-color-surface': host.surface ?? '' })[name] ?? host.onPrimary,
        }),
        Path2D: class {
            constructor(readonly path: string) {}
        },
    };
}

const DARK: Host = { primary: '#f4bb92', onPrimary: '#5d3719' };
const LIGHT: Host = { primary: '#875329', onPrimary: '#fff7f4' };

describe('paintTabIcon', () => {
    it('happyPath_theThemeColorMetaWearsTheHostsSurfaceAndLosesItsMedia', () => {
        const metas = [link('', '(prefers-color-scheme: dark)')];

        paintTabIcon(page([link('https://city.example/icon.png')], true, metas), { ...DARK, surface: '#1a1110' }, GLYPH);

        expect(metas[0]?.content).toBe('#1a1110');
        expect(metas[0]?.media).toBeNull();
    });

    it('badPath_aHostWithNoThemeLeavesTheThemeColorMetaAlone', () => {
        const metas = [link('', 'dark')];

        paintTabIcon(page([], true, metas), DARK, GLYPH);

        expect(metas[0]?.content).toBeUndefined();
        expect(metas[0]?.media).toBe('dark');
    });

    it('happyPath_theThemesColoursAreDrawnIntoTheFirstLinkAndTheOtherGoes', () => {
        const links = [link('data:image/png;base64,light', '(prefers-color-scheme: light)'), link('data:image/png;base64,dark', 'dark')];
        const scope = page(links);

        expect(paintTabIcon(scope, DARK, GLYPH)).toBe(true);

        expect(links[0]?.href).toBe(`data:image/png;base64,fill #f4bb92 square|fill #5d3719 ${String(MAP_GLYPH_PATH.length)}`);
        expect(links[0]?.media).toBeNull();
        expect(links[1]?.removed).toBe(true);
        expect(scope.calls).toEqual([
            'scale 0.0333 0.0333',
            'beginPath',
            'roundRect 0 0 960 960 211',
            'fill #f4bb92 square',
            'translate 480 480',
            'scale 0.8267 -0.8267',
            'translate -480 -480',
            `fill #5d3719 ${String(MAP_GLYPH_PATH.length)}`,
        ]);
    });

    it('happyPath_anotherThemeIsDrawnOverTheLastAndTheSameOneChangesNothing', () => {
        const links = [link('data:image/png;base64,light')];

        paintTabIcon(page(links), DARK, GLYPH);
        const dark = links[0]?.href;
        paintTabIcon(page(links), LIGHT, GLYPH);
        const light = links[0]?.href;

        expect(light).toContain('#875329');
        expect(light).not.toBe(dark);
        expect(paintTabIcon(page(links), LIGHT, GLYPH)).toBe(true);
        expect(links[0]?.href).toBe(light);
    });

    it.each([
        ['a city’s own icon', [link('https://storage.googleapis.com/x-public/cities/bacau/icon-32.png')], DARK, true],
        ['no icon link', [], DARK, true],
        ['a host without a theme', [link('data:image/png;base64,light')], { primary: '', onPrimary: '' }, true],
        ['a browser without a canvas', [link('data:image/png;base64,light')], DARK, false],
    ])('badPath_%s_isLeftAlone', (_name, links, host, canvas) => {
        const before = links.map((item) => item.href);

        expect(paintTabIcon(page(links, canvas), host, GLYPH)).toBe(false);

        expect(links.map((item) => item.href)).toEqual(before);
        expect(links.every((item) => !item.removed)).toBe(true);
    });
});

describe('followViewerTheme', () => {
    function viewerPage(viewer: Host | null) {
        const listeners = new Map<string, () => void>();
        const painted: Host[] = [];
        const scope = {
            document: {
                querySelector: (selector: string) => (selector === 'hcm-map-viewer' ? viewer : null),
                addEventListener: (name: string, listener: () => void) => listeners.set(name, listener),
            },
            matchMedia: (query: string) => ({
                addEventListener: (_name: 'change', listener: () => void) => listeners.set(query, listener),
            }),
        };
        const paint = (_scope: typeof scope, host: Host): boolean => painted.push(host) > 0;
        return { scope, listeners, painted, paint };
    }

    it('happyPath_theViewerIsPaintedOnLoadReadyAClickAndASystemChange', () => {
        const world = viewerPage(DARK);

        followViewerTheme(world.scope, world.paint, GLYPH);

        expect([...world.listeners.keys()]).toEqual([
            'DOMContentLoaded',
            'hcm-ready',
            'hcm-error',
            'click',
            'keyup',
            '(prefers-color-scheme: dark)',
            '(prefers-contrast: more)',
        ]);
        expect(world.painted).toEqual([]);
        world.listeners.forEach((listener) => {
            listener();
        });
        expect(world.painted).toHaveLength(7);
    });

    it('badPath_aPageWithoutAViewerPaintsNothing', () => {
        const world = viewerPage(null);

        followViewerTheme(world.scope, world.paint, GLYPH);
        world.listeners.forEach((listener) => {
            listener();
        });

        expect(world.painted).toEqual([]);
    });
});
