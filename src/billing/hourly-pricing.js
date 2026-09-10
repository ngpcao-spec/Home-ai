const MAX_RATE_VND = 1_000_000_000;
const MAX_WORKED_MINUTES = 10_080;
const MAX_MATERIAL_VND = 1_000_000_000_000;

const integer = (value) => Number.isInteger(Number(value)) ? Number(value) : Number.NaN;

export function calculateHourlyInvoice({ hourlyRate, minimumCharge, hours, minutes, materialAmount = 0 }) {
  const rate = integer(hourlyRate);
  const minimum = integer(minimumCharge);
  const wholeHours = integer(hours);
  const extraMinutes = integer(minutes);
  const material = integer(materialAmount);
  if (rate < 1 || rate > MAX_RATE_VND || minimum < 0 || minimum > MAX_MATERIAL_VND
      || wholeHours < 0 || extraMinutes < 0 || extraMinutes > 59
      || material < 0 || material > MAX_MATERIAL_VND) {
    throw new RangeError('Invalid hourly invoice values');
  }
  const workedMinutes = wholeHours * 60 + extraMinutes;
  if (workedMinutes < 1 || workedMinutes > MAX_WORKED_MINUTES) {
    throw new RangeError('Worked duration must be between 1 minute and 168 hours');
  }
  // Positive VND values use round-half-up, mirrored by the PostgreSQL RPC.
  const calculatedLabor = Math.floor((rate * workedMinutes + 30) / 60);
  const laborAmount = Math.max(minimum, calculatedLabor);
  return Object.freeze({
    pricingModel: 'hourly', hourlyRate: rate, minimumCharge: minimum,
    hours: wholeHours, minutes: extraMinutes, workedMinutes,
    laborAmount, materialAmount: material, totalAmount: laborAmount + material,
    currency: 'VND',
  });
}

export const hourlyPricingLimits = Object.freeze({
  maxRate: MAX_RATE_VND,
  maxWorkedMinutes: MAX_WORKED_MINUTES,
  maxMaterial: MAX_MATERIAL_VND,
});
