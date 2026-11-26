/**
 * Step 8's precondition (`docs/research/M5-interfaces.md` §4.4): billing (the Blaze plan) linked to the project, which
 * the owner does in Google's own pages (the Setup Assistant's billing step, or the page the CLI opens). With `gcloud`,
 * the CLI reads it (`gcloud billing projects describe`); without, it asks the owner. When it is not linked, the billing
 * page opens and the CLI waits for Enter, then checks every 15 seconds for at most `--billing-wait` minutes (20 by
 * default; 0 checks once more). Still not linked: nothing is deployed, and the run stops with the page and the command
 * to resume.
 */
import { refusal } from '../context.js';
import { NPX_COMMAND } from '../version.js';
import { capture, isYes, open, say, waitForEnter, type Session } from './session.js';
import { billingEnabled, GCLOUD, gcloudArgs, pages } from './tools.js';

const BILLING_POLL_SECONDS = 15;

async function isLinked(session: Session): Promise<boolean> {
    if (!session.gcloud) {
        const { t, ports } = session.context;
        return isYes(await ports.terminal.ask(t('cli.ask.billing', { project: session.project.id })));
    }
    return billingEnabled(await capture(session, GCLOUD, gcloudArgs.billing(session.project.id)));
}

/** The command that resumes at the server's deploy. */
export function deployCommand(session: Session): string {
    return `${NPX_COMMAND} deploy ${session.project.dir} --project ${session.project.id}`;
}

/** Checks again, every `BILLING_POLL_SECONDS`, for at most `--billing-wait` minutes (`gcloud` only: an answer is final). */
async function waitForBilling(session: Session): Promise<void> {
    const { t, ports, options } = session.context;
    const polls = session.gcloud ? Math.floor((options.billingWait * 60) / BILLING_POLL_SECONDS) : 0;
    let poll = 0;
    while (!(await isLinked(session))) {
        if (poll >= polls) {
            const { id } = session.project;
            throw refusal(session.context, 'cli.billing.never', { url: pages.billing(id), command: deployCommand(session) });
        }
        if (poll === 0) {
            say(session, t('cli.billing.waiting', { seconds: BILLING_POLL_SECONDS, minutes: options.billingWait }));
        }
        poll += 1;
        await ports.clock.sleep(BILLING_POLL_SECONDS * 1000);
    }
}

/** Resolves once billing is linked; throws the reason (with the page and the command to resume) when it never is. */
export async function billingReady(session: Session): Promise<void> {
    const { t } = session.context;
    const { id } = session.project;
    if (!(await isLinked(session))) {
        say(session, t('cli.billing.notLinked', { project: id }));
        await open(session, pages.billing(id));
        await waitForEnter(session);
        await waitForBilling(session);
    }
    say(session, t('cli.billing.linked'));
}
