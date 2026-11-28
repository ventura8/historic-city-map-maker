/** @param {string | undefined} value A worker count from the environment. */
export function workerCount(value) {
    if (!/^[1-9]\d*$/.test(value ?? '')) {
        return undefined;
    }
    const count = Number(value);
    return Number.isSafeInteger(count) ? count : undefined;
}
