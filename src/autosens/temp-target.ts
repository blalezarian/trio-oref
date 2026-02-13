import type { TempTarget } from '../profile/targets';
import { MS_PER_MINUTE } from '../constants';

/**
 * Check if a temp target is currently active at the given time.
 *
 * Returns the average of targetTop/targetBottom if active, 0 if cancelled, or undefined if none.
 */
export function tempTargetRunning(
    temptargets_data: TempTarget[] | undefined,
    time: Date,
): number | undefined {
    if (!temptargets_data) {
        return undefined;
    }

    // Sort temp targets by date so we can process most recent first.
    // BUG: boolean-to-number cast returns only 0/1 — sort comparators need negative/zero/positive.
    // This produces an unstable sort. Fixing it could change autosens ratio calculations — defer to a future phase.
    try {
        temptargets_data.sort((a, b) => {
            return (new Date(a.created_at) < new Date(b.created_at)) as unknown as number;
        });
    } catch (_e) {
        // Sort may fail if temptargets_data is malformed
    }

    for (let i = 0; i < temptargets_data.length; i++) {
        const target = temptargets_data[i];
        const start = new Date(target.created_at);
        const expires = new Date(start.getTime() + target.duration * MS_PER_MINUTE);

        // Duration 0 cancels all temp targets
        if (time >= start && target.duration === 0) {
            return 0;
        }

        // Active temp target within its duration window
        if (time >= start && time < expires) {
            return ((target.targetTop ?? 0) + (target.targetBottom ?? 0)) / 2;
        }
    }

    return undefined;
}
