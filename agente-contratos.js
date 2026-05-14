// ============================================================
// GESTOR DE CONTRATOS AI — WISE UP LATAM
// Contrato de Facilidades de Pago para Kit de Material Didáctico
// Stack: Node.js + WhatsApp Cloud API + Make.com webhooks
// ============================================================

require("dotenv").config();

const express = require("express");
const axios   = require("axios");
const fs      = require("fs");
const path    = require("path");

const app = express();
app.use(express.json());

// ─── RENDERIZAR HTML (sin Puppeteer — el PDF lo genera Make.com) ─
function renderizarHTML(tipo, datos) {
  const rutaPlantilla = path.join(__dirname, "plantillas", `${tipo}.html`);
  if (!fs.existsSync(rutaPlantilla)) throw new Error(`Plantilla no encontrada: ${tipo}`);

  let html = fs.readFileSync(rutaPlantilla, "utf-8");
  datos.fecha_generacion = new Date().toLocaleDateString("es-PE", {
    day: "2-digit", month: "long", year: "numeric",
  });
  Object.entries(datos).forEach(([key, valor]) => {
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), valor || "—");
  });
  return html;
}

// ─── CONFIGURACION ───────────────────────────────────────────
const CONFIG = {
  WA_TOKEN:     process.env.WA_TOKEN,
  WA_PHONE_ID:  process.env.WA_PHONE_ID,
  VERIFY_TOKEN: process.env.VERIFY_TOKEN,
  MAKE_WEBHOOK: process.env.MAKE_WEBHOOK,
  DOCUSIGN_URL: process.env.DOCUSIGN_URL,
};

// ─── DATOS FIJOS DE WISE UP (no se piden al usuario) ─────────
const WISE_UP = {
  razon_social:      "PRIMERA WISE UP LATAM S.A.C.",
  ruc:               "20614854261",
  domicilio:         "Av. José Larco 101, Miraflores, Lima",
  representante:     "José Santos Alava Baneo",
  dni_rep:           "46182778",
  asiento:           "A00001",
  partida:           "11076428",
  oficina_registral: "Yurimaguas",
  banco:             "Banco de Crédito del Perú – BCP",
  cuenta_bcp:        "585-7306904-0-99",
  cci:               "002-585-007306904-0-9983",
  monto_kit:         2684.00,
  porcentaje_ini:    0.20,
};

// ─── MEMORIA DE SESIONES (RGPD: se borra al finalizar) ───────
const sessions = new Map();

// ─── ALMACÉN TEMPORAL DE PDFs ────────────────────────────────
const pdfStore = new Map(); // id → { buffer, filename, expiry }

// ─── CAMPOS DEL CONTRATO DE FACILIDADES ──────────────────────
const CAMPOS_FACILIDADES = [
  { key: "nombre_estudiante",   label: "Nombre completo del estudiante (apellidos y nombres)" },
  { key: "dni_estudiante",      label: "DNI del estudiante" },
  { key: "domicilio_estudiante",label: "Domicilio del estudiante" },
  { key: "telefono_estudiante", label: "Teléfono móvil del estudiante" },
  { key: "email_estudiante",    label: "Correo electrónico del estudiante" },
  { key: "numero_cuotas",       label: "Número de cuotas (6, 12 o 18)" },
  { key: "fecha_firma",         label: "Fecha de firma del contrato (DD/MM/AAAA)" },
];

// ─── VALIDAR Y NORMALIZAR ────────────────────────────────────
function normalizar(key, valor) {
  valor = valor.trim();
  if (key === "dni_estudiante")
    return valor.replace(/[\.\-\s]/g, "");
  if (key === "numero_cuotas")
    return valor.replace(/[^\d]/g, "");
  if (key === "fecha_firma")
    return valor.replace(/[\-\.]/g, "/");
  return valor;
}

function validarCuotas(valor) {
  const n = parseInt(valor);
  return [6, 12, 18].includes(n);
}

function validarDNI(valor) {
  return /^\d{8}$/.test(valor);
}

