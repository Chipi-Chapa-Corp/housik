export function validDate(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    !Number.isFinite(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  )
    throw new Error('Choose a valid date.');
  return value;
}

const day = 24 * 60 * 60 * 1000;

export function departureDate(arrival: string, nights: number) {
  return new Date(Date.parse(validDate(arrival)) + nights * day).toISOString().slice(0, 10);
}

export function tripNights(arrival: string, departure: string) {
  const nights = (Date.parse(validDate(departure)) - Date.parse(validDate(arrival))) / day;
  if (nights < 1) throw new Error('Departure must be after arrival.');
  if (nights > 365) throw new Error('Trips can be at most 365 nights.');
  return nights;
}
