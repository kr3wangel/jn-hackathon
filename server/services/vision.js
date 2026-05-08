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

async function analyzeImage(imageUrl, prompt) {
  const imageResponse = await fetch(imageUrl);
  const contentType = imageResponse.headers.get('content-type') || '';
  const mediaType = contentType.includes('png') ? 'image/png' : 'image/jpeg';
  const imageBuffer = await imageResponse.arrayBuffer();
  const base64 = Buffer.from(imageBuffer).toString('base64');

  const response = await getClient().messages.create({
    model: 'claude-sonnet-4-20250514',
    max_tokens: 1024,
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
