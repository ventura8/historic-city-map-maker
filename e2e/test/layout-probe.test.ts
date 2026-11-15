import { page } from 'vitest/browser';
import { afterEach, beforeAll, describe, expect, test } from 'vitest';

import {
    componentOf,
    cutterOf,
    cutsContent,
    hasOwnText,
    idOrNull,
    interactiveElements,
    isPinned,
    modalPlace,
    modalSurfaces,
    movingAnimations,
    probeLayout,
    sampleElement,
    ownMapControl,
    scrollAxes,
    showsThrough,
    sidewaysCulprits,
    pointReaches,
    ringReach,
    scrolledAway,
    targetSizeOf,
    textLines,
    type LayoutSnapshot,
    type ProbeOptions,
} from '../support/layout-probe.js';
import { cornerRadius, cutCorner, withinShape } from '../support/dom-walk.js';
import { layoutViolations } from '../support/layout-rules.js';
import { at, clearStage, h, host, stage } from './fixtures.js';

/** e2e/support/layout-probe.ts: the in-page layout snapshot on synthetic DOM, and what the rules make of it. */

/** The kit's touch target (packages/ui/src/components/styles.ts → `touchTarget`): a centred 48 px `::after`. */
const RING =
    '.touch-target { overflow: visible; } .touch-target::after { content: ""; position: absolute; inset: 50% auto auto 50%;' +
    ' width: max(100%, 48px); height: max(100%, 48px); transform: translate(-50%, -50%); }';

const OPTIONS: ProbeOptions = {
    chrome: [
        { kind: 'fab', selector: 't-fab-menu >>> button.fab' },
        { kind: 'menu', selector: 't-fab-menu >>> [role="menu"]' },
        { kind: 'timeline', selector: 't-timeline' },
        { kind: 'sheet', selector: '.sheet' },
        { kind: 'mapbox-logo', selector: 'a.logo' },
        { kind: 'attribution', selector: '.attrib' },
        { kind: 'marked', selector: '[data-layout-check]' },
    ],
    legal: { map: 'canvas.map', logo: 'a.logo', attribution: '.attrib' },
    appRoots: ['t-viewer'],
    surfaceShare: 0.25,
};

beforeAll(async () => {
    await page.viewport(800, 600);
});

afterEach(() => {
    clearStage();
});

function nodeNamed(snapshot: LayoutSnapshot, name: string): number {
    const found = snapshot.nodes.find((node) => node.name === name);
    if (found === undefined) {
        throw new Error(`no node named ${name}`);
    }
    return found.id;
}

function checksOf(snapshot: LayoutSnapshot, windowClass: 'compact' | 'large' = 'large'): string[] {
    return layoutViolations(snapshot, { windowClass, sanctioned: [{ over: 'menu', under: '*', why: '' }] }).map(
        (violation) => violation.check,
    );
}

