const METER_FLOOR_DB = -60;

/** Map a linear audio peak onto a readable meter scale with a quiet floor. */
export const meetingMeterScale = (peak: number): number => {
  if (!Number.isFinite(peak) || peak <= 0) return 0;
  const decibels = 20 * Math.log10(Math.min(1, peak));
  return Math.max(0, Math.min(1, (decibels - METER_FLOOR_DB) / -METER_FLOOR_DB));
};
