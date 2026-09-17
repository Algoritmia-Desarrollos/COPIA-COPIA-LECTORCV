// supabase/functions/selectacv/index.ts
// Backend de SelectaCV. Todas las operaciones que necesitan la clave secreta
// o la de OpenAI pasan por acá, así el navegador nunca toca las tablas sin permiso.
//
// Acciones públicas (links para postulantes):
//   aviso-publico  -> datos mínimos del aviso y si acepta postulaciones
//   guardar-cv     -> guarda el CV (Storage + candidato + postulación) y lo analiza
// Acciones de miembros (usuarios en v2_miembros):
//   guardar-cv     -> igual, pero sin límites de aviso y con carpeta opcional
//   calificar      -> analiza una postulación con IA y guarda el puntaje
//   generar-aviso  -> propone descripción y condiciones para un aviso
// Acciones internas (header x-selectacv-admin con la clave secreta):
//   calificar

import { createClient } from "npm:@supabase/supabase-js@2";
import { decodeBase64 } from "jsr:@std/encoding@1/base64";

declare const EdgeRuntime: { waitUntil(promesa: Promise<unknown>): void };

const BUCKET = "selectacv-cvs";
// Dueño de los CVs que llegan por los links públicos (no es un usuario real).
const USUARIO_PUBLICO = "3973abe3-ca7c-4a7c-b51a-f5024731bb6c";
const MAX_BYTES_PUBLICO = 5 * 1024 * 1024;
const MAX_BYTES_MIEMBRO = 10 * 1024 * 1024;
const EXTENSIONES: Record<string, string> = {
  "application/pdf": "pdf",
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};
const MODELO = "gpt-4o-mini";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

class HttpError extends Error {
  constructor(public status: number, mensaje: string) {
    super(mensaje);
  }
}

// Clave secreta: nueva inyectada por la plataforma -> secret manual -> legacy
function getSecretKey(): string {
  const nuevas = Deno.env.get("SUPABASE_SECRET_KEYS");
  if (nuevas) {
    try {
      const parsed = JSON.parse(nuevas);
      if (parsed?.default) return parsed.default;
    } catch (_) { /* formato inesperado, seguimos con los fallbacks */ }
  }
  return Deno.env.get("APP_SECRET_KEY") ?? Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
}

const SECRET_KEY = getSecretKey();
const admin = createClient(Deno.env.get("SUPABASE_URL")!, SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function respuesta(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return respuesta({ error: "Método no permitido" }, 405);

  try {
    const body = await req.json().catch(() => {
      throw new HttpError(400, "Cuerpo de la solicitud inválido.");
    });

    switch (body?.accion) {
      case "aviso-publico":
        return respuesta(await avisoPublico(Number(body.avisoId)));

      case "guardar-cv":
        return respuesta(await guardarCv(body, await usuarioMiembro(req)));

      case "calificar": {
        await exigirMiembroOAdmin(req);
        return respuesta(await calificar(Number(body.postulacionId)));
      }

      case "generar-aviso": {
        if (!(await usuarioMiembro(req))) throw new HttpError(401, "No autorizado.");
        return respuesta(await generarAviso(String(body.titulo ?? "")));
      }

      default:
        throw new HttpError(400, "Acción desconocida.");
    }
  } catch (error) {
    const status = error instanceof HttpError ? error.status : 500;
    if (status === 500) console.error(error);
    return respuesta({ error: error instanceof Error ? error.message : String(error) }, status);
  }
});

// --- AUTORIZACIÓN ---

async function usuarioMiembro(req: Request): Promise<string | null> {
  const token = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "");
  // Las claves publicables no son JWT: sin token de usuario no hay sesión.
  if (!token.startsWith("eyJ")) return null;
  const { data, error } = await admin.auth.getUser(token);
  if (error || !data.user) return null;
  const { data: miembro } = await admin
    .from("v2_miembros")
    .select("user_id")
    .eq("user_id", data.user.id)
    .maybeSingle();
  return miembro ? data.user.id : null;
}

