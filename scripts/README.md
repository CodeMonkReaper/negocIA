# Scripts de Desarrollo

Utilidades para testing y debugging del proyecto negocIA durante el desarrollo.

## health-check.js

Verifica que la API esté respondiendo en `http://localhost:4000/api/health`.

```bash
node scripts/health-check.js
```

**Uso:** Validar que el servidor está arriba antes de ejecutar otros tests.

---

## test-auth.js

Prueba el flujo completo de autenticación y creación de cuenta WhatsApp.

```bash
node scripts/test-auth.js
```

**Requisitos:**
- API corriendo en `http://localhost:4000`
- Base de datos con datos de prueba

**Flujo:**
1. POST `/api/auth/login` con credenciales de prueba
2. POST `/api/whatsapp/accounts` con token Bearer

**Importante:** Las credenciales y números de teléfono están hardcodeados como placeholders. Ajustar antes de usar en desarrollo.

---

## add-whatsapp-account.ts

Script TypeScript para crear manualmente una cuenta WhatsApp en la base de datos usando Prisma (sin cifrado).

```bash
npx tsx scripts/add-whatsapp-account.ts
```

**Requisitos:**
- Node.js + tsx
- Base de datos PostgreSQL corriendo
- `.env` con DATABASE_URL

**Uso:** Debug de datos de cuenta WhatsApp sin pasar por la API (útil si webhook no funciona).

**Nota:** Este script no cifra el `access_token`. Para producción, usar el endpoint `/api/whatsapp/embedded-signup` que sí cifra.

---

## simulate-inbound.mjs

Simulador de webhooks entrantes de WhatsApp (incluido en este directorio).

```bash
node scripts/simulate-inbound.mjs
```

Consultar el archivo para ver opciones y payloads de ejemplo.

---

## .gitignore

Estos scripts usan a menudo credenciales reales en desarrollo. Asegurarse de que nunca se commiteen en `.env` o tokens reales. El `.gitignore` debe excluir:

```
.env
.env.local
*.log
ngrok_*.txt
```
