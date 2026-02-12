
import { MS_PER_MINUTE } from './constants';

function getTime(minutes: number): number {
    var baseTime = new Date();
    baseTime.setHours(0);
    baseTime.setMinutes(0);
    baseTime.setSeconds(0);

    return baseTime.getTime() + minutes * MS_PER_MINUTE;
}

export default getTime;
