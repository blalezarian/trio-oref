
import type {
    TempEvent,
    SuspendEvent,
} from './types';
import { MS_PER_MINUTE } from '../constants';

/** Deep-clone a TempEvent, preserving Date fields, works in Swift with JavaScriptCore */
function cloneTempEvent(event: TempEvent): TempEvent {
    return {
        ...event,
        started_at: event.started_at ? new Date(event.started_at.getTime()) : undefined,
        created_at: event.created_at ? new Date(event.created_at.getTime()) : undefined,
    };
}

// Split currentEvent around any conflicting suspends
// by removing the time period from the event that
// overlaps with any suspend.
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
        if ((currentEvent.date+(currentEvent.duration as number)*MS_PER_MINUTE) < firstResumeDate) {
            currentEvent.duration = 0;
        } else {
            currentEvent.duration = ((currentEvent.date+(currentEvent.duration as number)*MS_PER_MINUTE)-firstResumeDate)/MS_PER_MINUTE;

            currentEvent.started_at = new Date(firstResumeTime);
            currentEvent.date = firstResumeDate
        }
    }

    if (currentlySuspended && ((currentEvent.date+(currentEvent.duration as number)*MS_PER_MINUTE) > lastSuspendDate)) {
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

    for (let i=0; i < pumpSuspends.length; i++) {
        const suspend = pumpSuspends[i];

        for (let eventIndex=0; eventIndex < events.length; eventIndex++) {

            if ((events[eventIndex].date <= suspend.date) && (events[eventIndex].date+(events[eventIndex].duration as number)*MS_PER_MINUTE) > suspend.date) {
                // event started before the suspend, but finished after the suspend started

                if ((events[eventIndex].date+(events[eventIndex].duration as number)*MS_PER_MINUTE) > (suspend.date+(suspend.duration as number)*MS_PER_MINUTE)) {
                    const event2 = cloneTempEvent(events[eventIndex]);

                    const event2StartMs = (suspend.started_at as Date).getTime() + (suspend.duration as number)*MS_PER_MINUTE;
                    const event2StartDate = new Date(event2StartMs);

                    event2.timestamp = event2StartDate.toISOString();
                    event2.started_at = new Date(event2.timestamp);
                    event2.date = suspend.date+(suspend.duration as number)*MS_PER_MINUTE;

                    event2.duration = ((events[eventIndex].date+(events[eventIndex].duration as number)*MS_PER_MINUTE) - (suspend.date+(suspend.duration as number)*MS_PER_MINUTE))/MS_PER_MINUTE;

                    events.push(event2);
                }

                events[eventIndex].duration = (suspend.date-events[eventIndex].date)/MS_PER_MINUTE;

            } else if ((suspend.date <= events[eventIndex].date) && (suspend.date+(suspend.duration as number)*MS_PER_MINUTE > events[eventIndex].date)) {
                // suspend started before the event, but finished after the event started

                events[eventIndex].duration = ((events[eventIndex].date+(events[eventIndex].duration as number)*MS_PER_MINUTE) - (suspend.date+(suspend.duration as number)*MS_PER_MINUTE))/MS_PER_MINUTE;

                const eventStartMs = (suspend.started_at as Date).getTime() + (suspend.duration as number)*MS_PER_MINUTE;
                const eventStartDate = new Date(eventStartMs);

                events[eventIndex].timestamp = eventStartDate.toISOString();
                events[eventIndex].started_at = new Date(events[eventIndex].timestamp as string);
                events[eventIndex].date = suspend.date + (suspend.duration as number)*MS_PER_MINUTE;
            }
        }
    }

    return events;
}
