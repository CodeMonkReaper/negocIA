# CONTEXTO DEL PROYECTO — SaaS IA PARA WHATSAPP

## 1. Rol de OpenCode

Actúas como:

- Senior SaaS Architect
- Senior Backend Engineer
- Senior Fullstack Engineer
- Database Architect
- AI/LLM Engineer
- DevOps Engineer

Tu responsabilidad es ayudar a diseñar, implementar, revisar y evolucionar un SaaS multi-tenant production-ready.

No debes limitarte a generar código. Antes de implementar una funcionalidad debes analizar:
- arquitectura
- modelo de datos
- seguridad
- multi-tenancy
- concurrencia
- idempotencia
- errores
- observabilidad
- costos
- mantenibilidad
- escalabilidad razonable

Si detectas una decisión incorrecta en este contexto, debes señalarla explícitamente y proponer una alternativa técnicamente justificada.

No debes aceptar una decisión solamente porque esté escrita en este documento.

---

# 2. Visión del producto

Estamos construyendo un SaaS B2B para PyMEs de Chile y posteriormente Latinoamérica.

El producto permite que una PyME conecte su cuenta de WhatsApp Business y tenga un asistente de IA capaz de:

- responder consultas 24/7
- responder preguntas sobre productos o servicios
- entregar precios
- cotizar
- registrar pedidos
- consultar disponibilidad
- reservar horas
- evitar doble reserva
- escalar conversaciones a humanos
- permitir que trabajadores atiendan conversaciones desde un Inbox web
- administrar catálogo
- administrar clientes
- administrar agenda
- consultar pedidos y reservas

El producto es multi-tenant.

Cada empresa es un tenant aislado lógicamente.

---

# 3. Público objetivo

Principalmente:

- tiendas online
- distribuidoras
- peluquerías
- barberías
- centros de estética
- centros médicos
- centros dentales
- kinesiólogos
- profesionales independientes
- pequeños negocios de servicios

Problema principal:

Las PyMEs reciben consultas por WhatsApp y pierden tiempo o ventas debido a:

- respuestas manuales
- respuestas tardías
- información dispersa
- dificultad para administrar reservas
- dificultad para administrar pedidos
- falta de atención fuera del horario comercial

---

# 4. Propuesta de valor

El producto debe convertir WhatsApp en un canal operativo para la PyME.

La IA no debe limitarse a conversar.

Debe poder ejecutar acciones reales mediante herramientas controladas por el backend.

Ejemplos:

- consultar_producto
- buscar_productos
- calcular_cotizacion
- crear_pedido
- consultar_disponibilidad
- crear_reserva_temporal
- confirmar_reserva
- cancelar_reserva
- transferir_a_humano

El LLM NO debe modificar directamente la base de datos.

Toda operación importante debe pasar por una Tool / Application Service / Domain Service controlada por el backend.

---

# 5. Modos iniciales del producto

Cada tenant puede operar inicialmente en uno o ambos modos.

## Modo Ventas

Permite:

- catálogo
- productos
- precios
- stock opcional
- cotizaciones
- pedidos
- seguimiento de pedidos

Ejemplo:

Cliente:
"Necesito 20 cajas de producto X."

La IA debe poder:

1. identificar producto
2. consultar precio
3. consultar disponibilidad
4. calcular subtotal
5. generar cotización
6. solicitar confirmación
7. crear pedido

## Modo Agendamiento

Permite:

- servicios
- duración
- profesionales
- recursos
- horarios
- disponibilidad
- reservas
- cancelaciones

La IA puede interpretar lenguaje natural, pero NO controla directamente la agenda.

Debe utilizar Tools.

Ejemplo:

Cliente:
"Quiero hora para mañana a las 17."

La IA:

1. identifica intención
2. identifica servicio
3. consulta disponibilidad
4. ofrece slots válidos
5. crea HOLD temporal
6. solicita confirmación
7. confirma reserva

---

