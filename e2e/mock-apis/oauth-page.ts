import { element, renderDocument, type HtmlElement } from '../../scripts/site/src/html.js';

/**
 * The stand-in for Google's sign-in and consent page (docs/research/M2b-interfaces.md §2.6): the e2e build's
 * `GoogleAuthPort` opens it in a popup instead of Google's, so a spec drives "the human's consent" like any page. It
 * lists the accounts to sign in with (the request's `login_hint` preselected) and the requested scopes as ticked
 * checkboxes; Allow posts `{idToken, accessToken, scope, expiresIn}` to the opener and closes, Cancel posts
 * `{cancelled: true}` and closes (the admin's stand-in client also reads a popup closed without a message as a
 * cancel). In the local stack the page opens in a frame over the admin instead (e2e/stack/browser.ts: the Claude browser
 * pane opens a popup in place of its page), and posts to its parent. Built from elements and text only
 * (`scripts/site/src/html.ts`), with its script in a file of its own.
 */

/** Where the page's script is served (`oauth.ts`). */
export const STAND_IN_SCRIPT_PATH = '/__oauth/stand-in.js';

export interface ConsentView {
    /** The consent request's id (`oauth.ts` records it). */
    readonly request: string;
    /** The test's partition, posted back with the decision. */
    readonly test: string;
    /** The requested scopes beyond the sign-in's own (`openid`, the address, the profile). */
    readonly scopes: readonly string[];
    /** The accounts offered; `selected` is ticked. */
    readonly accounts: readonly string[];
    readonly selected: string;
    /** M14: the same-tab flow's `redirect_uri`, and its `state`; empty for a popup. */
    readonly redirect?: string;
    readonly state?: string;
}

function hidden(name: string, value: string): HtmlElement {
    return element('input', { type: 'hidden', name, value });
}

function choice(type: 'radio' | 'checkbox', name: string, value: string, checked: boolean): HtmlElement {
    const input = element('input', { type, name, value, ...(checked ? { checked: true } : {}) });
    return element('label', {}, [input, ` ${value}`]);
}

function scopeList(scopes: readonly string[]): HtmlElement {
    const items = scopes.length === 0 ? [element('p', {}, ['Only the name and the e-mail address of the account.'])] : [];
    return element('fieldset', {}, [
        element('legend', {}, ['The app asks to']),
        ...items,
        ...scopes.map((scope) => choice('checkbox', 'scope', scope, true)),
    ]);
}

/** The page's HTML for one consent request. */
export function consentPage(view: ConsentView): string {
    const accounts = element('fieldset', {}, [
        element('legend', {}, ['Choose an account']),
        ...view.accounts.map((account) => choice('radio', 'account', account, account === view.selected)),
    ]);
    const form = element('form', { id: 'consent' }, [
        hidden('request', view.request),
        hidden('test', view.test),
        // M14: the start page's same-tab flow, where the answer returns on the address's fragment instead of to an opener.
        hidden('redirect', view.redirect ?? ''),
        hidden('state', view.state ?? ''),
        accounts,
        scopeList(view.scopes),
        element('button', { type: 'submit' }, ['Allow']),
        element('button', { type: 'button', id: 'cancel' }, ['Cancel']),
    ]);
    const head = element('head', {}, [
        element('meta', { charset: 'utf-8' }),
        element('title', {}, ['Sign in with Google (e2e stand-in)']),
        element('link', { rel: 'icon', href: 'data:,' }),
        element('script', { src: STAND_IN_SCRIPT_PATH, defer: true }),
    ]);
    const main = element('main', {}, [
        element('h1', {}, ['Sign in with Google']),
        element('p', {}, ['e2e stand-in for the consent page']),
        form,
    ]);
    return renderDocument(element('html', { lang: 'en' }, [head, element('body', {}, [main])]));
}

export interface StandInScriptConfig {
    /** The origins the decision may be posted to (the admin server; the site server for the harness). */
    readonly openers: readonly string[];
}

/**
 * Runs in the stand-in page. Serialized with `Function.prototype.toString` (oauth.ts), so it must not reference
 * anything outside its own body; the mock APIs run under Node's type stripping, which leaves plain JavaScript.
 */
function standInConsent(config: StandInScriptConfig): void {
    const form = document.querySelector('form');
    const cancel = document.getElementById('cancel');
    if (form === null || cancel === null) {
        return;
    }
    const field = (name: string): string => {
        const value = new FormData(form).get(name);
        return typeof value === 'string' ? value : '';
    };
    const post = async (path: string, body: Readonly<Record<string, unknown>>): Promise<unknown> => {
        const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
        return (await response.json()) as unknown;
    };
    const tell = (message: unknown): void => {
        // A popup tells its opener; the local stack's overlay (e2e/stack/browser.ts) is a frame and tells its parent.
        const opener = (window.opener as Window | null) ?? (window.parent === window ? null : window.parent);
        for (const origin of config.openers) {
            opener?.postMessage(message, origin);
        }
        window.close();
    };
    const redirect = field('redirect');
    const back = (fields: Readonly<Record<string, string>>): void => {
        window.location.assign(`${redirect}#${new URLSearchParams({ ...fields, state: field('state') }).toString()}`);
    };
    const answered = (grant: unknown): void => {
        if (redirect === '') {
            tell(grant);
            return;
        }
        const { accessToken, scope, expiresIn } = grant as { accessToken: string; scope: string; expiresIn: number };
        back({ access_token: accessToken, token_type: 'Bearer', scope, expires_in: String(expiresIn) });
    };
    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const scopes = new FormData(form).getAll('scope').filter((scope): scope is string => typeof scope === 'string');
        void post('/__oauth/grant', { request: field('request'), test: field('test'), account: field('account'), scopes }).then(answered);
    });
    cancel.addEventListener('click', () => {
        void post('/__oauth/cancel', { request: field('request'), test: field('test') }).then(() => {
            if (redirect === '') {
                tell({ cancelled: true });
            } else {
                back({ error: 'access_denied' });
            }
        });
    });
}

/** The page's script: `standInConsent` applied to `config`. */
export function standInScript(config: StandInScriptConfig): string {
    return `(${standInConsent.toString()})(${JSON.stringify(config)});\n`;
}
