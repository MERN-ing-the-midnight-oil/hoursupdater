import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const distDir = path.resolve(__dirname, '../dist');
const PORT = Number(process.env.OFFICE_PORT) || 3849;

const app = express();
app.use(express.static(distDir));

app.get('/', (_req, res) => {
  res.sendFile(path.join(distDir, 'index.html'));
});

app.listen(PORT, () => {
  console.log(`Transportation Timechange Calculator listening on http://localhost:${PORT}`);
  console.log('Each route is a tab. Download CSV and upload that file to move the routes.');
  console.log('Leave this window open while you use the app.');
});
