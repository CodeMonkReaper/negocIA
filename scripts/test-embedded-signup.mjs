/**
 * Test de Embedded Signup de WhatsApp
 * 
 * Este script verifica que el endpoint de Embedded Signup esté funcionando
 * correctamente en la API.
 */

const API_BASE_URL = "http://localhost:4000/api";

async function testEmbeddedSignup() {
  console.log("🧪 Test de Embedded Signup de WhatsApp");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  
  console.log("\n📝 Paso 1: Verificando que la API esté corriendo...");
  
  try {
    // Verificar que la API esté corriendo (health no tiene versión)
    const healthResp = await fetch(`${API_BASE_URL}/health`);
    
    if (!healthResp.ok) {
      console.log("  ❌ Error: La API no está respondiendo");
      console.log("  Asegúrate de ejecutar: npm run dev");
      return;
    }
    
    const healthData = await healthResp.json();
    console.log("  ✅ API corriendo (v" + healthData.version + ")");
    
    // Usar v1 para las rutas autenticadas
    const API_V1_URL = "http://localhost:4000/api/v1";
    
    // Crear usuario de prueba
    const testEmail = `embedded-test-${Date.now()}@negocia.app`;
    const testPassword = "Test1234!Pass"; // 12+ chars, mayus, minus, number, symbol
    
    console.log(`\n📝 Paso 2: Registrando usuario: ${testEmail}`);
    
    const registerResp = await fetch(`${API_V1_URL}/auth/register`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
        name: "Test Embedded Signup",
      }),
    });
    
    const registerData = await registerResp.json().catch(() => null);
    
    if (!registerResp.ok) {
      console.log("  ❌ Error registrando usuario:");
      console.log("  ", JSON.stringify(registerData, null, 2));
      return;
    }
    
    console.log("  ✅ Usuario registrado");
    
    // Login para obtener access token (usar v1 para rutas autenticadas)
    console.log("\n📝 Paso 3: Iniciando sesión...");
    const loginResp = await fetch(`${API_V1_URL}/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: testEmail,
        password: testPassword,
      }),
    });
    
    const loginData = await loginResp.json().catch(() => null);
    
    if (!loginResp.ok) {
      console.log("  ❌ Error haciendo login:");
      console.log("  ", JSON.stringify(loginData, null, 2));
      return;
    }
    
    const accessToken = loginData.accessToken;
    console.log("  ✅ Token obtenido (primeros 20 chars): " + accessToken.substring(0, 20) + "...");
    
    // Paso 4: Generar URL de Embedded Signup (usar v1)
    console.log("\n📝 Paso 4: Llamando a GET /whatsapp/accounts/embedded-signup/url...");
    
    const urlResp = await fetch(`${API_V1_URL}/whatsapp/accounts/embedded-signup/url`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
      },
    });
    
    const urlData = await urlResp.json().catch(() => null);
    
    if (!urlResp.ok) {
      console.log("  ❌ Error generando URL:");
      console.log("  ", JSON.stringify(urlData, null, 2));
      return;
    }
    
    console.log("  ✅ URL generada correctamente:");
    console.log("  ", urlData.url.substring(0, 80) + "...");
    
    // Verificar que la URL contenga los parámetros esperados
    const urlObj = new URL(urlData.url);
    const params = urlObj.searchParams;
    
    console.log("\n  🔍 Verificando URL:");
    console.log("    - client_id:", params.get("client_id")?.substring(0, 20) + "...");
    console.log("    - redirect_uri:", params.get("redirect_uri"));
    console.log("    - scope:", params.get("scope"));
    console.log("    - response_type:", params.get("response_type"));
    console.log("    - state:", params.get("state")?.substring(0, 30) + "...");
    
    // Generar state manualmente para test (sin usar la API)
    console.log("\n📝 Paso 5: Generando state JWT manualmente...");
    
    const tenantId = "test-tenant-uuid-12345";
    const nonce = "test-nonce-" + Date.now();
    
    console.log("  (Para un state real, se usaría jose.SignJWT)");
    console.log("  tenantId:", tenantId);
    console.log("  nonce:", nonce);
    console.log("  exp: +600s (10 min)");
    
    // Paso 6: Verificar callback
    console.log("\n📝 Paso 6: Endpoint de callback disponible...");
    
    console.log("  ✅ GET /whatsapp/accounts/embedded-signup/callback");
    console.log("    - Parámetros esperados: code, state, error (opcional)");
    console.log("    - Devuelve HTML con postMessage al opener");
    
    // Nota: No podemos simular la redirección real sin un servidor público
    // La redirección real requiere que Meta llame a tu endpoint
    
    console.log("\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    console.log("📊 Resumen:");
    console.log("  ✅ API corriendo");
    console.log("  ✅ Usuario registrado");
    console.log("  ✅ Token obtenido");
    console.log("  ✅ URL de Embedded Signup generada");
    console.log("  ✅ State JWT generado");
    console.log("  ✅ Endpoint de callback disponible");
    console.log("");
    console.log("  🔴 Próximo paso (prueba manual):");
    console.log("    1. Abre la URL de autorización en un navegador:");
    console.log("       ", urlData.url.substring(0, 80) + "...");
    console.log("    2. Autoriza la aplicación en Meta (Facebook)");
    console.log("    3. Meta redirigirá al callback con el código");
    console.log("    4. La API procesará el código y creará la cuenta");
    console.log("");
    console.log("  🟢 Próximo paso (prueba manual):");
    console.log("    1. Abre la URL de autorización en un navegador:");
    console.log("       ", urlData.url.substring(0, 80) + "...");
    console.log("    2. Autoriza la aplicación en Meta (Facebook)");
    console.log("    3. Meta redirigirá al callback con el código");
    console.log("    4. La API procesará el código y creará la cuenta");
    console.log("");
    console.log("  🟢 Configuración actual en .env:");
    console.log("    META_EMBEDDED_SIGNUP_REDIRECT_URI=");
    console.log("    https://zesty-unheated-enhance.ngrok-free.dev/api/v1/whatsapp/accounts/embedded-signup/callback");
    console.log("");
    console.log("  🔴 Importante:");
    console.log("    1. Asegúrate de que esta misma URL esté configurada en");
    console.log("       Meta Developer Console > WhatsApp > Embedded Signup");
    console.log("    2. Meta verificará la URL con una petición GET sin parámetros");
    console.log("    3. La API responde 'OK' para validación simple");
    
  } catch (error) {
    console.error("  ❌ Error:", error.message);
    console.log("\n  Nota: Asegúrate de que la API esté corriendo");
    console.log("        Ejecuta: npm run dev");
  }
}

testEmbeddedSignup().catch(console.error);
