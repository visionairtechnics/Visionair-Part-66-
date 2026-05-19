exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;
  if (event.httpMethod !== 'POST') return { statusCode: 405, body: 'Method Not Allowed' };
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return { statusCode: 500, headers: {'Content-Type':'application/json'}, body: JSON.stringify({error:{message:'Sin API key'}}) };
  let body;
  try { body = JSON.parse(event.body); } catch(e) { return { statusCode: 400, headers: {'Content-Type':'application/json'}, body: JSON.stringify({error:{message:'JSON inválido: '+e.message}}) }; }
  if (body.max_tokens > 2000) body.max_tokens = 2000;
  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', { method:'POST', headers:{'Content-Type':'application/json','x-api-key':apiKey,'anthropic-version':'2023-06-01'}, body: JSON.stringify(body) });
    const text = await r.text();
    return { statusCode: r.status, headers: {'Content-Type':'application/json','Access-Control-Allow-Origin':'*'}, body: text };
  } catch(err) {
    return { statusCode: 500, headers: {'Content-Type':'application/json'}, body: JSON.stringify({error:{message:err.message}}) };
  }
};
