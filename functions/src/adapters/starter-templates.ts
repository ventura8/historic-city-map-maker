import { readFile } from 'node:fs/promises';

import type { StarterTemplateName, StarterTemplates } from '../ports/starter-templates.js';

/**
 * The starter templates in the deploy artifact (`functions/dist/starter/`, finding 73 of 2026-11-03), each read on first
 * use and kept for the instance's life (a failed read is not kept, so the next request reads again).
 */
export function createDiskStarterTemplates(folder: URL): StarterTemplates {
    const texts = new Map<StarterTemplateName, Promise<string>>();
    return {
        read: (name) => {
            const known = texts.get(name);
            if (known !== undefined) {
                return known;
            }
            const text = readFile(new URL(name, folder), 'utf8');
            texts.set(name, text);
            void text.catch(() => {
                texts.delete(name);
            });
            return text;
        },
    };
}
