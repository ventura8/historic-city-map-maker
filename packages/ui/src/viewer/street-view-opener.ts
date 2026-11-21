
export function openStreetView(url: string): void {
    const newWindow = window.open(url, 'hcm-street-view', getWindowFeatures());
    handleFallback(newWindow, url);
}

function getWindowFeatures(): string {
    const width = window.innerWidth || document.documentElement.clientWidth || screen.width;
    const height = window.innerHeight || document.documentElement.clientHeight || screen.height;
    const halfWidth = Math.floor(width / 2);
    return `toolbar=no, location=no, directories=no, status=no, menubar=no, scrollbars=yes, resizable=yes, width=${String(
        halfWidth,
    )}, height=${String(height)}, top=0, left=${String(halfWidth)}`;
}

function handleFallback(newWindow: Window | null, url: string): void {
    if (newWindow === null || newWindow.closed) {
        window.open(url, '_blank');
    }
}