function esAdminInterno(req: Request): boolean {
  const recibido = req.headers.get("x-selectacv-admin") ?? "";
  if (recibido.length !== SECRET_KEY.length) return false;
  let diferencia = 0;
  for (let i = 0; i < recibido.length; i++) diferencia |= recibido.charCodeAt(i) ^ SECRET_KEY.charCodeAt(i);
  return diferencia === 0;
}

async function exigirMiembroOAdmin(req: Request) {
  if (esAdminInterno(req)) return;
  if (!(await usuarioMiembro(req))) throw new HttpError(401, "No autorizado.");
}

// --- AVISOS PÚBLICOS ---

type Aviso = {
  id: number;
  titulo: string;
  valido_hasta: string | null;
  max_cv: number | null;
  postulaciones_count: number;
};

function hoyEnArgentina(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Argentina/Buenos_Aires" }).format(new Date());
}

function motivoCierre(aviso: Aviso): string | null {
  if (aviso.valido_hasta && hoyEnArgentina() > aviso.valido_hasta) {
    const [a, m, d] = aviso.valido_hasta.split("-");
    return `La fecha límite para aplicar (${d}/${m}/${a}) ya pasó.`;
  }
  if (aviso.max_cv && aviso.max_cv > 0 && aviso.postulaciones_count >= aviso.max_cv) {
    return "Se alcanzó el número máximo de candidatos para esta búsqueda.";
  }
  return null;
}

