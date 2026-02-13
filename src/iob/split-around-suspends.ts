
import _ from 'lodash';
import moment from 'moment';
import tz from 'moment-timezone';
import type {
    TempEvent,
    SuspendEvent,
} from './types';
import { MS_PER_MINUTE } from '../constants';

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
        if ((currentEvent.date+currentEvent.duration!*MS_PER_MINUTE) < firstResumeDate) {
            currentEvent.duration = 0;
        } else {
            currentEvent.duration = ((currentEvent.date+currentEvent.duration!*MS_PER_MINUTE)-firstResumeDate)/MS_PER_MINUTE;

            currentEvent.started_at = new Date(tz(firstResumeTime));
            currentEvent.date = firstResumeDate
        }
    }

    if (currentlySuspended && ((currentEvent.date+currentEvent.duration!*MS_PER_MINUTE) > lastSuspendDate)) {
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

        for (let j=0; j < events.length; j++) {

            if ((events[j].date <= suspend.date) && (events[j].date+events[j].duration!*MS_PER_MINUTE) > suspend.date) {
                // event started before the suspend, but finished after the suspend started

                if ((events[j].date+events[j].duration!*MS_PER_MINUTE) > (suspend.date+suspend.duration!*MS_PER_MINUTE)) {
                    const event2: TempEvent = _.cloneDeep(events[j]);

                    const event2StartDate = moment(suspend.started_at).add(suspend.duration,'minutes');

                    event2.timestamp = event2StartDate.format();
                    event2.started_at = new Date(tz(event2.timestamp));
                    event2.date = suspend.date+suspend.duration!*MS_PER_MINUTE;

                    event2.duration = ((events[j].date+events[j].duration!*MS_PER_MINUTE) - (suspend.date+suspend.duration!*MS_PER_MINUTE))/MS_PER_MINUTE;

                    events.push(event2);
                }

                events[j].duration = (suspend.date-events[j].date)/MS_PER_MINUTE;

            } else if ((suspend.date <= events[j].date) && (suspend.date+suspend.duration!*MS_PER_MINUTE > events[j].date)) {
                // suspend started before the event, but finished after the event started

                events[j].duration = ((events[j].date+events[j].duration!*MS_PER_MINUTE) - (suspend.date+suspend.duration!*MS_PER_MINUTE))/MS_PER_MINUTE;

                const eventStartDate = moment(suspend.started_at).add(suspend.duration,'minutes');

                events[j].timestamp = eventStartDate.format();
                events[j].started_at = new Date(tz(events[j].timestamp));
                events[j].date = suspend.date + suspend.duration!*MS_PER_MINUTE;
            }
        }
    }

    return events;
}
