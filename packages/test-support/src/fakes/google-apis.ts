import { route } from './routes.js';
import type { ServiceFake } from './service.js';

/**
 * The gapi loader (`https://apis.google.com/js/api.js?onload=<callback>`), which Firebase Auth fetches as soon as it
 * starts on Safari and on phones (its popup flow's hidden iframe), and on any browser before its first Google popup.
 * The e2e admin signs in through Google's consent stand-in, so the iframe is never needed: the fake loader defines a
 * `gapi` without `load` and calls the callback, which Firebase reads as a loader that cannot load the iframe (its
 * `network-request-failed`, which it handles), the same as an unreachable loader without the failed request. A loader
 * that never called back would hold Firebase Auth's start, and the admin with it, on Safari.
 */

const LOADER = `// e2e stand-in for the gapi loader: the admin signs in through the consent stand-in.
(function () {
    var src = document.currentScript && document.currentScript.src;
    var callback = src ? new URL(src).searchParams.get('onload') : null;
    window.gapi = window.gapi || {};
    if (callback && typeof window[callback] === 'function') {
        window[callback]();
    }
})();
`;

/** The fake gapi loader (stateless). */
export function createGoogleApisFake(): ServiceFake {
    return {
        name: 'google-apis',
        routes: [
            route(
                'GET',
                'https://apis.google.com/js/api.js',
                'google-apis.loader',
                () => new Response(LOADER, { status: 200, headers: { 'content-type': 'text/javascript; charset=utf-8' } }),
            ),
        ],
        failure: () => undefined,
        scenarios: {},
        snapshot: () => ({}),
    };
}
