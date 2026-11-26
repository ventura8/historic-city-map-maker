import { expect, test as setup } from '@playwright/test';

import { MOCK_API_ORIGIN } from '../../fixtures/world.js';
import { ADMIN_SCRIPT_FILE, ADMIN_SHELL_ELEMENT } from '../../../scripts/site/src/admin/page.js';
import { ADMIN_EMULATORS, ADMIN_ORIGIN, ADMIN_URL, ADMIN_WEB_CONFIG, E2E_PROJECT_ID, emulatorOrigin } from '../world.js';

/**
 * The `admin-setup` project every admin project depends on (e2e/projects.ts): the admin server serves a built admin
 * with the `demo-hcm` web configuration, the mock APIs answer, the emulators of the admin tier run, and the Functions
 * emulator has loaded the functions (an anonymous call of `admin-session` is refused by its access rule, through
 * CORS). A missing build or emulator fails here, once, instead of in every scenario. No page is opened, so this file
 * uses Playwright's own `test`.
 */

interface RunningEmulator {
    readonly name: string;
}

setup('the admin build, the mock APIs and the emulators of the admin tier answer', async ({ request }) => {
    expect((await request.get(`${MOCK_API_ORIGIN}/__health`)).ok()).toBe(true);
    const page = await request.get(ADMIN_URL);
    expect(page.status(), 'the admin is built into the e2e Hosting tree (npm run build:site:e2e)').toBe(200);
    expect(await page.text()).toContain(`<${ADMIN_SHELL_ELEMENT}></${ADMIN_SHELL_ELEMENT}>`);
    expect((await request.get(`${ADMIN_URL}${ADMIN_SCRIPT_FILE}`)).status(), 'the admin bundle is built').toBe(200);
    expect(await (await request.get(`${ADMIN_ORIGIN}/__/firebase/init.json`)).json()).toEqual(ADMIN_WEB_CONFIG);

    const running = (await (await request.get(`${emulatorOrigin('hub')}/emulators`)).json()) as Readonly<Record<string, RunningEmulator>>;
    expect(Object.keys(running)).toEqual(expect.arrayContaining([...ADMIN_EMULATORS]));

    const session = await request.post(`${emulatorOrigin('functions')}/${E2E_PROJECT_ID}/us-central1/admin-session`, {
        headers: { origin: ADMIN_ORIGIN },
        data: { data: {} },
    });
    expect(session.status(), 'the Functions emulator loaded functions/dist (npm run build --workspace @hcm/functions)').toBe(401);
    expect(session.headers()['access-control-allow-origin']).toBe(ADMIN_ORIGIN);
});