// ─── CALCULOS FINANCIEROS ────────────────────────────────────
function calcularFinanzas(numero_cuotas) {
  const cuota_inicial_monto = +(WISE_UP.monto_kit * WISE_UP.porcentaje_ini).toFixed(2);
  const monto_financiado    = +(WISE_UP.monto_kit - cuota_inicial_monto).toFixed(2);
  const cuota_mensual       = +(monto_financiado / numero_cuotas).toFixed(2);
  return { cuota_inicial_monto, monto_financiado, cuota_mensual };
}

// ─── GENERAR CRONOGRAMA DE PAGOS ─────────────────────────────
function generarCronograma(fecha_firma, numero_cuotas, monto_financiado, cuota_mensual) {
  const partes = fecha_firma.split("/");
  const base = new Date(
    parseInt(partes[2]),
    parseInt(partes[1]) - 1,
    parseInt(partes[0])
  );

  let saldo = monto_financiado;
  const filas = [];

  // Fila 0: saldo inicial
  filas.push(`<tr><td>0</td><td>${formatearFecha(base)}</td><td>—</td><td>S/. ${saldo.toFixed(2)}</td></tr>`);

  for (let i = 1; i <= numero_cuotas; i++) {
    const fecha = new Date(base);
    fecha.setMonth(base.getMonth() + i);
    saldo = +(saldo - cuota_mensual).toFixed(2);
    if (i === numero_cuotas) saldo = 0.00; // evitar residuo por redondeo
    filas.push(
      `<tr><td>${i}</td><td>${formatearFecha(fecha)}</td><td>S/. ${cuota_mensual.toFixed(2)}</td><td>S/. ${saldo.toFixed(2)}</td></tr>`
    );
  }

  return filas.join("\n");
}

function formatearFecha(date) {
  return `${String(date.getDate()).padStart(2,"0")}/${String(date.getMonth()+1).padStart(2,"0")}/${date.getFullYear()}`;
}

function numeroALetras(n) {
  // Convierte número a texto (simplificado para montos comunes)
  const entero = Math.floor(n);
  const centavos = Math.round((n - entero) * 100);
  return `${entero.toLocaleString("es-PE")} con ${String(centavos).padStart(2,"0")}/100 Soles`;
}

// ─── RESUMEN PARA CONFIRMACION ────────────────────────────────
function resumenContrato(datos) {
  const n = parseInt(datos.numero_cuotas);
  const fin = calcularFinanzas(n);
  return (
    `📋 *Resumen — Contrato de Facilidades de Pago*\n\n` +
    `👤 *Estudiante:* ${datos.nombre_estudiante}\n` +
    `🪪 *DNI:* ${datos.dni_estudiante}\n` +
    `🏠 *Domicilio:* ${datos.domicilio_estudiante}\n` +
    `📱 *Teléfono:* ${datos.telefono_estudiante}\n` +
    `📧 *Email:* ${datos.email_estudiante}\n\n` +
    `💰 *Valor del Kit:* S/. ${WISE_UP.monto_kit.toFixed(2)}\n` +
    `📥 *Cuota inicial (20%):* S/. ${fin.cuota_inicial_monto.toFixed(2)}\n` +
    `💳 *Monto a financiar:* S/. ${fin.monto_financiado.toFixed(2)}\n` +
    `📅 *Plazo:* ${datos.numero_cuotas} cuotas de S/. ${fin.cuota_mensual.toFixed(2)}\n` +
    `📆 *Fecha de firma:* ${datos.fecha_firma}\n\n` +
    `¿Son correctos estos datos?`
  );
}

// ─── ENVIAR MENSAJE TEXTO ────────────────────────────────────
async function enviarTexto(tel, texto) {
  return axios.post(
    `https://graph.facebook.com/v19.0/${CONFIG.WA_PHONE_ID}/messages`,
    { messaging_product: "whatsapp", to: tel, type: "text", text: { body: texto } },
    { headers: { Authorization: `Bearer ${CONFIG.WA_TOKEN}` } }
  );
}