# 6. Arquitectura tecnológica

## Backend

Node.js + TypeScript

Framework:

NestJS

No utilizar Express directamente como arquitectura de aplicación.

NestJS puede utilizar Express internamente, pero la aplicación debe organizarse mediante módulos de NestJS.

## Frontend

Next.js + React + TypeScript

UI:

Tailwind CSS

El dashboard será una aplicación web para:

- Inbox
- clientes
- productos
- pedidos
- agenda
- configuración
- usuarios
- conexión WhatsApp
- configuración de IA

## Base de datos

PostgreSQL.

Usar Supabase como proveedor de PostgreSQL inicialmente si resulta conveniente.

Usar pgvector para embeddings cuando realmente sea necesario.

No utilizar RAG para operaciones que deberían resolverse mediante consultas deterministas.

## Cache / Jobs

Redis

BullMQ

Redis se utiliza para:

- queues
- jobs
- procesamiento asíncrono
- locks auxiliares
- estados temporales cuando corresponda

Redis NO debe ser la fuente de verdad para reservas.

## WhatsApp

Meta WhatsApp Business Cloud API.

El onboarding debe utilizar Embedded Signup cuando corresponda.

El diseño debe contemplar múltiples tenants y múltiples cuentas/números de WhatsApp.

## IA

La arquitectura debe abstraer al proveedor LLM.

Inicialmente puede utilizarse OpenAI.

No acoplar la lógica de negocio directamente a una implementación concreta del SDK.

Debe existir una abstracción equivalente a:

LLMProvider

con posibilidad futura de:

- OpenAI
- Anthropic
- otros proveedores

## Tiempo real

Para el dashboard:

- WebSockets con Socket.IO
o
- Server-Sent Events

Elegir la alternativa técnicamente más apropiada para el caso concreto.

---

# 7. Arquitectura lógica

La aplicación debe separar claramente:

```text
Presentation
    ↓
Application
    ↓
Domain
    ↓
Infrastructure
```

No es necesario implementar Clean Architecture de manera dogmática.

La prioridad es mantener:

- separación de responsabilidades
- testabilidad
- bajo acoplamiento
- independencia razonable de infraestructura
- dominio independiente del proveedor LLM
- dominio independiente de Meta
- dominio independiente del framework HTTP

---

# 8. Multi-tenancy

La aplicación debe ser multi-tenant desde el primer día.

Conceptualmente:

```text
Tenant
 ├── Users
 ├── WhatsApp Accounts
 ├── Conversations
 ├── Messages
 ├── Customers
 ├── Products
 ├── Orders
 ├── Services
 ├── Resources
 ├── Appointments
 └── AI Configuration
```

Las entidades pertenecientes a un tenant deben tener:

```text
tenant_id
```

La aplicación debe impedir cualquier acceso cruzado entre tenants.

No confiar únicamente en filtros enviados desde frontend.

El tenant debe determinarse desde el contexto autenticado.

Cuando sea apropiado utilizar PostgreSQL RLS, debe considerarse como una segunda capa de aislamiento.

---

# 9. Seguridad multi-tenant

Nunca confiar en:

```text
tenant_id enviado por el frontend
```

Ejemplo incorrecto:

```http
GET /api/orders?tenant_id=123
```

El backend debe obtener el tenant desde la identidad autenticada y autorización del usuario.

Conceptualmente:

```text
JWT
 ↓
User
 ↓
Membership
 ↓
Tenant
 ↓
Authorization
 ↓
Query
```

Toda consulta debe estar asociada al tenant correcto.

También deben validarse permisos por rol.

---

# 10. Roles

Inicialmente considerar:

OWNER
ADMIN
AGENT

Posiblemente:

SUPER_ADMIN

para administración interna del SaaS.

No asumir que todos los usuarios de un tenant tienen los mismos permisos.

---

# 11. Conversaciones

Una conversación pertenece a un tenant.

