import PDFDocument from 'pdfkit';

const JN_BLUE = '#3968C6';
const JN_DEEP_BLUE = '#1F3E7A';
const JN_NIGHT = '#1F2C47';
const JN_SLATE = '#475C85';
const JN_GREEN = '#33CC99';
const WHITE = '#FFFFFF';
const BORDER = '#D0D9E8';

const PAGE_W = 612;
const PAGE_H = 792;
const MARGIN = 56;
const CONTENT_W = PAGE_W - MARGIN * 2;

function base64ToBuffer(dataUrl) {
  if (!dataUrl) return null;
  const match = dataUrl.match(/^data:[^;]+;base64,(.+)$/);
  if (!match) return null;
  return Buffer.from(match[1], 'base64');
}

export async function generateReport({ address, roofData, visionData, lineItems, pricing, imageryBase64, estimateId }) {
  const satBuf = base64ToBuffer(imageryBase64?.satellite);
  const svBuf = base64ToBuffer(imageryBase64?.streetView);

  const doc = new PDFDocument({
    size: 'LETTER',
    margin: 0,
    autoFirstPage: false,
  });
  doc.addPage({ size: 'LETTER', margin: 0 });
  const chunks = [];
  doc.on('data', (c) => chunks.push(c));
  const finished = new Promise((resolve) => doc.on('end', () => resolve(Buffer.concat(chunks))));

  // ---- Header (full-bleed) + address block ----
  drawHeader(doc, address);
  const propertyType = visionData?.propertyType || 'residential';
  let cursorY = drawAddressBlock(doc, address, 64, estimateId, propertyType);
  cursorY += 10;

  // ---- Property images (side-by-side, scale-to-cover for uniform sizing) ----
  const hasImages = svBuf || satBuf;
  if (hasImages) {
    const imgW = (CONTENT_W - 10) / 2;
    const imgH = 140;

    if (svBuf) {
      drawImageCover(doc, svBuf, MARGIN, cursorY, imgW, imgH);
      doc.fontSize(6).fillColor(JN_SLATE)
        .text('STREET VIEW', MARGIN, cursorY + imgH + 2, { width: imgW, align: 'center', lineBreak: false });
    }
    if (satBuf) {
      const satX = MARGIN + imgW + 10;
      drawImageCover(doc, satBuf, satX, cursorY, imgW, imgH);
      doc.fontSize(6).fillColor(JN_SLATE)
        .text('SATELLITE VIEW', satX, cursorY + imgH + 2, { width: imgW, align: 'center', lineBreak: false });
    }
    cursorY += imgH + 28;
  }

  // ---- Roof measurements (4-col compact grid) ----
  if (roofData) {
    cursorY = drawSectionTitle(doc, 'Roof Measurements', cursorY);

    const stats = [
      ['Total Area', `${roofData.totalAreaSqft?.toLocaleString() || '-'} sqft`],
      ['Squares', `${roofData.roofingSquares || '-'}`],
      ['Avg Pitch', roofData.avgPitchRatio || '-'],
      ['Facets', `${roofData.facetCount || '-'}`],
    ];
    cursorY = drawKeyValueGrid(doc, stats, 4, cursorY);
  }

  // ---- Pricing tiers (3-card row) ----
  if (pricing?.tiers?.length) {
    cursorY = drawSectionTitle(doc, 'Estimate', cursorY);

    const tierW = (CONTENT_W - 16) / 3;
    pricing.tiers.forEach((tier, i) => {
      const x = MARGIN + i * (tierW + 8);
      drawPricingCard(doc, tier, x, cursorY, tierW);
    });
    cursorY += 186;
  } else if (visionData?.commercialScale === 'large') {
    cursorY = drawSectionTitle(doc, 'Estimate', cursorY);
    doc.fontSize(10).fillColor('#CC3333')
      .text('Custom Quote Required', MARGIN, cursorY, { width: CONTENT_W });
    cursorY += 14;
    doc.fontSize(8).fillColor(JN_NIGHT)
      .text('This commercial property requires an on-site inspection for accurate pricing.', MARGIN, cursorY, { width: CONTENT_W });
    cursorY += 24;
  }

  // ---- Line Items (left) + AI Analysis (right) side-by-side ----
  const colW = (CONTENT_W - 16) / 2;
  const leftX = MARGIN;
  const rightX = MARGIN + colW + 16;
  const splitY = cursorY;

  let leftY = splitY;
  let rightY = splitY;

  if (lineItems) {
    leftY = drawSectionTitleAt(doc, 'Line Items', leftX, leftY, colW);
    const items = [
      ['Perimeter', fmtFt(lineItems.perimeterFeet)],
      ['Eaves', fmtFt(lineItems.eaveFeet)],
      ['Rakes', fmtFt(lineItems.rakeFeet)],
      ['Ridges', fmtFt(lineItems.ridgeFeet)],
      ['Hips', fmtFt(lineItems.hipFeet)],
      ['Valleys', fmtFt(lineItems.valleyFeet)],
      ['Gutter Run', fmtFt(lineItems.gutterFeet)],
      ['Wall Flashing', fmtFt(lineItems.wallFlashingFeet)],
      ['Step Flashing', fmtFt(lineItems.stepFlashingFeet)],
    ];
    leftY = drawCompactRows(doc, items, leftX, leftY, colW);
  }

  if (visionData && !visionData.skipped) {
    rightY = drawSectionTitleAt(doc, 'AI Analysis', rightX, rightY, colW);
    const items = [];
    if (visionData.material) items.push(['Material', visionData.material]);
    if (visionData.condition) items.push(['Condition', visionData.condition]);
    if (visionData.streetView?.estimatedAge) items.push(['Est. Age', visionData.streetView.estimatedAge]);
    if (visionData.stories) items.push(['Stories', `${visionData.stories}`]);
    if (visionData.satellite?.roofShape) items.push(['Roof Shape', visionData.satellite.roofShape]);
    if (visionData.satellite?.treeOverhang) items.push(['Tree Overhang', visionData.satellite.treeOverhang]);
    rightY = drawCompactRows(doc, items, rightX, rightY, colW);

    const condNotes = visionData.streetView?.conditionNotes;
    if (condNotes) {
      rightY += 2;
      doc.fontSize(7).fillColor(JN_SLATE).text(condNotes, rightX, rightY, { width: colW, lineBreak: true });
      rightY += doc.heightOfString(condNotes, { width: colW }) + 4;
    }

  }

  drawFooter(doc);

  doc.end();
  return finished;
}

