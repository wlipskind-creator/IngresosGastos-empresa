import { getStore } from "@netlify/blobs";
import { json, exigirClave, leerJSON, firmar, idNuevo, ID_OK, FECHA_OK } from "./_util.js";

// Movimientos (gastos e ingresos), guardados por mes: "movs-AAAA-MM".
//  GET  -> todos los movimientos (con la firma de la foto, si tienen)
//  POST {accion:"guardar", mov}  -> crea o modifica UN movimiento
//  POST {accion:"borrar", id}    -> borra UN movimiento (y su foto)
// Cada operación solo toca el movimiento indicado, así dos personas cargando
// a la vez no se pisan lo que cargó la otra.

const MONEDAS = ["UYU", "USD"];

function limpiar(m, usuario) {
  const monto = Number(m.monto);
  if (!(monto > 0) || monto > 1e10) return { error: "El monto tiene que ser mayor a cero" };
  if (m.tipo !== "gasto" && m.tipo !== "ingreso") return { error: "Tipo inválido" };
  if (!FECHA_OK.test(m.fecha || "")) return { error: "Fecha inválida" };
  const moneda = MONEDAS.includes(m.moneda) ? m.moneda : "UYU";
  const txt = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const out = {
    id: ID_OK.test(m.id || "") ? m.id : idNuevo(),
    tipo: m.tipo,
    fecha: m.fecha,
    monto: Math.round(monto * 100) / 100,
    moneda,
    categoria: txt(m.categoria, 60) || "Otros",
    detalle: txt(m.detalle, 200),
    contraparte: txt(m.contraparte, 100),
    animalId: ID_OK.test(m.animalId || "") ? m.animalId : "",
    fotoId: ID_OK.test(m.fotoId || "") ? m.fotoId : "",
    por: txt(m.por, 40),
    creado: m.creado || new Date().toISOString(),
    modificado: new Date().toISOString()
  };
  return { mov: out };
}

async function claves(store) {
  const r = await store.list({ prefix: "movs-" });
  return (r.blobs || []).map(b => b.key);
}

export default async (req) => {
  const e = exigirClave(req);
  if (e) return e;
  const store = getStore("gestion");
  try {
    if (req.method === "GET") {
      const ks = await claves(store);
      const todos = [];
      for (const k of ks) {
        const arr = await store.get(k, { type: "json" });
        if (Array.isArray(arr)) arr.forEach(m => { if (m.fotoId) m.fs = firmar(m.fotoId); todos.push(m); });
      }
      return json({ ok: true, movs: todos });
    }
    if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
    const body = await leerJSON(req);
    if (!body) return json({ error: "JSON inválido" }, 400);

    if (body.accion === "guardar") {
      const r = limpiar(body.mov || {});
      if (r.error) return json({ error: r.error }, 400);
      const mov = r.mov;
      // sacar el movimiento de donde estuviera (por si cambió de mes) y ponerlo en su mes
      const ks = await claves(store);
      let previo = null;
      for (const k of ks) {
        const arr = (await store.get(k, { type: "json" })) || [];
        const i = arr.findIndex(x => x.id === mov.id);
        if (i >= 0) {
          previo = arr[i];
          arr.splice(i, 1);
          await store.setJSON(k, arr);
        }
      }
      if (previo) {
        mov.creado = previo.creado || mov.creado;
        mov.por = mov.por || previo.por;
        if (previo.fotoId && previo.fotoId !== mov.fotoId) { // se cambió la foto: se borra la anterior
          const fotos = getStore("fotos");
          await fotos.delete(previo.fotoId);
          await fotos.delete(previo.fotoId + "-t");
        }
      }
      const key = "movs-" + mov.fecha.slice(0, 7);
      const arr = (await store.get(key, { type: "json" })) || [];
      arr.push(mov);
      arr.sort((a, b) => (a.fecha < b.fecha ? -1 : a.fecha > b.fecha ? 1 : 0));
      await store.setJSON(key, arr);
      if (mov.fotoId) mov.fs = firmar(mov.fotoId);
      return json({ ok: true, mov });
    }

    if (body.accion === "borrar") {
      const id = body.id;
      if (!ID_OK.test(id || "")) return json({ error: "Falta el id" }, 400);
      const ks = await claves(store);
      let fotoId = "";
      for (const k of ks) {
        const arr = (await store.get(k, { type: "json" })) || [];
        const i = arr.findIndex(x => x.id === id);
        if (i >= 0) {
          fotoId = arr[i].fotoId || "";
          arr.splice(i, 1);
          await store.setJSON(k, arr);
        }
      }
      if (fotoId) {
        const fotos = getStore("fotos");
        await fotos.delete(fotoId);
        await fotos.delete(fotoId + "-t");
      }
      return json({ ok: true });
    }
    return json({ error: "Acción desconocida" }, 400);
  } catch (err) {
    return json({ error: "Error en el servidor", detalle: String(err) }, 500);
  }
};
