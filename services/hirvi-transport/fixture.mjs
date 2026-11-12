// CI fixture: exercise the unchanged KLIO handlers without customer credentials.
import http from 'node:http';
import { combinedService } from '/opt/klio/combined.mjs';
const telegram = http.createServer(async (req, res) => {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ method: req.method, path: req.url, body: Buffer.concat(chunks).toString(), authorization: req.headers.authorization || null }));
});
telegram.listen(18081, '127.0.0.1');
combinedService({ telegramPort: 18081, token: process.env.KLIO_IMAGE_SERVICE_TOKEN, apiKey: process.env.OPENAI_API_KEY }).listen(Number(process.env.PORT), '0.0.0.0');
