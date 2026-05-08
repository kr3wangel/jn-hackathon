import { Router } from 'express';

export const healthRouter = Router();

healthRouter.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    env: {
      google: process.env.GOOGLE_MAPS_API_KEY ? 'set' : 'missing',
      anthropic: process.env.ANTHROPIC_API_KEY ? 'set' : 'missing',
      jn: process.env.JN_API_KEY ? 'set' : 'missing',
    },
  });
});
