import { describe, expect, test } from 'vitest';

import type { Rect } from '../support/dom-walk.js';
import type { ChromeInfo, InteractiveInfo, LayoutSnapshot, NodeInfo, Sample, SidewaysInfo, TextInfo } from '../support/layout-probe.js';
import {
    clippedTextViolations,
    crossedSides,
    edgeViolations,
    gapBetween,
    gapViolations,
    isSanctioned,
    isTouchClass,
    layoutViolations,
    legalViolations,
    occlusionViolations,
    scrolledToASliver,
    overlapOf,
    overlapViolations,
    pageScrollViolations,
    sidewaysScrollViolations,
    refOf,
    related,
    textOverlapViolations,
    graphicOverlapViolations,
    usableChrome,
    windowClassOf,
    type LayoutContext,
} from '../support/layout-rules.js';

/** e2e/support/layout-rules.ts: the pure rules of the generic layout checker, on hand-made snapshots. */

const VIEWPORT = { width: 360, height: 800 };

function box(x: number, y: number, width: number, height: number): Rect {
    return { x, y, width, height };
}

function node(id: number, rect: Rect, extra: Partial<NodeInfo> = {}): NodeInfo {
    return { id, name: `n${String(id)}`, selector: `div.n${String(id)}`, box: rect, visible: rect, ancestors: [], ...extra };
}

const HIT_OK: Sample = { x: 10, y: 10, hit: 0, ok: true, pinned: false };

function control(nodeId: number, extra: Partial<InteractiveInfo> = {}): InteractiveInfo {
    return {
        node: nodeId,
        role: 'button',
        focusable: true,
        disabled: false,
        inert: false,
        ariaHidden: false,
        modal: 'none',
        samples: [HIT_OK],
        target: { width: 48, height: 48 },
        inline: false,
        thirdParty: false,
        screenReaderOnly: false,
        scrolls: { x: false, y: false },
        cutBy: null,
        ...extra,
    };
}

function chrome(nodeId: number, kind: string, extra: Partial<ChromeInfo> = {}): ChromeInfo {
    return { node: nodeId, kind, group: null, usable: true, ...extra };
}

function text(nodeId: number, lines: Rect[], extra: Partial<TextInfo> = {}): TextInfo {
    return { node: nodeId, lines, clipped: false, shown: true, scrolls: { x: false, y: false }, thirdParty: false, cutBy: null, ...extra };
}

function snapshot(extra: Partial<LayoutSnapshot>): LayoutSnapshot {
    return {
        viewport: VIEWPORT,
        page: { scrollWidth: 360, scrollsX: false, scrollsY: false },
        nodes: [],
        interactives: [],
        chrome: [],
        texts: [],
        sideways: [],
        graphics: [],
        legal: { map: false, owes: { logo: false, attribution: false }, logos: [], attributions: [] },
        modals: [],
        ...extra,
    };
}

const COMPACT: LayoutContext = { windowClass: 'compact', sanctioned: [{ over: 'menu', under: '*', why: 'popup' }] };