// ─── ENVIAR BOTONES INTERACTIVOS ─────────────────────────────
async function enviarBotones(tel, texto, botones) {
  return axios.post(
    `https://graph.facebook.com/v19.0/${CONFIG.WA_PHONE_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: tel,
      type: "interactive",
      interactive: {
        type: "button",
        body: { text: texto },
        action: {
          buttons: botones.map(b => ({
            type: "reply",
            reply: { id: b.id, title: b.title }
          }))
        }
      }
    },
    { headers: { Authorization: `Bearer ${CONFIG.WA_TOKEN}` } }
  );
}

// ─── ENVIAR PDF ───────────────────────────────────────────────
async function enviarPDF(tel, url, nombre) {
  return axios.post(
    `https://graph.facebook.com/v19.0/${CONFIG.WA_PHONE_ID}/messages`,
    {
      messaging_product: "whatsapp",
      to: tel,
      type: "document",
      document: { link: url, filename: nombre, caption: "📄 Tu contrato está listo" },
    },
    { headers: { Authorization: `Bearer ${CONFIG.WA_TOKEN}` } }
  );
}

// ─── GENERAR PDF VIA GOTENBERG Y SERVIR DESDE ESTE SERVIDOR ──
async function generarYSubirPDF(html_contrato, dni) {
  const FormData = require("form-data");
  const { randomUUID } = require("crypto");

  // 1. Generar PDF con Gotenberg
  console.log("[PDF] Llamando a Gotenberg...");
  const form1 = new FormData();
  form1.append("files", Buffer.from(html_contrato, "utf-8"), {
    filename: "index.html",
    contentType: "text/html; charset=utf-8",
  });

  let pdfRes;
  try {
    pdfRes = await axios.post(
      "https://demo.gotenberg.dev/forms/chromium/convert/html",
      form1,
      { headers: form1.getHeaders(), responseType: "arraybuffer", timeout: 60000 }
    );
    console.log("[PDF] Gotenberg OK, tamaño:", pdfRes.data.byteLength);
  } catch (e) {
    console.error("[PDF] Gotenberg error:", e.response?.status, e.response?.data?.toString(), e.message);
    throw e;
  }

  // 2. Guardar PDF en memoria y generar URL propia
  const id = randomUUID();
  const filename = `Contrato_${dni}.pdf`;
  const expiry = Date.now() + 15 * 60 * 1000; // 15 minutos
  pdfStore.set(id, { buffer: Buffer.from(pdfRes.data), filename, expiry });

  // Limpiar entrada cuando expire
  setTimeout(() => pdfStore.delete(id), 15 * 60 * 1000);

  const baseUrl = process.env.BASE_URL || `https://agente-contratos.onrender.com`;
  const url = `${baseUrl}/pdf/${id}`;
  console.log("[PDF] URL propia generada:", url);
  return { url, buffer: pdfStore.get(id).buffer };
}

// ─── ENVIAR EMAIL CON PDF VIA SENDGRID ───────────────────────
async function enviarEmailConPDF(destinatario, nombre, pdfBuffer, dni) {
  const SENDGRID_API_KEY = process.env.SENDGRID_API_KEY;
  if (!SENDGRID_API_KEY) return;

  const pdfBase64 = pdfBuffer.toString("base64");
  const payload = {
    personalizations: [{ to: [{ email: destinatario, name: nombre }] }],
    from: { email: "cahuazapilcom@gmail.com", name: "WISE UP LATAM" },
    subject: "Tu Contrato de Facilidades de Pago — WISE UP",
    content: [{
      type: "text/html",
      value: `<p>Estimado/a <strong>${nombre.split(" ").slice(-2).join(" ")}</strong>,</p>
              <p>Adjunto encontrarás tu <strong>Contrato de Facilidades de Pago</strong> del Kit de Material Didáctico WISE UP.</p>
              <p>Ante cualquier consulta comunícate con tu asesor.</p>
              <br><p><strong>WISE UP LATAM S.A.C.</strong></p>`
    }],
    attachments: [{
      content: pdfBase64,
      type: "application/pdf",
      filename: `Contrato_Facilidades_${dni}.pdf`,
      disposition: "attachment"
    }]
  };

  try {
    await axios.post("https://api.sendgrid.com/v3/mail/send", payload, {
      headers: { Authorization: `Bearer ${SENDGRID_API_KEY}`, "Content-Type": "application/json" }
    });
    console.log("[EMAIL] Enviado a:", destinatario);
  } catch (e) {
    console.error("[EMAIL] Error:", e.response?.data || e.message);
  }
}

