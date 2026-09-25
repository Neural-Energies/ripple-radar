/** Live reads of two textbook structures.
 *
 * The policy rate is Taylor (1993): r* + inflation + 0.5(inflation − 2) + 0.5(output gap).
 * The output gap uses Okun's law with a coefficient of 2: −2 × (unemployment − natural rate).
 * r* is an outside estimate, not something this file invents.
 *
 * Conflict is the gap between wage growth and price growth. It is not a calibrated simulator.
 */

export function taylorRule(input: {
  funds: number;
  inflation: number;
  unemployment: number;
  nairu: number;
  rStar: number;
}) {
  const gap = -2 * (input.unemployment - input.nairu);
  const rule = input.rStar + input.inflation + 0.5 * (input.inflation - 2) + 0.5 * gap;
  return {
    gap,
    rule,
    stance: input.funds - rule,
  };
}

export function conflictGap(wageYoy: number, priceYoy: number) {
  return wageYoy - priceYoy;
}

/** Excel serial day to YYYY-MM-DD. The 1900 leap bug does not affect modern dates. */
export function excelDate(serial: number): string {
  const ms = Date.UTC(1899, 11, 30) + Math.round(serial) * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}