describe('geometry', () => {
    test('happyPath_overlapAndGap', () => {
        expect(overlapOf(box(0, 0, 10, 10), box(5, 5, 10, 10))).toEqual(box(5, 5, 5, 5));
        expect(overlapOf(box(0, 0, 10, 10), box(9.5, 0, 10, 10))).toBeNull();
        expect(gapBetween(box(0, 0, 10, 10), box(14, 0, 10, 10))).toBe(4);
        expect(gapBetween(box(0, 0, 10, 10), box(13, 14, 10, 10))).toBe(5);
        expect(gapBetween(box(0, 0, 10, 10), box(5, 5, 10, 10))).toBe(0);
    });

    test('happyPath_windowClasses', () => {
        expect([320, 600, 840, 1200, 1600].map((width) => windowClassOf(width))).toEqual([
            'compact',
            'medium',
            'expanded',
            'large',
            'extra-large',
        ]);
        expect(isTouchClass('medium')).toBe(true);
        expect(isTouchClass('expanded')).toBe(false);
    });

    test('happyPath_crossedSides', () => {
        expect(crossedSides(box(10, 10, 20, 20), VIEWPORT)).toBeNull();
        expect(crossedSides(box(350, 10, 20, 20), VIEWPORT)).toEqual({ x: true, y: false });
        expect(crossedSides(box(10, -5, 20, 20), VIEWPORT)).toEqual({ x: false, y: true });
        expect(crossedSides(box(400, 10, 20, 20), VIEWPORT)).toBeNull();
    });

    test('happyPath_anElementIsNamedByItsVisiblePartElseItsBox', () => {
        expect(refOf(node(0, box(1, 2, 3, 4), { visible: null })).box).toEqual(box(1, 2, 3, 4));
        expect(refOf(node(0, box(1, 2, 3, 4), { visible: box(1, 2, 3, 1) })).box).toEqual(box(1, 2, 3, 1));
    });

    test('happyPath_related', () => {
        const nodes = [node(0, box(0, 0, 1, 1)), node(1, box(0, 0, 1, 1), { ancestors: [0] })];
        expect(related(nodes, 0, 1)).toBe(true);
        expect(related(nodes, 1, 0)).toBe(true);
        expect(related(nodes, 0, 0)).toBe(true);
        expect(related(nodes, 0, 7)).toBe(false);
        expect(related(nodes, 7, 0)).toBe(false);
    });

    test('happyPath_sanctioned', () => {
        expect(isSanctioned(COMPACT.sanctioned, 'fab', 'menu')).toBe(true);
        expect(isSanctioned([{ over: 'sheet', under: 'fab', why: '' }], 'fab', 'sheet')).toBe(true);
        expect(isSanctioned([{ over: 'sheet', under: 'fab', why: '' }], 'chip', 'sheet')).toBe(false);
    });
});

