import { getStore } from "@netlify/blobs";
import { firmaValida, ID_OK } from "./_util.js";

// GET ?id=...&s=firma[&t=1]  -> la foto (o su miniatura). Sin firma válida no se entrega.
export default async (req) => {
  const url = new URL(req.url);
  const id = url.searchParams.get("id") || "";
  if (!ID_OK.test(id)) return new Response("id inválido", { status: 400 });
  if (!firmaValida(id, url.searchParams.get("s"))) return new Response("Sin permiso", { status: 403 });
  try {
    const store = getStore("fotos");
    let res = null;
    if (url.searchParams.get("t")) res = await store.getWithMetadata(id + "-t", { type: "arrayBuffer" });
    if (!res) res = await store.getWithMetadata(id, { type: "arrayBuffer" });
    if (!res) return new Response("No encontrada", { status: 404 });
    return new Response(res.data, {
      headers: { "Content-Type": (res.metadata && res.metadata.contentType) || "image/jpeg", "Cache-Control": "private, max-age=31536000, immutable" }
    });
  } catch (err) {
    return new Response("Error leyendo la foto", { status: 500 });
  }
};
