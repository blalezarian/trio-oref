/** Large sentinel for initializing minimum-deviation search */
export const INITIAL_MIN_DEVIATION = 1000000;

/**
 * Index of the current value in the 5-element deviations array.
 * Layout: [current−2, current−1, **current**, current+1, current+2]
 */
export const CURRENT_INDEX = 2;
