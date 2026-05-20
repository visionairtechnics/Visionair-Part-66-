const http = require('http');
const fs = require('fs');
const path = require('path');
const { jsonrepair } = require('jsonrepair');
// Increase body size limit
const MAX_BODY_SIZE = 50 * 1024 * 1024; // 50MB
const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;

function extractAndRepairJSON(text) {
  // Remove markdown fences
  let clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  
  // Extract JSON object boundaries
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  clean = clean.substring(start, end + 1);
  
  // Use jsonrepair to fix any LLM-generated JSON issues
  // (unescaped newlines, trailing commas, escaped slashes, etc.)
  try {
    return jsonrepair(clean);
  } catch(e) {
    console.error('jsonrepair failed:', e.message);
    return null;
  }
}

const server = http.createServer(async (req, res) => {

  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(html);
    return;
  }

  if (req.method === 'POST' && req.url === '/analizar') {
    let body = '';
    req.on('data', chunk => {
  body += chunk.toString();
  if (body.length > MAX_BODY_SIZE) req.destroy();
});
    req.on('end', async () => {
      try {
        if (!API_KEY) {
          res.writeHead(500, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error:{message:'ANTHROPIC_API_KEY no configurada'}}));
          return;
        }

        const parsed = JSON.parse(body);
        if (parsed.max_tokens > 8000) parsed.max_tokens = 8000;

        console.log('Llamando a Anthropic...');
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify(parsed)
        });

        const data = await response.json();
        const rawText = data.content?.map(i => i.text || '').join('') || '';
        console.log('Respuesta Anthropic, longitud:', rawText.length);

        const repairedText = extractAndRepairJSON(rawText);

        if (!repairedText) {
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error:{message:'No se encontró JSON en la respuesta de Claude'}}));
          return;
        }

        // Final parse after repair
        const result = JSON.parse(repairedText);
        console.log('JSON parseado correctamente');

        res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
        res.end(JSON.stringify(result));

      } catch(e) {
        console.error('Error:', e.message);
        res.writeHead(500, {'Content-Type': 'application/json'});
        res.end(JSON.stringify({error:{message: e.message}}));
      }
    });
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

server.timeout = 300000;
server.listen(PORT, () => console.log(`VisionAir Part-66 server running on port ${PORT}`));