// ─── LLAMAR A MAKE.COM (notificación sin esperar PDF) ────────
async function llamarMake(payload) {
  const res = await axios.post(CONFIG.MAKE_WEBHOOK, payload);
  return res.data;
}

// ─── DOCUSIGN: JWT AUTH + ENVIAR SOBRE PARA FIRMA ────────────
async function enviarADocuSign(pdfBuffer, datos) {
  const crypto = require("crypto");

  const DS_INTEGRATION_KEY = process.env.DOCUSIGN_INTEGRATION_KEY;
  const DS_USER_ID         = process.env.DOCUSIGN_USER_ID;
  const DS_ACCOUNT_ID      = process.env.DOCUSIGN_ACCOUNT_ID;
  const DS_PRIVATE_KEY     = process.env.DOCUSIGN_PRIVATE_KEY?.replace(/\\n/g, "\n");
  const DS_BASE_URI        = "https://demo.docusign.net";

  if (!DS_INTEGRATION_KEY || !DS_USER_ID || !DS_ACCOUNT_ID || !DS_PRIVATE_KEY) {
    console.log("[DOCUSIGN] Variables no configuradas, omitiendo firma digital.");
    return null;
  }

  // 1. Crear JWT
  const now = Math.floor(Date.now() / 1000);
  const header  = Buffer.from(JSON.stringify({ alg: "RS256", typ: "JWT" })).toString("base64url");
  const payload = Buffer.from(JSON.stringify({
    iss: DS_INTEGRATION_KEY,
    sub: DS_USER_ID,
    aud: "account-d.docusign.com",
    iat: now,
    exp: now + 3600,
    scope: "signature impersonation",
  })).toString("base64url");

  const sign = crypto.createSign("RSA-SHA256");
  sign.update(`${header}.${payload}`);
  const signature = sign.sign(DS_PRIVATE_KEY, "base64url");
  const jwt = `${header}.${payload}.${signature}`;

  // 2. Obtener access token
  let accessToken;
  try {
    const tokenRes = await axios.post(
      "https://account-d.docusign.com/oauth/token",
      new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
      { headers: { "Content-Type": "application/x-www-form-urlencoded" } }
    );
    accessToken = tokenRes.data.access_token;
    console.log("[DOCUSIGN] Token obtenido OK");
  } catch (e) {
    console.error("[DOCUSIGN] Error obteniendo token:", e.response?.data || e.message);
    return null;
  }

  // 3. Crear envelope con el PDF
  const pdfBase64 = pdfBuffer.toString("base64");
  const envelope = {
    emailSubject: "Firma tu Contrato de Facilidades de Pago — WISE UP",
    emailBlurb: `Estimado/a ${datos.nombre_estudiante}, por favor firma tu contrato haciendo clic en el enlace.`,
    documents: [{
      documentBase64: pdfBase64,
      name: `Contrato_Facilidades_${datos.dni_estudiante}.pdf`,
      fileExtension: "pdf",
      documentId: "1",
    }],
    recipients: {
      signers: [{
        email: datos.email_estudiante,
        name: datos.nombre_estudiante,
        recipientId: "1",
        routingOrder: "1",
        tabs: {
          signHereTabs: [{
            anchorString: "Firma del Estudiante",
            anchorUnits: "pixels",
            anchorXOffset: "0",
            anchorYOffset: "20",
          }],
          dateSignedTabs: [{
            anchorString: "Fecha de Firma",
            anchorUnits: "pixels",
            anchorXOffset: "0",
            anchorYOffset: "20",
          }],
        },
      }],
    },
    status: "sent",
  };

  try {
    const envRes = await axios.post(
      `${DS_BASE_URI}/restapi/v2.1/accounts/${DS_ACCOUNT_ID}/envelopes`,
      envelope,
      { headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" } }
    );
    console.log("[DOCUSIGN] Envelope enviado, ID:", envRes.data.envelopeId);
    return envRes.data.envelopeId;
  } catch (e) {
    console.error("[DOCUSIGN] Error creando envelope:", e.response?.data || e.message);
    return null;
  }
}

// ─── LIMPIAR SESION (RGPD — 5 min) ──────────────────────────
function limpiarSesion(tel) {
  setTimeout(() => {
    if (sessions.get(tel)?.estado === "completado") {
      sessions.delete(tel);
      console.log(`[RGPD] Datos eliminados: ${tel}`);
    }
  }, 5 * 60 * 1000);
}

// ─── MOTOR DEL AGENTE ─────────────────────────────────────────
async function agente(tel, texto, nombre = "") {
  const input = texto.trim().toLowerCase();

  if (!sessions.has(tel)) {
    sessions.set(tel, { estado: "inicio", datos: {}, campoActual: 0 });
  }
  const s = sessions.get(tel);

  // ── COMANDOS GLOBALES ─────────────────────────────────────
  if (["cancelar", "cancel", "reiniciar", "salir"].includes(input)) {
    sessions.set(tel, { estado: "inicio", datos: {}, campoActual: 0 });
    await enviarTexto(tel, menuPrincipal());
    return;
  }

  if (["agente", "humano", "asesor", "persona"].includes(input)) {
    await enviarTexto(tel, "👤 Transfiriendo a un asesor WISE UP...\nUn representante te contactará en breve.\n⏰ Horario: Lun-Vie 9am-6pm");
    return;
  }

  // ── ESTADO: INICIO / ESPERANDO CONFIRMACIÓN PARA EMPEZAR ──
  if (s.estado === "inicio") {
    await enviarTexto(tel, menuPrincipal(nombre));
    s.estado = "recopilando";
    return;
  }

  // ── ESTADO: RECOPILANDO DATOS ─────────────────────────────
  if (s.estado === "recopilando") {
    const campos = CAMPOS_FACILIDADES;
    const faltante = campos.find(c => !s.datos[c.key]);

    if (!faltante) {
      s.estado = "confirmacion";
      await enviarBotones(tel, resumenContrato(s.datos), [
        { id: "SI", title: "Confirmar" },
        { id: "NO", title: "Corregir" },
      ]).catch(() => enviarTexto(tel, resumenContrato(s.datos)));
      return;
    }

    // Guardar el dato recibido
    let valor = normalizar(faltante.key, texto);

    // Validar DNI
    if (faltante.key === "dni_estudiante" && !validarDNI(valor)) {
      await enviarTexto(tel, "❌ El DNI debe tener exactamente *8 dígitos numéricos*. Ingresa nuevamente:");
      return;
    }

    // Validar numero de cuotas
    if (faltante.key === "numero_cuotas" && !validarCuotas(valor)) {
      await enviarTexto(tel, "❌ Solo se aceptan *6*, *12* o *18* cuotas. ¿Cuántas cuotas prefiere el estudiante?");
      return;
    }

    s.datos[faltante.key] = valor;

    // Buscar siguiente campo faltante
    const siguiente = campos.find(c => !s.datos[c.key]);
    if (siguiente) {
      const prog = `${Object.keys(s.datos).length}/${campos.length}`;
      await enviarTexto(tel, `✅ Anotado. [${prog}]\n\n¿Cuál es el/la *${siguiente.label}*?`);
    } else {
      s.estado = "confirmacion";
      await enviarBotones(tel, resumenContrato(s.datos), [
        { id: "SI", title: "Confirmar" },
        { id: "NO", title: "Corregir" },
      ]).catch(() => enviarTexto(tel, resumenContrato(s.datos)));
    }
    return;
  }

  // ── ESTADO: CONFIRMACION ──────────────────────────────────
  if (s.estado === "confirmacion") {
    if (["si", "sí", "yes", "ok", "confirmar", "correcto"].includes(input)) {
      s.estado = "generando";
      await enviarTexto(tel, "⏳ Generando el contrato de facilidades de pago... un momento.");

      try {
        const n   = parseInt(s.datos.numero_cuotas);
        const fin = calcularFinanzas(n);
        const cronograma_html = generarCronograma(
          s.datos.fecha_firma, n, fin.monto_financiado, fin.cuota_mensual
        );

        // Formatear fecha larga para el cuerpo del contrato
        const partesFecha = s.datos.fecha_firma.split("/");
        const MESES_ES = ["enero","febrero","marzo","abril","mayo","junio",
                          "julio","agosto","septiembre","octubre","noviembre","diciembre"];
        const diaNum  = parseInt(partesFecha[0]);
        const mesNum  = parseInt(partesFecha[1]) - 1;
        const anioNum = partesFecha[2];
        const fecha_firma_larga = `${diaNum} días del mes de ${MESES_ES[mesNum]} de ${anioNum}`;
        const fecha_firma_corta = `${partesFecha[1]}/${diaNum}/${String(anioNum).slice(-2)}`;

        const datosContrato = {
            // Datos del estudiante
            ...s.datos,
            // Fechas formateadas
            fecha_firma_larga,
            fecha_firma_corta,
            // Datos calculados
            cuota_inicial_monto:  fin.cuota_inicial_monto.toFixed(2),
            monto_financiado:     fin.monto_financiado.toFixed(2),
            cuota_mensual:        fin.cuota_mensual.toFixed(2),
            monto_financiado_letras: numeroALetras(fin.monto_financiado),
            monto_kit_letras:        numeroALetras(WISE_UP.monto_kit),
            cuota_inicial_letras:    numeroALetras(fin.cuota_inicial_monto),
            cuota_mensual_letras:    numeroALetras(fin.cuota_mensual),
            cronograma_html,
            // Datos fijos WISE UP
            wise_razon_social:      WISE_UP.razon_social,
            wise_ruc:               WISE_UP.ruc,
            wise_domicilio:         WISE_UP.domicilio,
            wise_representante:     WISE_UP.representante,
            wise_dni_rep:           WISE_UP.dni_rep,
            wise_asiento:           WISE_UP.asiento,
            wise_partida:           WISE_UP.partida,
            wise_oficina_registral: WISE_UP.oficina_registral,
            wise_banco:             WISE_UP.banco,
            wise_cuenta_bcp:        WISE_UP.cuenta_bcp,
            wise_cci:               WISE_UP.cci,
            wise_monto_kit:         WISE_UP.monto_kit.toFixed(2),
        };

        // Generar HTML y subir PDF directamente sin Make.com
        const html_contrato = renderizarHTML("facilidades", { ...datosContrato });
        const { url: pdf_url, buffer: pdfBuffer } = await generarYSubirPDF(html_contrato, s.datos.dni_estudiante);

        await enviarPDF(tel, pdf_url, `Contrato_Facilidades_${s.datos.dni_estudiante}.pdf`);
        enviarEmailConPDF(s.datos.email_estudiante, s.datos.nombre_estudiante, pdfBuffer, s.datos.dni_estudiante)
          .catch(e => console.error("[EMAIL] fallo silencioso:", e.message));

        // Enviar a DocuSign para firma digital
        enviarADocuSign(pdfBuffer, s.datos).then(envelopeId => {
          if (envelopeId) {
            enviarTexto(tel,
              `✍️ *Firma digital enviada*\n\nHemos enviado un correo a *${s.datos.email_estudiante}* con el enlace para firmar el contrato digitalmente.\n\n_Revisa tu bandeja de entrada (o spam)._`
            ).catch(() => {});
          }
        }).catch(e => console.error("[DOCUSIGN] fallo silencioso:", e.message));

        await enviarTexto(tel, "✅ *¡Contrato generado exitosamente!*\n\n¿Necesitas algo más?\n• *NUEVO* — generar otro contrato\n• *AGENTE* — hablar con un asesor");
        s.estado = "completado";
        limpiarSesion(tel);

        // Registro en Google Sheets via Make.com
        const SHEETS_WEBHOOK = "https://hook.us2.make.com/upmgkie9tkar8e6fp4rug5etojweoa76";
        axios.post(SHEETS_WEBHOOK, {
          fecha:         new Date().toLocaleDateString("es-PE"),
          nombre:        s.datos.nombre_estudiante,
          dni:           s.datos.dni_estudiante,
          telefono:      s.datos.telefono_estudiante,
          email:         s.datos.email_estudiante,
          domicilio:     s.datos.domicilio_estudiante,
          cuotas:        s.datos.numero_cuotas,
          cuota_mensual: fin.cuota_mensual.toFixed(2),
          monto_total:   WISE_UP.monto_kit.toFixed(2),
        }).catch(e => console.error("[SHEETS] Error:", e.message));

        // Notificación al asesor
        const ASESOR_TEL = "51918156548";
        const msgAsesor =
          `🔔 *Nuevo contrato generado*\n\n` +
          `👤 *Estudiante:* ${s.datos.nombre_estudiante}\n` +
          `🪪 *DNI:* ${s.datos.dni_estudiante}\n` +
          `📱 *Tel:* ${s.datos.telefono_estudiante}\n` +
          `📧 *Email:* ${s.datos.email_estudiante}\n` +
          `🏠 *Domicilio:* ${s.datos.domicilio_estudiante}\n\n` +
          `💰 *Kit:* S/. ${WISE_UP.monto_kit.toFixed(2)}\n` +
          `📥 *Cuota inicial:* S/. ${fin.cuota_inicial_monto.toFixed(2)}\n` +
          `📅 *Cuotas:* ${s.datos.numero_cuotas} x S/. ${fin.cuota_mensual.toFixed(2)}\n` +
          `📆 *Fecha firma:* ${s.datos.fecha_firma}`;
        enviarTexto(ASESOR_TEL, msgAsesor).catch(e => console.error("[ASESOR] Error notificación:", e.message));
      } catch (err) {
        console.error("Error generando contrato:", err.message);
        await enviarTexto(tel, "❌ Error al generar el contrato. Escribe *AGENTE* para soporte humano.");
      }
      return;
    }

    if (["no", "corregir", "cambiar", "editar"].includes(input)) {
      s.estado = "corrigiendo";
      const lista = CAMPOS_FACILIDADES.map((c, i) => `${i + 1}. ${c.label}`).join("\n");
      await enviarTexto(tel, `¿Qué dato deseas corregir? Escribe el número:\n\n${lista}`);
      return;
    }

    await enviarTexto(tel, "Responde *SI* para confirmar o *NO* para corregir.");
    return;
  }

  // ── ESTADO: CORRIGIENDO ───────────────────────────────────
  if (s.estado === "corrigiendo") {
    const num = parseInt(input);
    if (num >= 1 && num <= CAMPOS_FACILIDADES.length) {
      s.campoEditando = CAMPOS_FACILIDADES[num - 1].key;
      s.estado = "editando";
      await enviarTexto(tel, `✏️ Nuevo valor para *${CAMPOS_FACILIDADES[num - 1].label}*:`);
    } else {
      await enviarTexto(tel, `Elige un número del 1 al ${CAMPOS_FACILIDADES.length}`);
    }
    return;
  }

  // ── ESTADO: EDITANDO ──────────────────────────────────────
  if (s.estado === "editando") {
    let valor = normalizar(s.campoEditando, texto);
    if (s.campoEditando === "dni_estudiante" && !validarDNI(valor)) {
      await enviarTexto(tel, "❌ El DNI debe tener exactamente *8 dígitos numéricos*. Ingresa nuevamente:");
      return;
    }
    if (s.campoEditando === "numero_cuotas" && !validarCuotas(valor)) {
      await enviarTexto(tel, "❌ Solo se aceptan *6*, *12* o *18* cuotas. Ingresa nuevamente:");
      return;
    }
    s.datos[s.campoEditando] = valor;
    s.estado = "confirmacion";
    await enviarTexto(tel, "✅ Dato actualizado.\n\n" + resumenContrato(s.datos));
    return;
  }

  // ── ESTADO: COMPLETADO ────────────────────────────────────
  if (s.estado === "completado") {
    if (["nuevo", "otro", "new"].includes(input)) {
      sessions.set(tel, { estado: "recopilando", datos: {}, campoActual: 0 });
      await enviarTexto(tel, `¡Perfecto! Empecemos con el nuevo contrato.\n\n¿Cuál es el *${CAMPOS_FACILIDADES[0].label}*?`);
    } else {
      await enviarTexto(tel, "¿Necesitas algo más?\n• *NUEVO* — otro contrato\n• *AGENTE* — asesor WISE UP");
    }
    return;
  }

  // ── FALLBACK ──────────────────────────────────────────────
  await enviarTexto(tel, "No entendí. Escribe *HOLA* para empezar o *AGENTE* para soporte.");
}

// ─── MENU PRINCIPAL ───────────────────────────────────────────
function menuPrincipal(nombre = "") {
  const saludo = nombre ? `¡Hola, *${nombre}*! 👋` : "¡Hola! 👋";
  return (
    `${saludo} Soy el asistente de *WISE UP* 📚\n\n` +
    "Voy a ayudarte a generar el *Contrato de Facilidades de Pago* para el Kit de Material Didáctico.\n\n" +
    "Necesitaré los siguientes datos del estudiante:\n\n" +
    "1. Nombre completo\n" +
    "2. DNI\n" +
    "3. Domicilio\n" +
    "4. Teléfono móvil\n" +
    "5. Correo electrónico\n" +
    "6. Número de cuotas (6, 12 o 18)\n" +
    "7. Fecha de firma\n\n" +
    `¿Cuál es el *nombre completo del estudiante* (apellidos y nombres)?`
  );
}

// ─── ENDPOINT PARA SERVIR PDFs TEMPORALES ────────────────────
app.get("/pdf/:id", (req, res) => {
  const entry = pdfStore.get(req.params.id);
  if (!entry || Date.now() > entry.expiry) {
    pdfStore.delete(req.params.id);
    return res.status(404).send("PDF no encontrado o expirado");
  }
  res.setHeader("Content-Type", "application/pdf");
  res.setHeader("Content-Disposition", `inline; filename="${entry.filename}"`);
  res.send(entry.buffer);
});

// ─── WEBHOOK DE WHATSAPP (META) ───────────────────────────────
app.get("/webhook", (req, res) => {
  if (req.query["hub.verify_token"] === CONFIG.VERIFY_TOKEN) {
    res.send(req.query["hub.challenge"]);
  } else {
    res.sendStatus(403);
  }
});

app.post("/webhook", async (req, res) => {
  res.sendStatus(200);

  try {
    const value = req.body?.entry?.[0]?.changes?.[0]?.value;
    if (!value?.messages) return;

    const msg = value.messages[0];
    const tel = msg.from;
    const nombre = value.contacts?.[0]?.profile?.name || "";

    let textoMensaje;
    if (msg.type === "text") {
      textoMensaje = msg.text.body;
    } else if (msg.type === "interactive") {
      textoMensaje = msg.interactive?.button_reply?.id || msg.interactive?.list_reply?.id || "";
    } else {
      await enviarTexto(tel, "Solo proceso texto por ahora 😊 Escribe *HOLA* para empezar.");
      return;
    }

    await agente(tel, textoMensaje, nombre);

  } catch (err) {
    console.error("Webhook error:", err.message);
  }
});

// ─── INICIAR SERVIDOR ────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`🤖 Agente WISE UP activo en puerto ${PORT}`);
  console.log(`📡 Webhook: http://localhost:${PORT}/webhook`);
});
