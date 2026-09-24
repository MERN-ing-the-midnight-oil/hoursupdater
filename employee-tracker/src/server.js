import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { EMPLOYEE_PORT } from './config.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.resolve(__dirname, '../../docs');

const app = express();
app.use(express.static(docsDir));

app.get('/', (_req, res) => {
  res.sendFile(path.join(docsDir, 'index.html'));
});

app.listen(EMPLOYEE_PORT, () => {
  console.log(`My Teamster Contract Date Calculator listening on http://localhost:${EMPLOYEE_PORT}`);
  console.log('Static multi-user app (each person is stored in this browser).');
  console.log('Leave this window open while you use the app.');
});
