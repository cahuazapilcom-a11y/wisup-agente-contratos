// ============================================================
// GENERADOR DE PDF — Lee plantilla HTML, inyecta datos, exporta PDF
// Usado por Make.com o llamado directamente desde el bot
// ============================================================

require("dotenv").config();

const puppeteer = require("puppeteer");
const fs        = require("fs");
const path      = require("path");

/**
 * Genera un PDF a partir de una plantilla HTML y datos del contrato.
 * @param {string} tipo   - Nombre del contrato (servicios, alquiler, etc.)
 * @param {object} datos  - Objeto con los campos del contrato
 * @returns {Buffer}      - Buffer del PDF generado
 */
async function generarPDF(tipo, datos) {
  const rutaPlantilla = path.join(__dirname, "plantillas", `${tipo}.html`);

  if (!fs.existsSync(rutaPlantilla)) {
    throw new Error(`Plantilla no encontrada: ${tipo}`);
  }

  // Leer plantilla HTML
  let html = fs.readFileSync(rutaPlantilla, "utf-8");

  // Inyectar fecha de generacion
  datos.fecha_generacion = new Date().toLocaleDateString("es-PE", {
    day: "2-digit", month: "long", year: "numeric",
  });

  // Reemplazar todos los {{campos}} con los datos reales
  Object.entries(datos).forEach(([key, valor]) => {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    html = html.replace(regex, valor || "—");
  });

  // Lanzar Puppeteer y generar PDF
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
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

// ─── ENDPOINT HTTP para Make.com ──────────────────────────────
// Make.com llama a este servidor con los datos → recibe el PDF en base64
const express = require("express");
const app = express();
app.use(express.json());

app.post("/generar-pdf", async (req, res) => {
  const { tipo, datos } = req.body;

  if (!tipo || !datos) {
    return res.status(400).json({ error: "Faltan tipo y datos" });
  }

  try {
    const pdfBuffer = await generarPDF(tipo, datos);
    const pdfBase64 = pdfBuffer.toString("base64");

    res.json({
      success: true,
      pdf_base64: pdfBase64,
      nombre_archivo: `Contrato_${tipo}_${Date.now()}.pdf`,
    });

  } catch (err) {
    console.error("Error PDF:", err.message);
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PDF_PORT || 3001;
app.listen(PORT, () => console.log(`📄 Servidor PDF activo en puerto ${PORT}`));

module.exports = { generarPDF };
