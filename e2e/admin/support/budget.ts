import { SETUP_STEP_SPECS, setupInputBudget, type SetupStepId } from '../../../packages/admin/src/setup/steps.js';
import type { InputBudget, InputFlow } from '../../support/budget.js';

/**
 * The Setup Assistant's input budget (docs/research/M2b-interfaces.md §3.5, scenarios A30): one counted flow of in-app
 * inputs and one of Google consents per step, limited by `SETUP_STEP_SPECS` plus the allowance a bad path earns (one
 * more input to choose among billing accounts, one per retry, one input and one consent to renew a Google token or to
 * claim without one). Every flow is a flow of the `inputBudget` fixture, so an overrun fails the test at teardown;
 * `used()` adds them up against `setupInputBudget()` for the whole assistant (S-A30-HAPPY).
 */
export class SetupBudget {
    readonly #budget: InputBudget;
    readonly #flows = new Map<string, InputFlow>();
    readonly #allowances = new Map<string, number>();

    constructor(budget: InputBudget) {
        this.#budget = budget;
    }

    /** The flow `name`, made on first use with `budget + allowance` (a later call returns it as it is). */
    #flow(name: string, budget: number, allowance: number): InputFlow {
        const existing = this.#flows.get(name) ?? this.#budget.flow(name, budget + allowance);
        if (!this.#flows.has(name)) {
            this.#allowances.set(name, allowance);
        }
        this.#flows.set(name, existing);
        return existing;
    }

    /** The in-app inputs of `step` (clicks, fills, pastes, file choices); a bad path declares its `allowance` on first use. */
    inputs(step: SetupStepId, allowance = 0): InputFlow {
        return this.#flow(`inputs:${step}`, SETUP_STEP_SPECS[step].inputs, allowance);
    }

    /** The Google consents of `step` (Allow or Cancel on the consent page). */
    consents(step: SetupStepId, allowance = 0): InputFlow {
        return this.#flow(`consents:${step}`, SETUP_STEP_SPECS[step].consents, allowance);
    }

    /** The in-app inputs the bad paths of the test were allowed beyond the happy path's budget. */
    allowance(): number {
        return [...this.#allowances].filter(([name]) => name.startsWith('inputs:')).reduce((sum, [, extra]) => sum + extra, 0);
    }

    /** What every flow used so far, against the happy-path budget of the whole assistant. */
    used(): { readonly inputs: number; readonly consents: number; readonly limit: ReturnType<typeof setupInputBudget> } {
        const total = (prefix: string): number =>
            [...this.#flows].filter(([name]) => name.startsWith(prefix)).reduce((sum, [, flow]) => sum + flow.used, 0);
        return { inputs: total('inputs:'), consents: total('consents:'), limit: setupInputBudget() };
    }
}
