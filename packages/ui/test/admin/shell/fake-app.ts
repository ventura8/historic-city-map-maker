// A scripted `AdminAppPort` for the admin elements' browser tests: the state is set by the test, every intent call is
// recorded, and the editor areas' stores are the ones the test puts in `areas`.
import { render, type TemplateResult } from 'lit';

import type {
    AdminAppPort,
    AdminDestinationPort,
    AdminIntentsPort,
    AdminRouteIdPort,
    AdminStatePort,
} from '../../../src/admin/admin-port.js';
import type { ContentPort } from '../../../src/admin/content-port.js';
import { AREA_ELEMENTS as ADMINS } from '../../../src/admin/areas/admins.js';
import { AREA_ELEMENTS as CRASHES } from '../../../src/admin/areas/crashes.js';
import { AREA_ELEMENTS as HISTORY } from '../../../src/admin/areas/history.js';
import { AREA_ELEMENTS as HOME } from '../../../src/admin/areas/home.js';
import { AREA_ELEMENTS as JOBS } from '../../../src/admin/areas/jobs.js';
import { AREA_ELEMENTS as LAYERS } from '../../../src/admin/areas/layers.js';
import { AREA_ELEMENTS as PHOTOS } from '../../../src/admin/areas/photos.js';
import { AREA_ELEMENTS as POIS } from '../../../src/admin/areas/pois.js';
import { AREA_ELEMENTS as SETTINGS } from '../../../src/admin/areas/settings.js';
import { defineAdminElements } from '../../../src/admin/define.js';
import { installFonts } from '../../../src/fonts/font-faces.js';
import { applyTheme, clearTheme } from '../../../src/theme/apply.js';
import { BASELINE_THEME } from '../../../src/theme/baseline.js';

export const DESTINATIONS: readonly AdminDestinationPort[] = [
    { id: 'setup', icon: 'checklist', compact: true },
    { id: 'photos', icon: 'photo_library', compact: true },
    { id: 'pois', icon: 'place', compact: true },
    { id: 'layers', icon: 'layers', compact: true },
    { id: 'jobs', icon: 'pending_actions', compact: false },
    { id: 'admins', icon: 'group', compact: false },
];

export function adminState(overrides: Partial<AdminStatePort> = {}): AdminStatePort {
    return {
        auth: 'admin',
        mode: 'normal',
        user: { uid: 'owner-uid', email: 'owner@e2e.test', displayName: 'Owner' },
        role: 'owner',
        busy: false,
        gate: { reconsent: false, issue: null, enableApi: null },
        route: { id: 'setup', params: [] },
        destinations: [{ id: 'setup', icon: 'checklist', compact: true }],
        locale: 'en',
        theme: { mode: 'light', city: null, preview: null },
        consent: 'unknown',
        analytics: false,
        windowClass: 'compact',
        notice: null,
        projectId: 'demo-hcm',
        authDomain: 'demo-hcm.firebaseapp.com',
        // M5: the owner of the one bundled city, who owns the project.
        cities: [{ id: 'bucharest', role: 'owner', name: { ro: 'București', en: 'Bucharest' } }],
        cityId: 'bucharest',
        projectOwner: true,
        setup: null,
        ...overrides,
    };
}

export class FakeAdminApp implements AdminAppPort {
    readonly calls: string[] = [];
    readonly #listeners = new Set<(state: AdminStatePort) => void>();
    #state: AdminStatePort;
    pages: Partial<Record<AdminRouteIdPort, string | null>> = {};
    /** The editor areas' stores a test gives the pages (any other area has none). */
    readonly areas: Partial<Record<keyof ContentPort, unknown>> = {};
    /** `content.<area>`: the test's store, or null. */
    readonly content = new Proxy({} as ContentPort, { get: (_target, area: string) => this.areas[area as keyof ContentPort] ?? null });
    readonly intents: AdminIntentsPort;

    constructor(state: AdminStatePort = adminState()) {
        this.#state = state;
        const record =
            (name: string) =>
            (...args: unknown[]): Promise<void> => {
                this.calls.push([name, ...args.map((arg) => JSON.stringify(arg))].join(' '));
                return Promise.resolve();
            };
        const sync =
            (name: string) =>
            (...args: unknown[]): void => {
                void record(name)(...args);
            };
        this.intents = {
            signIn: record('signIn'),
            signOut: record('signOut'),
            stayOnPage: sync('stayOnPage'),
            leavePage: record('leavePage'),
            claim: record('claim'),
            join: record('join'),
            retry: record('retry'),
            enableApi: record('enableApi'),
            reload: sync('reload'),
            navigate: sync('navigate'),
            switchCity: sync('switchCity'),
            refreshCities: record('refreshCities'),
            setLocale: sync('setLocale'),
            setTheme: sync('setTheme'),
            setAccent: sync('setAccent'),
            setConsent: sync('setConsent'),
            dismissNotice: sync('dismissNotice'),
            setWindowClass: sync('setWindowClass'),
            setup: null,
        };
    }