// ---- Drawing helpers ----

function drawHeader(doc, address) {
  const barH = 48;
  doc.save();
  doc.rect(0, 0, PAGE_W, barH).fill(JN_DEEP_BLUE);

  // We want every header element to share the same baseline. PDFKit's
  // text() y-coordinate is the top-left of the bounding box, so to align
  // baselines we subtract each font's actual ascender from a shared baseline.
  const baselineY = barH / 2 + 4; // visual midline, biased slightly down for cap-height-only text

  const topYFor = (size) => {
    // Helvetica ascender is ~718/1000em
    const ascender = (doc._font?.ascender || 718) / 1000;
    return baselineY - ascender * size;
  };

  // Brand
  const brandSize = 14;
  doc.font('Helvetica-Bold').fontSize(brandSize).fillColor(WHITE);
  doc.text('JobNimbus', MARGIN, topYFor(brandSize), { lineBreak: false });
  const brandWidth = doc.widthOfString('JobNimbus');

  // Subtitle
  const subSize = 9.5;
  doc.font('Helvetica').fontSize(subSize).fillColor('#C7D7F2');
  const subX = MARGIN + brandWidth + 10;
  doc.text('Roofing Estimator', subX, topYFor(subSize), { lineBreak: false });
  const subWidth = doc.widthOfString('Roofing Estimator');

  // BETA pill — vertically centered to the same baseline using the cap height
  // of the pill text.
  const pillH = 13;
  const pillY = baselineY - pillH * 0.72;
  const pillW = 32;
  const pillX = subX + subWidth + 8;
  doc.roundedRect(pillX, pillY, pillW, pillH, pillH / 2)
    .lineWidth(0.6).strokeColor('#7C9AD6').stroke();
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor('#C7D7F2');
  doc.text('BETA', pillX, baselineY - 5, { width: pillW, align: 'center', lineBreak: false });

  // Date right-aligned, baseline-aligned with subtitle
  const dateStr = new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
  doc.font('Helvetica').fontSize(subSize).fillColor('#B7C9E8');
  doc.text(dateStr, MARGIN, topYFor(subSize), { width: CONTENT_W, align: 'right', lineBreak: false });

  doc.restore();
}

