
import type { PumpHistoryEvent } from '../types/index';
import type {
    SuspendEvent,
    SuspendResumeData,
} from './types';
import { MS_PER_MINUTE } from '../shared/constants';

export function extractSuspendResumeData(
    pumpHistory: PumpHistoryEvent[],
): SuspendResumeData {
    let pumpSuspends: SuspendEvent[] = [];
    let pumpResumes: SuspendEvent[] = [];
    let suspendedPrior = false;
    let firstResumeTime: string | undefined;
    let lastSuspendTime: string | undefined;
    let currentlySuspended: number | false = false;

    for (let i=0; i < pumpHistory.length; i++) {
        const current: PumpHistoryEvent = pumpHistory[i];

        if (current._type === "PumpSuspend") {
            const started_at = new Date(current.timestamp as string);
            pumpSuspends.push({
                timestamp: current.timestamp,
                started_at,
                date: started_at.getTime(),
            });
        } else if (current._type === "PumpResume") {
            const started_at = new Date(current.timestamp as string);
            pumpResumes.push({
                timestamp: current.timestamp,
                started_at,
                date: started_at.getTime(),
            });
        }
    }

    pumpSuspends.sort((a, b) => a.date - b.date);

    pumpResumes.sort((a, b) => a.date - b.date);

    if (pumpResumes.length > 0) {
        firstResumeTime = pumpResumes[0].timestamp as string;

        // Check to see if our first resume was prior to our first suspend
        // indicating suspend was prior to our first event.
        if (pumpSuspends.length === 0 || (pumpResumes[0].date < pumpSuspends[0].date)) {
            suspendedPrior = true;
        }

    }

    let resumeIndex=0;  // matching pumpResumes entry;

    let i: number;
    // Match the resumes with the suspends to get durations
    for (i=0; i < pumpSuspends.length; i++) {
        for (; resumeIndex < pumpResumes.length; resumeIndex++) {
            if (pumpResumes[resumeIndex].date > pumpSuspends[i].date) {
                break;
            }
        }

        if ((resumeIndex >= pumpResumes.length) && !currentlySuspended) {
            // even though it isn't the last suspend, we have reached
            // the final suspend. Set resume last so the
            // algorithm knows to suspend all the way
            // through the last record beginning at the last suspend
            // since we don't have a matching resume.
            currentlySuspended = 1;
            lastSuspendTime = pumpSuspends[i].timestamp as string;

            break;
        }

        pumpSuspends[i].duration = (pumpResumes[resumeIndex].date - pumpSuspends[i].date)/MS_PER_MINUTE;

    }

    // These checks indicate something isn't quite aligned.
    // Perhaps more resumes that suspends or vice versa...
    if (!suspendedPrior && !currentlySuspended && (pumpResumes.length !== pumpSuspends.length)) {
        console.error(`Mismatched number of resumes(${pumpResumes.length}) and suspends(${pumpSuspends.length})!`);
    } else if (suspendedPrior && !currentlySuspended && ((pumpResumes.length-1) !== pumpSuspends.length)) {
        console.error(`Mismatched number of resumes(${pumpResumes.length}) and suspends(${pumpSuspends.length}) assuming suspended prior to history block!`);
    } else if (!suspendedPrior && currentlySuspended && (pumpResumes.length !== (pumpSuspends.length-1))) {
        console.error(`Mismatched number of resumes(${pumpResumes.length}) and suspends(${pumpSuspends.length}) assuming suspended past end of history block!`);
    } else if (suspendedPrior && currentlySuspended && (pumpResumes.length !== pumpSuspends.length)) {
        console.error(`Mismatched number of resumes(${pumpResumes.length}) and suspends(${pumpSuspends.length}) assuming suspended prior to and past end of history block!`);
    }

    if (i < (pumpSuspends.length-1)) {
        // truncate any extra suspends. if we had any extras
        // the error checks above would have issued a error log message
        pumpSuspends.splice(i+1, pumpSuspends.length-i-1);
    }

    return {
        pumpSuspends,
        suspendedPrior,
        firstResumeTime: firstResumeTime as string,
        lastSuspendTime: lastSuspendTime as string,
        currentlySuspended,
    };
}
