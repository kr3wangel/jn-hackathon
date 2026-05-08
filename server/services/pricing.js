import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const configDir = join(__dirname, '..', 'config', 'pricing');

function loadPricingConfig(zip) {
  try {
    const data = readFileSync(join(configDir, `${zip}.json`), 'utf-8');
    return JSON.parse(data);
  } catch {
    const data = readFileSync(join(configDir, 'default.json'), 'utf-8');
    return JSON.parse(data);
  }
}

export function generateEstimate(roofData, visionData, zip) {
  const config = loadPricingConfig(zip);
  const squares = roofData.roofingSquares;
  const stories = visionData?.stories || 1;
  const storyMultiplier = stories > 1 ? 1 + (stories - 1) * 0.10 : 1.0;
  const condition = visionData?.condition || 'fair';

  const tearOffMultiplier = condition === 'poor' ? 1.25 : condition === 'fair' ? 1.1 : 1.0;

  const tiers = config.tiers.map((tier) => {
    const materialCost = tier.materialPerSquare * squares;
    const laborCost = tier.laborPerSquare * squares * storyMultiplier;
    const tearOff = config.tearOffPerSquare * squares * tearOffMultiplier;
    const dumpFees = config.dumpFeePerSquare * squares;
    const permit = config.permitFee;
    const subtotal = materialCost + laborCost + tearOff + dumpFees + permit;
    const margin = subtotal * config.marginPercent;
    const total = subtotal + margin;

    return {
      name: tier.name,
      label: tier.label,
      material: tier.materialType,
      warranty: tier.warranty,
      items: [
        { name: `${tier.materialType} shingles`, quantity: squares, unit: 'squares', unitPrice: tier.materialPerSquare, total: materialCost },
        { name: 'Labor', quantity: squares, unit: 'squares', unitPrice: tier.laborPerSquare * storyMultiplier, total: laborCost },
        { name: 'Tear-off & disposal', quantity: squares, unit: 'squares', unitPrice: config.tearOffPerSquare * tearOffMultiplier, total: tearOff },
        { name: 'Dump fees', quantity: squares, unit: 'squares', unitPrice: config.dumpFeePerSquare, total: dumpFees },
        { name: 'Permit', quantity: 1, unit: 'flat', unitPrice: permit, total: permit },
      ],
      subtotal: round(subtotal),
      margin: round(margin),
      total: round(total),
    };
  });

  return {
    squares,
    stories,
    storyMultiplier,
    condition,
    tearOffMultiplier,
    tiers,
    pricingSource: config.source,
    pricingRegion: config.region,
  };
}

function round(n) {
  return Math.round(n * 100) / 100;
}