describe('interactive elements', () => {
    test('happyPath_whatCountsAsInteractive', () => {
        stage(
            h('button', { style: at(0, 0, 40, 40) }, 'b'),
            h('a', { href: '#', style: at(50, 0, 40, 40) }, 'a'),
            h('a', { style: at(100, 0, 40, 40) }, 'no href'),
            h('div', { role: 'slider', tabindex: '0', style: at(150, 0, 40, 40) }),
            h('div', { tabindex: '-1', style: at(200, 0, 40, 40) }),
            h('input', { type: 'hidden' }),
            h('button', { style: at(250, 0, 40, 40, 'display: none;') }, 'hidden'),
        );
        expect(interactiveElements().map((element) => element.tagName)).toEqual(['BUTTON', 'A', 'DIV']);
    });

    test('badPath_aButtonUnderAnOverlayIsCovered_happyPath_onTopItIsNot', () => {
        stage(
            h('button', { style: at(0, 0, 100, 50) }, 'Under'),
            h('div', { style: at(0, 0, 60, 50, 'background: red;') }, 'Overlay'),
            h('button', { style: at(200, 0, 100, 50) }, 'Free'),
        );
        const snapshot = probeLayout(OPTIONS);
        const under = snapshot.interactives.find((control) => control.node === nodeNamed(snapshot, 'Under'));
        const free = snapshot.interactives.find((control) => control.node === nodeNamed(snapshot, 'Free'));
        expect(under?.samples.some((sample) => !sample.ok)).toBe(true);
        expect(free?.samples.every((sample) => sample.ok)).toBe(true);
        expect(checksOf(snapshot)).toContain('occlusion');
    });

    test('happyPath_aLargeSurfaceSamplesItsCentreOnly_andTheTouchTargetPseudoElementCounts', () => {
        const target = h('button', { class: 'touch-target', style: at(100, 20, 20, 20) }, 't');
        const plain = h('button', { style: at(200, 20, 20, 20) });
        stage(h('style', {}, RING), h('canvas', { class: 'map', tabindex: '0', style: at(0, 100, 800, 500) }), target, plain);
        const snapshot = probeLayout(OPTIONS);
        expect(snapshot.interactives.map((control) => control.samples.length)).toEqual([1, 5, 5]);
        expect(targetSizeOf(target)).toEqual({ width: 48, height: 48 });
        expect(targetSizeOf(plain)).toEqual({ width: 20, height: 20 });
        expect(snapshot.legal.map).toBe(true);
    });

    test('badPath_aRingCutByOverflowHiddenIsTheControlsOwnBox_happyPath_offScreenSidesCountAsComputed', () => {
        // LA-6: the kit's state layer hid the button's overflow, so the 48 px ring took no tap past the 40 px button.
        const clipped = h('button', { class: 'touch-target', style: at(100, 20, 40, 40, 'overflow: hidden;') }, 'c');
        const atTheCorner = h('button', { class: 'touch-target', style: at(0, 0, 40, 40) }, 'e');
        const inBox = h('button', { class: 'touch-target', style: at(30, 2, 40, 40) }, 'b');
        const box = h('div', { style: at(200, 20, 100, 44, 'overflow: hidden;') }, inBox);
        const corner = h('button', { class: 'touch-target', style: at(0, 200, 20, 20) }, 'k');
        stage(h('style', {}, RING), clipped, atTheCorner, box, corner);
        expect(targetSizeOf(clipped)).toEqual({ width: 40, height: 40 });
        // Off screen above and to the left: the ring is counted as computed there, hit-tested below and to the right.
        expect(targetSizeOf(atTheCorner)).toEqual({ width: 48, height: 48 });
        // Its parent cuts the ring 2 px past the button above and below (found to the pixel), not at the sides.
        const cut = targetSizeOf(inBox);
        expect(cut.width).toBe(48);
        expect(cut.height).toBeGreaterThanOrEqual(42);
        expect(cut.height).toBeLessThanOrEqual(44);
        expect(targetSizeOf(corner)).toEqual({ width: 48, height: 48 });
        expect(pointReaches(corner, -5, 210)).toBe(true);
        expect(pointReaches(corner, 30, 210)).toBe(true);
        expect(pointReaches(corner, 40, 210)).toBe(false);
    });

    test('happyPath_aRingInTheViewportsLastHalfPixelCountsAsOffScreen_badPath_theRowAboveIsHitTested', () => {
        // The hit test rounds a point to the pixel: 0.25 px above the foot of a 600 px viewport is tested at row 600, off screen.
        const foot = h('button', { class: 'touch-target', style: at(300, 556.75, 40, 40) }, 'f');
        stage(h('style', {}, RING), foot);
        expect(targetSizeOf(foot)).toEqual({ width: 48, height: 48 });
        expect(pointReaches(foot, 100, 599.6)).toBe(true);
        expect(pointReaches(foot, 100, 599.4)).toBe(false);
    });

    test('happyPath_aRingScrolledOutOfItsListCountsAsComputed_badPath_aRingUnderAnotherControlDoesNot', () => {
        // A switch half scrolled out of its list: the hidden half of its ring is reached by scrolling, not cut.
        const scrolled = h(
            'button',
            { class: 'touch-target', style: 'position: relative; display: block; width: 40px; height: 40px; margin-top: 70px;' },
            's',
        );
        const list = h('div', { style: at(0, 0, 200, 100, 'overflow: auto;') }, scrolled, h('div', { style: 'height: 200px' }));
        const under = h('button', { class: 'touch-target', style: at(300, 20, 40, 40) }, 'u');
        const over = h('button', { style: at(336, 20, 30, 40) }, 'o');
        stage(h('style', {}, RING), list, under, over);
        expect(scrolledAway(scrolled, 20, 105)).toBe(true);
        expect(scrolledAway(scrolled, 20, 95)).toBe(false);
        expect(targetSizeOf(scrolled)).toEqual({ width: 48, height: 48 });
        // The neighbour drawn over its right side takes those taps: 4 px of ring on the left only.
        expect(targetSizeOf(under)).toEqual({ width: 44, height: 48 });
        expect(ringReach(under, 0, () => [0, 0])).toBe(0);
    });

    test('happyPath_fixedBarsScrollAxesAndCuts', () => {
        const inList = h('button', { style: 'display: block; height: 40px;' }, 'In list');
        const list = h('div', { style: at(0, 0, 100, 60, 'overflow: auto;') }, h('div', { style: 'height: 100px' }), inList);
        const cut = h('button', { style: at(0, 30, 50, 40) }, 'Cut');
        const box = h('div', { style: at(200, 0, 100, 50, 'overflow: hidden;') }, cut);
        const bar = h('nav', { style: 'position: fixed; left: 0; bottom: 0; width: 100px; height: 20px;' }, 'Bar');
        stage(list, box, bar);
        expect(scrollAxes(inList)).toEqual({ x: false, y: true });
        expect(cutterOf(cut)).toBe(box);
        expect(cutterOf(inList)).toBeNull();
        expect(isPinned(bar)).toBe(true);
        expect(isPinned(cut)).toBe(false);
        const snapshot = probeLayout(OPTIONS);
        const control = snapshot.interactives.find((entry) => entry.node === nodeNamed(snapshot, 'Cut'));
        expect(control?.cutBy).not.toBeNull();
        expect(checksOf(snapshot)).toContain('edge');
    });
});

