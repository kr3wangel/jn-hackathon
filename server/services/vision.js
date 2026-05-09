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

const PROPERTY_TYPE_PROMPT = `Look at this street-level image of a property. Classify it.

Return ONLY valid JSON:
{
  "propertyType": "residential" | "commercial",
  "commercialScale": "small" | "large" | null,
  "confidence": "high" | "medium" | "low"
}

Guidelines:
- "residential": house, townhouse, duplex, small multi-family (up to 4-plex)
- "commercial": office, warehouse, retail, industrial, large apartment complex
- "commercialScale": only set when commercial.
  - "small": standard pitched/shingle roof a residential crew could handle (small office, daycare, strip mall unit)
  - "large": warehouse, multi-story office, flat membrane roof, anything needing commercial roofing crews
- Default to "residential" / null if unsure.`;

// Roofing industry heuristics used in the satellite vision prompt:
//   - Total interior linear feet ≈ facet_count × 25-30 ft (residential rule of thumb)
//   - Per-line lengths: ridges 20-40 ft, hips 10-25 ft, valleys 10-25 ft
//   - Roof-shape ratios (e.g. cross-hip → hips ≈ 0.6–1.0 × perimeter)
// These are grounded in published industry estimating guides, not in any
// specific property's reference measurements. They serve as sanity checks
// for the model's enumeration, not as the answer itself.
function buildSatellitePrompt(ctx) {
  const c = ctx || {};
  const area = c.totalAreaSqft ? `${c.totalAreaSqft.toLocaleString()} sqft` : 'unknown';
  const facets = c.facetCount ?? 'unknown';
  const perimeter = c.perimeterFeet ? `${c.perimeterFeet} ft` : 'unknown';
  const pitch = c.avgPitchRatio || 'unknown';

  return `You are an expert roof inspector analyzing a top-down satellite image. The roof of interest is the centered house.

GROUND TRUTH for this house — use as scale anchors:
- Total roof area: ${area}
- Number of distinct roof facets: ${facets}
- Outer perimeter (eaves + rakes total): ${perimeter}
- Average pitch: ${pitch}
- Image is ~80 ft across at this zoom level. The roof's perimeter divided by 4 is roughly the size of one side.

LINE DEFINITIONS — look carefully at the image:
- RIDGE: a HORIZONTAL line at the very top where two slopes meet at a peak. A ridge runs along the TOP SPINE of a roof section — it is the HIGHEST horizontal line, with slopes falling away on BOTH sides. On a hip roof, the ridge is typically SHORT (often just 20–30% of the building length) because hips consume the ends. Most residential hip roofs have only 1–2 true ridges. A pure hip (pyramid) roof has ZERO ridges. Only count a line as a ridge if it is clearly horizontal at the apex with slopes descending on both sides.
- HIP: a SLOPED line going FROM an OUTSIDE corner of the house UP to a peak or ridge end. Hips are DIAGONAL lines — they rise from the eave at an outside corner upward toward the ridge. On a hip roof, hips typically outnumber ridges. Every outside corner that rises to a peak is a hip.
- VALLEY: a SLOPED line going FROM an INSIDE corner (concavity) of the roof footprint UP toward a peak or ridge. Valleys form where two roof planes meet in a trough. Inside corners only exist where two roof masses meet (e.g. an L-junction, T-junction, or a wing meeting the main mass). Valley lines are typically 15–25 ft on residential roofs — similar in length to hips from the same roof.

YOUR JOB: enumerate every distinct ridge, hip, and valley line you can see, estimate each one's length in feet, and sum them.

DO NOT just apply a heuristic ratio to the perimeter. LOOK AT THE IMAGE. Count the lines you can see.

KEY STRUCTURAL FACTS — use these as enumeration sanity checks:

(a) Every roof facet (flat plane) shares its edges with ADJACENT facets. With ${facets} facets, the roof has at minimum (${facets} - 1) shared edges between facets, and each shared edge is a ridge, hip, or valley. Real complex hip roofs have more (each facet shares edges with multiple neighbors). Expect roughly ${typeof facets === 'number' ? Math.max(facets - 1, 3) : 'N-1'} to ${typeof facets === 'number' ? Math.round(facets * 1.8) : '~2N'} distinct interior lines.

(b) Total interior linear feet (ridges + hips + valleys SUMMED) typically equals approximately the facet count × 25–30 ft. For this house with ${facets} facets, your total should land in the range ${typeof facets === 'number' ? facets * 22 : '~22N'}–${typeof facets === 'number' ? facets * 32 : '~32N'} ft. Use this as a hard sanity check after enumeration. If your total is significantly below this range, revisit your enumeration — you're either missing lines OR underestimating lengths.

(c) Typical residential roof line LENGTHS:
- A main ridge spans 20–40 ft on a gable roof but only 15–30 ft on a hip roof (hips consume the ends). Secondary ridges on wings are even shorter (10–20 ft).
- A hip from an outside corner to a peak runs 12–25 ft
- A valley between two roof masses runs 15–25 ft — valleys are typically SIMILAR in length to hips from the same junction, not shorter
- Lines shorter than 8 ft are unusual — usually short hip-end-caps on small bumpouts.

(d) RIDGE proportion check: On hip and cross-hip roofs, total ridge feet typically make up only 10–25% of total interior linear feet. Most of the interior footage comes from hips and valleys. If your ridge total exceeds 30% of your interior total (R + H + V), re-examine — you are likely over-counting ridges or over-estimating their lengths. A complex hip roof with ${facets} facets typically has only 1–3 true ridge lines.

(e) HIP length scaling: Hips run diagonally from eave corner to peak, so they are often LONGER than they first appear in a top-down image. On a large roof (3,000+ sqft), hips commonly run 18–25 ft — use the upper end of the range when the building footprint is clearly large. Total hip feet is typically the LARGEST component on hip roofs.

If you enumerate fewer lines than the minimum in (a), or your total is below the range in (b), or your individual lengths are systematically below the typical lengths in (c), go back and look harder. Trace EVERY peak and EVERY edge between facets.

PROCEDURE:
1. Identify the roof shape and the location of every peak (high point).
2. For each peak, trace each line that descends from it. Classify each:
   - Horizontal at the top + spans between two slopes facing opposite ways → RIDGE
   - Goes to an OUTSIDE corner of the polygon → HIP
   - Goes to an INSIDE corner (concave) of the polygon → VALLEY
3. Verify your count against the expected range above based on ${facets} facets.
4. Estimate each line's length using the 80 ft image scale.
5. Sum by type.

Return ONLY valid JSON:
{
  "roofShape": "gable" | "hip" | "cross-hip" | "cross-gable" | "mansard" | "gambrel" | "flat" | "complex",
  "materialFromAbove": "asphalt shingle" | "metal" | "tile" | "membrane" | "unknown",
  "colorTone": "dark" | "medium" | "light",
  "visibleDamage": [],
  "treeOverhang": "none" | "minimal" | "moderate" | "heavy",
  "debrisVisible": true | false,
  "poolingOrStaining": true | false,
  "obstaclesFromAbove": {
    "chimneys": 0,
    "skylights": 0,
    "ventsRidgeOrPlumbing": 0
  },
  "lineEnumeration": {
    "ridges": [
      { "approxLengthFeet": 0, "notes": "where this line is on the roof" }
    ],
    "hips": [
      { "approxLengthFeet": 0, "notes": "which corner / direction" }
    ],
    "valleys": [
      { "approxLengthFeet": 0, "notes": "which inside corner" }
    ]
  },
  "interiorLinearFeet": {
    "ridges": 0,
    "hips": 0,
    "valleys": 0
  },
  "interiorLinearFeetConfidence": "high" | "medium" | "low",
  "notes": "any additional observations from the aerial view"
}

interiorLinearFeet.ridges, .hips, .valleys MUST be the sum of the lineEnumeration arrays for that type. If lineEnumeration.hips is an empty array, interiorLinearFeet.hips MUST be 0. Do not fill in defaults.

For obstaclesFromAbove: count distinct features on the centered house. Chimneys appear as squarish protrusions casting shadows; skylights as glass rectangles; vents as small caps or pipes.

For visibleDamage, list each issue: { "type": "discoloration" | "missing sections" | "patching" | "ponding" | "debris accumulation", "description": "brief description" }`;
}

