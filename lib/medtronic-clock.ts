
function getTime(minutes: number): number {
    var baseTime = new Date();
    baseTime.setHours('00' as unknown as number);
    baseTime.setMinutes('00' as unknown as number);
    baseTime.setSeconds('00' as unknown as number);

    return baseTime.getTime() + minutes * 60 * 1000;
}

export default getTime;
