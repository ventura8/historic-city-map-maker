/**
 * The Chromium switches of the e2e projects (`e2e/projects.ts`), here so a spec that needs its own browser
 * (`test.use({ launchOptions })`) starts it with the same firewall and WebGL.
 */

/** Only loopback resolves in Chromium: defence in depth behind the firewall fixture (support/network.ts). */
export const HOST_RULES = '--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE 127.0.0.1, EXCLUDE localhost';
/** WebGL without a GPU: ANGLE on SwiftShader, which the containers and CI runners always have. */
export const GL_ARGS: readonly string[] = ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist', HOST_RULES];
/**
 * Chrome's dark theme for sites ("Auto Dark Mode"), on by default on Android while the system is dark: it repaints
 * every element whose used colour scheme is light, which no computed style shows (the Pixel 9 Pro review, P2).
 */
export const FORCE_DARK = '--blink-settings=forceDarkModeEnabled=true';
