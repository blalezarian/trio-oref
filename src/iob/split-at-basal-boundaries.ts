import type {
    TempEvent,
    SplitterEvent,
} from './types';
import {
    MS_PER_MINUTE,
    TEMP_BASAL_DURATION_MINUTES,
    MINUTES_PER_DAY,
} from '../shared/constants';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Deep-clone a TempEvent, preserving Date fields */
function cloneTempEvent(event: TempEvent): TempEvent {
    return {
        ...event,
        started_at: event.started_at ? new Date(event.started_at.getTime()) : undefined,
        created_at: event.created_at ? new Date(event.created_at.getTime()) : undefined,
    };
}

// ---------------------------------------------------------------------------
// Main functions
// ---------------------------------------------------------------------------

/**
 * Split a single temp event at one basal profile boundary (splitter). If the
 * event straddles the boundary or exceeds the maximum temp basal duration
 * (30 min), it is split into two events. Otherwise the original is returned.
 */
export function splitTimespanWithOneSplitter(
    event: TempEvent,
    splitter: SplitterEvent,
): TempEvent[] {

    let resultArray: TempEvent[] = [event];

    if (splitter.type === 'recurring') {

        const startMinutes = (event.started_at as Date).getHours() * 60 + (event.started_at as Date).getMinutes();
        const endMinutes = startMinutes + (event.duration as number);

        // MINUTES_PER_DAY = one day; no clean way to check if the event overlaps midnight
        // so checking if end of event in minutes is past midnight

        if ((event.duration as number) > TEMP_BASAL_DURATION_MINUTES || (startMinutes < splitter.minutes && endMinutes > splitter.minutes) || (endMinutes > MINUTES_PER_DAY && splitter.minutes < (endMinutes - MINUTES_PER_DAY))) {

            const event1 = cloneTempEvent(event);
            const event2 = cloneTempEvent(event);

            let event1Duration = 0;

            if ((event.duration as number) > TEMP_BASAL_DURATION_MINUTES) {
                event1Duration = TEMP_BASAL_DURATION_MINUTES;
            } else {
                let splitPoint = splitter.minutes;
                if (endMinutes > MINUTES_PER_DAY) { splitPoint = MINUTES_PER_DAY; }
                event1Duration = splitPoint - startMinutes;
            }

            const event1EndDate = new Date((event.started_at as Date).getTime() + event1Duration * MS_PER_MINUTE);

            event1.duration = event1Duration;

            event2.duration  = (event.duration as number) - event1Duration;
            event2.timestamp = event1EndDate.toISOString();
            event2.started_at = new Date(event2.timestamp);
            event2.date = event2.started_at.getTime();

            resultArray = [event1, event2];
        }
    }

    return resultArray;
}

/**
 * Iteratively split a temp event at all basal profile boundaries. Repeats
 * until no further splits are possible, handling events that span multiple
 * basal schedule segments.
 */
export function splitTimespan(
    event: TempEvent,
    splitterEvents: SplitterEvent[],
): TempEvent[] {

    let results: TempEvent[] = [event];

    let splitFound = true;

    while(splitFound) {

        let resultArray: TempEvent[] = [];
        splitFound = false;

        for (const tempEvent of results) {
            for (const splitterEvent of splitterEvents) {
                const splitResult = splitTimespanWithOneSplitter(tempEvent, splitterEvent);
                if (splitResult.length > 1) {
                    resultArray = resultArray.concat(splitResult);
                    splitFound = true;
                    break;
                }
            }

            if (!splitFound) resultArray = resultArray.concat([tempEvent]);

        }

        results = resultArray;
    }

    return results;
}
