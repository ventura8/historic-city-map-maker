export const DATE_KEYS = new Map<string, number>([
    ['ArrowUp', -1],
    ['ArrowDown', 1],
    ['Enter', 0],
    [' ', 0],
]);

export const KEY_STEPS: Readonly<Record<string, number>> = {
    ArrowRight: 1,
    PageUp: 1,
    ArrowLeft: -1,
    PageDown: -1,
    Home: -Infinity,
    End: Infinity,
};
