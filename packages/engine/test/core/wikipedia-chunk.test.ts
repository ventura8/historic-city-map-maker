/**
 * The Wikipedia overlay's lazy chunk (`src/wikipedia/wikipedia.ts`): it reads the city's file with no cookie and checks it; a
 * failed answer or a file the schema refuses rejects, so the store switches the overlay off and says so.
 */
import { describe, expect, it, vi } from 'vitest';

import { WikipediaFileError, wikipediaModule } from '../../src/wikipedia/wikipedia.js';

const ARTICLE = {
    id: 'en-5',
    lng: 26.1,
    lat: 44.45,
    versions: { en: { title: 'Only English', extract: '', url: 'https://en.wikipedia.org/wiki/Only' } },
};

function answer(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status });
}

describe('wikipediaModule.load', () => {
    it('happyPath_theFilesArticles', async () => {
        const fetch = vi.fn(() =>
            Promise.resolve(
                answer({
                    version: 1,
                    generatedAt: '2026-11-22T08:00:00.000Z',
                    attribution: 'Wikipedia (CC BY-SA 4.0)',
                    articles: [ARTICLE],
                }),
            ),
        );

        await expect(wikipediaModule.load('https://b.example/wikipedia.json', fetch)).resolves.toEqual([ARTICLE]);
        expect(fetch).toHaveBeenCalledWith('https://b.example/wikipedia.json', { credentials: 'omit' });
    });

    it('badPath_aFailedAnswerOrAnInvalidFileRejects', async () => {
        await expect(wikipediaModule.load('u', () => Promise.resolve(answer({}, 404)))).rejects.toBeInstanceOf(WikipediaFileError);
        await expect(wikipediaModule.load('u', () => Promise.resolve(answer({ version: 2 })))).rejects.toThrow('not valid');
    });
});
