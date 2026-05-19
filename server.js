const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;

function sanitizeJSON(text) {
  let clean = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
  
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start === -1 || end === -1) return null;
  clean = clean.substring(start, end + 1);
  
  // Fix escaped forward slashes that break JSON arrays: "R\/I" -> "R/I"
  clean = clean.replace(/\\\//g, '/');
  
  // Replace problematic Unicode characters
  clean = clean
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014]/g, '-')
    .replace(/[\u00A0]/g, ' ')
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
  
  return clean;
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
    req.on('data', chunk => body += chunk.toString());
    req.on('end', async () => {
      try {
        if (!API_KEY) {
          res.writeHead(500, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error:{message:'ANTHROPIC_API_KEY no configurada'}}));
          return;
        }

        const parsed = JSON.parse(body);
        if (parsed.max_tokens > 3000) parsed.max_tokens = 3000;

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
        const cleanText = sanitizeJSON(rawText);
        
        if (!cleanText) {
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error:{message:'No se encontró JSON en la respuesta'}}));
          return;
        }

        let result;
        try {
          result = JSON.parse(cleanText);
        } catch(e) {
          const pos = parseInt(e.message.match(/position (\d+)/)?.[1] || '0');
          console.error('JSON parse error:', e.message);
          console.error('Context:', cleanText.substring(Math.max(0,pos-80), pos+80));
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error:{message:'Error parseando: ' + e.message}}));
          return;
        }

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