Una conversación está asociada a un contacto/cliente y a un canal.

Ejemplo:

```text
Conversation
 ├── tenant_id
 ├── customer_id
 ├── channel
 ├── status
 ├── mode
 ├── assigned_user_id
 └── timestamps
```

Estados mínimos:

```text
BOT_ACTIVE
HUMAN_REQUESTED
HUMAN_ACTIVE
CLOSED
```

La máquina de estados debe impedir transiciones inválidas.

---

# 12. Mensajes

Cada mensaje debe registrar al menos:

- tenant_id
- conversation_id
- dirección
- contenido
- tipo
- provider_message_id
- timestamps
- metadata necesaria

Dirección:

```text
INBOUND
OUTBOUND
```

Los mensajes provenientes de Meta deben tener identificadores externos para garantizar idempotencia.

---

# 13. Webhooks

Los webhooks de Meta deben:

1. validar autenticidad
2. validar estructura
3. persistir evento o mensaje
4. garantizar idempotencia
5. responder rápidamente a Meta
6. enviar procesamiento pesado a BullMQ

No ejecutar una llamada LLM dentro del request HTTP del webhook.

Arquitectura:

```text
Meta
 ↓
Webhook
 ↓
Persist / deduplicate
 ↓
Queue
 ↓
HTTP 200
```

Después:

```text
Worker
 ↓
Conversation Engine
 ↓
LLM
 ↓
Tools
 ↓
Business Logic
 ↓
Response
 ↓
Meta
```

---

# 14. Idempotencia

Los eventos externos pueden repetirse.

Por lo tanto deben existir identificadores únicos apropiados.

Ejemplo conceptual:

```text
provider
provider_event_id
```

con constraint única.

Un evento ya procesado no debe generar:

- segundo mensaje
- segundo pedido
- segunda reserva
- segundo envío de WhatsApp

---

# 15. LLM y Tool Calling

El LLM sirve para:

- entender intención
- extraer parámetros
- mantener contexto conversacional
- decidir qué Tool utilizar
- generar respuestas naturales

El LLM NO debe ser la fuente de verdad.

Ejemplo:

```text
LLM
 ↓
consultar_disponibilidad()
 ↓
SchedulingService
 ↓
PostgreSQL
```

Nunca:

```text
LLM
 ↓
"creo que las 17:00 está libre"
```

La disponibilidad debe provenir de la base de datos.

---

# 16. Tools iniciales

## Ventas

```text
buscar_productos
consultar_producto
consultar_stock
calcular_cotizacion
crear_pedido
consultar_estado_pedido
```

## Agenda

```text
consultar_servicios
consultar_profesionales
consultar_disponibilidad
crear_reserva_temporal
confirmar_reserva
cancelar_reserva
```

## Conversación

```text
transferir_a_humano
cerrar_conversacion
```

Las Tools deben tener:

- input schema estricto
- validación
- autorización
- tenant context
- manejo de errores
- logs
- resultado estructurado

---

# 17. Agendamiento

El LLM nunca administra directamente la agenda.

El flujo es:

```text
Intención
 ↓
consultar_disponibilidad
 ↓
mostrar slots
 ↓
crear HOLD
 ↓
confirmación
 ↓
confirmar reserva
```

Los HOLD duran inicialmente 5 minutos.

La base de datos es la fuente de verdad.

Debe existir protección contra condiciones de carrera.

Nunca implementar solamente:

```text
if slot_available:
    insert appointment
```

porque dos procesos concurrentes pueden reservar el mismo slot.

Utilizar transacciones y mecanismos de PostgreSQL apropiados, incluyendo restricciones de exclusión/rangos cuando corresponda.

---

# 18. RAG

RAG se utilizará principalmente para conocimiento no estructurado.

Ejemplos:

- políticas
- preguntas frecuentes
- descripciones extensas
- instrucciones
- información comercial
- documentos

No utilizar embeddings para:

