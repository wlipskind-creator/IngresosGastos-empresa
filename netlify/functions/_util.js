// Utilidades compartidas por las funciones (el guion bajo evita que Netlify
// lo publique como si fuera una función).
import { createHmac, timingSafeEqual, randomUUID } from "node:crypto";

export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }
  });
}

function iguales(a, b) {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
}

// La clave de acceso de la familia viaja en la cabecera "x-clave".
export function claveOk(req) {
  const c = req.headers.get("x-clave");
  return !!process.env.EDIT_PASSWORD && typeof c === "string" && iguales(c, process.env.EDIT_PASSWORD);
}

// Devuelve una respuesta de error si la clave no sirve; null si está todo bien.
export function exigirClave(req) {
  if (!process.env.EDIT_PASSWORD) return json({ error: "Falta configurar EDIT_PASSWORD en Netlify" }, 500);
  return claveOk(req) ? null : json({ error: "Clave incorrecta" }, 401);
}

// Firma de una foto: solo la reciben quienes entraron con la clave.
export function firmar(id) {
  return createHmac("sha256", "gc1|" + (process.env.EDIT_PASSWORD || "")).update(String(id)).digest("hex").slice(0, 24);
}
export function firmaValida(id, s) {
  return !!process.env.EDIT_PASSWORD && typeof s === "string" && iguales(s, firmar(id));
}

export function idNuevo() {
  return Date.now().toString(36) + "-" + randomUUID().replace(/-/g, "").slice(0, 12);
}

export async function leerJSON(req) {
  try { return await req.json(); } catch (e) { return null; }
}

export const ID_OK = /^[a-z0-9-]{1,60}$/;
export const FECHA_OK = /^\d{4}-\d{2}-\d{2}$/;