describe('occlusionViolations', () => {
    test('happyPath_aControlOnTopPasses', () => {
        expect(occlusionViolations(snapshot({ nodes: [node(0, box(0, 0, 48, 48))], interactives: [control(0)] }))).toEqual([]);
    });

    test('badPath_aCoveredControlNamesWhatCoversIt', () => {
        const nodes = [node(0, box(0, 0, 48, 48), { name: 'Meniu' }), node(1, box(0, 0, 100, 100), { name: 'Timeline' })];
        const samples: Sample[] = [HIT_OK, { x: 40, y: 40, hit: 1, ok: false, pinned: false }];
        const [violation] = occlusionViolations(snapshot({ nodes, interactives: [control(0, { samples })] }));
        expect(violation?.check).toBe('occlusion');
        expect(violation?.message).toContain('"Meniu"');
        expect(violation?.message).toContain('1 of 2 sampled points (first at 40,40) hit "Timeline"');
        expect(violation?.elements).toHaveLength(2);
    });

    test('happyPath_aSliverAtTheEdgeOfWhatScrollsIsScrolledIntoView_badPath_aSliverThatCannotScrollIsCovered', () => {
        // CR-M2c-29: 4 px of a field at the bottom of a dialog's scrolling content hit the actions below the clip.
        const hidden = [{ x: 10, y: 706, hit: 1, ok: false, pinned: false }];
        const nodes = [
            node(0, box(0, 660, 300, 48), { visible: box(0, 704, 300, 4), name: 'Atribuire' }),
            node(1, box(0, 708, 300, 72), { name: 'Acțiuni' }),
            node(2, box(0, 0, 4, 300), { visible: box(0, 0, 3, 300), name: 'Bara' }),
        ];
        const cut = (scrolls: { x: boolean; y: boolean }, id = 0): InteractiveInfo => control(id, { samples: hidden, scrolls });
        expect(occlusionViolations(snapshot({ nodes, interactives: [cut({ x: false, y: true })] }))).toEqual([]);
        // A box that is itself only 3 px wide is no sliver of something larger: it is checked as it is.
        expect(occlusionViolations(snapshot({ nodes, interactives: [cut({ x: true, y: false }, 2)] }))).toHaveLength(1);
        const [field = node(9, box(0, 0, 1, 1))] = nodes;
        expect(scrolledToASliver(cut({ x: true, y: false }), field)).toBe(false);
        expect(scrolledToASliver(cut({ x: false, y: true }), { ...field, visible: null })).toBe(false);
        expect(occlusionViolations(snapshot({ nodes, interactives: [cut({ x: false, y: false })] }))[0]?.message).toMatch(
            /^"Atribuire" .* is covered/,
        );
    });

    test('badPath_aPointOutsideThePageHitsNothing', () => {
        const samples: Sample[] = [{ x: 1, y: 1, hit: null, ok: false, pinned: false }];
        const [violation] = occlusionViolations(
            snapshot({ nodes: [node(0, box(0, 0, 4, 4), { name: '' })], interactives: [control(0, { samples })] }),
        );
        expect(violation?.message).toContain('(no name)');
        expect(violation?.message).toContain('hit nothing of the page');
    });

    test('badPath_aUsableControlOutsideAnOpenModal', () => {
        const nodes = [node(0, box(0, 0, 48, 48)), node(1, box(0, 400, 360, 400), { name: 'Straturi' })];
        const found = occlusionViolations(snapshot({ nodes, modals: [1], interactives: [control(0, { modal: 'outside' })] }));
        expect(found.map((violation) => violation.check)).toEqual(['modal-escape']);
        expect(found[0]?.message).toContain('outside the open modal "Straturi"');
    });

    test('happyPath_outsideAModalAnInertHiddenOrUnfocusableControlPasses', () => {
        const nodes = [node(0, box(0, 0, 48, 48))];
        for (const extra of [{ inert: true }, { ariaHidden: true }, { focusable: false }]) {
            expect(occlusionViolations(snapshot({ nodes, interactives: [control(0, { modal: 'outside', ...extra })] }))).toEqual([]);
        }
        expect(
            occlusionViolations(snapshot({ nodes, modals: [], interactives: [control(0, { modal: 'outside' })] }))[0]?.message,
        ).toContain('a modal surface');
    });

    test('happyPath_hiddenOffScreenAndScreenReaderOnlyControlsAreNotSampled', () => {
        const failing: Sample[] = [{ x: 1, y: 1, hit: null, ok: false, pinned: false }];
        const nodes = [node(0, box(0, 0, 48, 48)), node(1, box(0, 0, 48, 48), { visible: null })];
        const interactives = [
            control(0, { screenReaderOnly: true, samples: failing }),
            control(1, { samples: failing }),
            control(0, { inert: true, samples: failing }),
        ];
        expect(occlusionViolations(snapshot({ nodes, interactives }))).toEqual([]);
    });

    test('happyPath_scrolledUnderAFixedBarOrUnderTheOpenMenu_badPath_pinnedOverContentThatCannotScroll', () => {
        const nodes = [
            node(0, box(0, 0, 48, 48)),
            node(1, box(0, 0, 360, 60)),
            node(2, box(0, 0, 50, 50), { ancestors: [3] }),
            node(3, box(0, 0, 200, 200)),
        ];
        const pinned: Sample[] = [{ x: 10, y: 10, hit: 1, ok: false, pinned: true }];
        const underMenu: Sample[] = [{ x: 10, y: 10, hit: 2, ok: false, pinned: false }];
        const scrolling = (axis: 'x' | 'y'): InteractiveInfo =>
            control(0, { samples: pinned, scrolls: { x: axis === 'x', y: axis === 'y' } });
        const chrome = [{ node: 3, kind: 'menu', group: null, usable: true }];
        expect(occlusionViolations(snapshot({ nodes, interactives: [scrolling('y'), scrolling('x')] }))).toEqual([]);
        expect(
            occlusionViolations(snapshot({ nodes, chrome, interactives: [control(0, { samples: underMenu })] }), COMPACT.sanctioned),
        ).toEqual([]);
        expect(
            occlusionViolations(snapshot({ nodes, interactives: [control(0, { samples: underMenu })] }), COMPACT.sanctioned),
        ).toHaveLength(1);
        expect(occlusionViolations(snapshot({ nodes, interactives: [control(0, { samples: pinned })] }))).toHaveLength(1);
    });

    test('badPath_anUnknownNodeIsAProbeError', () => {
        expect(() => occlusionViolations(snapshot({ interactives: [control(3)] }))).toThrow('no element 3');
    });
});