- precios actuales
- stock
- disponibilidad
- reservas
- pedidos
- usuarios

Esos datos deben consultarse directamente mediante Tools.

---

# 19. Dashboard

El dashboard debe incluir inicialmente:

```text
Dashboard
├── Inbox
├── Clientes
├── Productos
├── Pedidos
├── Agenda
├── Servicios
├── WhatsApp
├── Configuración IA
├── Usuarios
└── Cuenta
```

El Inbox debe permitir:

- visualizar conversaciones
- enviar mensajes manualmente
- tomar control de una conversación
- devolver conversación al bot
- asignar conversación a usuario
- visualizar estado
- visualizar historial

---

# 20. Estados de atención humana

Si el cliente solicita una persona:

```text
BOT_ACTIVE
     ↓
HUMAN_REQUESTED
     ↓
HUMAN_ACTIVE
```

Mientras una conversación esté en HUMAN_ACTIVE:

La IA NO debe responder automáticamente.

Un operador puede:

```text
HUMAN_ACTIVE
     ↓
BOT_ACTIVE
```

cuando devuelva el control al bot.

---

# 21. Base de datos

No crear tablas arbitrariamente.

Antes de modificar el esquema:

1. identificar entidades
2. identificar relaciones
3. identificar ownership/tenant
4. identificar constraints
5. identificar índices
6. identificar concurrencia
7. identificar lifecycle/status
8. evaluar migración

Usar migraciones versionadas.

Nunca modificar producción manualmente sin una migración reproducible.

---

# 22. Observabilidad

La aplicación debe contemplar:

- structured logging
- correlation/request IDs
- tenant IDs en logs cuando sea seguro
- job IDs
- provider message IDs
- errores de LLM
- errores de Meta
- duración de jobs
- número de reintentos

No registrar:

- tokens de acceso
- contraseñas
- secretos
- información sensible innecesaria

---

# 23. Manejo de errores

Los errores deben clasificarse.

Ejemplo:

```text
ValidationError
AuthorizationError
NotFoundError
ConflictError
ExternalProviderError
LLMError
DatabaseError
RateLimitError
```

No devolver stack traces al cliente.

Los errores externos deben tener retry cuando sea seguro.

Los jobs deben diferenciar entre:

- errores reintentables
- errores permanentes

---

# 24. Testing

Cada funcionalidad importante debe tener tests.

Prioridad:

1. domain/business logic
2. services
3. authorization
4. tenant isolation
5. webhook idempotency
6. scheduling concurrency
7. tool execution
8. API integration
9. frontend critical flows

El sistema de reservas debe tener pruebas explícitas de concurrencia.

El sistema multi-tenant debe tener pruebas explícitas de aislamiento.

---

# 25. Principios de desarrollo

Priorizar:

- simplicidad
- seguridad
- claridad
- testabilidad
- observabilidad
- mantenibilidad

Evitar:

- overengineering
- microservicios prematuros
- abstracciones sin necesidad
- dependencias innecesarias
- lógica de negocio en controllers
- lógica de negocio dentro de componentes React
- acceso directo a DB desde frontend
- llamadas LLM desde cualquier lugar sin control

Preferir un modular monolith inicialmente.

No crear microservicios hasta que exista una razón operacional real.

---

# 26. Arquitectura inicial de despliegue

Inicialmente:

```text
Cloudflare
    │
    ├── Next.js / Frontend
    │
    └── API
          │
          ▼
       NestJS
          │
     ┌────┴────┐
     ▼         ▼
  Redis     PostgreSQL
  BullMQ
```

Workers pueden ejecutarse como procesos separados aunque pertenezcan al mismo código base.

No crear infraestructura compleja sin necesidad.

---

# 27. Modelo comercial inicial

Planes conceptuales:

## Básico

25.000 CLP/mes

- hasta 1.000 mensajes
- hasta 50 productos/servicios
- 1 usuario

## Pro

45.000 CLP/mes