describe('modal surfaces', () => {
    test('badPath_aUsableButtonOutsideAnOpenModal_happyPath_anInertOne', () => {
        const outside = h('button', { style: at(0, 0, 50, 50) }, 'Outside');
        const sleeping = h('button', { inert: '', style: at(60, 0, 50, 50) }, 'Sleeping');
        const legal = h('a', { href: '#', class: 'logo', style: at(120, 0, 50, 20) }, 'Mapbox');
        const sheet = h('section', { 'aria-modal': 'true', style: at(0, 100, 400, 300, 'background: white;') }, h('button', {}, 'Inside'));
        stage(outside, sleeping, legal, sheet);
        const modals = modalSurfaces();
        expect(modals).toEqual([sheet]);
        expect(modalPlace(outside, modals, [legal])).toBe('outside');
        expect(modalPlace(legal, modals, [legal])).toBe('exempt');
        expect(modalPlace(outside, [], [])).toBe('none');
        const snapshot = probeLayout(OPTIONS);
        const places = snapshot.interactives.map((control) => control.modal);
        expect(places).toEqual(['outside', 'outside', 'exempt', 'inside']);
        expect(checksOf(snapshot).filter((check) => check === 'modal-escape')).toHaveLength(1);
    });

    test('happyPath_aModalCoveredByAnotherIsNotOnTop_andAModalDialogMakesTheRestInert', () => {
        const lower = h('section', { 'aria-modal': 'true', style: at(0, 0, 200, 200) }, h('button', {}, 'Lower'));
        const upper = h('section', { 'aria-modal': 'true', style: at(0, 0, 300, 300, 'background: black;') }, h('button', {}, 'Upper'));
        const dialog = h('dialog', {}, h('button', {}, 'In dialog'));
        stage(lower, upper, dialog);
        expect(modalSurfaces()).toEqual([upper]);
        (dialog as HTMLDialogElement).showModal();
        const snapshot = probeLayout(OPTIONS);
        const lowerButton = snapshot.interactives.find((control) => control.node === nodeNamed(snapshot, 'Lower'));
        expect(lowerButton?.inert).toBe(true);
        (dialog as HTMLDialogElement).close();
    });
});

