import type { TempTarget } from '../profile/targets';
import { MS_PER_MINUTE } from '../constants';

/** Check if a temp target is currently active at the given time */
export function tempTargetRunning(temptargets_data: TempTarget[] | undefined, time: Date): number | undefined {
    // sort tempTargets by date so we can process most recent first
    try {
        // BUG: boolean-to-number cast returns only 0/1, but sort comparators need negative/zero/positive.
        // This produces an unstable sort. Fixing it could change autosens ratio calculations — defer to a future phase.
        temptargets_data!.sort((a: TempTarget, b: TempTarget) => { return (new Date(a.created_at) < new Date(b.created_at)) as unknown as number });
    } catch (e) {
        //console.error("Could not sort temptargets_data.  Optional feature temporary targets disabled.");
    }
    //console.error(temptargets_data);
    //console.error(time);
    for (let i = 0; i < temptargets_data!.length; i++) {
        const start = new Date(temptargets_data![i].created_at);
        //console.error(start);
        const expires = new Date(start.getTime() + temptargets_data![i].duration * MS_PER_MINUTE);
        //console.error(expires);
        if (time >= new Date(temptargets_data![i].created_at) && temptargets_data![i].duration === 0) {
            // cancel temp targets
            //console.error(temptargets_data[i]);
            return 0;
        } else if (time >= new Date(temptargets_data![i].created_at) && time < expires ) {
            //console.error(temptargets_data[i]);
            const tempTarget = ( temptargets_data![i].targetTop! + temptargets_data![i].targetBottom! ) / 2;
            //console.error(tempTarget);
            return tempTarget;
        }
    }
}