describe('overlapViolations', () => {
    const nodes = [
        node(0, box(10, 700, 56, 56), { name: 'Meniu' }),
        node(1, box(40, 690, 300, 80), { name: 'Cronologie' }),
        node(2, box(10, 400, 200, 280), { name: 'menu' }),
        node(3, box(0, 600, 360, 200), { name: 'dock' }),
        node(4, box(0, 0, 50, 50), { visible: null }),
    ];

    test('badPath_theFabOverTheTimeline', () => {
        const found = overlapViolations(snapshot({ nodes, chrome: [chrome(0, 'fab'), chrome(1, 'timeline')] }), COMPACT);
        expect(found).toHaveLength(1);
        expect(found[0]?.message).toContain('fab "Meniu"');
        expect(found[0]?.message).toContain('overlaps timeline "Cronologie" (div.n1) at 40,690 300x80 by 40,700 26x56');
    });

    test('badPath_theOpenMenuOverTheTimeline_happyPath_overTheMapAndTheTopDocks', () => {
        // The visual audit at 768 px: the open menu's last item lay on the timeline's thumb, which `*` had allowed.
        const popup = [
            { over: 'menu', under: 'content', why: '' },
            { over: 'menu', under: 'banner', why: '' },
        ];
        const context = { ...COMPACT, sanctioned: popup };
        const low = [node(0, box(400, 540, 200, 160), { name: 'menu' }), node(1, box(100, 690, 520, 84), { name: 'Cronologie' })];
        const overTimeline = overlapViolations(snapshot({ nodes: low, chrome: [chrome(0, 'menu'), chrome(1, 'timeline')] }), context);
        expect(overTimeline.map((violation) => violation.message)).toEqual([expect.stringContaining('menu "menu"')]);
        expect(overlapViolations(snapshot({ nodes: low, chrome: [chrome(0, 'menu'), chrome(1, 'banner')] }), context)).toEqual([]);
        // A marker on the map under the menu is not covered for good: the popup closes.
        const marker = [...nodes, node(5, box(20, 410, 40, 40)), node(6, box(20, 410, 40, 40), { ancestors: [2] })];
        const under: Sample[] = [{ x: 40, y: 430, hit: 6, ok: false, pinned: false }];
        const snap = snapshot({ nodes: marker, chrome: [chrome(2, 'menu')], interactives: [control(5, { samples: under })] });
        expect(occlusionViolations(snap, popup)).toEqual([]);
    });

    test('happyPath_theOpenMenuIsSanctionedAndAContainerStandsAside', () => {
        const withContainer = nodes.map((entry) => (entry.id === 0 || entry.id === 1 ? { ...entry, ancestors: [3] } : entry));
        const items = [
            chrome(2, 'menu'),
            chrome(1, 'timeline'),
            chrome(3, 'marked'),
            chrome(0, 'fab', { usable: false }),
            chrome(4, 'chip'),
        ];
        expect(overlapViolations(snapshot({ nodes: withContainer, chrome: items }), COMPACT)).toEqual([]);
        expect(usableChrome(snapshot({ nodes: withContainer, chrome: items })).map((item) => item.kind)).toEqual(['menu', 'timeline']);
    });
});