describe('floating chrome', () => {
    function viewer(...shadow: Node[]): HTMLElement {
        return host('t-viewer', { style: at(0, 0, 800, 600) }, shadow);
    }

    test('badPath_theFabOverTheTimeline_happyPath_theOpenMenuIsSanctioned', () => {
        const fab = h('button', { class: 'fab', style: at(0, 0, 56, 56) }, 'Meniu');
        const menu = h(
            'div',
            { role: 'menu', style: at(0, 60, 150, 200, 'background: white;') },
            h('button', { role: 'menuitem' }, 'Layers'),
        );
        const fabMenu = host('t-fab-menu', { style: at(10, 300, 200, 300) }, [fab, menu]);
        const timeline = h(
            't-timeline',
            { style: at(40, 320, 400, 60, 'display: block;') },
            h('div', { role: 'slider', tabindex: '0' }, 'Year'),
        );
        stage(viewer(fabMenu, timeline));
        const snapshot = probeLayout(OPTIONS);
        expect(snapshot.chrome.map((chrome) => chrome.kind)).toEqual(['fab', 'menu', 'timeline']);
        expect(snapshot.chrome[0]?.group).toBe(snapshot.chrome[1]?.group);
        expect(snapshot.chrome[2]?.group).toBeNull();
        expect(componentOf(fab, ['t-viewer'])).toBe(fabMenu);
        expect(componentOf(timeline, ['t-viewer'])).toBeNull();
        expect(componentOf(document.body, [])).toBeNull();
        const checks = checksOf(snapshot);
        expect(checks.filter((check) => check === 'overlap')).toHaveLength(1);
    });

    test('happyPath_chromeUnderAModalIsNotUsable_andMarkersAreChromeToo', () => {
        const marked = h('div', { 'data-layout-check': 'note', style: at(0, 0, 100, 40) }, 'Note');
        const frame = h('div', { inert: '' }, h('t-timeline', { style: at(0, 0, 200, 40, 'display: block;') }));
        stage(marked, frame, h('section', { 'aria-modal': 'true', style: at(300, 300, 100, 100) }));
        const snapshot = probeLayout(OPTIONS);
        expect(snapshot.chrome.map((chrome) => [chrome.kind, chrome.usable])).toEqual([
            ['timeline', false],
            ['marked', false],
        ]);
    });
});