async function buscarAviso(avisoId: number): Promise<Aviso | null> {
  if (!Number.isInteger(avisoId) || avisoId <= 0) return null;
  const { data, error } = await admin
    .from("v2_avisos")
    .select("id, titulo, valido_hasta, max_cv, postulaciones_count")
    .eq("id", avisoId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function avisoPublico(avisoId: number) {
  const aviso = await buscarAviso(avisoId);
  if (!aviso) return { abierto: false, motivo: "El aviso que buscas ya no existe." };
  const motivo = motivoCierre(aviso);
  return { id: aviso.id, titulo: aviso.titulo, abierto: !motivo, motivo };
}

// --- GUARDAR CV ---

function toTitleCase(str: unknown): string | null {
  if (!str || typeof str !== "string") return null;
  const limpio = str.toLowerCase().trim().replace(/\s+/g, " ");
  if (!limpio) return null;
  return limpio.split(" ").map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join(" ");
}

function coincideFirma(bytes: Uint8Array, tipo: string): boolean {
  const empieza = (...firma: number[]) => firma.every((b, i) => bytes[i] === b);
  switch (tipo) {
    case "application/pdf": {
      // Algunos PDFs traen basura antes de %PDF: buscamos en los primeros 1024 bytes.
      const cabecera = new TextDecoder("latin1").decode(bytes.subarray(0, 1024));
      return cabecera.includes("%PDF");
    }
    case "image/jpeg": return empieza(0xff, 0xd8, 0xff);
    case "image/png": return empieza(0x89, 0x50, 0x4e, 0x47);
    case "image/webp":
      return empieza(0x52, 0x49, 0x46, 0x46) && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
    default: return false;
  }
}

type DatosContacto = { nombreCompleto: string | null; email: string | null; telefono: string | null };

async function extraerContacto(texto: string): Promise<DatosContacto> {
  const textoLimpio = texto.replace(/\s+/g, " ").trim().substring(0, 4000);
  if (!textoLimpio) return { nombreCompleto: null, email: null, telefono: null };
  const prompt = `
Actúa como un asistente de extracción de datos altamente preciso. Tu única tarea es analizar el siguiente texto de un CV y extraer el nombre completo, la dirección de email y el número de teléfono.

**Instrucciones Clave:**
1.  **Nombre Completo:** Busca el nombre más prominente, usualmente ubicado al principio del documento.
2.  **Email:** Busca un texto que siga el formato de un correo electrónico (ej: texto@dominio.com). Sé flexible con los espacios que puedan haberse colado (ej: texto @ dominio . com).
3.  **Teléfono:** Busca secuencias de números que parezcan un número de teléfono. Pueden incluir prefijos (+54), paréntesis, guiones o espacios. Prioriza números de móvil si hay varios.

**Texto del CV a Analizar:**
"""
${textoLimpio}
"""

**Formato de Salida Obligatorio:**
Responde únicamente con un objeto JSON válido con las claves "nombreCompleto", "email" y "telefono". Si no puedes encontrar un dato de forma confiable, usa el valor \`null\`. No incluyas ninguna otra explicación o texto fuera del JSON.
`;
  try {
    const r = await openaiJSON(prompt);
    const texto_ = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
    return { nombreCompleto: texto_(r.nombreCompleto), email: texto_(r.email), telefono: texto_(r.telefono) };
  } catch (e) {
    console.error("Extracción de contacto fallida:", e);
    return { nombreCompleto: null, email: null, telefono: null };
  }
}

async function guardarCandidato(fila: Record<string, unknown>, datos: DatosContacto): Promise<number> {
  const nombre = fila.nombre_candidato as string;
  for (let intento = 0; intento < 2; intento++) {
    const { data: existente, error: errBuscar } = await admin
      .from("v2_candidatos")
      .select("id")
      .eq("nombre_candidato", nombre)
      .maybeSingle();
    if (errBuscar) throw errBuscar;

    if (existente) {
      // Ya existe: actualizamos su CV sin pisar el contacto con datos vacíos.
      const cambios: Record<string, unknown> = { ...fila };
      delete cambios.user_id;
      if (!datos.email) delete cambios.email;
      if (!datos.telefono) delete cambios.telefono;
      const { error } = await admin.from("v2_candidatos").update(cambios).eq("id", existente.id);
      if (error) throw error;
      return existente.id;
    }

    const { data, error } = await admin.from("v2_candidatos").insert(fila).select("id").single();
    if (!error) return data.id;
    // Otro envío creó el mismo candidato en paralelo: reintentamos como actualización.
    if (error.code !== "23505") throw error;
  }
  throw new Error("No se pudo guardar el candidato.");
}

async function guardarCv(body: Record<string, any>, miembro: string | null) {
  const archivo = body.archivo ?? {};
  const tipo = String(archivo.tipo ?? "");
  const ext = EXTENSIONES[tipo];
  if (!ext) throw new HttpError(415, "Formato no admitido. Sube un PDF o una imagen (JPG, PNG o WEBP).");

  let bytes: Uint8Array;
  try {
    bytes = decodeBase64(String(archivo.base64 ?? "").replace(/^data:[^,]*,/, ""));
  } catch (_) {
    throw new HttpError(400, "El archivo llegó dañado. Intenta de nuevo.");
  }
  const maxBytes = miembro ? MAX_BYTES_MIEMBRO : MAX_BYTES_PUBLICO;
  if (!bytes.length) throw new HttpError(400, "El archivo está vacío.");
  if (bytes.length > maxBytes) {
    throw new HttpError(413, `El archivo supera el máximo de ${maxBytes / 1024 / 1024} MB.`);
  }
  if (!coincideFirma(bytes, tipo)) throw new HttpError(415, "El archivo no parece ser un PDF o una imagen válida.");

  const nombreArchivo = String(archivo.nombre ?? `cv.${ext}`).replace(/[\\/]/g, "_").slice(0, 200);
  const texto = String(body.texto ?? "").replace(/ /g, "").trim().slice(0, 100_000);

  const avisoId = body.avisoId ? Number(body.avisoId) : null;
  if (avisoId !== null) {
    const aviso = await buscarAviso(avisoId);
    if (!aviso) throw new HttpError(404, "El aviso ya no existe.");
    if (!miembro) {
      const motivo = motivoCierre(aviso);
      if (motivo) throw new HttpError(409, motivo);
    }
  }

  const datos = await extraerContacto(texto);

  const ruta = `cvs/${new Date().toISOString().slice(0, 7)}/${crypto.randomUUID()}.${ext}`;
  const { error: errSubida } = await admin.storage.from(BUCKET).upload(ruta, bytes, { contentType: tipo });
  if (errSubida) throw new Error(`No se pudo guardar el archivo: ${errSubida.message}`);

  const sufijo = crypto.randomUUID().slice(0, 6);
  const fila: Record<string, unknown> = {
    nombre_candidato: toTitleCase(datos.nombreCompleto) ?? `Candidato No Identificado ${Date.now()}-${sufijo}`,
    email: datos.email ?? `no-extraido-${Date.now()}-${sufijo}@dominio.com`,
    telefono: datos.telefono,
    texto_cv_general: texto,
    nombre_archivo_general: nombreArchivo,
    cv_path: ruta,
    base64_general: null,
    read: false,
    updated_at: new Date().toISOString(),
    user_id: miembro ?? USUARIO_PUBLICO,
  };
  const carpetaId = miembro && body.carpetaId ? Number(body.carpetaId) : null;
  if (carpetaId) fila.carpeta_id = carpetaId;

  const candidatoId = await guardarCandidato(fila, datos);

  let postulacionId: number | null = null;
  if (avisoId !== null) {
    const nueva = {
      candidato_id: candidatoId,
      aviso_id: avisoId,
      texto_cv_especifico: texto,
      nombre_archivo_especifico: nombreArchivo,
      cv_path: ruta,
    };
    const { data, error } = await admin.from("v2_postulaciones").insert(nueva).select("id").single();
    if (!error) {
      postulacionId = data.id;
    } else if (error.code === "23505") {
      // Ya estaba postulado: guardamos el CV nuevo y lo volvemos a analizar.
      const { data: actualizada, error: errUpd } = await admin
        .from("v2_postulaciones")
        .update({
          texto_cv_especifico: texto,
          nombre_archivo_especifico: nombreArchivo,
          cv_path: ruta,
          base64_cv_especifico: null,
          calificacion: null,
          resumen: null,
          analisis_iniciado_at: null,
        })
        .eq("candidato_id", candidatoId)
        .eq("aviso_id", avisoId)
        .select("id")
        .single();
      if (errUpd) throw errUpd;
      postulacionId = actualizada.id;
    } else {
      throw error;
    }

    const id = postulacionId;
    EdgeRuntime.waitUntil(calificar(id).catch((e) => console.error(`Análisis ${id} fallido:`, e)));
  }

  return { ok: true, candidatoId, postulacionId, nombre: fila.nombre_candidato };
}

// --- ANÁLISIS CON IA ---

async function openaiJSON(prompt: string): Promise<Record<string, any>> {
  const apiKey = Deno.env.get("OPENAI_API_KEY");
  if (!apiKey) throw new Error("Falta configurar la clave de OpenAI.");

  for (let intento = 1; ; intento++) {
    const control = new AbortController();
    const temporizador = setTimeout(() => control.abort(), 90_000);
    try {
      const r = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: MODELO,
          messages: [{ role: "user", content: prompt }],
          response_format: { type: "json_object" },
        }),
        signal: control.signal,
      });
      const json = await r.json().catch(() => ({}));
      // Postgres no acepta el carácter nulo: a veces la IA lo copia del texto del CV.
      if (r.ok) return JSON.parse(String(json.choices[0].message.content).replace(/\\u0000/g, ""));

      const codigo = json?.error?.code;
      if (codigo === "insufficient_quota") throw new Error("OpenAI no tiene saldo disponible.");
      const reintentable = r.status === 429 || r.status >= 500;
      if (!reintentable || intento >= 4) throw new Error(json?.error?.message ?? `OpenAI respondió ${r.status}`);
      await new Promise((ok) => setTimeout(ok, intento * 3000 + Math.random() * 2000));
    } catch (e) {
      const esTimeout = e instanceof DOMException && e.name === "AbortError";
      if (!esTimeout || intento >= 2) throw esTimeout ? new Error("OpenAI tardó demasiado en responder.") : e;
    } finally {
      clearTimeout(temporizador);
    }
  }
}

