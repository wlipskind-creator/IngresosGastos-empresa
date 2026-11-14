import { getStore } from "@netlify/blobs";
import { json, exigirClave, leerJSON, idNuevo, ID_OK } from "./_util.js";

// Lotes de hacienda (invernada): guardados como una lista en "lotes".
//  GET -> lista    POST {accion:"guardar", lote}   POST {accion:"borrar", id}
function limpiar(l) {
  const txt = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const fecha = v => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : "");
  const num = (v, max) => { const n = Number(String(v).replace(",", ".")); return isFinite(n) && n >= 0 && n < max ? Math.round(n * 100) / 100 : 0; };
  const nombre = txt(l.nombre, 80);
  if (!nombre) return { error: "Falta el nombre del lote" };
  const cantidad = Math.round(num(l.cantidad, 100000));
  if (!(cantidad > 0)) return { error: "Falta la cantidad de animales del lote" };
  const pesadas = (Array.isArray(l.pesadas) ? l.pesadas : []).slice(0, 300).map(p => ({
    id: ID_OK.test((p && p.id) || "") ? p.id : idNuevo(),
    fecha: fecha(p && p.fecha),
    cantidad: Math.round(num(p && p.cantidad, 100000)),
    pesoProm: num(p && p.pesoProm, 5000)
  })).filter(p => p.fecha && p.pesoProm > 0).sort((a, b) => (a.fecha < b.fecha ? -1 : 1));
  return {
    lote: {
      id: ID_OK.test(l.id || "") ? l.id : idNuevo(),
      nombre,
      cantidad,
      cantidadActual: Math.min(cantidad, Math.round(num(l.cantidadActual, 100000)) || cantidad),
      fechaEntrada: fecha(l.fechaEntrada),
      pesoEntrada: num(l.pesoEntrada, 5000),
      estado: l.estado === "Cerrado" ? "Cerrado" : "Activo",
      fechaCierre: l.estado === "Cerrado" ? fecha(l.fechaCierre) : "",
      notas: txt(l.notas, 1000),
      pesadas
    }
  };
}

export default async (req) => {
  const e = exigirClave(req);
  if (e) return e;
  const store = getStore("gestion");
  try {
    let lista = (await store.get("lotes", { type: "json" })) || [];
    if (req.method === "GET") return json({ ok: true, lotes: lista });
    if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
    const body = await leerJSON(req);
    if (!body) return json({ error: "JSON inválido" }, 400);
    if (body.accion === "guardar") {
      const r = limpiar(body.lote || {});
      if (r.error) return json({ error: r.error }, 400);
      const i = lista.findIndex(x => x.id === r.lote.id);
      if (i >= 0) lista[i] = r.lote; else lista.push(r.lote);
      await store.setJSON("lotes", lista);
      return json({ ok: true, lote: r.lote });
    }
    if (body.accion === "borrar") {
      lista = lista.filter(x => x.id !== body.id);
      await store.setJSON("lotes", lista);
      return json({ ok: true });
    }
    return json({ error: "Acción desconocida" }, 400);
  } catch (err) {
    return json({ error: "Error en el servidor", detalle: String(err) }, 500);
  }
};
