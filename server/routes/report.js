import { Router } from 'express';
import { randomUUID } from 'crypto';
import { generateReport } from '../services/pdfReport.js';

export const reportRouter = Router();

reportRouter.post('/report', async (req, res) => {
  const { address, roofData, visionData, lineItems, pricing, imageryBase64, estimateId: providedId } = req.body;

  if (!address) {
    return res.status(400).json({ error: 'address is required' });
  }

  try {
    // Prefer the ID minted by the pipeline so the UI stamp matches the PDF.
    // Fall back to a fresh one for direct API callers that didn't run the
    // pipeline first.
    const estimateId = providedId || randomUUID().replace(/-/g, '').slice(0, 8).toUpperCase();
    const pdfBuffer = await generateReport({ address, roofData, visionData, lineItems, pricing, imageryBase64, estimateId });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="roof-report-${estimateId}.pdf"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('PDF generation failed:', err);
    res.status(500).json({ error: err.message });
  }
});
