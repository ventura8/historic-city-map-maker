import { describe, expect, test } from 'vitest';

import type { ControlContrast, ExpectedStop, FocusEntry, FocusStop, Landmark } from '../support/a11y-probe.js';
import {
    announced,
    circleMeets,
    contrastViolations,
    coverageViolations,
    distinctRuns,
    focusViolations,
    holds,
    landmarkViolations,
    liveRegionViolations,
    orderViolations,
    pointerTargets,
    roundOf,
    stopsOf,
    stopViolations,
    targetSizeViolations,
} from '../support/a11y-rules.js';
import type { Rect } from '../support/dom-walk.js';
import type { InteractiveInfo, LayoutSnapshot, NodeInfo } from '../support/layout-probe.js';

/** e2e/support/a11y-rules.ts: the pure rules of the generic accessibility checker. */

function box(x: number, y: number, width: number, height: number): Rect {
    return { x, y, width, height };
}

function node(id: number, rect: Rect, extra: Partial<NodeInfo> = {}): NodeInfo {
    return { id, name: `n${String(id)}`, selector: `button.n${String(id)}`, box: rect, visible: rect, ancestors: [], ...extra };
}

function control(nodeId: number, size: number, extra: Partial<InteractiveInfo> = {}): InteractiveInfo {
    return {
        node: nodeId,
        role: 'button',
        focusable: true,
        disabled: false,
        inert: false,
        ariaHidden: false,
        modal: 'none',
        samples: [],
        target: { width: size, height: size },
        inline: false,
        thirdParty: false,
        screenReaderOnly: false,
        scrolls: { x: false, y: false },
        cutBy: null,
        ...extra,
    };
}

function snapshot(nodes: NodeInfo[], interactives: InteractiveInfo[]): LayoutSnapshot {
    return {
        viewport: { width: 360, height: 800 },
        page: { scrollWidth: 360, scrollsX: false, scrollsY: false },
        nodes,
        interactives,
        chrome: [],
        sideways: [],
        graphics: [],
        texts: [],
        legal: { map: false, owes: { logo: false, attribution: false }, logos: [], attributions: [] },
        modals: [],
    };
}

function stop(id: number, extra: Partial<FocusStop> = {}): FocusStop {
    return {
        id,
        name: `s${String(id)}`,
        selector: `button.s${String(id)}`,
        box: box(0, id * 50, 48, 48),
        scope: 'hcm-map-viewer',
        modal: 'none',
        content: { top: id * 50, bottom: id * 50 + 48 },
        ring: true,
        ringContrast: 4,
        obscured: false,
        ringCutBy: null,
        ...extra,
    };
}

function expected(id: number): ExpectedStop {
    return { id, name: `s${String(id)}`, selector: `button.s${String(id)}`, box: null };
}