describe('gapViolations', () => {
    const nodes = [
        node(0, box(10, 700, 56, 56), { name: 'Meniu' }),
        node(1, box(70, 700, 100, 40), { name: 'chip' }),
        node(2, box(200, 700, 100, 40)),
    ];

    test('badPath_twoTargetsCloserThan8px', () => {
        const interactives = [control(0), control(1)];
        const found = gapViolations(snapshot({ nodes, interactives, chrome: [chrome(0, 'fab'), chrome(1, 'chip')] }), COMPACT);
        expect(found.map((violation) => violation.check)).toEqual(['gap']);
        expect(found[0]?.message).toContain('is 4.0 px from chip');
    });

    test('happyPath_farEnoughOneComponentLargeWindowsOrNoTarget', () => {
        const interactives = [control(0), control(1)];
        const close = { nodes, interactives, chrome: [chrome(0, 'fab', { group: 9 }), chrome(1, 'chip', { group: 9 })] };
        expect(gapViolations(snapshot(close), COMPACT)).toEqual([]);
        expect(
            gapViolations(snapshot({ nodes, interactives, chrome: [chrome(0, 'fab'), chrome(1, 'chip')] }), {
                ...COMPACT,
                windowClass: 'large',
            }),
        ).toEqual([]);
        expect(
            gapViolations(snapshot({ nodes, interactives: [control(0)], chrome: [chrome(0, 'fab'), chrome(1, 'chip')] }), COMPACT),
        ).toEqual([]);
        expect(
            gapViolations(
                snapshot({ nodes, interactives: [control(0), control(2)], chrome: [chrome(0, 'fab'), chrome(2, 'chip')] }),
                COMPACT,
            ),
        ).toEqual([]);
        const sanctioned = { ...COMPACT, sanctioned: [{ over: 'fab', under: 'chip', why: '' }] };
        expect(gapViolations(snapshot({ nodes, interactives, chrome: [chrome(0, 'fab'), chrome(1, 'chip')] }), sanctioned)).toEqual([]);
    });

    test('happyPath_overlappingChromeIsTheOverlapCheckNotTheGapCheck', () => {
        const overlapping = [node(0, box(0, 0, 50, 50)), node(1, box(10, 10, 50, 50))];
        const found = gapViolations(
            snapshot({ nodes: overlapping, interactives: [control(0), control(1)], chrome: [chrome(0, 'fab'), chrome(1, 'chip')] }),
            COMPACT,
        );
        expect(found).toEqual([]);
    });

    test('happyPath_aTargetInsideTheChromeCounts', () => {
        const inside = [...nodes, node(3, box(75, 705, 40, 30), { ancestors: [1] })];
        const found = gapViolations(
            snapshot({ nodes: inside, interactives: [control(0), control(3)], chrome: [chrome(0, 'fab'), chrome(1, 'chip')] }),
            COMPACT,
        );
        expect(found).toHaveLength(1);
    });
});

describe('edgeViolations', () => {
    test('badPath_aControlAndATextPartlyOffScreen', () => {
        const nodes = [node(0, box(340, 10, 48, 48), { name: 'Închide' }), node(1, box(-10, 100, 100, 20), { name: 'text' })];
        const found = edgeViolations(snapshot({ nodes, interactives: [control(0)], texts: [text(1, [box(0, 100, 90, 20)])] }));
        expect(found.map((violation) => violation.message)).toEqual([
            'control "Închide" (div.n0) at 340,10 48x48 is partly outside the 360x800 viewport',
            'text "text" (div.n1) at -10,100 100x20 is partly outside the 360x800 viewport',
        ]);
    });

    test('happyPath_scrolledIntoViewOnThatAxisOrUnusable', () => {
        const nodes = [node(0, box(10, 790, 48, 48)), node(1, box(340, 10, 48, 48)), node(2, box(340, 10, 48, 48))];
        const interactives = [
            control(0, { scrolls: { x: false, y: true } }),
            control(1, { inert: true }),
            control(2, { modal: 'outside' }),
            control(0, { scrolls: { x: false, y: true } }),
        ];
        expect(edgeViolations(snapshot({ nodes, interactives }))).toEqual([]);
    });

    test('badPath_scrollingOnTheOtherAxisDoesNotHelp_andEachElementIsNamedOnce', () => {
        const nodes = [node(0, box(340, 10, 48, 48))];
        const found = edgeViolations(
            snapshot({ nodes, interactives: [control(0, { scrolls: { x: false, y: true } })], texts: [text(0, [])] }),
        );
        expect(found).toHaveLength(1);
    });
});

