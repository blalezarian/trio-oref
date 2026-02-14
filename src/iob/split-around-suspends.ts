import type {
    TempEvent,
    SuspendEvent,
} from './types';
import { MS_PER_MINUTE } from '../shared/constants';

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

/**
 * Split a temp event around any conflicting pump suspends by removing the
 * time periods that overlap with suspend intervals. Handles three cases:
 * suspended prior to history window, currently suspended, and mid-event
 * suspends that bisect the temp into pre- and post-suspend segments.
 */
export function splitAroundSuspends (
    currentEvent: TempEvent,
    pumpSuspends: SuspendEvent[],
    firstResumeTime: string,
    suspendedPrior: boolean,
    lastSuspendTime: string,
    currentlySuspended: number | false,
): TempEvent[] {
    const events: TempEvent[] = [];

    const firstResumeStarted = new Date(firstResumeTime);
    const firstResumeDate = firstResumeStarted.getTime()

    const lastSuspendStarted = new Date(lastSuspendTime);
    const lastSuspendDate = lastSuspendStarted.getTime();

    if (suspendedPrior && (currentEvent.date < firstResumeDate)) {
        if ((currentEvent.date+(Number(currentEvent.duration))*MS_PER_MINUTE) < firstResumeDate) {
            currentEvent.duration = 0;
        } else {
            currentEvent.duration = ((currentEvent.date+(Number(currentEvent.duration))*MS_PER_MINUTE)-firstResumeDate)/MS_PER_MINUTE;

            currentEvent.started_at = new Date(firstResumeTime);
            currentEvent.date = firstResumeDate
        }
    }

    if (currentlySuspended && ((currentEvent.date+(Number(currentEvent.duration))*MS_PER_MINUTE) > lastSuspendDate)) {
        if (currentEvent.date > lastSuspendDate) {
            currentEvent.duration = 0;
        } else {
            currentEvent.duration = (firstResumeDate - currentEvent.date)/MS_PER_MINUTE;
        }
    }

    events.push(currentEvent);

    if (currentEvent.duration === 0) {
        // bail out rather than wasting time going through the rest of the suspend events
        return events;
    }

    for (let suspendIdx = 0; suspendIdx < pumpSuspends.length; suspendIdx++) {
        const suspend = pumpSuspends[suspendIdx];

        for (let eventIdx = 0; eventIdx < events.length; eventIdx++) {

            if ((events[eventIdx].date <= suspend.date) && (events[eventIdx].date+(Number(events[eventIdx].duration))*MS_PER_MINUTE) > suspend.date) {
                // event started before the suspend, but finished after the suspend started

                if ((events[eventIdx].date+(Number(events[eventIdx].duration))*MS_PER_MINUTE) > (suspend.date+(Number(suspend.duration))*MS_PER_MINUTE)) {
                    const event2 = cloneTempEvent(events[eventIdx]);

                    const event2StartMs = Number(suspend.started_at) + (Number(suspend.duration))*MS_PER_MINUTE;
                    const event2StartDate = new Date(event2StartMs);

                    event2.timestamp = event2StartDate.toISOString();
                    event2.started_at = new Date(event2.timestamp);
                    event2.date = suspend.date+(Number(suspend.duration))*MS_PER_MINUTE;

                    event2.duration = ((events[eventIdx].date+(Number(events[eventIdx].duration))*MS_PER_MINUTE) - (suspend.date+(Number(suspend.duration))*MS_PER_MINUTE))/MS_PER_MINUTE;

                    events.push(event2);
                }

                events[eventIdx].duration = (suspend.date-events[eventIdx].date)/MS_PER_MINUTE;

            } else if ((suspend.date <= events[eventIdx].date) && (suspend.date+(Number(suspend.duration))*MS_PER_MINUTE > events[eventIdx].date)) {
                // suspend started before the event, but finished after the event started

                events[eventIdx].duration = ((events[eventIdx].date+(Number(events[eventIdx].duration))*MS_PER_MINUTE) - (suspend.date+(Number(suspend.duration))*MS_PER_MINUTE))/MS_PER_MINUTE;

                const eventStartMs = Number(suspend.started_at) + (Number(suspend.duration))*MS_PER_MINUTE;
                const eventStartDate = new Date(eventStartMs);

                events[eventIdx].timestamp = eventStartDate.toISOString();
                events[eventIdx].started_at = new Date(String(events[eventIdx].timestamp));
                events[eventIdx].date = suspend.date + (Number(suspend.duration))*MS_PER_MINUTE;
            }
        }
    }

    return events;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deep-clone a TempEvent, preserving Date fields, works in Swift with JavaScriptCore */
function cloneTempEvent(event: TempEvent): TempEvent {
    return {
        ...event,
        started_at: event.started_at ? new Date(event.started_at.getTime()) : undefined,
        created_at: event.created_at ? new Date(event.created_at.getTime()) : undefined,
    };
}
