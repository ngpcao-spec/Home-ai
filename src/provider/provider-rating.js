// Display precision only. Averages/counts remain calculated by PostgreSQL.
export function formatProviderRating(value) {
  const rating=Number(value);
  return Number.isFinite(rating) && rating>=0 && rating<=5 ? String(Number(rating.toFixed(1))) : '0';
}