- hasta 2.000 mensajes
- hasta 130 productos/servicios
- 3 usuarios

## Premium

70.000 CLP/mes

- hasta 3.500 mensajes
- hasta 200 productos/servicios
- 5 usuarios

Estos precios son hipótesis de negocio y no deben tratarse como precios de mercado validados.

El sistema debe diseñarse para poder modificar posteriormente:

- límites
- planes
- consumo
- funcionalidades
- billing

sin reescribir el core.

---

# 28. MVP

El MVP no debe intentar implementar todo.

Orden recomendado:

### Fase 1

- monorepo
- NestJS
- Next.js
- PostgreSQL
- Redis
- Docker
- configuración
- migraciones
- auth
- tenants
- usuarios
- roles

### Fase 2

- Meta WhatsApp Cloud API
- Embedded Signup
- webhook
- idempotencia
- mensajes
- conversaciones

### Fase 3

- LLM provider abstraction
- conversación con IA
- Tool Calling
- contexto
- transferencia a humano

### Fase 4

Modo Ventas:

- productos
- catálogo
- precios
- clientes
- cotización
- pedidos

### Fase 5

Modo Agendamiento:

- servicios
- profesionales
- horarios
- disponibilidad
- HOLD
- confirmación
- cancelación
- anti-solapamiento

### Fase 6

Dashboard:

- Inbox
- productos
- clientes
- pedidos
- agenda
- configuración

### Fase 7

- RAG
- analytics
- billing
- métricas
- optimización de costos

---

# 29. Regla fundamental para OpenCode

NO implementar una funcionalidad grande directamente si primero requiere decisiones arquitectónicas.

Cuando una tarea tenga impacto en:

- DB
- seguridad
- multi-tenancy
- eventos
- concurrencia
- API
- arquitectura

primero generar un artifact de diseño.

Después de revisar el diseño, implementar.

---

# 30. Artifact esperado

Para cada feature importante generar, cuando corresponda:

```text
docs/
├── architecture/
├── adr/
├── database/
├── api/
├── flows/
├── security/
└── testing/
```

Ejemplos:

```text
docs/architecture/overview.md
docs/architecture/multi-tenancy.md
docs/architecture/whatsapp.md
docs/architecture/ai-tool-calling.md

docs/adr/001-modular-monolith.md
docs/adr/002-postgresql-source-of-truth.md
docs/adr/003-llm-provider-abstraction.md

docs/database/schema.md
docs/database/erd.md

docs/api/webhooks.md
docs/api/conversations.md
docs/api/appointments.md

docs/flows/message-processing.md
docs/flows/human-handoff.md
docs/flows/appointment-booking.md

docs/security/tenant-isolation.md
docs/security/authentication.md
```

Los artifacts deben permanecer sincronizados con la implementación.

---

# 31. Regla de decisión

Cuando existan varias alternativas:

1. explicar las opciones
2. indicar ventajas y desventajas
3. recomendar una arquitectura
4. justificar técnicamente
5. esperar aprobación si la decisión cambia significativamente la arquitectura

No preguntar innecesariamente por decisiones triviales.

Si existe una opción claramente adecuada y no cambia una decisión arquitectónica importante, implementarla directamente.

---

# 32. Restricción importante

No inventar APIs, precios, límites o capacidades de proveedores externos.

Cuando una integración dependa de información actual de:

- Meta
- OpenAI
- Anthropic
- Supabase
- Redis
- proveedores cloud

consultar documentación oficial actualizada cuando sea posible.

---

# 33. Estado actual

El proyecto está en etapa de diseño/MVP.

No asumir que existen módulos o archivos que todavía no han sido creados.

Antes de modificar código:

1. inspeccionar el repositorio
2. entender estructura existente
3. revisar dependencias
4. revisar migraciones
5. revisar convenciones
6. detectar inconsistencias
7. recién después implementar

Nunca sobrescribir código existente sin analizarlo primero.