async function calificar(postulacionId: number) {
  if (!Number.isInteger(postulacionId) || postulacionId <= 0) throw new HttpError(400, "Postulación inválida.");

  const { data: reclamadas, error } = await admin.rpc("v2_reclamar_analisis", { p_postulacion_id: postulacionId });
  if (error) throw error;

  if (!reclamadas?.length) {
    const { data: actual, error: errActual } = await admin
      .from("v2_postulaciones")
      .select("calificacion, resumen")
      .eq("id", postulacionId)
      .maybeSingle();
    if (errActual) throw errActual;
    if (!actual) throw new HttpError(404, "La postulación no existe.");
    if (actual.calificacion === null || actual.calificacion === -1) return { estado: "en_curso" };
    return { estado: "ok", calificacion: actual.calificacion, resumen: actual.resumen };
  }

  const postulacion = reclamadas[0];
  try {
    if (!postulacion.texto_cv_especifico?.trim()) throw new Error("El texto del CV está vacío.");
    const { data: aviso, error: errAviso } = await admin
      .from("v2_avisos")
      .select("titulo, descripcion, condiciones_necesarias, condiciones_deseables")
      .eq("id", postulacion.aviso_id)
      .single();
    if (errAviso) throw new Error(`No se pudo leer el aviso: ${errAviso.message}`);

    const resultado = await calificarCVConIA(postulacion.texto_cv_especifico, aviso);
    const { error: errGuardar } = await admin
      .from("v2_postulaciones")
      .update({ calificacion: resultado.calificacion, resumen: resultado.justificacion })
      .eq("id", postulacionId);
    if (errGuardar) throw new Error(`No se pudo guardar el análisis: ${errGuardar.message}`);
    return { estado: "ok", calificacion: resultado.calificacion, resumen: resultado.justificacion };
  } catch (e) {
    const resumen = `Error de análisis: ${e instanceof Error ? e.message : String(e)}`;
    await admin
      .from("v2_postulaciones")
      .update({ calificacion: -1, resumen, analisis_iniciado_at: null })
      .eq("id", postulacionId);
    return { estado: "error", calificacion: -1, resumen };
  }
}

