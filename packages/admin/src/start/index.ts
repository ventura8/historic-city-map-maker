/**
 * The start page's entry (`docs/research/M14-start-your-map.md`): the browser's parts, the controller, `<hcm-start-page>`.
 * No Firebase SDK and no Google script: the page talks to Google's REST APIs with the token of the consent. Importing it in
 * Node (the tests) does nothing: the start needs a document.
 */
import { createLogger, isUsableCityId, PROJECT_ID_PATTERN, type Logger } from '@hcm/shared';
import { defineHcmStartPage, HCM_START_PAGE_TAG, type HcmStartPage, type StartPagePort } from '@hcm/ui/start';

import { webStorage, windowClock, type LocationWindow } from '../app/browser.js';
import { STAND_IN_ORIGIN } from '../auth/stand-in-origin.js';
import { AUTHORIZE_URL } from './consent.js';
import { StartController, type StartDeps } from './controller.js';
import { gzipBytes, sha256Hex } from './files.js';
import { areaProblem, censusBoxOf, cityIdProblem, planOf, projectIdProblem } from './form.js';

/** The self-host road's command (`create-historic-city`, the release the page belongs to is printed by its own page). */
const COMMAND = 'npx create-historic-city@1 self-host';

const IS_E2E = import.meta.env.MODE === 'e2e';

export interface StartScope {
    readonly document?: Document;
    readonly customElements?: CustomElementRegistry;
}

type StartWindow = LocationWindow &
    Pick<Window, 'setTimeout' | 'clearTimeout'> & {
        readonly location: LocationWindow['location'] & Pick<Location, 'assign'>;
        readonly history: History;
        readonly navigator: Navigator;
        readonly crypto: Crypto;
        readonly sessionStorage: Storage;
        readonly localStorage: Storage;
        readonly fetch: typeof fetch;
    };

function portOf(controller: StartController): StartPagePort {
    return {
        get view() {
            return controller.view;
        },
        subscribe: (listener) => controller.subscribe(listener),
        intents: controller.intents,
        censusBox: () => censusBoxOf(controller.view.form),
        problems: () => {
            const { form } = controller.view;
            return {
                cityId: cityIdProblem(form),
                area: areaProblem(form),
                projectId: projectIdProblem(form),
                ready: planOf(form) !== null && isUsableCityId(form.cityId) && (!form.create || PROJECT_ID_PATTERN.test(form.projectId)),
            };
        },
    };
}

/** The e2e build's consent: the mock APIs' stand-in, in the partition of the address's `test`. */
function e2eConsent(search: string): Pick<StartDeps, 'authorizeUrl' | 'testId'> {
    return { authorizeUrl: `${STAND_IN_ORIGIN}/__oauth/authorize`, testId: new URLSearchParams(search).get('test') ?? '' };
}

/** The real ports over `win`. */
export function browserDeps(win: StartWindow, log: Logger, e2e: boolean = IS_E2E): StartDeps {
    const { location, history, crypto } = win;

    const baseUrl = `${location.origin}${location.pathname}`;
    return {
        fetch: (...args) => win.fetch(...args),
        tools: {
            fetch: (...args) => win.fetch(...args),
            digest: (bytes) => sha256Hex(crypto.subtle, bytes),
            gzip: gzipBytes,
        },
        clock: windowClock(win),
        session: webStorage(() => win.sessionStorage, log),
        local: webStorage(() => win.localStorage, log),
        log,
        baseUrl,
        fragment: () => location.hash,
        clearFragment: () => {
            history.replaceState(null, '', `${location.pathname}${location.search}`);
        },
        assign: (url) => {
            location.assign(url);
        },
        random: () => crypto.randomUUID(),
        search: location.search,
        languages: win.navigator.languages,
        ...(e2e ? e2eConsent(location.search) : { authorizeUrl: AUTHORIZE_URL }),
        command: COMMAND,
    };
}

/** Registers the element and starts the page in the document's `<hcm-start-page>`. */
export function autoStart(scope: StartScope, win: StartWindow, log: Logger): void {
    const { document: doc, customElements: registry } = scope;
    if (doc === undefined || registry === undefined) {
        return;
    }
    defineHcmStartPage(registry);
    const controller = new StartController(browserDeps(win, log));
    const page = (doc.querySelector(HCM_START_PAGE_TAG) ?? doc.body.appendChild(doc.createElement(HCM_START_PAGE_TAG))) as HcmStartPage;
    page.port = portOf(controller);
    void controller.start();
}

autoStart(globalThis, globalThis, createLogger('start'));
