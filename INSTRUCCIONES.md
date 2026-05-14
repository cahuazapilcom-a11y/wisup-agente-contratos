# WISE UP — Agente de Contratos WhatsApp

Bot que genera el **Contrato de Facilidades de Pago** de WISE UP LATAM S.A.C. vía WhatsApp, produce un PDF firmable y lo sube a Google Drive.

---

## Estructura del proyecto

```
AGENTE CONTRATO/
├── agente-contratos.js     ← Bot principal (webhook WhatsApp, lógica conversacional)
├── generar-pdf.js          ← Servidor PDF (convierte HTML → PDF con Puppeteer)
├── make-scenario.json      ← Referencia del flujo Make.com (no se importa, es guía)
├── package.json            ← Dependencias Node.js
├── .env.example            ← Plantilla de variables de entorno
├── .env                    ← Tu configuración real (NO subir a git)
└── plantillas/
    └── facilidades.html    ← Plantilla HTML del contrato
```

---

## Requisitos previos

- Node.js LTS (v18 o superior): https://nodejs.org
- Cuenta Meta for Developers con WhatsApp Business API activa
- Cuenta Make.com (plan gratuito alcanza para pruebas)
- Cuenta Google con Google Drive
- Servidor con IP pública (Railway, Render, VPS, etc.) — o ngrok para pruebas locales

---

## Paso 1 — Instalar dependencias

```bash
npm install
```

---

## Paso 2 — Crear el archivo .env

Copia `.env.example` y renómbralo a `.env`, luego llena cada valor:

```env
# Token de acceso de Meta (WhatsApp Business API)
WA_TOKEN=EAAxxxxxxxxxxxxxxx

# ID del número de teléfono registrado en Meta
WA_PHONE_ID=123456789012345

# Palabra secreta para verificar el webhook (la inventas tú)
VERIFY_TOKEN=wiseupsecret2026

# URL del webhook de tu escenario en Make.com
MAKE_WEBHOOK=https://hook.eu1.make.com/xxxxxxxxxxxxxxxxx

# Puerto del bot principal (por defecto 3000)
PORT=3000

# Puerto del servidor PDF (por defecto 3001)
PDF_PORT=3001
```

---

## Paso 3 — Configurar Make.com

Sigue el flujo descrito en `make-scenario.json`. En resumen:

| Módulo | Tipo | Acción |
|--------|------|--------|
| 1 | Webhooks → Custom Webhook | Recibe datos del bot. Copia la URL al `.env` como `MAKE_WEBHOOK` |
| 2 | HTTP → Make a request | POST a `https://TU-SERVIDOR/generar-pdf` con los datos del contrato |
| 3 | Google Drive → Upload a File | Sube el PDF en base64 a una carpeta de Drive |
| 4 | Google Drive → Create a Shared Link | Genera enlace público del PDF |
| 5 | Webhooks → Webhook Response | Devuelve `{ "pdf_url": "..." }` al bot |

**En el Módulo 2**, el body debe ser:
```json
{"tipo": "{{1.tipo}}", "datos": {{toJSON(1.datos)}}}
```
> Nota: `toJSON()` es importante — convierte el objeto datos en JSON válido.

---

## Paso 4 — Configurar Meta WhatsApp Business

1. Ve a https://developers.facebook.com → tu app → WhatsApp → Configuración
2. En **Webhooks**, registra:
   - URL: `https://TU-SERVIDOR.com/webhook`
   - Token de verificación: el mismo valor que pusiste en `VERIFY_TOKEN`
3. Suscríbete al evento: `messages`

---

## Paso 5 — Iniciar los servidores

Abre **dos terminales**:

**Terminal 1 — Bot principal (puerto 3000):**
```bash
npm start
```

**Terminal 2 — Servidor PDF (puerto 3001):**
```bash
npm run pdf
```

---

## Paso 6 — Pruebas locales con ngrok

Si no tienes servidor en producción, usa ngrok para exponer tu localhost:

```bash
# Instala ngrok: https://ngrok.com/download
ngrok http 3000
```

Copia la URL HTTPS que genera ngrok (ej: `https://abc123.ngrok.io`) y úsala en:
- Meta Webhooks → URL del webhook
- `make-scenario.json` Módulo 2 → reemplaza `TU-SERVIDOR.com` por `abc123.ngrok.io`

> Para el servidor PDF también necesitarás exponer el puerto 3001, o correr ambos en el mismo proceso.

---

## Flujo completo del bot

```
Usuario escribe HOLA en WhatsApp
        ↓
agente-contratos.js recibe el mensaje vía webhook Meta
        ↓
Bot pide datos del estudiante uno a uno:
  1. Apellidos y nombres
  2. DNI
  3. Domicilio
  4. Teléfono
  5. Email
  6. N° cuotas (6, 12 o 18)
  7. Fecha de firma
        ↓
Bot calcula: cuota inicial (20%), monto financiado, cuota mensual, cronograma
        ↓
Bot muestra resumen → usuario confirma con SI
        ↓
Bot llama al webhook de Make.com con todos los datos
        ↓
Make.com llama a generar-pdf.js → genera PDF desde facilidades.html
        ↓
Make.com sube PDF a Google Drive y obtiene enlace público
        ↓
Make.com responde al bot con { pdf_url: "..." }
        ↓
Bot envía el PDF por WhatsApp al usuario
        ↓
Datos borrados de memoria a los 5 minutos (RGPD)
```

---

## Comandos disponibles en WhatsApp

| Comando | Acción |
|---------|--------|
| `HOLA` | Inicia el proceso |
| `SI` | Confirma los datos y genera el contrato |
| `NO` | Vuelve a ingresar los datos desde el inicio |
| `CANCELAR` | Reinicia todo desde cero |
| `NUEVO` | Genera otro contrato luego de completar uno |
| `AGENTE` | Transfiere a asesor humano |

---

## Datos del contrato (hardcoded — cambiar en agente-contratos.js)

Los siguientes datos de WISE UP son fijos en el código. Si cambian, edítalos en el objeto `WISE_UP` dentro de `agente-contratos.js`:

| Campo | Valor actual |
|-------|-------------|
| Razón social | PRIMERA WISE UP LATAM S.A.C. |
| RUC | 20614854261 |
| Domicilio | Av. José Larco 101, Miraflores, Lima |
| Representante | José Santos Alava Baneo |
| DNI representante | 46182778 |
| Poder inscrito | Asiento A00001, Partida 11076428, Of. Registral Yurimaguas |
| Banco | BCP — Cta. 585-7306904-0-99 |
| CCI | 002-585-007306904-0-9983 |
| Valor del Kit | S/ 2,684.00 |
| Cuota inicial | 20% fijo |

---

## Despliegue en producción (Railway — recomendado)

1. Crea cuenta en https://railway.app
2. Nuevo proyecto → Deploy from GitHub (o sube los archivos)
3. En Variables de entorno, agrega todos los valores de tu `.env`
4. Railway asigna una URL pública automáticamente → úsala en Meta y Make.com
5. Para el servidor PDF: agrega un segundo servicio en el mismo proyecto con `npm run pdf`

---

## Archivos que NO debes subir a git

```
.env
node_modules/
```

Crea un archivo `.gitignore` con esas dos líneas si vas a usar GitHub.