describe('texts and the legal line', () => {
    test('badPath_clippedAndOverlappingTexts', () => {
        stage(
            h('p', { style: at(0, 0, 40, 20, 'overflow: hidden; white-space: nowrap;') }, 'A label far too long to fit'),
            h('p', { style: at(0, 100, 200, 20) }, 'First text'),
            h('p', { style: at(10, 105, 200, 20, 'background: transparent;') }, 'Second text'),
            h('p', { style: at(0, 300, 200, 20) }, 'Under'),
            h('div', { style: at(0, 290, 200, 40, 'background: white;') }),
            h('span', { 'aria-hidden': 'true', style: at(0, 200, 10, 10) }, 'icon'),
        );
        const snapshot = probeLayout(OPTIONS);
        expect(snapshot.texts).toHaveLength(4);
        expect(snapshot.texts.map((text) => text.shown)).toEqual([true, true, true, false]);
        expect(snapshot.texts[0]?.clipped).toBe(true);
        const checks = checksOf(snapshot);
        expect(checks).toContain('clipped-text');
        expect(checks).toContain('text-overlap');
        expect(hasOwnText(h('div', {}, '  '))).toBe(false);
    });

    test('badPath_aLoadingIndicatorsShapeOverALabel_happyPath_insideItsBox', () => {
        // M6 (finding 6): an 18 px indicator box whose 38 px shape spills over the label beside it.
        stage(
            h(
                'span',
                { style: at(0, 400, 200, 40) },
                h(
                    'span',
                    { style: at(0, 0, 18, 18) },
                    h('div', { part: 'indicator', role: 'progressbar', 'aria-label': 'Working', style: at(-10, -10, 38, 38) }),
                ),
                h('span', { style: at(22, 0, 100, 20) }, 'To do'),
            ),
            h('div', { part: 'indicator', role: 'progressbar', 'aria-label': 'Loading', style: at(300, 400, 14, 14) }),
        );
        const snapshot = probeLayout(OPTIONS);
        expect(snapshot.graphics).toHaveLength(2);
        expect(checksOf(snapshot).filter((check) => check === 'graphic-overlap')).toHaveLength(1);
    });

    test('badPath_twoLogosAndACoveredAttribution', () => {
        stage(
            h('canvas', { class: 'map', style: at(0, 0, 800, 600) }),
            h('a', { href: '#', class: 'logo', style: at(0, 560, 80, 30) }, 'Mapbox'),
            h('a', { href: '#', class: 'logo', style: at(100, 560, 80, 30) }, 'Mapbox'),
            h('div', { class: 'attrib', style: at(700, 560, 80, 30) }, '© Mapbox'),
            h('div', { style: at(690, 550, 110, 50, 'background: white;') }, 'Over'),
        );
        const snapshot = probeLayout(OPTIONS);
        expect(snapshot.legal.logos).toHaveLength(2);
        expect(snapshot.legal.attributions[0]?.samples.every((sample) => !sample.ok)).toBe(true);
        expect(checksOf(snapshot).filter((check) => check === 'legal')).toHaveLength(2);
    });

    test('happyPath_aMapScrolledPastItsFootOwesNoLogoUntilItShowsIt', () => {
        const scroller = h(
            'div',
            { style: at(0, 0, 400, 300, 'overflow: auto;') },
            h('canvas', { class: 'map', style: 'display: block; width: 380px; height: 500px;' }),
            h('div', { style: 'height: 400px;' }),
        );
        stage(scroller);

        const cut = probeLayout(OPTIONS);
        scroller.scrollTop = 300;
        const footInView = probeLayout(OPTIONS);

        expect([cut.legal.map, footInView.legal.map]).toEqual([false, true]);
        expect(checksOf(footInView).filter((check) => check === 'legal')).toHaveLength(2);
    });

    test('happyPath_aStripOfTheMapBelowItsLegalControlsOwesNoLogo', () => {
        const scroller = h(
            'div',
            { style: at(0, 0, 400, 300, 'overflow: auto;') },
            h(
                'div',
                { style: 'position: relative; width: 380px; height: 500px;' },
                h('canvas', { class: 'map', style: 'display: block; width: 380px; height: 500px;' }),
                h(
                    'a',
                    { href: '#', class: 'logo', style: 'position: absolute; left: 10px; bottom: 6px; width: 80px; height: 20px;' },
                    'Mapbox',
                ),
                h('div', { class: 'attrib', style: 'position: absolute; right: 0; bottom: 10px; width: 80px; height: 20px;' }, '© Mapbox'),
            ),
            h('div', { style: 'height: 296px;' }),
        );
        stage(scroller);

        // Scrolled to the end: the map's last 4 px show, under its logo (6 px above the foot).
        scroller.scrollTop = 496;
        const strip = probeLayout(OPTIONS);
        // 10 px show: the logo's lowest pixels are on screen, so the rule asks for it (and finds it); the attribution,
        // 10 px above the foot, is not reached yet, so it is not owed (lesson 163).
        scroller.scrollTop = 490;
        const band = probeLayout(OPTIONS);
        // 14 px show: both are reached, and both found.
        scroller.scrollTop = 486;
        const both = probeLayout(OPTIONS);

        expect([strip.legal.map, band.legal.map, both.legal.map]).toEqual([false, true, true]);
        expect([band.legal.owes, both.legal.owes]).toEqual([
            { logo: true, attribution: false },
            { logo: true, attribution: true },
        ]);
        expect(checksOf(band).filter((check) => check === 'legal')).toEqual([]);
        expect(checksOf(both).filter((check) => check === 'legal')).toEqual([]);
    });

    test('badPath_thePageScrollsSideways', () => {
        stage(h('div', { style: 'position: absolute; left: 0; top: 0; width: 1200px; height: 10px;' }));
        document.body.style.overflowX = 'auto';
        const wide = h('div', { style: 'width: 1200px; height: 1px;' });
        document.body.append(wide);
        const snapshot = probeLayout(OPTIONS);
        wide.remove();
        expect(snapshot.page.scrollWidth).toBeGreaterThan(800);
        expect(checksOf(snapshot)).toContain('page-scroll');
    });
});

