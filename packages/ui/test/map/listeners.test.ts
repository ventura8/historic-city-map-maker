import { describe, expect, it } from 'vitest';

import { EventListeners, Listeners } from '../../src/map/listeners.js';

describe('Listeners', () => {
    it('happyPath_everyListenerHearsEachEmitUntilItUnsubscribes', () => {
        const heard: string[] = [];
        const list = new Listeners<[string]>(() => undefined);
        const stop = list.add((value) => heard.push(`a:${value}`));
        list.add((value) => heard.push(`b:${value}`));

        list.emit('1');
        stop();
        list.emit('2');

        expect(heard).toEqual(['a:1', 'b:1', 'b:2']);
        expect(list.size).toBe(1);
    });

    it('badPath_aThrowingListenerIsReportedAndTheOthersStillRun', () => {
        const errors: unknown[] = [];
        const heard: number[] = [];
        const list = new Listeners<[number]>((error) => errors.push(error));
        list.add(() => {
            throw new Error('boom');
        });
        list.add((value) => heard.push(value));

        list.emit(7);
        list.clear();
        list.emit(8);

        expect(heard).toEqual([7]);
        expect(errors).toEqual([new Error('boom')]);
    });

    it('happyPath_eventListenersKeepOneListPerEvent', () => {
        const heard: string[] = [];
        const events = new EventListeners<{ a: number; b: string }>(() => undefined);
        events.on('a', (value) => heard.push(`a${String(value)}`));
        const stop = events.on('b', (value) => heard.push(`b${value}`));
        events.on('b', (value) => heard.push(`B${value}`));

        events.emit('a', 1);
        events.emit('b', 'x');
        stop();
        events.emit('b', 'y');
        events.clear();
        events.emit('a', 2);

        expect(heard).toEqual(['a1', 'bx', 'Bx', 'By']);
    });
});
