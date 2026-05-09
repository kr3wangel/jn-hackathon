import dotenv from 'dotenv';
import { writeFileSync, existsSync, readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __filename = fileURLToPath(import.meta.url);
const PROJECT_ROOT = join(dirname(__filename), '..');
dotenv.config({ path: join(PROJECT_ROOT, '.env'), override: true });

import { geocodeAddress } from '../server/services/geocode.js';
import { fetchBuildingInsights } from '../server/services/solar.js';
import { fetchImagery } from '../server/services/imagery.js';
import { fetchRoofPolygon } from '../server/services/roofMask.js';
import { computeLineItems } from '../server/services/roofMeasurements.js';
import { analyzeProperty } from '../server/services/vision.js';

const RESULTS_FILE = join(dirname(__filename), 'benchmark-results.json');

const BENCHMARK_PROPERTIES = [
  {
    label: 'Humble TX',
    address: '21106 Kenswick Meadows Ct, Humble, TX 77338',
    ref: {
      sqft: { a: 2443, b: 2343 },
      pitch: '6:12',
      ridge: { a: null, b: 26, combined_a: 141 },
      hip: { a: null, b: 101, combined_a: 141 },
      valley: { a: 40, b: 38 },
      rake: { a: 101, b: 83 },
      eave: { a: 187, b: 164 },
    },
  },
  {
    label: 'Spring TX',
    address: '5914 Copper Lilly Lane, Spring, TX 77389',
    ref: {
      sqft: { a: 4391, b: 4296 },
      pitch: '8:12',
      ridge: { a: 79, b: 77 },
      hip: { a: 321, b: 348 },
      valley: { a: 197, b: 195 },
      rake: { a: 121, b: 119 },
      eave: { a: 324, b: 293 },
    },
  },
  {
    label: 'Cape Coral FL',
    address: '122 NW 13th Ave, Cape Coral, FL 33993',
    ref: {
      sqft: { a: 2917, b: 2851 },
      pitch: '6:12',
      ridge: { a: 59, b: 59 },
      hip: { a: 83, b: 81 },
      valley: { a: 22, b: 21 },
      rake: { a: 51, b: 49 },
      eave: { a: 201, b: 198 },
    },
  },
  {
    label: 'Orland Park IL',
    address: '14132 Trenton Ave, Orland Park, IL 60462',
    ref: {
      sqft: { a: 2990, b: 2935 },
      pitch: '4:12',
      ridge: { a: null, b: 48, combined_a: 241 },
      hip: { a: null, b: 187, combined_a: 241 },
      valley: { a: 78, b: 78 },
      rake: { a: 0, b: 0 },
      eave: { a: 255, b: 251 },
    },
  },
  {
    label: 'Nixa MO',
    address: '835 S Cobble Creek, Nixa, MO 65714',
    ref: {
      sqft: { a: 3070, b: 3017 },
      pitch: '8:12',
      ridge: { a: null, b: 79, combined_a: 232 },
      hip: { a: null, b: 150, combined_a: 232 },
      valley: { a: 113, b: 111 },
      rake: { a: 50, b: 48 },
      eave: { a: 211, b: 208 },
    },
  },
];

function refAvg(ref) {
  if (ref.a != null && ref.b != null) return (ref.a + ref.b) / 2;
  if (ref.b != null) return ref.b;
  if (ref.a != null) return ref.a;
  return null;
}

function pctOff(ours, refAvgVal) {
  if (refAvgVal == null || refAvgVal === 0) return null;
  return ((ours - refAvgVal) / refAvgVal) * 100;
}

function passFlag(pctOffVal, threshold) {
  if (pctOffVal == null) return '—';
  return Math.abs(pctOffVal) <= threshold ? '✓' : '✗';
}

async function runProperty(prop, model) {
  console.log(`\n  → ${prop.label}: ${prop.address}`);

  const geo = await geocodeAddress(prop.address);
  console.log(`    Geocoded: ${geo.lat}, ${geo.lng}`);

  const [roofData, imagery] = await Promise.all([
    fetchBuildingInsights(geo.lat, geo.lng),
    fetchImagery(geo.lat, geo.lng),
  ]);
  console.log(`    Solar: ${roofData.totalAreaSqft} sqft, ${roofData.facetCount} facets, pitch ${roofData.avgPitchRatio}`);

  const patioBoundingBoxes = (roofData.patioInfo?.patioSegments || [])
    .map((s) => s.boundingBox)
    .filter(Boolean);
  const expectedKeepFraction = roofData.fullStructureSqft > 0
    ? (roofData.fullStructureSqft - roofData.patioSqft) / roofData.fullStructureSqft
    : 1;
  const roofOutline = await fetchRoofPolygon(geo.lat, geo.lng, {
    excludeBoundingBoxes: patioBoundingBoxes,
    expectedKeepFraction,
  }).catch((e) => {
    console.warn(`    Roof mask failed: ${e.message}`);
    return null;
  });

  const geometricLineItems = computeLineItems({
    geoPolygon: roofOutline?.geoPolygon,
    segments: roofData.segments,
    visionData: null,
  });

  const visionData = await analyzeProperty(imagery.satellite, imagery.streetView, {
    totalAreaSqft: roofData.totalAreaSqft,
    facetCount: roofData.facetCount,
    avgPitchRatio: roofData.avgPitchRatio,
    perimeterFeet: geometricLineItems?.perimeterFeet,
  }, model);
  console.log(`    Vision complete (${model || 'default'})`);

  const lineItems = computeLineItems({
    geoPolygon: roofOutline?.geoPolygon,
    segments: roofData.segments,
    visionData,
  });

  const rawVision = visionData?.satellite?.interiorLinearFeet || {};

  return {
    label: prop.label,
    address: prop.address,
    measured: {
      sqft: roofData.totalAreaSqft,
      pitch: roofData.avgPitchRatio,
      facetCount: roofData.facetCount,
      perimeterFeet: lineItems.perimeterFeet,
      eaveFeet: lineItems.eaveFeet,
      rakeFeet: lineItems.rakeFeet,
      gutterFeet: lineItems.gutterFeet,
      ridgeFeet: lineItems.ridgeFeet,
      hipFeet: lineItems.hipFeet,
      valleyFeet: lineItems.valleyFeet,
      wallFlashingFeet: lineItems.wallFlashingFeet,
      stepFlashingFeet: lineItems.stepFlashingFeet,
    },
    rawVision: {
      ridges: rawVision.ridges ?? null,
      hips: rawVision.hips ?? null,
      valleys: rawVision.valleys ?? null,
    },
    calibrationApplied: lineItems.sources?.ridges === 'calibrated',
    visionSatellite: visionData?.satellite || null,
    ref: prop.ref,
  };
}

function printComparisonTable(results) {
  console.log('\n' + '='.repeat(120));
  console.log('BENCHMARK COMPARISON — Per-Line-Item');
  console.log('='.repeat(120));

  const header = [
    'Property'.padEnd(16),
    'Item'.padEnd(10),
    'Ours'.padStart(8),
    'Raw'.padStart(8),
    'Ref Avg'.padStart(8),
    '% Off'.padStart(8),
    'Pass'.padStart(6),
    'Calibrated'.padStart(11),
  ].join(' | ');
  console.log(header);
  console.log('-'.repeat(120));

  for (const r of results) {
    const items = [
      { key: 'sqft', ours: r.measured.sqft, raw: null, ref: r.ref.sqft, threshold: 10 },
      { key: 'ridge', ours: r.measured.ridgeFeet, raw: r.rawVision.ridges, ref: r.ref.ridge, threshold: 25 },
      { key: 'hip', ours: r.measured.hipFeet, raw: r.rawVision.hips, ref: r.ref.hip, threshold: 25 },
      { key: 'valley', ours: r.measured.valleyFeet, raw: r.rawVision.valleys, ref: r.ref.valley, threshold: 25 },
      { key: 'rake', ours: r.measured.rakeFeet, raw: null, ref: r.ref.rake, threshold: 30 },
      { key: 'eave', ours: r.measured.eaveFeet, raw: null, ref: r.ref.eave, threshold: 30 },
    ];

    for (let i = 0; i < items.length; i++) {
      const it = items[i];
      const avg = refAvg(it.ref);
      const pct = pctOff(it.ours, avg);
      const row = [
        (i === 0 ? r.label : '').padEnd(16),
        it.key.padEnd(10),
        (it.ours != null ? String(Math.round(it.ours)) : '—').padStart(8),
        (it.raw != null ? String(Math.round(it.raw)) : '—').padStart(8),
        (avg != null ? String(Math.round(avg)) : '—').padStart(8),
        (pct != null ? `${pct > 0 ? '+' : ''}${pct.toFixed(1)}%` : '—').padStart(8),
        passFlag(pct, it.threshold).padStart(6),
        (i === 0 ? '' : r.calibrationApplied ? 'yes' : 'no').padStart(11),
      ].join(' | ');
      console.log(row);
    }
    console.log('-'.repeat(120));
  }

  // Summary: count passes/fails per line item type
  console.log('\nSUMMARY — Pass rates per line item:');
  for (const key of ['sqft', 'ridge', 'hip', 'valley']) {
    const threshold = key === 'sqft' ? 10 : 25;
    let pass = 0, fail = 0, skip = 0;
    for (const r of results) {
      const ref = r.ref[key];
      const avg = refAvg(ref);
      const ours = key === 'sqft' ? r.measured.sqft
        : key === 'ridge' ? r.measured.ridgeFeet
        : key === 'hip' ? r.measured.hipFeet
        : r.measured.valleyFeet;
      const pct = pctOff(ours, avg);
      if (pct == null) skip++;
      else if (Math.abs(pct) <= threshold) pass++;
      else fail++;
    }
    console.log(`  ${key.padEnd(8)}: ${pass} pass, ${fail} fail, ${skip} skip (threshold: ±${threshold}%)`);
  }
}

function printAveragedSummary(sessionRuns, model) {
  console.log('\n' + '='.repeat(120));
  console.log(`AVERAGED SUMMARY across ${sessionRuns.length} runs — Model: ${model}`);
  console.log('='.repeat(120));

  const propLabels = BENCHMARK_PROPERTIES.map((p) => p.label);
  const items = ['sqft', 'ridge', 'hip', 'valley'];
  const thresholds = { sqft: 10, ridge: 25, hip: 25, valley: 25 };

  const header = ['Property'.padEnd(16), 'Item'.padEnd(8), 'Avg %Off'.padStart(10), 'Std Dev'.padStart(8), 'Pass Rate'.padStart(10)].join(' | ');
  console.log(header);
  console.log('-'.repeat(120));

  for (const label of propLabels) {
    for (const item of items) {
      const pcts = sessionRuns
        .map((run) => run.find((r) => r.label === label))
        .filter((r) => r && !r.error)
        .map((r) => {
          const avg = refAvg(r.ref[item]);
          const ours = item === 'sqft' ? r.measured.sqft
            : item === 'ridge' ? r.measured.ridgeFeet
            : item === 'hip' ? r.measured.hipFeet
            : r.measured.valleyFeet;
          return pctOff(ours, avg);
        })
        .filter((p) => p != null);

      if (pcts.length === 0) continue;
      const avg = pcts.reduce((a, b) => a + b, 0) / pcts.length;
      const variance = pcts.reduce((s, p) => s + (p - avg) ** 2, 0) / pcts.length;
      const stdDev = Math.sqrt(variance);
      const passRate = pcts.filter((p) => Math.abs(p) <= thresholds[item]).length / pcts.length;

      const row = [
        label.padEnd(16),
        item.padEnd(8),
        `${avg > 0 ? '+' : ''}${avg.toFixed(1)}%`.padStart(10),
        `${stdDev.toFixed(1)}%`.padStart(8),
        `${(passRate * 100).toFixed(0)}%`.padStart(10),
      ].join(' | ');
      console.log(row);
    }
    console.log('-'.repeat(120));
  }

  // Overall pass rates
  console.log('\nOverall pass rates (averaged across runs):');
  for (const item of items) {
    const allPcts = [];
    for (const run of sessionRuns) {
      for (const r of run) {
        if (r.error) continue;
        const avg = refAvg(r.ref[item]);
        const ours = item === 'sqft' ? r.measured.sqft
          : item === 'ridge' ? r.measured.ridgeFeet
          : item === 'hip' ? r.measured.hipFeet
          : r.measured.valleyFeet;
        const p = pctOff(ours, avg);
        if (p != null) allPcts.push(p);
      }
    }
    const passed = allPcts.filter((p) => Math.abs(p) <= thresholds[item]).length;
    const total = allPcts.length;
    const meanAbs = allPcts.reduce((s, p) => s + Math.abs(p), 0) / total;
    console.log(`  ${item.padEnd(8)}: ${passed}/${total} pass (${((passed / total) * 100).toFixed(0)}%) | Mean abs error: ${meanAbs.toFixed(1)}%`);
  }
}

async function runOnce(model) {
  const results = [];
  for (const prop of BENCHMARK_PROPERTIES) {
    try {
      const result = await runProperty(prop, model);
      results.push(result);
    } catch (err) {
      console.error(`  ✗ ${prop.label} FAILED: ${err.message}`);
      results.push({ label: prop.label, address: prop.address, error: err.message });
    }
  }
  return results;
}

async function main() {
  // CLI args: --model <name> --runs <n>
  const args = process.argv.slice(2);
  const model = (() => {
    const i = args.indexOf('--model');
    return i >= 0 ? args[i + 1] : 'claude-sonnet-4-6';
  })();
  const runs = (() => {
    const i = args.indexOf('--runs');
    return i >= 0 ? parseInt(args[i + 1], 10) : 1;
  })();

  console.log('BENCHMARK RUN');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Model: ${model}`);
  console.log(`Runs: ${runs}`);
  console.log(`Properties: ${BENCHMARK_PROPERTIES.length}`);

  // Load existing results file or start fresh
  let allRuns = [];
  if (existsSync(RESULTS_FILE)) {
    try {
      allRuns = JSON.parse(readFileSync(RESULTS_FILE, 'utf-8'));
    } catch { allRuns = []; }
  }

  const sessionRuns = [];
  for (let runIdx = 0; runIdx < runs; runIdx++) {
    console.log(`\n--- Run ${runIdx + 1}/${runs} (model: ${model}) ---`);
    const results = await runOnce(model);
    sessionRuns.push(results);
    printComparisonTable(results.filter((r) => !r.error));
    saveRun(allRuns, results, model);
  }

  if (runs > 1) {
    printAveragedSummary(sessionRuns, model);
  }
}

function saveRun(allRuns, results, model) {
  allRuns.push({
    timestamp: new Date().toISOString(),
    runNumber: allRuns.length + 1,
    model,
    results: results.map((r) => {
      if (r.error) return { label: r.label, error: r.error };
      return {
        label: r.label,
        measured: r.measured,
        rawVision: r.rawVision,
        calibrationApplied: r.calibrationApplied,
        visionSatellite: r.visionSatellite,
        ref: r.ref,
        deltas: {
          sqft: { ours: r.measured.sqft, refAvg: refAvg(r.ref.sqft), pctOff: pctOff(r.measured.sqft, refAvg(r.ref.sqft)) },
          ridge: { ours: r.measured.ridgeFeet, raw: r.rawVision.ridges, refAvg: refAvg(r.ref.ridge), pctOff: pctOff(r.measured.ridgeFeet, refAvg(r.ref.ridge)) },
          hip: { ours: r.measured.hipFeet, raw: r.rawVision.hips, refAvg: refAvg(r.ref.hip), pctOff: pctOff(r.measured.hipFeet, refAvg(r.ref.hip)) },
          valley: { ours: r.measured.valleyFeet, raw: r.rawVision.valleys, refAvg: refAvg(r.ref.valley), pctOff: pctOff(r.measured.valleyFeet, refAvg(r.ref.valley)) },
          rake: { ours: r.measured.rakeFeet, refAvg: refAvg(r.ref.rake), pctOff: pctOff(r.measured.rakeFeet, refAvg(r.ref.rake)) },
          eave: { ours: r.measured.eaveFeet, refAvg: refAvg(r.ref.eave), pctOff: pctOff(r.measured.eaveFeet, refAvg(r.ref.eave)) },
        },
      };
    }),
  });

  writeFileSync(RESULTS_FILE, JSON.stringify(allRuns, null, 2));
  console.log(`\nResults saved to ${RESULTS_FILE} (run #${allRuns.length})`);
}

main().catch((err) => {
  console.error('Benchmark failed:', err);
  process.exit(1);
});