describe('sideways scrolling inside the page', () => {
    test('badPath_aBoxScrollingOnlyDownStillScrollsSideways_happyPath_oneThatFitsDoesNot', () => {
        // `overflow-y: auto` makes the inline axis scroll too: a row wider than the box then scrolls sideways.
        const row = h(
            'div',
            { style: 'width: 260px; height: 20px;' },
            h('span', { style: 'display: inline-block; width: 260px;' }, 'Întunecată'),
        );
        const dialog = h('div', { style: at(0, 0, 200, 100, 'overflow-y: auto;') }, row);
        const fits = h('div', { style: at(300, 0, 200, 100, 'overflow-y: auto;') }, h('p', { style: 'margin: 0' }, 'Temă'));
        stage(dialog, fits);
        const snapshot = probeLayout(OPTIONS);
        expect(snapshot.sideways).toHaveLength(1);
        expect(snapshot.sideways[0]?.overflow).toBe(60);
        expect(snapshot.sideways[0]?.culprits.map((id) => snapshot.nodes[id]?.selector)).toEqual([expect.stringContaining('span')]);
        expect(sidewaysCulprits(fits)).toEqual([]);
        expect(checksOf(snapshot)).toContain('sideways-scroll');
    });

    test('happyPath_aRowMadeToScrollSidewaysOnlyIsNoFault', () => {
        // The lying timeline of many years: `overflow: auto hidden`, one row that scrolls sideways and never down.
        const years = h('div', { style: 'width: 600px; height: 20px;' }, 'Anii');
        const row = h('div', { style: at(0, 0, 200, 40, 'overflow: auto hidden;') }, years);
        stage(row);
        const snapshot = probeLayout(OPTIONS);
        expect(snapshot.sideways).toEqual([]);
        expect(checksOf(snapshot)).not.toContain('sideways-scroll');
    });
});

