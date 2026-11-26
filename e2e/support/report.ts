import { appendFile } from 'node:fs/promises';

import { test, type Page } from '@playwright/test';
import sharp from 'sharp';

import { outlineSvg, type Violation } from './violations.js';

/**
 * Where the tour's checkers put what they found (e2e/support/layout.ts, e2e/support/a11y.ts): every violation of a state
 * as a line of `layout-a11y-violations.jsonl` in the test's output folder (`reports/test-results*`, kept for a failing
 * test; the input of docs/research/layout-a11y-findings.md), and, for a state with violations, the JSON and a screenshot
 * with the boxes of the elements involved outlined, attached to the test (the HTML report shows both).
 */

/** The file of a test's output folder that collects its violations, one JSON object per line. */
const VIOLATIONS_FILE = 'layout-a11y-violations.jsonl';

/** One line of `VIOLATIONS_FILE`. */
interface ViolationRecord extends Violation {
    readonly project: string;
    readonly test: string;
    readonly state: string;
    readonly viewport: { readonly width: number; readonly height: number };
}

/**
 * Records `violations` of `state` and attaches them to the running test, with a screenshot of the page outlining their
 * elements (unless `screenshot` is false: a variant checked on a changed page, whose boxes the page no longer shows).
 */
export async function reportViolations(page: Page, state: string, violations: readonly Violation[], screenshot = true): Promise<void> {
    if (violations.length === 0) {
        return;
    }
    const info = test.info();
    const viewport = page.viewportSize() ?? { width: 0, height: 0 };
    const records = violations.map((violation): ViolationRecord => ({
        ...violation,
        project: info.project.name,
        test: info.title,
        state,
        viewport,
    }));
    await appendFile(info.outputPath(VIOLATIONS_FILE), records.map((record) => `${JSON.stringify(record)}\n`).join(''));
    await info.attach(`${state}: violations`, { body: JSON.stringify(violations, null, 2), contentType: 'application/json' });
    if (!screenshot) {
        return;
    }
    const png = await page.screenshot({ scale: 'css', animations: 'disabled', caret: 'hide' });
    const svg = Buffer.from(outlineSvg(viewport, violations));
    const outlined = await sharp(png)
        .composite([{ input: svg, top: 0, left: 0 }])
        .png()
        .toBuffer();
    await info.attach(`${state}: outlined`, { body: outlined, contentType: 'image/png' });
}
