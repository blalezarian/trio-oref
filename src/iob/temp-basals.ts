
import tz from 'moment-timezone';
import type { PumpHistoryEvent } from '../types/index';
import type {
    TempEvent,
    TempBasalsAndBoluses,
} from './types';
import {
    MS_PER_MINUTE,
    MINUTES_PER_HOUR,
} from '../constants';

export function extractTempBasalsAndBoluses(
    pumpHistory: PumpHistoryEvent[],
    now: Date,
    zeroTempDuration?: number,
): TempBasalsAndBoluses {
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