function drawFooter(doc) {
  const footerH = 30;
  const footerY = PAGE_H - footerH;
  const ascender = (doc._font?.ascender || 718) / 1000;

  doc.save();
  doc.rect(0, footerY, PAGE_W, footerH).fill('#F5F7FB');
  doc.moveTo(0, footerY).lineTo(PAGE_W, footerY)
    .strokeColor(BORDER).lineWidth(0.6).stroke();
  doc.restore();

  const baselineY = footerY + footerH / 2 + 3;

  // Left: brand
  const brandSize = 8.5;
  doc.font('Helvetica-Bold').fontSize(brandSize).fillColor(JN_DEEP_BLUE)
    .text('JobNimbus', MARGIN, baselineY - ascender * brandSize, { lineBreak: false });

  // Right: copyright year
  const yearSize = 7.5;
  const year = new Date().getFullYear();
  doc.font('Helvetica').fontSize(yearSize).fillColor(JN_SLATE)
    .text(`© ${year}`, MARGIN, baselineY - ascender * yearSize, {
      width: CONTENT_W, align: 'right', lineBreak: false,
    });
}

function drawAddressBlock(doc, address, y, estimateId, propertyType) {
  // Section title row: "Property" left, property type pill + estimate ID right
  doc.font('Helvetica').fontSize(10.5).fillColor(JN_DEEP_BLUE)
    .text('Property', MARGIN, y, { lineBreak: false });

  // Property type pill
  const typeLabel = (propertyType === 'commercial' ? 'COMMERCIAL' : 'RESIDENTIAL');
  const badgeColor = propertyType === 'commercial' ? '#FF704C' : JN_BLUE;
  doc.font('Helvetica-Bold').fontSize(6.5);
  const badgeTextW = doc.widthOfString(typeLabel);
  const badgeW = badgeTextW + 14;
  let badgeX = MARGIN + CONTENT_W - badgeW;

  if (estimateId) {
    doc.font('Helvetica-Bold').fontSize(7);
    const estW = doc.widthOfString(`EST-${estimateId}`);
    badgeX = MARGIN + CONTENT_W - estW - 8 - badgeW;

    doc.font('Helvetica-Bold').fontSize(7).fillColor(JN_SLATE)
      .text(`EST-${estimateId}`, MARGIN, y + 3, {
        width: CONTENT_W, align: 'right', lineBreak: false,
      });
  }

  doc.save();
  doc.roundedRect(badgeX, y - 1, badgeW, 14, 7).fill(badgeColor);
  doc.font('Helvetica-Bold').fontSize(6.5).fillColor(WHITE)
    .text(typeLabel, badgeX, y + 2, { width: badgeW, align: 'center', lineBreak: false });
  doc.restore();

  doc.moveTo(MARGIN, y + 14).lineTo(MARGIN + CONTENT_W, y + 14)
    .strokeColor(BORDER).lineWidth(0.5).stroke();

  doc.font('Helvetica-Bold').fontSize(11).fillColor(JN_NIGHT)
    .text(address || 'Property Report', MARGIN, y + 22, { width: CONTENT_W, lineBreak: false });

  return y + 44;
}

function drawSectionTitle(doc, title, y) {
  doc.fontSize(10.5).fillColor(JN_DEEP_BLUE).text(title, MARGIN, y, { lineBreak: false });
  doc.moveTo(MARGIN, y + 14).lineTo(MARGIN + CONTENT_W, y + 14).strokeColor(BORDER).lineWidth(0.5).stroke();
  return y + 26;
}

function drawSectionTitleAt(doc, title, x, y, w) {
  doc.fontSize(10).fillColor(JN_DEEP_BLUE).text(title, x, y, { lineBreak: false });
  doc.moveTo(x, y + 13).lineTo(x + w, y + 13).strokeColor(BORDER).lineWidth(0.5).stroke();
  return y + 24;
}

function drawKeyValueGrid(doc, items, cols, y) {
  const colW = CONTENT_W / cols;
  for (let i = 0; i < items.length; i++) {
    const [label, value] = items[i];
    const x = MARGIN + (i % cols) * colW;
    const align = i === 0 ? 'left' : i === cols - 1 ? 'right' : 'center';
    doc.fontSize(6.5).fillColor(JN_SLATE).text(label.toUpperCase(), x, y, { width: colW, align, lineBreak: false });
    doc.fontSize(13).fillColor(JN_NIGHT).text(value, x, y + 9, { width: colW, align, lineBreak: false });
  }
  return y + 50;
}

