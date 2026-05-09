const JN_BASE = 'https://app.jobnimbus.com/api1';

async function jnFetch(endpoint, body) {
  const res = await fetch(`${JN_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.JN_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`JN API ${endpoint} failed (${res.status}): ${text}`);
  }

  return res.json();
}

export async function pushToJobNimbus({ address, lat, lng, zip, roofData, visionData, lineItems }) {
  const nameParts = parseAddressName(address);
  const now = Math.floor(Date.now() / 1000);

  const contact = await jnFetch('/contacts', {
    first_name: nameParts.street,
    last_name: 'Homeowner',
    address_line1: nameParts.line1,
    city: nameParts.city,
    state_text: nameParts.state,
    zip: zip,
    status_name: 'Lead',
    record_type_name: 'Contact',
    date_created: now,
    date_updated: now,
  });

  const description = buildJobDescription(address, roofData, visionData, lineItems);

  const job = await jnFetch('/jobs', {
    name: `Roof Inspection — ${nameParts.line1}`,
    description,
    status_name: 'Pending',
    record_type_name: 'Job',
    primary: { id: contact.jnid },
    address_line1: nameParts.line1,
    city: nameParts.city,
    state_text: nameParts.state,
    zip: zip,
    geo: { lat: lat, lon: lng },
    date_created: now,
    date_updated: now,
  });

  return {
    contactId: contact.jnid,
    jobId: job.jnid,
    contactName: `${nameParts.street} Homeowner`,
    jobName: `Roof Inspection — ${nameParts.line1}`,
  };
}

function buildJobDescription(address, roofData, visionData, lineItems) {
  const lines = [`AI roof inspection for ${address}.`];
  if (roofData) {
    lines.push('');
    lines.push('Measurements (Google Solar API):');
    lines.push(`  Total roof area: ${roofData.totalAreaSqft.toLocaleString()} sqft`);
    lines.push(`  Roofing squares: ${roofData.roofingSquares}`);
    lines.push(`  Avg pitch: ${roofData.avgPitchRatio}`);
    lines.push(`  Facets: ${roofData.facetCount}`);
  }
  if (lineItems) {
    lines.push('');
    lines.push('Line items (linear feet):');
    pushLineItem(lines, 'Perimeter', lineItems.perimeterFeet, 'measured');
    pushLineItem(lines, 'Eaves', lineItems.eaveFeet, lineItems.sources.eaveRake);
    pushLineItem(lines, 'Rakes', lineItems.rakeFeet, lineItems.sources.eaveRake);
    pushLineItem(lines, 'Gutter', lineItems.gutterFeet, 'measured');
    pushLineItem(lines, 'Ridges', lineItems.ridgeFeet, lineItems.sources.ridges);
    pushLineItem(lines, 'Hips', lineItems.hipFeet, lineItems.sources.hips);
    pushLineItem(lines, 'Valleys', lineItems.valleyFeet, lineItems.sources.valleys);
    pushLineItem(lines, 'Wall flashing', lineItems.wallFlashingFeet, lineItems.sources.wallFlashing);
    pushLineItem(lines, 'Step flashing', lineItems.stepFlashingFeet, lineItems.sources.stepFlashing);
  }
  if (visionData && !visionData.skipped) {
    lines.push('');
    lines.push('AI roof analysis (Claude vision):');
    if (visionData.material) lines.push(`  Material: ${visionData.material}`);
    if (visionData.condition) lines.push(`  Condition: ${visionData.condition}`);
    if (visionData.stories) lines.push(`  Stories: ${visionData.stories}`);
    if (visionData.streetView?.damage?.length) {
      lines.push('  Damage observed:');
      for (const d of visionData.streetView.damage) {
        lines.push(`    - ${d.type} (${d.severity}): ${d.description || ''}`);
      }
    }
  }
  return lines.join('\n');
}

function pushLineItem(lines, label, value, source) {
  if (value == null) {
    lines.push(`  ${label}: — (not detected)`);
    return;
  }
  const tag = source === 'measured' ? '' : ` (${source})`;
  lines.push(`  ${label}: ${value} ft${tag}`);
}

function parseAddressName(address) {
  const parts = address.split(',').map((s) => s.trim());
  return {
    line1: parts[0] || address,
    street: parts[0]?.replace(/^\d+\s*/, '') || 'Property',
    city: parts[1] || '',
    state: parts[2]?.replace(/\s*\d+.*$/, '') || '',
  };
}
