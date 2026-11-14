import { json, exigirClave } from "./_util.js";

// Sirve para comprobar si la clave es correcta (la pantalla de entrada).
export default async (req) => {
  const e = exigirClave(req);
  if (e) return e;
  return json({ ok: true });
};
