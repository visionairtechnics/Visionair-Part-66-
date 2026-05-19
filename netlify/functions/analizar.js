exports.handler = async (event, context) => {
  context.callbackWaitsForEmptyEventLoop = false;

  // Log incoming request for debugging
  console.log('Method:', event.httpMethod);
  console.log('Body length:', event.body ? event.body.length : 0);
  console.log('IsBase64:', event.isBase64Encoded);

  if (event.httpMethod !== 'POST') {
    return { statusCode: 405, headers: {'Content-Type':'application/json'}, body: JSON.stringify({error:{message:'Method Not Allowed'}}) };
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return { statusCode: 500, headers: {'Content-Type':'application/json'}, body: JSON.stringify({error:{message:'Sin API key configurada'}}) };
  }

  // Handle body - may be base64 encoded
  let rawBody = event.body;
  if (event.isBase64Encoded && rawBody) {
    rawBody = Buffer.from(rawBody, 'base64').toString('utf8');
  }

  if (!rawBody || rawBody.length < 10) {
    console.log('Empty body received');
    return { statusCode: 400, headers: {'Content-Type':'application/json'}, body: JSON.stringify({error:{message:'Cuerpo de la petición vacío'}}) };
  }

  let body;
  try {
    body = JSON.parse(rawBody);
  } catch(e) {
    console.log('JSON parse error:', e.message, 'Body start:', rawBody.substring(0, 100));
    return { statusCode: 400, headers: {'Content-Type':'application/json'}, body: JSON.stringify({error:{message:'JSON inválido: ' + e.message}}) };
  }

  if (body.max_tokens > 2000) body.max_tokens = 2000;

  console.log('Calling Anthropic, model:', body.model, 'messages:', body.messages?.length);

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify(body)
    });

    console.log('Anthropic status:', r.status);
    const text = await r.text();
    console.log('Response length:', text.length);

    return {
      statusCode: r.status,
      headers: {'Content-Type':'application/json', 'Access-Control-Allow-Origin':'*'},
      body: text
    };
  } catch(err) {
    console.log('Fetch error:', err.message);
    return { statusCode: 500, headers: {'Content-Type':'application/json'}, body: JSON.stringify({error:{message:err.message}}) };
  }
};
