import { describe, expect, test } from 'vitest';

import { boxText, elementText, outlineSvg, violationLines, type Violation } from '../support/violations.js';

/** e2e/support/violations.ts: how a violation names its elements, and the outline drawn over the screenshot. */

const COVERED: Violation = {
    check: 'occlusion',
    message: 'the menu is covered',
    elements: [
        { name: 'Meniu', selector: 'hcm-fab-menu > button.fab', box: { x: 10.4, y: 20.6, width: 56, height: 56 } },
        { name: '', selector: 'div.toast', box: null },
    ],
};

describe('naming', () => {
    test('happyPath_aBoxAnElementAndALine', () => {
        expect(boxText({ x: 10.4, y: 20.6, width: 56, height: 56.5 })).toBe('10,21 56x57');
        expect(boxText(null)).toBe('off screen');
        expect(elementText(COVERED.elements[0] ?? { name: '', selector: '', box: null })).toBe(
            '"Meniu" (hcm-fab-menu > button.fab) at 10,21 56x56',
        );
        expect(elementText({ name: '', selector: 'div', box: null })).toBe('(no name) (div) at off screen');
        expect(violationLines('viewer.home', [COVERED])).toEqual(['viewer.home: [occlusion] the menu is covered']);
    });
});

describe('outlineSvg', () => {
    test('happyPath_eachBoxOutlinedAndLabelled', () => {
        const svg = outlineSvg({ width: 360, height: 800 }, [COVERED, { ...COVERED, check: 'axe', message: 'x' }]);
        expect(svg).toContain('width="360" height="800"');
        expect(svg).toContain('<rect x="10.4" y="20.6" width="56" height="56" fill="none" stroke="#d50000"');
        expect(svg).toContain('>1.1 occlusion</text>');
        expect(svg).toContain('stroke="#c51162"');
        expect(svg.match(/<rect/g)).toHaveLength(2);
    });

    test('badPath_textFromThePageIsEscaped', () => {
        const svg = outlineSvg({ width: 10, height: 10 }, [{ ...COVERED, check: '<x&y>' as Violation['check'] }]);
        expect(svg).toContain('&lt;x&amp;y&gt;');
        expect(svg).not.toContain('<x&y>');
    });
});
