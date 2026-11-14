import { getStore } from "@netlify/blobs";
import { json, exigirClave, leerJSON } from "./_util.js";

// Ajustes: nombre del establecimiento, tipo de cambio, categorías, personas.
const GASTOS = ["Alimentación", "Sanidad / veterinario", "Genética (compra de reproductores, semen, embriones)", "Exposiciones (inscripción, flete, preparación)", "Personal / jornales", "Combustible", "Mantenimiento del campo", "Impuestos y tasas", "Servicios (luz, agua, teléfono)", "Otros"];
const INGRESOS = ["Venta de animales", "Premios de exposiciones", "Servicios (alquiler de reproductores, semen)", "Otros"];
const DEFAULT = { nombre: "Mi cabaña", tc: 40, catGasto: GASTOS, catIngreso: INGRESOS, personas: [] };

function lista(v, def, n) {
  if (!Array.isArray(v)) return def;
  const out = v.map(x => (typeof x === "string" ? x.trim().slice(0, 80) : "")).filter(Boolean);
  return Array.from(new Set(out)).slice(0, n);
}

export default async (req) => {
  const e = exigirClave(req);
  if (e) return e;
  const store = getStore("gestion");
  try {
    const actual = (await store.get("config", { type: "json" })) || {};
    if (req.method === "GET") return json({ ok: true, config: { ...DEFAULT, ...actual } });
    if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
    const b = await leerJSON(req);
    if (!b || !b.config) return json({ error: "JSON inválido" }, 400);
    const c = b.config;
    const tc = Number(c.tc);
    const nueva = {
      nombre: (typeof c.nombre === "string" && c.nombre.trim().slice(0, 80)) || DEFAULT.nombre,
      tc: tc > 0 && tc < 1e6 ? tc : DEFAULT.tc,
      catGasto: lista(c.catGasto, GASTOS, 40),
      catIngreso: lista(c.catIngreso, INGRESOS, 40),
      personas: lista(c.personas, [], 10)
    };
    if (!nueva.catGasto.length) nueva.catGasto = GASTOS;
    if (!nueva.catIngreso.length) nueva.catIngreso = INGRESOS;
    await store.setJSON("config", nueva);
    return json({ ok: true, config: nueva });
  } catch (err) {
    return json({ error: "Error en el servidor", detalle: String(err) }, 500);
  }
};