describe('target sizes', () => {
    test('happyPath_geometry', () => {
        expect(holds(box(0, 0, 100, 100), box(10, 10, 20, 20))).toBe(true);
        expect(holds(box(0, 0, 100, 100), box(90, 10, 20, 20))).toBe(false);
        expect(circleMeets(box(0, 0, 20, 20), 12, box(21, 0, 10, 10))).toBe(true);
        expect(circleMeets(box(0, 0, 20, 20), 12, box(40, 40, 10, 10))).toBe(false);
    });

    test('happyPath_targetsLeaveOutWhatNobodyCanUse', () => {
        const nodes = [node(0, box(0, 0, 48, 48)), node(1, box(100, 0, 48, 48), { visible: null }), node(2, box(200, 0, 48, 48))];
        const targets = pointerTargets(
            snapshot(nodes, [control(0, 48), control(1, 48), control(2, 48, { disabled: true }), control(5, 48)]),
        );
        expect(targets.map((target) => target.node)).toEqual([0]);
        expect(targets[0]?.box).toEqual(box(0, 0, 48, 48));
    });

    test('badPath_anUndersizedTargetTooCloseToAnother', () => {
        const nodes = [node(0, box(0, 0, 20, 20), { name: 'small' }), node(1, box(21, 0, 48, 48))];
        const found = targetSizeViolations(snapshot(nodes, [control(0, 20), control(1, 48)]), 'large');
        expect(found.map((violation) => violation.message)).toEqual([
            '"small" (button.n0) at 0,0 20x20 is a 20x20 pointer target, under 24 x 24 and too close to another (WCAG 2.5.8)',
        ]);
    });

    test('badPath_twoUndersizedTargetsWhoseCirclesMeet', () => {
        const nodes = [node(0, box(0, 0, 20, 20)), node(1, box(23, 0, 20, 20))];
        expect(targetSizeViolations(snapshot(nodes, [control(0, 20), control(1, 20)]), 'large')).toHaveLength(2);
    });

    test('happyPath_spacedEnoughOnTheMapsCanvasOrInlineOrLargeEnough', () => {
        const nodes = [
            node(0, box(100, 100, 20, 20)),
            node(1, box(0, 0, 360, 800)),
            node(2, box(200, 200, 10, 10)),
            node(3, box(300, 300, 30, 30)),
        ];
        const interactives = [control(0, 20), control(1, 360), control(2, 10, { inline: true }), control(3, 30)];
        expect(targetSizeViolations(snapshot(nodes, interactives), 'large')).toEqual([]);
    });

    test('badPath_underM3s48OnCompactButNotMapboxsOwn', () => {
        const nodes = [node(0, box(0, 0, 40, 40), { name: 'Închide' }), node(1, box(200, 0, 40, 40))];
        const found = targetSizeViolations(snapshot(nodes, [control(0, 40), control(1, 40, { thirdParty: true })]), 'compact');
        expect(found.map((violation) => violation.message)).toEqual([
            '"Închide" (button.n0) at 0,0 40x40 is a 40x40 touch target, under M3\'s 48 x 48 on a compact window',
        ]);
        expect(targetSizeViolations(snapshot(nodes, [control(0, 40)]), 'expanded')).toEqual([]);
    });
});

describe('the Tab walk', () => {
    test('happyPath_aRoundIsTheStopsUntilTheFirstComesBack', () => {
        const walk: FocusEntry[] = [stop(1), { left: true }, stop(2), stop(1)];
        expect(stopsOf(walk).map((entry) => entry.id)).toEqual([1, 2, 1]);
        expect(roundOf(stopsOf(walk))?.map((entry) => entry.id)).toEqual([1, 2]);
        expect(roundOf([stop(1), stop(2)])).toBeNull();
    });

    test('happyPath_aFullRoundInOrderWithRings', () => {
        const walk = [stop(1), stop(2), stop(3), { left: true } as const, stop(1)];
        expect(focusViolations(walk, [expected(1), expected(2), expected(3)], false)).toEqual([]);
    });

    test('badPath_eachStopsDefects', () => {
        const checks = (entry: FocusStop, modal = false): string[] => stopViolations(entry, modal).map((violation) => violation.check);
        expect(checks(stop(1, { box: null, ring: false }))).toEqual(['focus-order', 'focus-ring']);
        expect(checks(stop(1, { obscured: true, ringContrast: 1.5 }))).toEqual(['focus-obscured', 'focus-ring']);
        expect(checks(stop(1, { ringContrast: null, modal: 'outside' }), true)).toEqual(['modal-escape']);
        expect(stopViolations(stop(1, { ringContrast: 2 }), false)[0]?.message).toContain('has 2.00:1 against its surroundings');
        // The visual audit: the drag handle's ring rose past the sheet's top edge, which hides its overflow.
        const cut = stopViolations(stop(1, { ringCutBy: 'hcm-sheet > section.sheet' }), false);
        expect(cut.map((violation) => violation.message)).toEqual([
            expect.stringContaining('is cut off by hcm-sheet > section.sheet, which hides its overflow'),
        ]);
        expect(checks(stop(1, { ring: false, ringCutBy: 'section.sheet' }))).toEqual(['focus-ring']);
    });

    test('badPath_climbingBackUpInsideOneComponent_happyPath_acrossComponentsOrColumns', () => {
        const down = stop(1);
        const up = stop(2, { content: { top: 0, bottom: 20 } });
        expect(orderViolations([down, up])[0]?.message).toContain('Tab goes back up from "s1"');
        expect(orderViolations([down, { ...up, scope: 'document' }])).toEqual([]);
        expect(orderViolations([down, { ...up, box: box(400, 0, 48, 48) }])).toEqual([]);
        expect(orderViolations([down, { ...up, box: null }])).toEqual([]);
    });

    test('happyPath_theFieldsOfOneNativeControlAreOneStop', () => {
        const walk = [stop(1), stop(2), stop(2), stop(2), stop(1)];
        expect(distinctRuns(walk).map((entry) => entry.id)).toEqual([1, 2, 1]);
        expect(focusViolations(walk, [expected(1), expected(2)], false)).toEqual([]);
    });

    test('badPath_reachedTwiceOrNever', () => {
        const found = coverageViolations([stop(1), stop(2), stop(1)], [expected(1), expected(2), expected(3)]);
        expect(found.map((violation) => violation.message)).toEqual([
            'Tab reaches "s1" (button.s1) at 0,50 48x48 more than once in one round',
            'Tab never reaches "s3" (button.s3) at off screen',
        ]);
    });

    test('badPath_aTrapNoRoundAndNothingReached', () => {
        expect(focusViolations([stop(1), stop(2), stop(2), stop(2)], [], false).map((violation) => violation.check)).toEqual([
            'keyboard-trap',
        ]);
        expect(focusViolations([stop(1), stop(2), stop(3)], [], false)[0]?.message).toContain('Tab did not come back to "s1"');
        expect(focusViolations([{ left: true }], [expected(1)], false)[0]?.message).toBe('Tab reaches nothing on the page');
        expect(focusViolations([stop(1)], [], false)[0]?.message).toBe(
            'Tab did not come back to "s1" (button.s1) at 0,50 48x48 within 1 presses',
        );
        expect(focusViolations([], [], false)).toEqual([]);
    });

    test('badPath_tabLeavesThePageFromAnOpenModal', () => {
        const found = focusViolations([stop(1), { left: true }, stop(1)], [expected(1)], true);
        expect(found.map((violation) => violation.message)).toEqual(['Tab leaves the page from the open modal']);
        expect(focusViolations([{ left: true }], [], true).map((violation) => violation.check)).toEqual(['modal-escape']);
    });
});

