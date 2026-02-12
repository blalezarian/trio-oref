
import tz from 'moment-timezone';
import basalprofile from '../profile/basal';
import _ from 'lodash';
import moment from 'moment';
import type { PumpHistoryEvent, PumpHistoryEventType, InsulinCurve } from '../types/index';
import {
    MS_PER_MINUTE,
    MS_PER_HOUR,
    MINUTES_PER_DAY,
    TEMP_BASAL_DURATION_MINUTES,
    EXERCISE_NORMAL_TARGET,
    EXERCISE_HALF_BASAL_TARGET,
    MAX_DIA_FOR_SUSPEND_HOURS,
    MINUTES_PER_HOUR,
} from '../constants';

interface HistoryBasalProfileEntry {
    i: number;
    start: string;
    rate: number;
    minutes: number;
}

interface HistoryProfile {
    dia: number;
    curve?: InsulinCurve;
    basalprofile: HistoryBasalProfileEntry[];
    current_basal: number;
    max_daily_basal?: number;
    min_bg?: number;
    max_bg?: number;
    exercise_mode?: boolean;
    temptargetSet?: boolean;
    half_basal_exercise_target?: number;
    suspend_zeros_iob?: boolean;
}

interface HistoryInputs {
    clock: string;
    history: PumpHistoryEvent[];
    history24?: PumpHistoryEvent[];
    profile: HistoryProfile;
    autosens?: { ratio: number };
}

interface HistoryTreatment {
    insulin?: number;
    date: number;
    created_at?: Date;
    started_at?: Date;
    timestamp?: string;
    rate?: number;
    duration?: number;
}

interface TempEvent {
    _type?: PumpHistoryEventType | (string & {});
    rate?: number;
    duration?: number;
    date: number;
    timestamp?: string;
    started_at?: Date;
    created_at?: Date;
    insulin?: number;
}

interface SplitterEvent {
    type: 'recurring';
    minutes: number;
}

interface SuspendEvent {
    timestamp?: string;
    started_at?: Date;
    date: number;
    duration?: number;
}

interface SuspendResumeData {
    pumpSuspends: SuspendEvent[];
    suspendedPrior: boolean;
    firstResumeTime: string;
    lastSuspendTime: string;
    currentlySuspended: number | false;
}

interface TempBasalsAndBoluses {
    tempHistory: TempEvent[];
    tempBoluses: TempEvent[];
}

