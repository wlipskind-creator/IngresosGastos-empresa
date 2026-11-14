import { getStore } from "@netlify/blobs";
import { json, exigirClave, leerJSON, firmar, idNuevo } from "./_util.js";

const MAX_BYTES = 3 * 1024 * 1024;
function decodificar(dataUrl) {
  const m = typeof dataUrl === "string" && dataUrl.match(/^data:(image\/[a-z+.-]+);base64,(.+)$/i);
  return m ? { contentType: m[1], buffer: Buffer.from(m[2], "base64") } : null;
}

// Sube la foto de un comprobante (ya reducida en el celular) y su miniatura.
export default async (req) => {
  const e = exigirClave(req);
  if (e) return e;
  if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
  const b = await leerJSON(req);
  if (!b) return json({ error: "JSON inválido" }, 400);
  const grande = decodificar(b.dataUrl);
  if (!grande) return json({ error: "Formato de imagen inválido" }, 400);
  if (grande.buffer.length > MAX_BYTES) return json({ error: "La imagen es demasiado pesada" }, 413);
  const mini = b.thumbUrl ? decodificar(b.thumbUrl) : null;
  const id = idNuevo();
  try {
    const store = getStore("fotos");
    await store.set(id, grande.buffer, { metadata: { contentType: grande.contentType } });
    if (mini) await store.set(id + "-t", mini.buffer, { metadata: { contentType: mini.contentType } });
    return json({ ok: true, id, s: firmar(id) });
  } catch (err) {
    return json({ error: "Error guardando la imagen", detalle: String(err) }, 500);
  }
};
