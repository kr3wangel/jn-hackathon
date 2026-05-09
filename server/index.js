import { config } from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
config({ path: join(__dirname, '..', '.env') });
import express from 'express';
import cors from 'cors';
import { pipelineRouter } from './routes/pipeline.js';
import { healthRouter } from './routes/health.js';
import { autocompleteRouter } from './routes/autocomplete.js';
import { reportRouter } from './routes/report.js';

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use('/api', healthRouter);
app.use('/api', autocompleteRouter);
app.use('/api', pipelineRouter);
app.use('/api', reportRouter);

app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});