describe('edge cases of the probes', () => {
    test('happyPath_aHiddenModalBoxIsNoSurface_andAPointNothingTakesHitsNothing', () => {
        stage(h('section', { 'aria-modal': 'true', style: 'display: none;' }));
        expect(modalSurfaces()).toEqual([]);
        const button = h('button', { style: at(0, 0, 50, 50) }, 'x');
        stage(button);
        const registry = { elements: [], ids: new Map() };
        expect(sampleElement(registry, button, true)).toEqual([{ x: 25, y: 25, hit: 0, ok: true, pinned: false }]);
        expect(idOrNull(registry, null)).toBeNull();
        expect(idOrNull(registry, button)).toBe(0);
        expect(sampleElement(registry, h('button'), true)).toEqual([]);
        expect(showsThrough(button, null)).toBe(false);
    });

    test('badPath_aSheetOverTheCentreOfALargeSurfaceLeavesItReachableElsewhere_butOneOverAllOfItDoesNot', () => {
        const canvas = h('canvas', { style: at(0, 0, 200, 100) });
        const sheet = h('section', { style: at(0, 40, 200, 60) });
        stage(h('div', {}, canvas, sheet));
        const registry = { elements: [], ids: new Map() };

        const [reached] = sampleElement(registry, canvas, true);
        expect([reached?.x, reached?.y, reached?.ok]).toEqual([40, 20, true]);
        sheet.setAttribute('style', at(0, 0, 200, 100));
        const [covered] = sampleElement(registry, canvas, true);
        expect([covered?.x, covered?.y, covered?.ok]).toEqual([100, 50, false]);
    });

    test('happyPath_aMapsOwnControlsOverItsCanvasDoNotCoverIt_butAnotherElementDoes', () => {
        const canvas = h('canvas', { style: at(0, 0, 200, 100) });
        const attribution = h('a', { style: at(0, 0, 200, 100) }, '© Mapbox');
        const map = h(
            'div',
            { class: 'mapboxgl-map' },
            h('div', { class: 'mapboxgl-canvas-container' }, canvas),
            h('div', { class: 'mapboxgl-control-container' }, attribution),
        );
        stage(map);
        const registry = { elements: [], ids: new Map() };
        expect(sampleElement(registry, canvas, true)).toEqual([{ x: 100, y: 50, hit: 0, ok: true, pinned: false }]);
        expect(ownMapControl(canvas, attribution)).toBe(true);
        expect(ownMapControl(canvas, h('div'))).toBe(false);
        expect(ownMapControl(h('button'), attribution)).toBe(false);
    });

    test('happyPath_aRoundControlScrolledToAStripIsSampledInsideItsShape_butACoveredOneStillMisses', () => {
        // A round 48 px button whose top 8 px show above the scroller's edge: its strip's corners lie outside the circle.
        const round = h('button', { style: at(16, 0, 48, 48, 'border-radius: 50%; border: 0;') });
        const scroller = h('div', { style: at(0, 100, 200, 8, 'overflow: auto;') }, h('div', { style: at(0, 0, 200, 400) }, round));
        const square = h('button', { style: at(100, 0, 48, 48) }, 'x');
        const cover = h('div', { style: at(100, 0, 20, 48, 'background: white;') });
        stage(scroller, square, cover);
        const registry = { elements: [], ids: new Map() };

        expect(sampleElement(registry, round, false).every((sample) => sample.ok)).toBe(true);
        expect(sampleElement(registry, square, false).some((sample) => !sample.ok)).toBe(true);
    });

    test('happyPath_roundedCornersInPercentPixelsAndEllipses', () => {
        const box = new DOMRect(0, 0, 48, 24);
        expect(cornerRadius('50%', 48)).toBe(24);
        expect(cornerRadius('9999px', 24)).toBe(12);
        expect(cornerRadius('none', 24)).toBe(0);
        expect(cutCorner('24px 12px', box, [0, 0, 1, 1], 1, 1)).toBe(true);
        expect(cutCorner('24px 12px', box, [0, 0, 1, 1], 20, 10)).toBe(false);
        expect(cutCorner('0px', box, [0, 0, 1, 1], 1, 1)).toBe(false);
        const round = h('div', { style: at(0, 0, 40, 40, 'border-radius: 50%;') });
        stage(round);
        expect([withinShape(round, 1, 1), withinShape(round, 20, 20), withinShape(round, 39, 39)]).toEqual([false, true, false]);
    });

    test('happyPath_aTouchTargetWithoutItsPseudoElementSize', () => {
        const target = h('button', { class: 'touch-target', style: at(0, 0, 20, 30) });
        stage(target);
        expect(targetSizeOf(target)).toEqual({ width: 20, height: 30 });
    });

    test('happyPath_cutsAcrossAndAlong_andAHorizontalScrollerCutsNothing', () => {
        const across = h('button', { style: at(80, 0, 50, 20) }, 'x');
        const clip = h('div', { style: at(0, 0, 100, 50, 'overflow-x: clip;') }, across);
        const along = h('button', { style: at(80, 0, 50, 20) }, 'y');
        const scroller = h('div', { style: at(0, 100, 100, 50, 'overflow-x: auto; overflow-y: hidden;') }, along);
        stage(clip, scroller);
        expect(cutterOf(across)).toBe(clip);
        expect(cutterOf(along)).toBeNull();
    });

    test('happyPath_anInlineLinkInASentence_andOneAtTheTopOfAShadowRoot', () => {
        const inSentence = h('a', { href: '#' }, 'here');
        const top = h('a', { href: '#', style: 'display: inline;' }, 'top');
        stage(h('p', { style: at(0, 0, 300, 20) }, 'Read ', inSentence, '.'), host('t-links', { style: at(0, 40, 300, 20) }, [top]));
        const snapshot = probeLayout(OPTIONS);
        expect(snapshot.interactives.map((control) => control.inline)).toEqual([true, false]);
    });

    test('happyPath_linesCutAwayAndATextTallerThanItsBox', () => {
        const text = h('p', { style: at(0, 0, 60, 20, 'overflow: hidden;') }, 'many words over several lines here');
        stage(text);
        expect(textLines(text, { x: 0, y: 0, width: 60, height: 20 })).toHaveLength(1);
        expect(cutsContent(text)).toBe(true);
    });
});

describe('movingAnimations', () => {
    test('happyPath_aFiniteAnimationCountsUntilItEnds_andAnEndlessOneNever', () => {
        const moving = h('div', { style: at(0, 0, 10, 10) });
        const endless = h('div', { style: at(20, 0, 10, 10) });
        stage(moving, endless);
        const finite = moving.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 10_000 });
        endless.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 100, iterations: Infinity });
        expect(movingAnimations()).toBe(1);
        finite.finish();
        expect(movingAnimations()).toBe(0);
    });
});
