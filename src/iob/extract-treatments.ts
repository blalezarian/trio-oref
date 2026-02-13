
import tz from 'moment-timezone';
import _ from 'lodash';
import type { PumpHistoryEvent } from '../types/index';
import type {
    IobInputs,
    IobTreatment,
    TempEvent,
    SplitterEvent,
} from './types';
import {
    MS_PER_MINUTE,
    MS_PER_HOUR,
    MAX_DIA_FOR_SUSPEND_HOURS,
} from '../constants';
import { splitTimespan } from './split-at-basal-boundaries';
import { splitAroundSuspends } from './split-around-suspends';
import { extractSuspendResumeData } from './extract-suspends';
import { extractTempBasalsAndBoluses } from './extract-temp-basals';
import { convertNetBasalsToTreatments } from './convert-net-basals';

export function calcTempTreatments (
    inputs: IobInputs,
    zeroTempDuration?: number,
): IobTreatment[] {
    let pumpHistory: PumpHistoryEvent[] = inputs.history;
    const profile_data = inputs.profile;
    const autosens_data = inputs.autosens;
    const now = new Date(tz(inputs.clock));

    if(inputs.history24) {
        pumpHistory = [...inputs.history, ...inputs.history24];
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
        splitterEvents.push({ type: 'recurring' as const, minutes: o.minutes });
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

    let all_data: TempEvent[] = [...tempBoluses, ...netBasalBoluses, ...tempHistory];
    all_data = _.sortBy(all_data, 'date');
    return all_data;
}
export default calcTempTreatments;
