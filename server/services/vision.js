import Anthropic from '@anthropic-ai/sdk';

let client;
function getClient() {
  if (!client) client = new Anthropic();
  return client;
}

const STREETVIEW_PROMPT = `You are an expert roofing inspector analyzing a Street View image of a residential property.

Analyze the visible roof and provide a detailed assessment in JSON format. Be specific with roofing terminology — this will appear on a professional estimate.

Return ONLY valid JSON with this structure:
{
  "material": "3-tab shingle" | "architectural shingle" | "metal" | "tile" | "slate" | "wood shake" | "flat/rolled" | "unknown",
  "materialConfidence": "high" | "medium" | "low",
  "condition": "excellent" | "good" | "fair" | "poor",
  "conditionNotes": "brief description of visible condition",
  "estimatedAge": "0-5 years" | "5-10 years" | "10-15 years" | "15-20 years" | "20+ years",
  "stories": 1 | 2 | 3,
  "features": {
    "valleys": 0,
    "ridges": 0,
    "hips": 0,
    "dormers": 0,
    "gables": 0
  },
  "obstacles": {
    "chimneys": 0,
    "skylights": 0,
    "vents": 0,
    "satelliteDishes": 0
  },
  "drainage": {
    "guttersVisible": true | false,
    "downspoutsVisible": true | false,
    "gutterCondition": "good" | "fair" | "poor" | "not visible"
  },
  "damage": [],
  "notes": "any additional observations relevant to estimating"
}

For the damage array, list each issue found:
{ "type": "missing shingles" | "curling" | "moss/algae" | "storm damage" | "flashing deterioration" | "sagging", "severity": "minor" | "moderate" | "severe", "description": "brief description" }

If the image doesn't clearly show the roof or the property isn't residential, still return the JSON structure with best guesses and set confidences to "low".`;

const SATELLITE_PROMPT = `You are an expert roofing inspector analyzing a top-down satellite image of a residential property's roof.

Analyze the visible roof structure and provide observations in JSON format. Focus on what's visible from above.

Return ONLY valid JSON with this structure:
{
  "roofShape": "gable" | "hip" | "cross-hip" | "cross-gable" | "mansard" | "gambrel" | "flat" | "complex",
  "materialFromAbove": "asphalt shingle" | "metal" | "tile" | "membrane" | "unknown",
  "colorTone": "dark" | "medium" | "light",
  "visibleDamage": [],
  "treeOverhang": "none" | "minimal" | "moderate" | "heavy",
  "debrisVisible": true | false,
  "poolingOrStaining": true | false,
  "notes": "any additional observations from the aerial view"
}

For visibleDamage, list each issue: { "type": "discoloration" | "missing sections" | "patching" | "ponding" | "debris accumulation", "description": "brief description" }`;

function buildPolygonPrompt(context) {
  const ctx = context || {};
  const sqft = ctx.totalAreaSqft ? `${ctx.totalAreaSqft.toLocaleString()} sqft` : 'unknown';
  const facets = ctx.facetCount ?? 'unknown';

  return `You are looking at a 640×640 top-down satellite image of a residential property. The image is centered on a single specific house — the one whose roof footprint is at the geometric center of the image. Your job is to trace the EXACT outer perimeter of that house's roof.

Ground truth from Google Solar API for this house:
- Total roof area: ${sqft}
- Number of distinct roof facets: ${facets}

Your traced polygon must be consistent with those numbers. If you trace a small rectangle when the area is 4,000 sqft, you are wrong. If you trace a simple shape when there are 11 facets, you are wrong.

STEP 1 — Internally describe the centered house in plain words. Identify its shape (rectangle, L, T, U, complex), where the main mass is, where any wings, garage, or bumpouts sit, and what the roof orientation looks like. Do not output this — it's your private reasoning.

STEP 2 — Identify every outside corner of the roof perimeter. For an L-shape there are 6 corners. For a complex roof with bumpouts there can be 14–20+. Every corner you list must correspond to a real change in direction along the visible roof edge.

STEP 3 — Output the polygon as JSON.

Rules for the output:
- Coordinates are normalized 0–1 relative to image dimensions. (0,0) is top-left. (1,1) is bottom-right.
- Use 3 decimals of precision (e.g. 0.423, not 0.42). Two decimals is too coarse to trace accurately.
- Real roofs have edges at all angles, NOT just horizontal/vertical. If an eave runs at 30°, your edge between two corners must run at 30°. Do NOT default to a Manhattan-style step pattern.
- Order the points by walking the perimeter clockwise.
- Do not repeat the first point at the end — closure is implicit.
- INCLUDE attached garages, additions, and covered porches that share a roof with the main house.
- EXCLUDE neighboring houses, driveways, detached sheds, pools, fences, sidewalks, and trees.

Return ONLY valid JSON in this exact format:
{
  "polygon": [
    { "x": 0.423, "y": 0.318 },
    { "x": 0.551, "y": 0.318 }
  ],
  "confidence": "high" | "medium" | "low"
}

Confidence guide:
- "high" — every corner is visible, your trace matches the ground-truth area and facet count, and edges follow real roof angles.
- "medium" — some corners obscured by trees or shadow; trace is approximate.
- "low" — heavy occlusion, cannot identify the centered house, or trace conflicts with ground-truth area.

If you cannot identify the centered house, return { "polygon": [], "confidence": "low" }.`;
}

export async function analyzeProperty(satelliteUrl, streetViewUrl) {
  const [streetViewAnalysis, satelliteAnalysis] = await Promise.all([
    analyzeImage(streetViewUrl, STREETVIEW_PROMPT),
    analyzeImage(satelliteUrl, SATELLITE_PROMPT),
  ]);

  return {
    streetView: streetViewAnalysis,
    satellite: satelliteAnalysis,
    material: streetViewAnalysis.material || 'architectural shingle',
    condition: streetViewAnalysis.condition || 'fair',
    stories: streetViewAnalysis.stories || 1,
  };
}

async function analyzeImage(imageUrl, prompt, maxTokens = 1024) {
  const imageResponse = await fetch(imageUrl);
  const contentType = imageResponse.headers.get('content-type') || '';
  const mediaType = contentType.includes('png') ? 'image/png' : 'image/jpeg';
  const imageBuffer = await imageResponse.arrayBuffer();
  const base64 = Buffer.from(imageBuffer).toString('base64');

  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: maxTokens,
    messages: [{
      role: 'user',
      content: [
        { type: 'image', source: { type: 'base64', media_type: mediaType, data: base64 } },
        { type: 'text', text: prompt },
      ],
    }],
  });

  const text = response.content[0].text;
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('Vision model did not return valid JSON');

  return JSON.parse(jsonMatch[0]);
}
