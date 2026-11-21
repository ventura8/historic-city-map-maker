import { expect, test } from '../../support/test.js';

/**
 * Harness smoke (behaviour V00 in e2e/scenarios.json): a static page at the loopback origin renders WebGL2 under
 * SwiftShader (the map's precondition in a GPU-less container), and the firewall fixture aborts and reports a request
 * to a real external host that is not mocked.
 *
 * The page is fulfilled by the spec rather than committed as an .html file: the repository's Prettier output
 * (`<!doctype html>`, `<meta ... />`) fails html-validate's recommended `doctype-style` and `void-style` rules, and
 * that conflict is a config decision (docs/research/DECISIONS-for-review.md §1).
 */
const PAGE = '/__harness/webgl.html';
const SMOKE_HTML = `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><title>E2E smoke</title><link rel="icon" href="data:,"></head>
<body><main>
<h1>E2E smoke</h1>
<canvas width="8" height="8" role="img" aria-label="WebGL2 probe"></canvas>
</main></body>
</html>`;
/** Firestore: never mocked, so the firewall must stop it before DNS or the network (the viewer never reads it). */
const EXTERNAL = 'https://firestore.googleapis.com/v1/projects/demo-hcm/databases/(default)/documents/cities/bucuresti';
/** RGBA the probe clears to: (0, 128, 255) at full opacity. */
const PROBE_RGBA = [0, 128, 255, 255];

/** Runs in the page: clears the canvas through WebGL2 and reads back its first pixel (null without WebGL2). */
function clearAndReadPixel(canvas: HTMLCanvasElement): number[] | null {
    const gl = canvas.getContext('webgl2', { preserveDrawingBuffer: true });
    if (gl === null) {
        return null;
    }
    gl.clearColor(0, 128 / 255, 1, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    const pixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    return Array.from(pixel);
}

/** Runs in the page: fetches `url` and reports whether the browser saw a network failure. */
async function fetchOutcome(url: string): Promise<string> {
    try {
        await fetch(url);
        return 'loaded';
    } catch (error: unknown) {
        return error instanceof TypeError ? 'network-error' : 'other-error';
    }
}

test.beforeEach(async ({ page }) => {
    // A page-level route wins over the context-level network routes, so only this one URL is answered here.
    await page.route(PAGE, (route) => route.fulfill({ contentType: 'text/html; charset=utf-8', body: SMOKE_HTML }));
});

test('A static page at the loopback origin renders WebGL2 under SwiftShader', { tag: '@S-V00-HAPPY' }, async ({ page }) => {
    await page.goto(PAGE);

    await expect(page.getByRole('heading', { level: 1, name: 'E2E smoke' })).toBeVisible();
    const probe = page.getByRole('img', { name: 'WebGL2 probe' });
    await expect(probe).toBeVisible();
    expect(await probe.evaluate(clearAndReadPixel)).toEqual(PROBE_RGBA);
});

test(
    'A request to a host outside the allowlist is aborted and reported',
    { tag: '@S-V00-BAD-BLOCKED-HOST' },
    async ({ page, firewall, consoleErrors }) => {
        await page.goto(PAGE);

        expect(await page.evaluate(fetchOutcome, EXTERNAL)).toBe('network-error');
        expect(firewall.take()).toEqual([EXTERNAL]);
        expect(consoleErrors.take()).toEqual([expect.stringContaining('net::ERR_BLOCKED_BY_CLIENT')]);
    },
);
