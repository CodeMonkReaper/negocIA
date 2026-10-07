/**
 * Test directo de la API de OpenRouter
 * 
 * Verifica que la conexión con OpenRouter está funcionando correctamente
 * haciendo una llamada simple al modelo configurado.
 */

const OPENROUTER_API_KEY = process.env.OPENROUTER_API_KEY;
if (!OPENROUTER_API_KEY) {
  console.error("❌ OPENROUTER_API_KEY no está definida en el entorno.");
  process.exit(1);
}
const LLM_MODEL = process.env.LLM_MODEL || "apodex/apodex-1.1-mini:free";

async function testOpenRouter() {
  console.log("🧪 Test de OpenRouter LLM");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log(`API Key ( primeros 20 chars ): ${OPENROUTER_API_KEY.substring(0, 20)}...`);
  console.log(`Modelo: ${LLM_MODEL}`);
  console.log("");

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${OPENROUTER_API_KEY}`,
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:4000",
        "X-Title": "negocIA",
      },
      body: JSON.stringify({
        model: LLM_MODEL,
        messages: [
          { role: "user", content: "Dime un saludo simple en una palabra." }
        ],
        temperature: 0.7,
        max_tokens: 50,
      }),
    });

    console.log(`Status Code: ${response.status}`);
    console.log(`Status Text: ${response.statusText}`);
    console.log("");

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      console.log("❌ Error en la respuesta:");
      console.log(JSON.stringify(data, null, 2));
      process.exit(1);
    }

    console.log("✅ Respuesta exitosa:");
    console.log(JSON.stringify(data, null, 2));

    // Verificar que tiene el contenido esperado
    const content = data.choices?.[0]?.message?.content;
    if (content) {
      console.log("");
      console.log(`✨ Content: "${content}"`);
    }

  } catch (error) {
    console.error("❌ Error al conectar con OpenRouter:");
    console.error(error.message);
    process.exit(1);
  }
}

testOpenRouter();