function splitTimespanWithOneSplitter(event: TempEvent, splitter: SplitterEvent): TempEvent[] {

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

function splitTimespan(event: TempEvent, splitterMoments: SplitterEvent[]): TempEvent[] {

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

// Split currentEvent around any conflicting suspends
// by removing the time period from the event that
// overlaps with any suspend.
function splitAroundSuspends (currentEvent: TempEvent, pumpSuspends: SuspendEvent[], firstResumeTime: string, suspendedPrior: boolean, lastSuspendTime: string, currentlySuspended: number | false): TempEvent[] {
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

    if (currentlySuspended && ((currentEvent.date+currentEvent.duration!*MS_PER_MINUTE) > (lastSuspendTime as unknown as number))) {
        if (currentEvent.date > (lastSuspendTime as unknown as number)) {
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

function extractSuspendResumeData(pumpHistory: PumpHistoryEvent[]): SuspendResumeData {
    let pumpSuspends: SuspendEvent[] = [];
    let pumpResumes: SuspendEvent[] = [];
    let suspendedPrior = false;
    let firstResumeTime: string = undefined!;
    let lastSuspendTime: string = undefined!;
    let currentlySuspended: number | false = false;

    for (let i=0; i < pumpHistory.length; i++) {
        const temp: TempEvent = {} as TempEvent;

        const current: PumpHistoryEvent = pumpHistory[i];

        if (current._type === "PumpSuspend") {
            temp.timestamp = current.timestamp;
            temp.started_at = new Date(tz(current.timestamp));
            temp.date = temp.started_at.getTime();
            pumpSuspends.push(temp as SuspendEvent);
        } else if (current._type === "PumpResume") {
            temp.timestamp = current.timestamp;
            temp.started_at = new Date(tz(current.timestamp));
            temp.date = temp.started_at.getTime();
            pumpResumes.push(temp as SuspendEvent);
        }
    }

    pumpSuspends = _.sortBy(pumpSuspends, 'date');

    pumpResumes = _.sortBy(pumpResumes, 'date');

    if (pumpResumes.length > 0) {
        firstResumeTime = pumpResumes[0].timestamp!;

        // Check to see if our first resume was prior to our first suspend
        // indicating suspend was prior to our first event.
        if (pumpSuspends.length === 0 || (pumpResumes[0].date < pumpSuspends[0].date)) {
            suspendedPrior = true;
        }

    }

    let j=0;  // matching pumpResumes entry;

    let i: number;
    // Match the resumes with the suspends to get durations
    for (i=0; i < pumpSuspends.length; i++) {
        for (; j < pumpResumes.length; j++) {
            if (pumpResumes[j].date > pumpSuspends[i].date) {
                break;
            }
        }

        if ((j >= pumpResumes.length) && !currentlySuspended) {
            // even though it isn't the last suspend, we have reached
            // the final suspend. Set resume last so the
            // algorithm knows to suspend all the way
            // through the last record beginning at the last suspend
            // since we don't have a matching resume.
            currentlySuspended = 1;
            lastSuspendTime = pumpSuspends[i].timestamp!;

            break;
        }

        pumpSuspends[i].duration = (pumpResumes[j].date - pumpSuspends[i].date)/MS_PER_MINUTE;

    }

    // These checks indicate something isn't quite aligned.
    // Perhaps more resumes that suspends or vice versa...
    if (!suspendedPrior && !currentlySuspended && (pumpResumes.length !== pumpSuspends.length)) {
        console.error("Mismatched number of resumes("+pumpResumes.length+") and suspends("+pumpSuspends.length+")!");
    } else if (suspendedPrior && !currentlySuspended && ((pumpResumes.length-1) !== pumpSuspends.length)) {
        console.error("Mismatched number of resumes("+pumpResumes.length+") and suspends("+pumpSuspends.length+") assuming suspended prior to history block!");
    } else if (!suspendedPrior && currentlySuspended && (pumpResumes.length !== (pumpSuspends.length-1))) {
        console.error("Mismatched number of resumes("+pumpResumes.length+") and suspends("+pumpSuspends.length+") assuming suspended past end of history block!");
    } else if (suspendedPrior && currentlySuspended && (pumpResumes.length !== pumpSuspends.length)) {
        console.error("Mismatched number of resumes("+pumpResumes.length+") and suspends("+pumpSuspends.length+") assuming suspended prior to and past end of history block!");
    }

    if (i < (pumpSuspends.length-1)) {
        // truncate any extra suspends. if we had any extras
        // the error checks above would have issued a error log message
        pumpSuspends.splice(i+1, pumpSuspends.length-i-1);
    }

    return { pumpSuspends, suspendedPrior, firstResumeTime, lastSuspendTime, currentlySuspended };
}

function extractTempBasalsAndBoluses(pumpHistory: PumpHistoryEvent[], now: Date, zeroTempDuration?: number): TempBasalsAndBoluses {
    const tempHistory: TempEvent[] = [];
    const tempBoluses: TempEvent[] = [];
    let lastRecordTime = now;

    for (let i=0; i < pumpHistory.length; i++) {
        let current: PumpHistoryEvent = pumpHistory[i];
        if (current.bolus && current.bolus._type === "Bolus") {
            const temp: TempEvent = current as unknown as TempEvent;
            current = (temp as unknown as PumpHistoryEvent).bolus as PumpHistoryEvent;
        }
        if (current.created_at) {
            current.timestamp = current.created_at;
        }
        const currentRecordTime = new Date(tz(current.timestamp));
        //console.error(current);
        //console.error(currentRecordTime,lastRecordTime);
        // ignore duplicate or out-of-order records (due to 1h and 24h overlap, or timezone changes)
        if (currentRecordTime > lastRecordTime) {
            //console.error("",currentRecordTime," > ",lastRecordTime);
            //process.stderr.write(".");
            continue;
        } else {
            lastRecordTime = currentRecordTime;
        }
        if (current._type === "Bolus") {
            const temp: TempEvent = {} as TempEvent;
            temp.timestamp = current.timestamp;
            temp.started_at = new Date(tz(current.timestamp));
            if (temp.started_at > now) {
                //console.error("Warning: ignoring",current.amount,"U bolus in the future at",temp.started_at);
                process.stderr.write(" "+current.amount+"U @ "+temp.started_at);
            } else {
                temp.date = temp.started_at.getTime();
                temp.insulin = current.amount;
                tempBoluses.push(temp);
            }
        } else if (current.eventType === "Meal Bolus" || current.eventType === "Correction Bolus" || current.eventType === "Snack Bolus" || current.eventType === "Bolus Wizard") {
            //imports treatments entered through Nightscout Care Portal
            //"Bolus Wizard" refers to the Nightscout Bolus Wizard, not the Medtronic Bolus Wizard
            const temp: TempEvent = {} as TempEvent;
            temp.timestamp = current.created_at;
            temp.started_at = new Date(tz(temp.timestamp));
            temp.date = temp.started_at.getTime();
            temp.insulin = current.insulin;
            tempBoluses.push(temp);
        } else if (current.enteredBy === "xdrip") {
            const temp: TempEvent = {} as TempEvent;
            temp.timestamp = current.timestamp;
            temp.started_at = new Date(tz(temp.timestamp));
            temp.date = temp.started_at.getTime();
            temp.insulin = current.insulin;
            tempBoluses.push(temp);
        } else if (current.enteredBy ==="HAPP_App" && current.insulin) {
            const temp: TempEvent = {} as TempEvent;
            temp.timestamp = current.created_at;
            temp.started_at = new Date(tz(temp.timestamp));
            temp.date = temp.started_at.getTime();
            temp.insulin = current.insulin;
            tempBoluses.push(temp);
        } else if (current.eventType === "Temp Basal" && (current.enteredBy === "HAPP_App" || current.enteredBy === "openaps://AndroidAPS")) {
            const temp: TempEvent = {} as TempEvent;
            temp.rate = current.absolute;
            temp.duration = current.duration;
            temp.timestamp = current.created_at;
            temp.started_at = new Date(tz(temp.timestamp));
            temp.date = temp.started_at.getTime();
            tempHistory.push(temp);
        } else if (current.eventType === "Temp Basal") {
            const temp: TempEvent = {} as TempEvent;
            temp.rate = current.rate;
            temp.duration = current.duration;
            // Loop reports the amount of insulin actually delivered while the temp basal was running
            // use that to calculate the effective temp basal rate
            if (current.amount !== undefined) {
                temp.rate = current.amount / current.duration! * MINUTES_PER_HOUR;
            }
            temp.timestamp = current.timestamp;
            temp.started_at = new Date(tz(temp.timestamp));
            temp.date = temp.started_at.getTime();
            tempHistory.push(temp);
        } else if (current._type === "TempBasal") {
            if (current.temp === 'percent') {
                continue;
            }
            const rate = current.rate;
            const timestamp = current.timestamp;
            let duration: number | undefined;
            if (i>0 && pumpHistory[i-1].timestamp === timestamp && pumpHistory[i-1]._type === "TempBasalDuration") {
                duration = pumpHistory[i-1]['duration (min)'] as number;
            } else {
                for (let iter=0; iter < pumpHistory.length; iter++) {
                    if (pumpHistory[iter].timestamp === timestamp && pumpHistory[iter]._type === "TempBasalDuration") {
                            duration = pumpHistory[iter]['duration (min)'] as number;
                            break;
                    }
                }

                if (duration === undefined) {
                    console.error("No duration found for "+rate+" U/hr basal "+timestamp, pumpHistory[i - 1], current, pumpHistory[i + 1]);
                }
            }
            const temp: TempEvent = {} as TempEvent;
            temp.rate = rate;
            temp.timestamp = current.timestamp;
            temp.started_at = new Date(tz(temp.timestamp));
            temp.date = temp.started_at.getTime();
            temp.duration = duration;
            tempHistory.push(temp);
        }
        // Add a temp basal cancel event to ignore future temps and reduce predBG oscillation
        const cancelTemp: TempEvent = {} as TempEvent;
        cancelTemp.rate = 0;
        // start the zero temp 1m in the future to avoid clock skew
        cancelTemp.started_at = new Date(now.getTime() + MS_PER_MINUTE);
        cancelTemp.date = cancelTemp.started_at.getTime();
        if (zeroTempDuration) {
            cancelTemp.duration = zeroTempDuration;
        } else {
            cancelTemp.duration = 0;
        }
        tempHistory.push(cancelTemp);
    }

    return { tempHistory, tempBoluses };
}

function convertNetBasalsToTreatments(splitHistory: TempEvent[], profile_data: HistoryProfile, autosens_data?: { ratio: number }): TempEvent[] {
    const tempBoluses: TempEvent[] = [];
    let tempBolusSize;
    let target_bg: number | undefined;

    for (let i=0; i < splitHistory.length; i++) {

        const currentItem = splitHistory[i];

        if (currentItem.duration! > 0) {

            let currentRate: number = profile_data.current_basal;
            if (!_.isEmpty(profile_data.basalprofile)) {
                currentRate = basalprofile.basalLookup(profile_data.basalprofile,new Date(currentItem.timestamp!))!;
            }

            if (profile_data.min_bg !== undefined && profile_data.max_bg !== undefined) {
                target_bg = (profile_data.min_bg + profile_data.max_bg) / 2;
            }
            //if (profile_data.temptargetSet && target_bg > 110) {
                //sensitivityRatio = 2/(2+(target_bg-100)/40);
                //currentRate = profile_data.current_basal * sensitivityRatio;
            //}
            let sensitivityRatio: number | undefined;
            const profile = profile_data;
            const normalTarget = EXERCISE_NORMAL_TARGET; // evaluate high/low temptarget against 100, not scheduled basal (which might change)
            let halfBasalTarget: number;
            if ( profile.half_basal_exercise_target ) {
                halfBasalTarget = profile.half_basal_exercise_target;
            } else {
                halfBasalTarget = EXERCISE_HALF_BASAL_TARGET; // when temptarget is 160 mg/dL, run 50% basal (120 = 75%; 140 = 60%)
            }
            if ( profile.exercise_mode && profile.temptargetSet && target_bg! >= normalTarget + 5 ) {
                // w/ target 100, temp target 110 = .89, 120 = 0.8, 140 = 0.67, 160 = .57, and 200 = .44
                // e.g.: Sensitivity ratio set to 0.8 based on temp target of 120; Adjusting basal from 1.65 to 1.35; ISF from 58.9 to 73.6
                const c = halfBasalTarget - normalTarget;
                sensitivityRatio = c/(c+target_bg!-normalTarget);
            } else if (autosens_data !== undefined ) {
                sensitivityRatio = autosens_data.ratio;
                //process.stderr.write("Autosens ratio: "+sensitivityRatio+"; ");
            }
            if ( sensitivityRatio ) {
                currentRate = currentRate * sensitivityRatio;
            }

            const netBasalRate = currentItem.rate! - currentRate;
            if (netBasalRate < 0) { tempBolusSize = -0.05; }
            else { tempBolusSize = 0.05; }
            const netBasalAmount = Math.round(netBasalRate*currentItem.duration!*10/6)/100
            const tempBolusCount = Math.round(netBasalAmount / tempBolusSize);
            const tempBolusSpacing = currentItem.duration! / tempBolusCount;
            for (let j=0; j < tempBolusCount; j++) {
                const tempBolus: TempEvent = {} as TempEvent;
                tempBolus.insulin = tempBolusSize;
                tempBolus.date = currentItem.date + j * tempBolusSpacing*MS_PER_MINUTE;
                tempBolus.created_at = new Date(tempBolus.date);
                tempBoluses.push(tempBolus);
            }
        }
    }
    return tempBoluses;
}

function calcTempTreatments (inputs: HistoryInputs, zeroTempDuration?: number): HistoryTreatment[] {
    let pumpHistory: PumpHistoryEvent[] = inputs.history;
    const profile_data = inputs.profile;
    const autosens_data = inputs.autosens;
    const now = new Date(tz(inputs.clock));

    if(inputs.history24) {
        pumpHistory =  ([] as PumpHistoryEvent[]).concat(inputs.history).concat(inputs.history24);
    }

    // Gather suspend/resume events and compute durations
    const { pumpSuspends, suspendedPrior, firstResumeTime, lastSuspendTime, currentlySuspended } = extractSuspendResumeData(pumpHistory);

    // Parse temp basals and boluses from pump history
    const { tempHistory: rawTempHistory, tempBoluses } = extractTempBasalsAndBoluses(pumpHistory, now, zeroTempDuration);

    // Check for overlapping events and adjust event lengths in case of overlap

    let tempHistory = _.sortBy(rawTempHistory, 'date');

    for (let i=0; i+1 < tempHistory.length; i++) {
        if (tempHistory[i].date + tempHistory[i].duration!*MS_PER_MINUTE > tempHistory[i+1].date) {
            tempHistory[i].duration = (tempHistory[i+1].date - tempHistory[i].date)/MS_PER_MINUTE;
            // Delete AndroidAPS "Cancel TBR records" in which duration is not populated
            if (tempHistory[i+1].duration === null) {
                tempHistory.splice(i+1, 1);
            }
        }
    }

    // Create an array of moments to slit the temps by
    // currently supports basal changes

    const splitterEvents: SplitterEvent[] = [];

    _.forEach(profile_data.basalprofile, (o) => {
        const splitterEvent: SplitterEvent = {} as SplitterEvent;
        splitterEvent.type = 'recurring';
        splitterEvent.minutes = o.minutes;
        splitterEvents.push(splitterEvent);
    });

    // iterate through the events and split at basal break points if needed

    let splitHistoryByBasal: TempEvent[] = [];

    _.forEach(tempHistory, (o) => {
        splitHistoryByBasal = splitHistoryByBasal.concat(splitTimespan(o,splitterEvents));
    });

    tempHistory = _.sortBy(tempHistory, (o) => { return o.date; });

    let suspend_zeros_iob: boolean = false;

    if (profile_data.suspend_zeros_iob !== undefined) {
        suspend_zeros_iob = profile_data.suspend_zeros_iob;
    }

    let splitHistory: TempEvent[];

    if (suspend_zeros_iob) {
        // iterate through the events and adjust their
        // times as required to account for pump suspends
        splitHistory = [];

        _.forEach(splitHistoryByBasal, (o) => {
            const splitEvents = splitAroundSuspends(o, pumpSuspends, firstResumeTime, suspendedPrior, lastSuspendTime, currentlySuspended);
            splitHistory = splitHistory.concat(splitEvents);
        });

        let zTempSuspendBasals: TempEvent[] = [];

        // Any existing temp basals during times the pump was suspended are now deleted
        // Add 0 temp basals to negate the profile basal rates during times pump is suspended
        _.forEach(pumpSuspends, (o) => {
            const zTempBasal: TempEvent[] = [{
                _type: 'SuspendBasal',
                rate: 0,
                duration: o.duration,
                date: o.date,
                started_at: o.started_at
            }];
            zTempSuspendBasals = zTempSuspendBasals.concat(zTempBasal);
        });

        // Add temp suspend basal for maximum DIA (8) up to the resume time
        // if there is no matching suspend in the history before the first
        // resume
        const max_dia_ago = now.getTime() - MAX_DIA_FOR_SUSPEND_HOURS*MS_PER_HOUR;
        const firstResumeStarted = new Date(firstResumeTime);
        const firstResumeDate = firstResumeStarted.getTime()

        // impact on IOB only matters if the resume occurred
        // after DIA hours before now.
        // otherwise, first resume date can be ignored. Whatever
        // insulin is present prior to resume will be aged
        // out due to DIA.
        if (suspendedPrior && (max_dia_ago < firstResumeDate)) {

            const suspendStart = new Date(max_dia_ago);
            const suspendStartDate = suspendStart.getTime()
            const started_at = new Date(tz(suspendStart.toISOString()));

            const zTempBasal: TempEvent[] = [{
               // add _type to aid debugging. It isn't used
               // anywhere.
                _type: 'SuspendBasal',
                rate: 0,
                duration: (firstResumeDate - max_dia_ago)/MS_PER_MINUTE,
                date: suspendStartDate,
                started_at: started_at
            }];
            zTempSuspendBasals = zTempSuspendBasals.concat(zTempBasal);
        }

        if (currentlySuspended) {
            const suspendStart = new Date(lastSuspendTime);
            const suspendStartDate = suspendStart.getTime()
            const started_at = new Date(tz(suspendStart.toISOString()));

            const zTempBasal: TempEvent[] = [{
                _type: 'SuspendBasal',
                rate: 0,
                duration: (now.getTime() - suspendStartDate)/MS_PER_MINUTE,
                date: suspendStartDate,
                timestamp: lastSuspendTime,
                started_at: started_at
            }];
            zTempSuspendBasals = zTempSuspendBasals.concat(zTempBasal);
        }

        // Add the new 0 temp basals to the splitHistory.
        // We have to split the new zero temp basals by the profile
        // basals just like the other temp basals.
        _.forEach(zTempSuspendBasals, (o) => {
            splitHistory = splitHistory.concat(splitTimespan(o,splitterEvents));
        });
    } else {
        splitHistory = splitHistoryByBasal;
    }

    splitHistory = _.sortBy(splitHistory, (o) => { return o.date; });

    // Convert net basals to treatment boluses
    const netBasalBoluses = convertNetBasalsToTreatments(splitHistory, profile_data, autosens_data);

    let all_data: TempEvent[] =  ([] as TempEvent[]).concat(tempBoluses).concat(netBasalBoluses).concat(tempHistory);
    all_data = _.sortBy(all_data, 'date');
    return all_data;
}
export default calcTempTreatments;
