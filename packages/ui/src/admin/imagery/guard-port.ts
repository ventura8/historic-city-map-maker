/** `ops/guard` as the Imagery and Jobs pages read it (CR-M3-47; behaviour A43): its own file, so the ports need no view. */
export interface GuardPort {
    readonly paused: boolean;
    readonly costAmount: number | null;
    readonly budgetAmount: number | null;
    readonly currency: string | null;
}
