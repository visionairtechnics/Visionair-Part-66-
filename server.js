const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const API_KEY = process.env.ANTHROPIC_API_KEY;

const server = http.createServer(async (req, res) => {
  // Serve index.html
  if (req.method === 'GET' && (req.url === '/' || req.url === '/index.html')) {
    const html = fs.readFileSync(path.join(__dirname, 'index.html'), 'utf8');
    res.writeHead(200, {'Content-Type': 'text/html; charset=utf-8'});
    res.end(html);
    return;
  }

  // API proxy endpoint
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

        console.log('Body length:', body.length);
        const parsed = JSON.parse(body);
        if (parsed.max_tokens > 3000) parsed.max_tokens = 3000;

        console.log('Calling Anthropic...');
        const response = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-api-key': API_KEY,
            'anthropic-version': '2023-06-01'
          },
          body: JSON.stringify(parsed)
        });

        const text = await response.text();
        console.log('Anthropic status:', response.status, 'Response length:', text.length);

        res.writeHead(response.status, {
          'Content-Type': 'application/json',
          'Access-Control-Allow-Origin': '*'
        });
        res.end(text);
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

server.timeout = 300000; // 5 minutes
server.listen(PORT, () => console.log(`VisionAir Part-66 server running on port ${PORT}`));
