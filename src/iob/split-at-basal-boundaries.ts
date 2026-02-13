
import _ from 'lodash';
import moment from 'moment';
import type {
    TempEvent,
    SplitterEvent,
} from './types';
import {
    TEMP_BASAL_DURATION_MINUTES,
    MINUTES_PER_DAY,
} from '../constants';

export function splitTimespanWithOneSplitter(
    event: TempEvent,
    splitter: SplitterEvent,
): TempEvent[] {

    let resultArray: TempEvent[] = [event];

    if (splitter.type === 'recurring') {

        const startMinutes = event.started_at!.getHours() * 60 + event.started_at!.getMinutes();
        const endMinutes = startMinutes + event.duration!;

        // MINUTES_PER_DAY = one day; no clean way to check if the event overlaps midnight
        // so checking if end of event in minutes is past midnight

        if (event.duration! > TEMP_BASAL_DURATION_MINUTES || (startMinutes < splitter.minutes && endMinutes > splitter.minutes) || (endMinutes > MINUTES_PER_DAY && splitter.minutes < (endMinutes - MINUTES_PER_DAY))) {

            const event1 = _.cloneDeep(event);
            const event2: TempEvent = _.cloneDeep(event);

            let event1Duration = 0;

            if (event.duration! > TEMP_BASAL_DURATION_MINUTES) {
                event1Duration = TEMP_BASAL_DURATION_MINUTES;
            } else {
                let splitPoint = splitter.minutes;
                if (endMinutes > MINUTES_PER_DAY) { splitPoint = MINUTES_PER_DAY; }
                event1Duration = splitPoint - startMinutes;
            }

            const event1EndDate = moment(event.started_at).add(event1Duration,'minutes');

            event1.duration = event1Duration;

            event2.duration  = event.duration! - event1Duration;
            event2.timestamp = event1EndDate.format();
            event2.started_at = new Date(event2.timestamp);
            event2.date = event2.started_at.getTime();

            resultArray = [event1,event2];
        }
    }

    return resultArray;
}

export function splitTimespan(
    event: TempEvent,
    splitterMoments: SplitterEvent[],
): TempEvent[] {

    let results: TempEvent[] = [event];

    let splitFound = true;

    while(splitFound) {

        let resultArray: TempEvent[] = [];
        splitFound = false;

        _.forEach(results, (o) => {
            _.forEach(splitterMoments, (p) => {
                const splitResult = splitTimespanWithOneSplitter(o,p);
                if (splitResult.length > 1) {
                    resultArray = resultArray.concat(splitResult);
                    splitFound = true;
                    return false;
                }
            });

            if (!splitFound) resultArray = resultArray.concat([o]);

        });

        results = resultArray;
    }

    return results;
}
