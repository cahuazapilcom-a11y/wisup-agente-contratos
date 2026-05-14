// ============================================================
// GESTOR DE CONTRATOS AI — WISE UP LATAM
// Contrato de Facilidades de Pago para Kit de Material Didáctico
// Stack: Node.js + WhatsApp Cloud API + Make.com webhooks
// ============================================================

require("dotenv").config();

const express    = require("express");
const axios      = require("axios");
const puppeteer  = require("puppeteer-core");
const chromium   = require("@sparticuz/chromium");
const fs         = require("fs");
const path       = require("path");

const app = express();
app.use(express.json());

// ─── GENERADOR DE PDF (integrado) ────────────────────────────
async function generarPDF(tipo, datos) {
  const rutaPlantilla = path.join(__dirname, "plantillas", `${tipo}.html`);
  if (!fs.existsSync(rutaPlantilla)) throw new Error(`Plantilla no encontrada: ${tipo}`);

  let html = fs.readFileSync(rutaPlantilla, "utf-8");
  datos.fecha_generacion = new Date().toLocaleDateString("es-PE", {
    day: "2-digit", month: "long", year: "numeric",
  });
  Object.entries(datos).forEach(([key, valor]) => {
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), valor || "—");
  });

  const browser = await puppeteer.launch({
    args: chromium.args,
    defaultViewport: chromium.defaultViewport,
    executablePath: await chromium.executablePath(),
    headless: chromium.headless,
  });
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  const pdfBuffer = await page.pdf({
    format: "A4",
    margin: { top: "20mm", bottom: "20mm", left: "20mm", right: "20mm" },
    printBackground: true,
  });
  await browser.close();
  return pdfBuffer;
}

app.post("/generar-pdf", async (req, res) => {
  const { tipo, datos } = req.body;
  if (!tipo || !datos) return res.status(400).json({ error: "Faltan tipo y datos" });
  try {
    const pdfBuffer = await generarPDF(tipo, datos);
    res.json({
      success: true,
      pdf_base64: pdfBuffer.toString("base64"),
      nombre_archivo: `Contrato_${tipo}_${Date.now()}.pdf`,
    });
  } catch (err) {
    console.error("Error PDF:", err.message);
    res.status(500).json({ error: err.message });
  }
});

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
    `¿Son correctos estos datos?\n` +
    `✅ Escribe *SI* para generar el contrato\n` +
    `✏️ Escribe *NO* para corregir\n` +
    `🔁 Escribe *CANCELAR* para empezar de nuevo`
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

// ─── LLAMAR A MAKE.COM ────────────────────────────────────────
async function llamarMake(payload) {
  const res = await axios.post(CONFIG.MAKE_WEBHOOK, payload);
  return res.data;
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
async function agente(tel, texto) {
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
    await enviarTexto(tel, menuPrincipal());
    s.estado = "recopilando";
    return;
  }

  // ── ESTADO: RECOPILANDO DATOS ─────────────────────────────
  if (s.estado === "recopilando") {
    const campos = CAMPOS_FACILIDADES;
    const faltante = campos.find(c => !s.datos[c.key]);

    if (!faltante) {
      s.estado = "confirmacion";
      await enviarTexto(tel, resumenContrato(s.datos));
      return;
    }

    // Guardar el dato recibido
    let valor = normalizar(faltante.key, texto);

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
      await enviarTexto(tel, resumenContrato(s.datos));
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

        const payload = {
          tipo:     "facilidades",
          telefono: tel,
          timestamp: new Date().toISOString(),
          datos: {
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
          },
        };

        const resultado = await llamarMake(payload);

        if (resultado.pdf_url) {
          await enviarPDF(tel, resultado.pdf_url, `Contrato_Facilidades_${s.datos.dni_estudiante}.pdf`);
          let msg = "✅ *¡Contrato generado exitosamente!*\n\n";
          if (resultado.firma_url)
            msg += `🖊️ *Enlace de firma electrónica:*\n${resultado.firma_url}\n\n`;
          msg += "¿Necesitas algo más?\n• *NUEVO* — generar otro contrato\n• *AGENTE* — hablar con un asesor";
          await enviarTexto(tel, msg);
          s.estado = "completado";
          limpiarSesion(tel);
        }
      } catch (err) {
        console.error("Error Make.com:", err.message);
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
function menuPrincipal() {
  return (
    "¡Hola! 👋 Soy el asistente de *WISE UP* 📚\n\n" +
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

    if (msg.type !== "text") {
      await enviarTexto(tel, "Solo proceso texto por ahora 😊 Escribe *HOLA* para empezar.");
      return;
    }

    await agente(tel, msg.text.body);

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
