import { getStore } from "@netlify/blobs";
import { json, exigirClave, leerJSON, firmar, idNuevo, ID_OK } from "./_util.js";

// Registro de animales (guardado como una lista en "animales").
//  GET -> lista    POST {accion:"guardar", animal}  POST {accion:"borrar", id}
const ESPECIES = ["Bovino", "Ovino", "Otro"];
const ESTADOS = ["Activo", "Vendido", "Fallecido"];

function limpiar(a) {
  const txt = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
  const fecha = v => (/^\d{4}-\d{2}-\d{2}$/.test(v || "") ? v : "");
  const nombre = txt(a.nombre, 80);
  if (!nombre) return { error: "Falta el nombre o la identificación del animal" };
  return {
    animal: {
      id: ID_OK.test(a.id || "") ? a.id : idNuevo(),
      nombre,
      especie: ESPECIES.includes(a.especie) ? a.especie : "Bovino",
      categoria: txt(a.categoria, 40),
      caravana: txt(a.caravana, 40),
      raza: txt(a.raza, 60),
      nacimiento: fecha(a.nacimiento),
      origen: txt(a.origen, 100),
      estado: ESTADOS.includes(a.estado) ? a.estado : "Activo",
      fechaBaja: fecha(a.fechaBaja),
      notas: txt(a.notas, 1000),
      fotoId: ID_OK.test(a.fotoId || "") ? a.fotoId : ""
    }
  };
}

// Compara caravanas sin importar espacios, puntos o guiones: "982 000123456789" = "982000123456789".
export const normCaravana = s => String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "");

export default async (req) => {
  const e = exigirClave(req);
  if (e) return e;
  const store = getStore("gestion");
  try {
    let lista = (await store.get("animales", { type: "json" })) || [];
    if (req.method === "GET") {
      lista.forEach(a => { if (a.fotoId) a.fs = firmar(a.fotoId); });
      return json({ ok: true, animales: lista });
    }
    if (req.method !== "POST") return json({ error: "Método no permitido" }, 405);
    const body = await leerJSON(req);
    if (!body) return json({ error: "JSON inválido" }, 400);
    if (body.accion === "guardar") {
      const r = limpiar(body.animal || {});
      if (r.error) return json({ error: r.error }, 400);
      const nc = normCaravana(r.animal.caravana);
      if (nc) {
        const otro = lista.find(x => x.id !== r.animal.id && normCaravana(x.caravana) === nc);
        if (otro) return json({ error: "Ya hay otro animal con esa caravana: " + otro.nombre }, 409);
      }
      const i = lista.findIndex(x => x.id === r.animal.id);
      if (i >= 0) lista[i] = r.animal; else lista.push(r.animal);
      await store.setJSON("animales", lista);
      if (r.animal.fotoId) r.animal.fs = firmar(r.animal.fotoId);
      return json({ ok: true, animal: r.animal });
    }
    if (body.accion === "importar") {
      // Alta masiva desde lecturas de caravanas. El control de duplicados se repite acá, en el servidor.
      const entrantes = Array.isArray(body.animales) ? body.animales.slice(0, 300) : [];
      const usadas = new Map(lista.filter(x => normCaravana(x.caravana)).map(x => [normCaravana(x.caravana), x.nombre]));
      const creados = [], omitidos = [];
      for (const en of entrantes) {
        const r = limpiar(en || {});
        if (r.error) { omitidos.push({ caravana: String(en && en.caravana || ""), motivo: r.error }); continue; }
        const nc = normCaravana(r.animal.caravana);
        if (!nc) { omitidos.push({ caravana: "", motivo: "Sin número de caravana" }); continue; }
        if (usadas.has(nc)) { omitidos.push({ caravana: r.animal.caravana, motivo: "Ya existe: " + usadas.get(nc) }); continue; }
        usadas.set(nc, r.animal.nombre);
        lista.push(r.animal); creados.push(r.animal);
      }
      if (creados.length) await store.setJSON("animales", lista);
      return json({ ok: true, creados: creados.length, omitidos });
    }
    if (body.accion === "borrar") {
      const a = lista.find(x => x.id === body.id);
      lista = lista.filter(x => x.id !== body.id);
      await store.setJSON("animales", lista);
      if (a && a.fotoId) {
        const fotos = getStore("fotos");
        await fotos.delete(a.fotoId);
        await fotos.delete(a.fotoId + "-t");
      }
      return json({ ok: true });
    }
    return json({ error: "Acción desconocida" }, 400);
  } catch (err) {
    return json({ error: "Error en el servidor", detalle: String(err) }, 500);
  }
};