    get state(): AdminStatePort {
        return this.#state;
    }

    set(patch: Partial<AdminStatePort>): void {
        this.#state = { ...this.#state, ...patch };
        for (const listener of this.#listeners) {
            listener(this.#state);
        }
    }

    subscribe(listener: (state: AdminStatePort) => void): () => void {
        this.#listeners.add(listener);
        return () => {
            this.#listeners.delete(listener);
        };
    }

    get listening(): number {
        return this.#listeners.size;
    }

    loadPage(id: AdminRouteIdPort): Promise<string | null> {
        this.calls.push(`loadPage ${id}`);
        return Promise.resolve(this.pages[id] ?? null);
    }

    /** The calls of one intent. */
    named(name: string): readonly string[] {
        return this.calls.filter((call) => call === name || call.startsWith(`${name} `));
    }
}

const hosts: HTMLElement[] = [];

/** Registers the admin's elements (and the kit) once, and every area's page, as the admin does once their chunks load. */
export function defineAll(): void {
    defineAdminElements();
    for (const area of [PHOTOS, POIS, LAYERS, SETTINGS, HOME, ADMINS, HISTORY, JOBS, CRASHES]) {
        area.define(customElements);
    }
}

/** Renders `template` into a themed host (`width` in CSS px when given) and resolves its first element once rendered. */
export async function mount<T extends Element>(template: TemplateResult, width?: number): Promise<T> {
    installFonts(document, '/packages/ui/fonts/');
    const host = document.createElement('div');
    if (width !== undefined) {
        host.style.inlineSize = `${String(width)}px`;
    }
    document.body.append(host);
    applyTheme(host, BASELINE_THEME, 'light', false);
    hosts.push(host);
    render(template, host);
    const element = host.firstElementChild as T;
    await (element as Partial<{ updateComplete: Promise<unknown> }>).updateComplete;
    return element;
}

export function cleanup(): void {
    for (const host of hosts.splice(0)) {
        clearTheme(host);
    }
    document.body.replaceChildren();
}

/** Waits for `element` (and the elements it renders) to finish updating. */
export async function updated(element: Element): Promise<void> {
    for (let round = 0; round < 5; round += 1) {
        await (element as Partial<{ updateComplete: Promise<unknown> }>).updateComplete;
        await new Promise((resolve) => requestAnimationFrame(resolve));
    }
}

/** Every element matching `selector` in `root` and in the shadow roots below it. */
export function deepAll(root: Element | ShadowRoot | Document, selector: string): HTMLElement[] {
    const found: HTMLElement[] = [...root.querySelectorAll<HTMLElement>(selector)];
    const own = root instanceof Element ? root.shadowRoot : null;
    if (own !== null) {
        found.push(...deepAll(own, selector));
    }
    for (const element of root.querySelectorAll('*')) {
        if (element.shadowRoot !== null) {
            found.push(...deepAll(element.shadowRoot, selector));
        }
    }
    return found;
}

/** The first match of `selector` anywhere below `root` (throws when missing). */
export function deep(root: Element | ShadowRoot | Document, selector: string): HTMLElement {
    const found = deepAll(root, selector)[0];
    if (found === undefined) {
        throw new Error(`no ${selector}`);
    }
    return found;
}

/**
 * Runs one action of the selection's bar (`.bulk-bar`, `packages/ui/src/admin/editing/bulk-bar.ts`): a button of the
 * bar by its class, else the overflow menu's action of that id (the menu opened first; it fires once it has closed).
 */
export async function bulkAction(root: Element, id: string): Promise<void> {
    const bar = deep(root, '.bulk-bar');
    const button = deepAll(bar, `hcm-button.${id}`)[0];
    if (button !== undefined) {
        deep(button, 'button').click();
        await updated(root);
        return;
    }
    deep(deep(deep(bar, 'hcm-overflow-menu'), 'hcm-icon-button'), 'button').click();
    await updated(root);
    deep(deep(bar, `[data-action="${id}"]`), 'button').click();
    await updated(root);
}

/** The visible text below `root`, shadow roots included, whitespace collapsed. */
export function deepText(root: Element | ShadowRoot): string {
    const parts: string[] = [];
    const walk = (node: Node): void => {
        if (node.nodeType === Node.TEXT_NODE) {
            parts.push(node.textContent ?? '');
        }
        const shadow = (node as Element).shadowRoot ?? null;
        for (const child of [...(shadow?.childNodes ?? []), ...node.childNodes]) {
            walk(child);
        }
    };
    walk(root);
    return parts.join(' ').replace(/\s+/g, ' ').trim();
}