// Mismo prompt y misma lógica de puntaje que usaba el panel, para que los
// puntajes nuevos sean comparables con los que ya estaban guardados.
async function calificarCVConIA(textoCV: string, aviso: Record<string, any>) {
  const textoCVOptimizado = textoCV.substring(0, 12000);
  const condicionesNecesariasTexto = (aviso.condiciones_necesarias ?? [])
    .map((req: string, index: number) => `${index + 1}. ${req}`)
    .join("\n");
  const condicionesDeseablesTexto = (aviso.condiciones_deseables ?? [])
    .map((req: string, index: number) => `${index + 1}. ${req}`)
    .join("\n");

  const contextoAviso = `
Puesto: ${aviso.titulo}
Descripción: ${aviso.descripcion}

Condiciones Necesarias (INDISPENSABLES):
${condicionesNecesariasTexto}

Condiciones Deseables:
${condicionesDeseablesTexto}
    `;

  const prompt = `
    Eres un analista de RRHH experto, pragmático y muy hábil para interpretar CVs cuyo texto ha sido extraído de un PDF y puede estar desordenado. Tu misión es analizar el CV con inteligencia contextual y compararlo con el aviso de trabajo para devolver UN ÚNICO OBJETO JSON válido.

### PRINCIPIOS GUÍA

1.  **Principio de Evidencia Razonable (Más importante)**: Tu objetivo NO es la coincidencia literal, sino encontrar **evidencia fuerte y razonable** en el CV. Si el aviso pide "2 años de experiencia como operador" y el CV dice "Empresa X - Operador (2021-2024)", DEBES considerar el requisito como "cumplido" porque la evidencia (3 años en el rol) es clara.
2.  **Interpretación Contextual**: El texto del CV puede estar fragmentado. Debes conectar la información. Por ejemplo, un puesto listado en una sección puede estar detallado con fechas en otra parte del documento. Asume que la información puede no estar junta.
3.  **Regla de Contención Geográfica**: Si un requisito de ubicación (ej: "vivir en Timbúes") no se cumple de forma exacta, pero el CV indica una localidad más grande que la contiene (ej: "vivo en San Lorenzo", y Timbúes es parte de San Lorenzo), debes marcarlo como **"Parcial"**. Esto se debe a que el candidato podría vivir en la localidad requerida, pero solo mencionó el área general.
4.  **Regla de Ambigüedad y Omisión**: Si un requisito no se menciona explícitamente en el CV y no aplica la regla de proximidad, pero tampoco hay evidencia que lo contradiga, debes marcarlo como **"Parcial"**. Esto indica que no hay información suficiente para confirmarlo o negarlo.
5.  **Regla de Inferencia Lógica**: Debes inferir información que es de conocimiento común o se deduce lógicamente del contexto.
    * **Ejemplo Clave (Género)**: Si un requisito es "Sexo Femenino" y el nombre del candidato es "Sofía Rodríguez", debes marcarlo como **"Cumple"**. Es una inferencia lógica y razonable basada en el nombre. No lo marques como "No Cumple" o "Parcial" solo porque el CV no dice explícitamente "Género: Femenino".
    * **Ejemplo (Título Profesional)**: Si el nombre es "Lic. Juan Pérez", infiere que tiene una licenciatura.
    *
6. Regla de Evaluación de Evidencia (Definición de Estados)

Para determinar el estado de cada requisito (Cumple, Parcial, No Cumple), utiliza la siguiente jerarquía de evidencia:

### Lógica de Evaluación de Requisitos

Para determinar el estado de cada requisito ("Cumple", "Parcial", "No Cumple"), sigue esta jerarquía estricta:

A) Estado: Cumple
Se usa EXCLUSIVAMENTE cuando hay evidencia clara, ya sea directa o por una inferencia lógica fuerte.
* Evidencia Directa:** El CV contiene texto que satisface el requisito.
    Ejemplo:* Aviso pide "Licenciatura en Administración". CV dice "Título: Lic. en Administración". -> **Cumple**.
* Inferencia Lógica Fuerte (Más importante que la omisión):** Debes inferir activamente información obvia. ESTA REGLA ANULA LA OMISIÓN DE TEXTO.
    Ejemplo Clave:* Aviso pide "Sexo Femenino". El nombre del candidato es "Priscila Solis" o "Maria López". -> **Cumple**. Justificación: "Se infiere el cumplimiento por el nombre del candidato." No lo marques como "No Cumple" solo porque el CV no dice "género: femenino".
    Ejemplo de Título:* El candidato firma como "Lic. Juan Pérez". -> **Cumple** el requisito de tener una licenciatura.

B) Estado: Parcial
Se usa cuando el CV muestra una proximidad o cumplimiento incompleto. El candidato está cerca, pero no al 100%.
* Proximidad de Competencia:** Demuestra una habilidad muy similar.
    Ejemplo:* Aviso pide "Experiencia en SAP". CV dice "Manejo de Oracle ERP". -> **Parcial**.
* Cumplimiento Cuantitativo Incompleto:** Cumple una parte significativa del requisito numérico.
    Ejemplo:* Aviso pide "5 años de experiencia". CV demuestra 3.5 años. -> **Parcial**.

C) Estado: No Cumple
Se usa **SOLO SI** no se puede aplicar "Cumple" (ni por evidencia ni por inferencia) o "Parcial".
* Omisión Total SIN Inferencia Posible:** El CV no menciona el requisito y no hay ninguna pista para inferirlo.
    *Ejemplo:* Aviso pide "Carnet de conducir". El CV no lo menciona en ninguna parte. -> **No Cumple**.
* Contradicción Directa:** El CV presenta información que choca frontalmente con el requisito.
    * *Ejemplo:* Aviso pide "Residir en Rosario". CV dice "Residencia actual: Córdoba Capital". -> **No Cumple**.

### ENTRADAS

**JOB DESCRIPTION:**
${contextoAviso}

**CV (texto extraído):**
"""${textoCVOptimizado}"""

### SISTEMA DE PUNTAJE (Lógica en Código)

#### A) REQUISITOS INDISPENSABLES (Análisis)
Tu tarea es analizar TODOS Y CADA UNO de los requisitos indispensables presentados en el aviso original. NO OMITAS NINGUNO bajo ninguna circunstancia. Devuelve un array de objetos en \`desglose_indispensables\`. Es OBLIGATORIO que haya la misma cantidad de elementos en este array que requisitos indispensables provistos.

-   **Para cada requisito**, busca "evidencia razonable" en el CV para determinar si está:
    -   \`"Cumple"\`: Hay evidencia clara de que se satisface.
    -   \`"Parcial"\`: No hay evidencia clara, pero hay indicios o no se contradice.
    -   \`"No Cumple"\`: Absolutamente ninguna evidencia de que se cumple. DEBES INCLUIRLO indicando "No Cumple".

#### B) COMPETENCIAS DESEABLES (Análisis)
Tu tarea es analizar TODAS Y CADA UNA de las competencias deseables presentadas en el aviso original. NO OMITAS NINGUNA bajo ninguna circunstancia. Devuelve un array de objetos en \`desglose_deseables\`. Es OBLIGATORIO que haya la misma cantidad de elementos en este array que condiciones deseables provistas.

-   **Para cada competencia**, determina su estado:
    -   \`"cumplido"\`: Evidencia clara.
    -   \`"parcial"\`: Evidencia parcial (ej: pide "inglés avanzado", CV dice "inglés intermedio").
    -   \`"no cumplido"\`: Sin evidencia de ello. DEBES INCLUIRLO indicando "no cumplido".

#### C) ALINEAMIENTO (Análisis)
Tu tarea es analizar cada ítem de alineamiento y determinar su valor.

-   **funciones**: Determina si la coincidencia de funciones es "Alta", "Media" o "Baja".
-   **experiencia**: Determina si la experiencia es ">3 años", "1-3 años" o "<1 año".
-   **logros**: Determina si hay logros cuantificables ("Sí" o "No").

### FORMATO DE SALIDA (JSON ÚNICO)

Devuelve **solo** el objeto JSON. La justificación debe ser un borrador que el código usará como plantilla.

{
  "nombreCompleto": "string o null",
  "email": "string o null",
  "telefono": "string o null",
  "desglose_indispensables": [
    { "requisito": "nombre del requisito", "estado": "Cumple", "justificacion": "breve explicación" }
  ],
  "desglose_deseables": [
    { "competencia": "nombre de la competencia", "estado": "cumplido", "justificacion": "breve explicación" }
  ],
  "justificacion_template": {
    "conclusion": "Recomendar",
    "alineamiento_items": {
        "funciones": { "valor": "Alta", "justificacion": "Las tareas descritas coinciden con el puesto." },
        "experiencia": { "valor": ">3 años", "justificacion": "Suma 5 años en roles similares." },
        "logros": { "valor": "Sí", "justificacion": "Menciona una reducción de costos del 15%." }
    }
  }
}
`;

  const content = await openaiJSON(prompt);

  // 1. Requisitos indispensables (50 pts)
  const desglose_indispensables: any[] = Array.isArray(content.desglose_indispensables) ? content.desglose_indispensables : [];
  let p_indispensables = 0;
  const estados_indispensables = desglose_indispensables.map((item) => String(item?.estado ?? "").trim().toLowerCase());
  if (estados_indispensables.includes("no cumple")) {
    p_indispensables = 0;
  } else {
    const parciales = estados_indispensables.filter((e) => e === "parcial").length;
    if (parciales === 0) p_indispensables = 50;
    else if (parciales === 1) p_indispensables = 40;
    else if (parciales === 2) p_indispensables = 30;
    else if (parciales === 3) p_indispensables = 20;
    else p_indispensables = 0;
  }

  // 2. Competencias deseables (30 pts)
  const desglose_deseables: any[] = Array.isArray(content.desglose_deseables) ? content.desglose_deseables : [];
  let p_deseables = 0;
  if (desglose_deseables.length > 0) {
    const peso_unitario = 30 / desglose_deseables.length;
    p_deseables = desglose_deseables.reduce((total, item) => {
      const estado = String(item?.estado ?? "").toLowerCase();
      if (estado === "cumplido") return total + peso_unitario;
      if (estado === "parcial") return total + peso_unitario * 0.5;
      return total;
    }, 0);
  }
  p_deseables = parseFloat(p_deseables.toFixed(2));

  // 3. Alineamiento (20 pts)
  const al_items = content.justificacion_template?.alineamiento_items ?? {};
  const valor = (item: any) => String(item?.valor ?? "").trim().toLowerCase();
  const puntos_funciones = valor(al_items.funciones) === "alta" ? 8 : valor(al_items.funciones) === "media" ? 4 : 0;
  const puntos_experiencia = valor(al_items.experiencia) === ">3 años" ? 8 : valor(al_items.experiencia) === "1-3 años" ? 4 : 0;
  const puntos_logros = ["sí", "si"].includes(valor(al_items.logros)) ? 4 : 0;
  const p_alineamiento = puntos_funciones + puntos_experiencia + puntos_logros;

  // 4. Calificación final
  const calificacion_final = Math.round(Math.max(0, Math.min(100, p_indispensables + p_deseables + p_alineamiento)));

  // 5. Justificación legible
  const template = content.justificacion_template ?? {};
  const conclusion = toTitleCase(template.conclusion) || (calificacion_final >= 50 ? "Recomendar" : "Descartar");
  const getEmoji = (estado: unknown) => {
    const e = String(estado ?? "").toLowerCase();
    if (e === "cumple" || e === "cumplido") return "✅";
    if (e === "parcial") return "🟠";
    return "❌";
  };
  const indispensables_txt = desglose_indispensables.map((item) => {
    const requisito = String(item?.requisito ?? "").replace(/\*/g, "");
    return `${getEmoji(item?.estado)} ${requisito}: ${toTitleCase(item?.estado) ?? ""}. ${item?.justificacion ?? ""}`;
  }).join("\n");
  const deseables_txt = desglose_deseables.map((item) => {
    const competencia = String(item?.competencia ?? "").replace(/\*/g, "");
    return `${getEmoji(item?.estado)} ${competencia}: ${toTitleCase(item?.estado) ?? ""}. ${item?.justificacion ?? ""}`;
  }).join("\n");
  const formatAlineamientoItem = (label: string, data: any, points: number, maxPoints: number, positivo: string, parcial?: string) => {
    const item = data ?? {};
    const emoji = item.valor === positivo ? "✅" : item.valor === parcial ? "🟠" : "❌";
    return `${emoji} ${label} (${points}/${maxPoints} pts): ${item.valor ?? "N/A"}. ${item.justificacion ?? ""}`;
  };
  const alineamiento_txt = [
    formatAlineamientoItem("Funciones", al_items.funciones, puntos_funciones, 8, "Alta", "Media"),
    formatAlineamientoItem("Experiencia", al_items.experiencia, puntos_experiencia, 8, ">3 años", "1-3 años"),
    formatAlineamientoItem("Logros", al_items.logros, puntos_logros, 4, "Sí"),
  ].join("\n");

  const justificacion = `
CONCLUSIÓN: ${conclusion} - Puntaje: ${calificacion_final}/100
---
A) Requisitos Indispensables (${p_indispensables}/50 pts)
${indispensables_txt}

B) Competencias Deseables (${p_deseables}/30 pts)
${deseables_txt}

C) Alineamiento (${p_alineamiento}/20 pts)
${alineamiento_txt}
  `.trim().replace(/ /g, "");

  return { calificacion: calificacion_final, justificacion };
}

// --- GENERAR AVISO ---

async function generarAviso(titulo: string) {
  const puesto = titulo.trim().slice(0, 200);
  if (!puesto) throw new HttpError(400, "Escribe un título para el puesto.");
  const prompt = `
      Actúa como un experto en RRHH. Crea el contenido para una búsqueda laboral con el título: "${puesto}".
      Tu respuesta DEBE SER únicamente un objeto JSON con 3 claves: "descripcion" (un párrafo de 80-150 palabras), "condiciones_necesarias" (un array de 4 strings), y "condiciones_deseables" (un array de 3 strings).
    `;
  const r = await openaiJSON(prompt);
  const lista = (v: unknown) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
  return {
    descripcion: typeof r.descripcion === "string" ? r.descripcion : "",
    condiciones_necesarias: lista(r.condiciones_necesarias),
    condiciones_deseables: lista(r.condiciones_deseables),
  };
}