export async function analyzeProperty(satelliteUrl, streetViewUrl, roofContext, modelOverride) {
  const satellitePrompt = buildSatellitePrompt(roofContext);
  const [streetViewAnalysis, satelliteAnalysis, propertyTypeResult] = await Promise.all([
    analyzeImage(streetViewUrl, STREETVIEW_PROMPT, 1024, modelOverride),
    // Satellite needs more tokens because it enumerates each ridge/hip/valley line.
    analyzeImage(satelliteUrl, satellitePrompt, 3072, modelOverride),
    analyzeImage(streetViewUrl, PROPERTY_TYPE_PROMPT, 256, 'claude-haiku-4-5-20251001')
      .catch(() => ({ propertyType: 'residential', commercialScale: null })),
  ]);

  // Merge obstacle counts from both views, taking the max — satellite is
  // generally better for top-down features (skylights, vents) and street
  // view for chimneys.
  const svObs = streetViewAnalysis.obstacles || {};
  const satObs = satelliteAnalysis.obstaclesFromAbove || {};
  const mergedObstacles = {
    chimneys: Math.max(svObs.chimneys || 0, satObs.chimneys || 0),
    skylights: Math.max(svObs.skylights || 0, satObs.skylights || 0),
    vents: Math.max(svObs.vents || 0, satObs.ventsRidgeOrPlumbing || 0),
    satelliteDishes: svObs.satelliteDishes || 0,
  };
  streetViewAnalysis.obstacles = mergedObstacles;

  return {
    streetView: streetViewAnalysis,
    satellite: satelliteAnalysis,
    material: streetViewAnalysis.material || 'architectural shingle',
    condition: streetViewAnalysis.condition || 'fair',
    stories: streetViewAnalysis.stories || 1,
    propertyType: propertyTypeResult.propertyType || 'residential',
    commercialScale: propertyTypeResult.commercialScale || null,
  };
}

async function analyzeImage(imageUrl, prompt, maxTokens = 1024, modelOverride) {
  const imageResponse = await fetch(imageUrl);
  const contentType = imageResponse.headers.get('content-type') || '';
  const mediaType = contentType.includes('png') ? 'image/png' : 'image/jpeg';
  const imageBuffer = await imageResponse.arrayBuffer();
  const base64 = Buffer.from(imageBuffer).toString('base64');

  const response = await getClient().messages.create({
    model: modelOverride || 'claude-sonnet-4-6',
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
