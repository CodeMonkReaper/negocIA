/**
 * Script para configurar ngrok y obtener la URL pública
 * 
 * Instrucciones:
 * 1. Ejecuta este script: node scripts/setup-ngrok.mjs
 * 2. Sigue las instrucciones para iniciar ngrok
 * 3. Copia la URL pública que muestra ngrok
 * 4. Pega la URL en el prompt del script
 * 5. El script actualizará tu archivo .env con la URL correcta
 */

import readline from "readline";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
});

const envPath = path.join(__dirname, "..", ".env");

function log(message, type = "info") {
  const prefix = {
    info: "ℹ️",
    success: "✅",
    warning: "⚠️",
    error: "❌",
  }[type] || "ℹ️";
  
  console.log(`${prefix} ${message}`);
}

function askQuestion(question) {
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      resolve(answer.trim());
    });
  });
}

async function getNgrokUrl() {
  log("🚀 Iniciando ngrok...");
  log("1. Abre una nueva terminal");
  log("2. Ejecuta: ngrok http 4000");
  log("3. Copia la URL pública (ej: https://abc123.ngrok-free.dev)");
  log("4. Pégala abajo");
  
  const url = await askQuestion("URL pública de ngrok: ");
  
  if (!url || !url.startsWith("https://")) {
    log("❌ La URL debe empezar con https://", "error");
    process.exit(1);
  }
  
  return url;
}

async function updateEnvFile(ngrokUrl) {
  log("✏️  Actualizando archivo .env...");
  
  let envContent = fs.readFileSync(envPath, "utf-8");
  
  // Encontrar y reemplazar la URL de redirect
  const redirectUriPattern = /META_EMBEDDED_SIGNUP_REDIRECT_URI=.+/;
  const newRedirectUri = `META_EMBEDDED_SIGNUP_REDIRECT_URI=${ngrokUrl}/api/v1/whatsapp/accounts/embedded-signup/callback`;
  
  if (redirectUriPattern.test(envContent)) {
    envContent = envContent.replace(redirectUriPattern, newRedirectUri);
    log(`✅ Redirect URI actualizado a:`, "success");
    log(`   ${newRedirectUri}`);
  } else {
    log("⚠️  No se encontró META_EMBEDDED_SIGNUP_REDIRECT_URI en .env", "warning");
    log("   Agregando manualmente...");
    envContent += `\n${newRedirectUri}\n`;
  }
  
  // Guardar archivo
  fs.writeFileSync(envPath, envContent);
  log("✅ Archivo .env actualizado", "success");
}

async function main() {
  log("⚙️  Configuración de ngrok para Embedded Signup");
  log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  log("");
  
  try {
    const ngrokUrl = await getNgrokUrl();
    
    log("");
    log("📍 URL recibida: " + ngrokUrl);
    log("");
    
    // Verificar que la URL funciona
    log("🔍 Verificando URL...");
    try {
      const response = await fetch(ngrokUrl + "/api/health");
      if (response.ok) {
        log("✅ La URL está funcionando correctamente", "success");
      } else {
        log("⚠️  La URL responde pero con código: " + response.status, "warning");
      }
    } catch (error) {
      log("⚠️  No se pudo verificar la URL: " + error.message, "warning");
    }
    
    log("");
    log("📝 Instrucciones para Meta Developer Console:");
    log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
    log("1. Ve a: https://developers.facebook.com/apps/");
    log("2. Selecciona tu aplicación de WhatsApp");
    log("3. Ve a Configuración > Básico > Ver");
    log("4. Copia tu App ID y App Secret (ya están en tu .env)");
    log("");
    log("5. Ve a Configuración > WhatsApp > Configuración");
    log("6. Busca 'Embedded Signup'");
    log("7. Habilita Embedded Signup OAuth flow");
    log("8. En 'Redirect URIs', agrega:");
    log(`   ${ngrokUrl}/api/v1/whatsapp/accounts/embedded-signup/callback`);
    log("");
    log("9. Guarda los cambios");
    log("");
    
    const confirm = await askQuestion("¿Has configurado la URL en Meta? (s/n): ");
    
    if (confirm.toLowerCase() === "s") {
      await updateEnvFile(ngrokUrl);
      log("");
      log("🎉 Configuración completada!");
      log("");
      log("Puedes probar ahora con: node scripts/test-embedded-signup.mjs");
    } else {
      log("⚠️  No olvides configurar la URL en Meta antes de probar", "warning");
    }
    
  } catch (error) {
    log("❌ Error: " + error.message, "error");
  } finally {
    rl.close();
  }
}

main();