describe('sidewaysScrollViolations', () => {
    test('badPath_aDialogScrollsSideways_namingWhatSticksOut_happyPath_nothingDoes', () => {
        // The visual audit at 360 px: the account menu's theme choice ran 48 px past the dialog, which scrolled sideways.
        const nodes = [node(0, box(24, 100, 312, 400), { name: 'Contul' }), node(1, box(48, 300, 336, 40), { name: 'Temă' })];
        const sideways: SidewaysInfo[] = [{ node: 0, overflow: 48.4, culprits: [1] }];
        const [violation, ...rest] = sidewaysScrollViolations(snapshot({ nodes, sideways }));
        expect(rest).toEqual([]);
        expect(violation?.check).toBe('sideways-scroll');
        expect(violation?.message).toContain(
            '"Contul" (div.n0) at 24,100 312x400 scrolls sideways, its content 48 px wider than it: "Temă"',
        );
        expect(violation?.elements).toHaveLength(2);
        const [ring] = sidewaysScrollViolations(snapshot({ nodes, sideways: [{ node: 0, overflow: 4, culprits: [] }] }));
        expect(ring?.message).toMatch(/4 px wider than it$/);
        expect(sidewaysScrollViolations(snapshot({ nodes }))).toEqual([]);
    });
});

describe('pageScrollViolations', () => {
    test('badPath_theWidestElementsAreNamed', () => {
        const nodes = [node(0, box(0, 0, 500, 10), { name: 'wide' }), node(1, box(0, 0, 10, 10))];
        const [violation] = pageScrollViolations(snapshot({ nodes, page: { scrollWidth: 500, scrollsX: true, scrollsY: false } }));
        expect(violation?.message).toBe('the page scrolls 140 px sideways: "wide" (div.n0) at 0,0 500x10');
    });

    test('badPath_withoutACulprit_andHappyPath_noScroll', () => {
        expect(pageScrollViolations(snapshot({ page: { scrollWidth: 400, scrollsX: true, scrollsY: false } }))[0]?.message).toBe(
            'the page scrolls 40 px sideways',
        );
        expect(pageScrollViolations(snapshot({}))).toEqual([]);
    });
});

describe('legalViolations', () => {
    const nodes = [
        node(0, box(8, 770, 88, 23), { name: 'Mapbox' }),
        node(1, box(300, 770, 50, 24), { name: 'attribution' }),
        node(2, box(0, 700, 360, 100), { name: 'sheet' }),
    ];

    const OWES_BOTH = { logo: true, attribution: true };

    test('happyPath_oneOfEachUncovered_orNoMap', () => {
        const legal = {
            map: true,
            owes: OWES_BOTH,
            logos: [{ node: 0, samples: [HIT_OK] }],
            attributions: [{ node: 1, samples: [HIT_OK] }],
        };
        expect(legalViolations(snapshot({ nodes, legal }))).toEqual([]);
        expect(legalViolations(snapshot({ nodes, legal: { ...legal, map: false, logos: [] } }))).toEqual([]);
    });

    test('happyPath_aStripThatReachesTheAttributionOnlyOwesNoLogo_badPath_twoLogosStillTooMany', () => {
        // The map's last few pixels show the attribution on its foot, not the logo 10 px above it (lesson 163).
        const legal = { map: true, owes: { logo: false, attribution: true }, logos: [], attributions: [{ node: 1, samples: [HIT_OK] }] };
        const twice = {
            ...legal,
            logos: [
                { node: 0, samples: [HIT_OK] },
                { node: 0, samples: [HIT_OK] },
            ],
        };

        expect(legalViolations(snapshot({ nodes, legal }))).toEqual([]);
        expect(legalViolations(snapshot({ nodes, legal: twice })).map((violation) => violation.message)).toEqual([
            '2 visible Mapbox logos instead of exactly one (Mapbox terms)',
        ]);
    });

    test('badPath_aMissingLogoAndACoveredAttribution', () => {
        const legal = {
            map: true,
            owes: OWES_BOTH,
            logos: [],
            attributions: [{ node: 1, samples: [{ x: 310, y: 780, hit: 2, ok: false, pinned: false }] }],
        };
        const found = legalViolations(snapshot({ nodes, legal })).map((violation) => violation.message);
        expect(found).toEqual([
            '0 visible Mapbox logos instead of exactly one (Mapbox terms)',
            'the map attribution "attribution" (div.n1) at 300,770 50x24 is covered: 1 of 1 sampled points (first at 310,780) hit "sheet" (div.n2) at 0,700 360x100',
        ]);
    });
});

