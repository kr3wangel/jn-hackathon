// Run the pipeline against the 5 hackathon test addresses and capture every
// artifact the submission rubric asks for: satellite.jpg, streetview.jpg,
// output.json, and report.pdf — all under examples/<slug>/.
//
// Usage:
//   node scripts/capture-artifacts.js                  # all 5 test addresses
//   node scripts/capture-artifacts.js "<address>"      # single address (ad hoc)
//
// Requires the dev server (npm run server) running on localhost:3001.

import { writeFile, mkdir, readFile } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');

const SERVER = process.env.CAPTURE_SERVER || 'http://localhost:3001';
const OUTPUT_DIR = join(REPO_ROOT, 'examples');

const TEST_ADDRESSES = [
  '3561 E 102nd Ct, Thornton, CO 80229',
  '1612 S Canton Ave, Springfield, MO 65802',
  '6310 Laguna Bay Court, Houston, TX 77041',
  '3820 E Rosebrier St, Springfield, MO 65809',
  '1261 20th Street, Newport News, VA 23607',
];

function slugify(address) {
  return address
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// Parse an SSE response stream and return the final `done` payload.
async function runPipeline(address) {
  const res = await fetch(`${SERVER}/api/pipeline`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ address }),
  });
  if (!res.ok) throw new Error(`Pipeline HTTP ${res.status}`);

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let pendingEvent = null;
  let donePayload = null;
  let errorPayload = null;

  const processLines = (lines) => {
    for (const line of lines) {
      if (line.startsWith('event: ')) {
        pendingEvent = line.slice(7);
      } else if (line.startsWith('data: ') && pendingEvent) {
        try {
          const data = JSON.parse(line.slice(6));
          if (pendingEvent === 'done') donePayload = data;
          if (pendingEvent === 'error') errorPayload = data;
        } catch { /* ignore malformed */ }
        pendingEvent = null;
      }
    }
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop();
    processLines(lines);
  }
  buffer += decoder.decode();
  if (buffer.length > 0) processLines(buffer.split('\n'));

  if (errorPayload) {
    const err = new Error(errorPayload.message);
    err.code = errorPayload.code;
    throw err;
  }
  if (!donePayload) throw new Error('Pipeline ended without a done event');
  return donePayload;
}

async function downloadImage(url, destPath) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Image fetch HTTP ${res.status} for ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buf);
  return buf;
}

async function generatePdf(reportInput, destPath) {
  const res = await fetch(`${SERVER}/api/report`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(reportInput),
  });
  if (!res.ok) throw new Error(`Report HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await writeFile(destPath, buf);
}

async function captureOne(address) {
  const slug = slugify(address);
  const dir = join(OUTPUT_DIR, slug);
  await mkdir(dir, { recursive: true });

  process.stdout.write(`▶ ${address}\n`);
  const t0 = Date.now();

  const result = await runPipeline(address);
  const pipelineMs = Date.now() - t0;

  await writeFile(join(dir, 'output.json'), JSON.stringify(result, null, 2));

  const satPath = join(dir, 'satellite.jpg');
  const svPath = join(dir, 'streetview.jpg');
  const [satBuf, svBuf] = await Promise.all([
    downloadImage(result.imagery.satellite, satPath),
    downloadImage(result.imagery.streetView, svPath),
  ]);

  // Static Maps actually returns PNG; the .jpg extension is a slight lie but
  // every viewer handles it fine, and the rubric doesn't care about the
  // extension. Renaming on disk to match content type would be churn.
  const satMime = satBuf[0] === 0x89 ? 'image/png' : 'image/jpeg';
  const svMime = svBuf[0] === 0x89 ? 'image/png' : 'image/jpeg';

  await generatePdf(
    {
      address,
      estimateId: result.estimateId,
      roofData: result.roofData,
      visionData: result.visionData,
      lineItems: result.lineItems,
      pricing: result.pricing,
      imageryBase64: {
        satellite: `data:${satMime};base64,${satBuf.toString('base64')}`,
        streetView: `data:${svMime};base64,${svBuf.toString('base64')}`,
      },
    },
    join(dir, 'report.pdf'),
  );

  return {
    address,
    slug,
    sqft: result.roofData?.totalAreaSqft ?? null,
    squares: result.roofData?.roofingSquares ?? null,
    pitch: result.roofData?.avgPitchRatio ?? null,
    facets: result.roofData?.facetCount ?? null,
    estimateId: result.estimateId ?? null,
    pipelineSec: (pipelineMs / 1000).toFixed(1),
  };
}

async function main() {
  const overrideAddress = process.argv[2];
  const addresses = overrideAddress ? [overrideAddress] : TEST_ADDRESSES;

  if (!existsSync(OUTPUT_DIR)) await mkdir(OUTPUT_DIR, { recursive: true });

  console.log(`Capturing artifacts for ${addresses.length} address(es) → ${OUTPUT_DIR}/\n`);
  const summary = [];
  const failures = [];

  for (const address of addresses) {
    try {
      const row = await captureOne(address);
      summary.push(row);
      console.log(`  ✓ ${row.sqft} sqft · ${row.pipelineSec}s · EST-${row.estimateId}\n`);
    } catch (err) {
      console.log(`  ✗ ${err.message}\n`);
      failures.push({ address, error: err.message, code: err.code || null });
    }
  }

  if (summary.length) {
    console.log('=== Summary ===');
    console.table(summary.map((r) => ({
      Address: r.address,
      Sqft: r.sqft,
      Squares: r.squares,
      Pitch: r.pitch,
      Facets: r.facets,
      Sec: r.pipelineSec,
    })));
  }
  if (failures.length) {
    console.log('=== Failures ===');
    console.table(failures);
  }

  // Persist the summary so the README / form can reuse it without re-running.
  await writeFile(
    join(OUTPUT_DIR, 'summary.json'),
    JSON.stringify({ runAt: new Date().toISOString(), summary, failures }, null, 2),
  );
  console.log(`\nSummary written to ${join(OUTPUT_DIR, 'summary.json')}`);
}

main().catch((err) => {
  console.error('Fatal:', err);
  process.exit(1);
});