describe('contrast, landmarks and announcements', () => {
    const contrast = (kind: ControlContrast['kind'], ratio: number): ControlContrast => ({
        kind,
        ratio,
        name: kind,
        selector: 'button',
        box: null,
    });

    test('badPath_controlsUnder3to1_happyPath_theOthers', () => {
        const found = contrastViolations(
            [contrast('state', 2), contrast('field', 1.2), contrast('icon', 2.9), contrast('icon', 3)],
            'dark high contrast',
        );
        expect(found.map((violation) => violation.message)).toEqual([
            '"state" (button) at off screen: its track, handle and border reach 2.00:1 against the background in dark high contrast (3:1)',
            '"field" (button) at off screen: its border reach 1.20:1 against the background in dark high contrast (3:1)',
            '"icon" (button) at off screen: its icon reach 2.90:1 against the background in dark high contrast (3:1)',
        ]);
    });

    test('badPath_unnamedAndSharedLandmarks_happyPath_aNamedOne', () => {
        const landmark = (role: string, name: string): Landmark => ({ role, name, selector: role, box: null });
        const found = landmarkViolations([
            landmark('navigation', ''),
            landmark('region', 'Hartă'),
            landmark('region', 'hartă'),
            landmark('main', ''),
            landmark('complementary', 'x'),
        ]);
        expect(found.map((violation) => violation.message)).toEqual([
            'the navigation landmark (no name) (navigation) at off screen has no name',
            'more than one region landmark is named "Hartă"',
        ]);
        expect(found[1]?.elements).toHaveLength(2);
    });

    test('happyPath_anAnnouncementFromARegionThatWasThere_badPath_aFreshPoliteRegion', () => {
        const log = [
            { politeness: 'polite', role: 'status', text: 'Linkul a fost copiat.', fresh: false },
            { politeness: 'polite', role: 'status', text: 'Fresh', fresh: true },
            { politeness: 'assertive', role: 'alert', text: 'Eroare', fresh: true },
            { politeness: 'off', role: '', text: 'Off', fresh: false },
        ];
        expect(announced(log, 'Linkul')).toBe(true);
        expect(announced(log, 'Eroare')).toBe(true);
        expect(announced(log, 'Fresh')).toBe(false);
        expect(announced(log, 'Off')).toBe(false);
        expect(liveRegionViolations(log, ['Linkul', 'Fresh']).map((violation) => violation.message)).toEqual([
            '"Fresh" is never announced by a live region that existed before it',
        ]);
    });
});
