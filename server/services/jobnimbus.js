const JN_BASE = 'https://app.jobnimbus.com/api1';
const JN_API_KEY = process.env.JN_API_KEY;

async function jnFetch(endpoint, body) {
  const res = await fetch(`${JN_BASE}${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${JN_API_KEY}`,
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

export async function pushToJobNimbus({ address, lat, lng, zip, estimate, selectedTier }) {
  const tier = estimate.tiers[selectedTier || 1];
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

  const job = await jnFetch('/jobs', {
    name: `Roof Estimate — ${nameParts.line1}`,
    description: `AI-generated roofing estimate for ${address}. ${tier.name} tier: ${tier.material} — $${tier.total.toLocaleString()}`,
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

  const estimateRecord = await jnFetch('/estimates', {
    type: 'estimate',
    title: `${tier.name} Roofing Estimate — ${tier.material}`,
    status: 'Draft',
    primary: { id: contact.jnid },
    job: { id: job.jnid },
    items: tier.items.map((item) => ({
      name: item.name,
      description: `${item.quantity} ${item.unit} @ $${item.unitPrice.toFixed(2)}/${item.unit}`,
      quantity: item.quantity,
      cost: item.unitPrice,
      total: item.total,
    })),
    subtotal: tier.subtotal,
    total: tier.total,
    date_created: now,
    date_updated: now,
  });

  return {
    contactId: contact.jnid,
    jobId: job.jnid,
    estimateId: estimateRecord.jnid,
    contactName: `${nameParts.street} Homeowner`,
    jobName: `Roof Estimate — ${nameParts.line1}`,
    tier: tier.name,
    total: tier.total,
  };
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
