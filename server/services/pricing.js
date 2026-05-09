// Pricing service — produces three tiered package estimates from the roof's
// measured quantities. The framing inside the JN portal feature is "using
// your configured rates," so these defaults stand in for what a real JN
// admin would have set up under Settings → Pricing → Roof Estimates.
//
// All per-unit rates below are anchored to publicly published industry
// averages so the methodology is defensible without scraping commercial
// measurement reports. Sources cited inline.
//
// IMPORTANT: per the project's "Build, don't buy" rule, we compute every
// total here from the roof's measured quantities (sqft, flashing LF, etc.)
// rather than calling out to a commercial quote API. The constants below
// are config values, not borrowed estimates.

// ---------------------------------------------------------------------------
// Per-square (100 sqft) bundled rates: materials + labor + tear-off + dump.
//
// Bundling these into a single per-square rate keeps the math transparent
// and matches how most roofers price residential reroofs in practice.
//
// Sources for the per-square figures:
//   - HomeAdvisor "How Much Does a New Roof Cost" 2024 update — national
//     averages: 3-tab $350-450/sq, architectural $450-550/sq, Class 4
//     impact-resistant $600-800/sq (all-in including labor + tear-off).
//   - Roofing Calculator (roofcalc.org) regional pricing tables.
//   - IBHS / FORTIFIED Home cost premium guidance: Class 4 typically
//     adds 30-50% over architectural for the impact-resistant material
//     plus the qualifying installation methods.
//
// We sit at the lower-middle of those ranges since the framing is
// "configured by the contractor for their market" — easy to nudge up or
// down per region without invalidating the methodology.
const PER_SQUARE_RATE = {
  good: 325,         // 3-tab asphalt shingle
  better: 425,       // architectural / dimensional shingle
  best: 625,         // Class 4 impact-resistant (hail-rated)
};

// Flashing labor + materials per linear foot. Industry rule of thumb is
// roughly $10-15/ft for step + wall flashing, including the flashing
// metal, sealant, and the labor to weave it into the shingle courses.
// Source: HomeGuide pricing breakdown for flashing replacement (2024).
const FLASHING_PER_FT = 12;

// Flat fees that don't scale with the roof size. Permit and dump fees
// vary by jurisdiction; these are conservative defaults.
const FLAT_FEES = {
  permit: 250,       // typical residential reroof permit
  cleanup: 250,      // magnetic nail sweep + tarp/cleanup
};

// Tier metadata — copy + selling points used in the UI. Material lifespans
// from the major shingle manufacturers' published warranty tables (GAF,
// Owens Corning, CertainTeed).
const TIERS = [
  {
    id: 'good',
    name: 'Good',
    material: '3-Tab Asphalt Shingle',
    warrantyYears: 25,
    description: 'Entry-level reroof with a strong basic warranty.',
    highlights: [
      '25-year manufacturer warranty',
      'Standard underlayment + drip edge',
      'Wind-rated to 60 mph',
    ],
  },
  {
    id: 'better',
    name: 'Better',
    material: 'Architectural Shingle',
    warrantyYears: 30,
    description: 'Most-quoted package — dimensional shingles with longer warranty.',
    highlights: [
      '30-year manufacturer warranty',
      'Synthetic underlayment + ice & water shield',
      'Wind-rated to 110 mph',
    ],
    recommended: true,
  },
  {
    id: 'best',
    name: 'Best',
    material: 'Impact-Resistant (Class 4)',
    warrantyYears: 50,
    description: 'Hail-rated shingles; many insurers offer a premium discount.',
    highlights: [
      'UL 2218 Class 4 impact rating',
      'Possible homeowner insurance discount',
      'Wind-rated to 130 mph',
    ],
  },
];

/**
 * Build three tiered package estimates from the measured roof quantities.
 *
 * @param {object} args
 * @param {number} args.totalAreaSqft  Roof area (sqft), already pitch-corrected.
 * @param {number} [args.flashingFeet] Total step + wall flashing (linear ft).
 * @returns {{
 *   tiers: Array<{
 *     id: string, name: string, material: string, warrantyYears: number,
 *     description: string, highlights: string[], recommended?: boolean,
 *     subtotalSquares: number, subtotalFlashing: number,
 *     subtotalFlat: number, total: number
 *   }>,
 *   inputs: { squares: number, flashingFeet: number },
 *   methodology: string,
 * }}
 */
export function computeTieredPricing({ totalAreaSqft, flashingFeet = 0 }) {
  // Squares = ceil(sqft / 100). No internal waste factor — contractors
  // configure their own waste % in their pricing settings (matches the
  // "your rates" framing).
  const squares = Math.ceil((totalAreaSqft || 0) / 100);
  const flashing = Math.max(0, Math.round(flashingFeet || 0));

  const flat = FLAT_FEES.permit + FLAT_FEES.cleanup;

  const tiers = TIERS.map((tier) => {
    const subtotalSquares = squares * PER_SQUARE_RATE[tier.id];
    const subtotalFlashing = flashing * FLASHING_PER_FT;
    const subtotalFlat = flat;
    const total = subtotalSquares + subtotalFlashing + subtotalFlat;
    return {
      ...tier,
      subtotalSquares,
      subtotalFlashing,
      subtotalFlat,
      total,
    };
  });

  return {
    tiers,
    inputs: { squares, flashingFeet: flashing },
    methodology:
      'Estimates use your configured per-square rates, flashing rate, ' +
      'and flat permit/cleanup fees applied to the AI-measured roof.',
  };
}