function drawCompactRows(doc, rows, x, y, w) {
  for (const [label, value] of rows) {
    doc.fontSize(8).fillColor(JN_NIGHT).text(label, x, y, { width: w * 0.6, lineBreak: false });
    doc.fontSize(8).fillColor(JN_DEEP_BLUE).text(value, x + w * 0.55, y, {
      width: w * 0.45, align: 'right', lineBreak: false,
    });
    y += 15;
  }
  return y;
}

function drawPricingCard(doc, tier, x, y, w) {
  const h = 162;
  const isRecommended = tier.recommended;

  doc.save();
  doc.roundedRect(x, y, w, h, 5);
  if (isRecommended) {
    doc.lineWidth(1.4).fillAndStroke(WHITE, JN_BLUE);
  } else {
    doc.lineWidth(0.5).fillAndStroke(WHITE, BORDER);
  }
  doc.restore();

  let cy = y + 10;
  const px = x + 10;
  const pw = w - 20;

  doc.fontSize(6.5).fillColor(isRecommended ? JN_BLUE : JN_SLATE)
    .text(tier.name.toUpperCase(), px, cy, { width: pw, lineBreak: false });
  cy += 10;

  doc.fontSize(8.5).fillColor(JN_NIGHT).text(tier.material, px, cy, { width: pw, lineBreak: false });
  cy += 14;

  doc.fontSize(17).fillColor(JN_DEEP_BLUE)
    .text(`$${tier.total.toLocaleString()}`, px, cy, { width: pw, lineBreak: false });
  cy += 22;

  doc.fontSize(7).fillColor(JN_SLATE).text(`${tier.warrantyYears}-year warranty`, px, cy, { width: pw, lineBreak: false });
  cy += 12;

  // Top 3 highlights only
  for (const hl of (tier.highlights || []).slice(0, 3)) {
    drawCheckmark(doc, px, cy + 1, JN_GREEN);
    doc.fontSize(6.5).fillColor(JN_NIGHT).text(hl, px + 12, cy, { width: pw - 12, lineBreak: false });
    cy += 11;
  }

  cy += 3;
  doc.moveTo(px, cy).lineTo(x + w - 10, cy).strokeColor(BORDER).lineWidth(0.5).stroke();
  cy += 5;

  const squares = Math.round(tier.subtotalSquares / ({ good: 325, better: 425, best: 625 }[tier.id] || 425));
  const breakdown = [
    [`${squares} SQUARES`, `$${tier.subtotalSquares.toLocaleString()}`],
    ['FLASHING', `$${tier.subtotalFlashing.toLocaleString()}`],
    ['PERMITS + CLEANUP', `$${tier.subtotalFlat.toLocaleString()}`],
  ];
  for (const [bl, bv] of breakdown) {
    doc.fontSize(5.8).fillColor(JN_SLATE).text(bl, px, cy, { width: pw * 0.6, lineBreak: false });
    doc.fontSize(5.8).fillColor(JN_NIGHT).text(bv, px + pw * 0.6, cy, { width: pw * 0.4, align: 'right', lineBreak: false });
    cy += 9;
  }

  if (isRecommended) {
    doc.save();
    const badgeW = 70;
    const badgeX = x + (w - badgeW) / 2;
    doc.roundedRect(badgeX, y - 7, badgeW, 14, 7).fill(JN_BLUE);
    doc.fontSize(6).fillColor(WHITE).text('MOST SELECTED', badgeX, y - 4.5, { width: badgeW, align: 'center', lineBreak: false });
    doc.restore();
  }
}

function drawImageCover(doc, buf, x, y, w, h) {
  try {
    const img = doc.openImage(buf);
    const scale = Math.max(w / img.width, h / img.height);
    const drawW = img.width * scale;
    const drawH = img.height * scale;
    const drawX = x + (w - drawW) / 2;
    const drawY = y + (h - drawH) / 2;
    doc.save();
    doc.rect(x, y, w, h).clip();
    doc.image(img, drawX, drawY, { width: drawW, height: drawH });
    doc.restore();
  } catch { /* skip on bad image */ }
}

function drawCheckmark(doc, x, y, color) {
  doc.save();
  doc.strokeColor(color).lineWidth(1.4).lineJoin('round').lineCap('round');
  doc.moveTo(x, y + 4).lineTo(x + 3, y + 6.5).lineTo(x + 7, y).stroke();
  doc.restore();
}

function fmtFt(v) {
  if (v == null) return '-';
  return `${Math.round(v)} ft`;
}
