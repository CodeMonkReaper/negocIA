// Test auth endpoints
const fetch = globalThis.fetch;

async function test() {
  // Try login
  const loginRes = await fetch('http://localhost:4000/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'test@test.com', password: 'test1234' })
  });
  const loginData = await loginRes.json();
  console.log('Login response:', JSON.stringify(loginData, null, 2));
  
  if (loginData.accessToken) {
    // Try to add WhatsApp account with auth header
    const waRes = await fetch('http://localhost:4000/api/whatsapp/accounts', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${loginData.accessToken}`
      },
      body: JSON.stringify({
        wabaId: "1121473550347494",
        phoneNumberId: "1336241236247821",
        accessToken: process.env.META_ACCESS_TOKEN
      })
    });
    const waData = await waRes.json();
    console.log('WhatsApp account response:', JSON.stringify(waData, null, 2));
  }
}

test().catch(console.error);