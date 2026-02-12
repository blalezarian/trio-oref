
function getTime(minutes: number): number {
    var baseTime = new Date();
    baseTime.setHours(0);
    baseTime.setMinutes(0);
    baseTime.setSeconds(0);

    return baseTime.getTime() + minutes * 60 * 1000;
}

export default getTime;