describe('text rules', () => {
    test('badPath_aClippedLabel_butNotMapboxsCollapsedAttribution', () => {
        const nodes = [node(0, box(0, 0, 50, 20), { name: 'Straturi' }), node(1, box(0, 30, 50, 20))];
        const found = clippedTextViolations(
            snapshot({ nodes, texts: [text(0, [], { clipped: true }), text(1, [], { clipped: true, thirdParty: true })] }),
        );
        expect(found.map((violation) => violation.message)).toEqual(['"Straturi" (div.n0) at 0,0 50x20 cuts its text']);
    });

    test('badPath_twoTextsRunningOverEachOther_happyPath_nestedOrHidden', () => {
        const nodes = [
            node(0, box(0, 0, 100, 20), { name: 'a' }),
            node(1, box(50, 5, 100, 20), { name: 'b' }),
            node(2, box(60, 5, 10, 10), { ancestors: [0] }),
        ];
        const texts = [text(0, [box(0, 0, 100, 20)]), text(1, [box(50, 5, 100, 20)]), text(2, [box(60, 5, 10, 10)])];
        const found = textOverlapViolations(snapshot({ nodes, texts }));
        expect(found.map((violation) => violation.message)).toEqual([
            'the text of "a" (div.n0) at 0,0 100x20 runs over "b" (div.n1) at 50,5 100x20 at 50,5 50x15',
            'the text of "b" (div.n1) at 50,5 100x20 runs over "n2" (div.n2) at 60,5 10x10 at 60,5 10x10',
        ]);
        const hidden = texts.map((entry) => (entry.node === 1 ? { ...entry, shown: false } : entry));
        expect(textOverlapViolations(snapshot({ nodes, texts: hidden }))).toEqual([]);
    });
});

describe('graphicOverlapViolations (M6, finding 6)', () => {
    test('badPath_anIndicatorDrawnOverALabel_happyPath_clearOfItOrItsOwnText', () => {
        const nodes = [
            node(0, box(0, 0, 38, 38), { name: 'Working' }),
            node(1, box(22, 10, 60, 20), { name: 'To do' }),
            node(2, box(100, 0, 14, 14), { name: 'Working' }),
            node(3, box(4, 4, 10, 10), { ancestors: [0] }),
        ];
        const texts = [text(1, [box(22, 10, 60, 20)]), text(3, [box(4, 4, 10, 10)])];
        const found = graphicOverlapViolations(snapshot({ nodes, texts, graphics: [{ node: 0 }, { node: 2 }] }));
        expect(found.map((violation) => violation.message)).toEqual([
            'the loading indicator "Working" (div.n0) at 0,0 38x38 is drawn over the text of "To do" (div.n1) at 22,10 60x20 at 22,10 16x20',
        ]);
        expect(found[0]?.check).toBe('graphic-overlap');
        const hidden = nodes.map((entry) => (entry.id === 0 ? { ...entry, visible: null } : entry));
        expect(graphicOverlapViolations(snapshot({ nodes: hidden, texts, graphics: [{ node: 0 }] }))).toHaveLength(1);
    });
});

describe('layoutViolations', () => {
    test('happyPath_aSoundPageHasNone_badPath_everyRuleReports', () => {
        expect(layoutViolations(snapshot({}), COMPACT)).toEqual([]);
        const nodes = [node(0, box(350, 0, 48, 48))];
        const checks = layoutViolations(
            snapshot({ nodes, interactives: [control(0)], page: { scrollWidth: 400, scrollsX: true, scrollsY: false } }),
            COMPACT,
        ).map((violation) => violation.check);
        expect(checks).toEqual(['edge', 'page-scroll']);
    });
});
