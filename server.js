const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;

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
        
        // Extract text and clean it for safe JSON parsing
        const text = data.content?.map(i => i.text || '').join('') || '';
        const clean = text.replace(/```json|```/g, '').trim();
        const match = clean.match(/\{[\s\S]*\}/);
        
        if (!match) {
          res.writeHead(200, {'Content-Type': 'application/json'});
          res.end(JSON.stringify({error:{message:'Claude no devolvió JSON válido: ' + clean.substring(0,200)}}));
          return;
        }

        // Parse and re-serialize to ensure clean JSON
        try {
          const result = JSON.parse(match[0]);
          res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({content:[{type:'text',text:JSON.stringify(result)}]}));
        } catch(parseErr) {
          // Return raw but sanitized
          res.writeHead(200, {'Content-Type': 'application/json; charset=utf-8'});
          res.end(JSON.stringify({content:[{type:'text',text:match[0]}]}));
        }

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
