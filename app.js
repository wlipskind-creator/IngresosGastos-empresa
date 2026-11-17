// Gestión de la cabaña: pantallas y llamadas al servidor.
(function () {
  'use strict';
  const G = window.Gestion;
  const $ = (s, r) => (r || document).querySelector(s);
  const app = $('#app');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---------- almacenamiento del teléfono (con respaldo en memoria) ----------
  const mem = {};
  const LS = {
    get(k) { try { const v = localStorage.getItem(k); return v === null ? (mem[k] || null) : v; } catch (e) { return mem[k] || null; } },
    set(k, v) { mem[k] = v; try { localStorage.setItem(k, v); } catch (e) { /* queda en memoria */ } },
    del(k) { delete mem[k]; try { localStorage.removeItem(k); } catch (e) { /* nada */ } }
  };

  const S = {
    clave: LS.get('gc-clave') || '',
    quien: LS.get('gc-quien') || '',
    config: { nombre: 'Mi cabaña', logo: '', color: '#2f6b3a', tc: 40, catGasto: [], catIngreso: [], personas: [] },
    movs: [], animales: [], lotes: [], cargado: false
  };

  // ---------- avisos ----------
  let tAviso = null;
  function aviso(txt, error) {
    const el = $('#aviso');
    el.textContent = txt;
    el.className = 'aviso' + (error ? ' error' : '');
    clearTimeout(tAviso);
    tAviso = setTimeout(() => el.classList.add('oculto'), error ? 5000 : 2200);
  }
  const esperar = ms => new Promise(r => setTimeout(r, ms));

  // ---------- marca (nombre, logo y color del establecimiento) ----------
  function mezcla(hex, con, k) { // mezcla un color con blanco o negro
    const n = parseInt(hex.slice(1), 16), t = con === 'negro' ? 0 : 255;
    const ch = [n >> 16 & 255, n >> 8 & 255, n & 255].map(v => Math.round(v + (t - v) * k));
    return '#' + ch.map(v => v.toString(16).padStart(2, '0')).join('');
  }
  function aplicarMarca(m) {
    const color = /^#[0-9a-f]{6}$/i.test(m.color || '') ? m.color : '#2f6b3a';
    const r = document.documentElement.style;
    r.setProperty('--verde', color); r.setProperty('--verde-osc', mezcla(color, 'negro', 0.35)); r.setProperty('--verde-cl', mezcla(color, 'blanco', 0.88));
    const nombre = m.nombre || 'Mi cabaña';
    $('#marca').innerHTML = (m.logo ? '<img class="logo-top" alt="" src="' + m.logo + '">' : '🐂 ') + '<span>' + esc(nombre) + '</span>';
    document.title = nombre;
    const tm = document.querySelector('meta[name=theme-color]'); if (tm) tm.content = color;
    try { localStorage.setItem('gc-marca', JSON.stringify({ nombre, logo: m.logo || '', color })); } catch (e) { /* nada */ }
  }
  function marcaGuardada() { try { return JSON.parse(localStorage.getItem('gc-marca') || 'null'); } catch (e) { return null; } }
  async function cargarMarcaPublica() {
    try { const r = await fetch('/.netlify/functions/config?publico=1'); const j = await r.json(); if (j.marca) { aplicarMarca(j.marca); return j.marca; } } catch (e) { /* sin red: queda la guardada */ }
    return null;
  }
  function logoAData(file) { // achica el logo (mantiene transparencia) para guardarlo en los ajustes
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => {
        const k = Math.min(1, 256 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        let d = c.toDataURL('image/png');
        if (d.length > 200000) d = c.toDataURL('image/jpeg', 0.85);
        resolve(d);
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer el logo')); };
      img.src = url;
    });
  }

  // ---------- servidor ----------
  async function api(fn, body) {
    let ultimo = null;
    for (let i = 0; i < 3; i++) {
      try {
        const res = await fetch('/.netlify/functions/' + fn, {
          method: body ? 'POST' : 'GET',
          headers: { 'Content-Type': 'application/json', 'x-clave': S.clave },
          body: body ? JSON.stringify(body) : undefined
        });
        let j = {};
        try { j = await res.json(); } catch (e) { /* sin JSON */ }
        if (res.status === 401) { const e = new Error(j.error || 'Clave incorrecta'); e.clave = true; throw e; }
        if (!res.ok) throw new Error(j.error || ('Error ' + res.status));
        return j;
      } catch (e) {
        if (e.clave) throw e;
        if (e instanceof TypeError) { ultimo = new Error('Sin conexión. Revisá la señal e intentá de nuevo.'); await esperar(1500 * (i + 1)); continue; }
        throw e;
      }
    }
    throw ultimo;
  }

  async function cargarTodo() {
    const [c, m, a, lo] = await Promise.all([api('config'), api('movs'), api('animales'), api('lotes')]);
    S.config = c.config; S.movs = m.movs; S.animales = a.animales; S.lotes = lo.lotes; S.cargado = true;
    aplicarMarca(S.config);
  }

  function cerrarSesion(msg) {
    S.clave = ''; LS.del('gc-clave'); S.cargado = false;
    pantallaEntrada(msg);
  }

  // ---------- utilidades ----------
  const urlFoto = (id, s, mini) => '/.netlify/functions/foto-ver?id=' + encodeURIComponent(id) + '&s=' + encodeURIComponent(s || '') + (mini ? '&t=1' : '');
  function nuevoId() {
    const b = new Uint8Array(6);
    (window.crypto || window.msCrypto).getRandomValues(b);
    return Date.now().toString(36) + '-' + Array.from(b, x => x.toString(16).padStart(2, '0')).join('');
  }
  const animalPorId = id => S.animales.find(a => a.id === id);
  const nombreAnimal = id => { const a = animalPorId(id); return a ? a.nombre : ''; };
  const lotePorId = id => S.lotes.find(l => l.id === id);
  const nombreLote = id => { const l = lotePorId(id); return l ? l.nombre : ''; };
  function monto(m) { return G.fmtMonto(m.monto, m.moneda, m.monto >= 1000 ? 0 : 2); }

  function abrirVisor(src) {
    const v = $('#visor');
    $('img', v).src = src;
    v.classList.remove('oculto');
    v.onclick = () => v.classList.add('oculto');
  }

  // Reduce la foto en el teléfono antes de subirla (ahorra datos y espacio).
  function reducirFoto(file, maxLado, calidad) {
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, maxLado / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k));
        c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        resolve(c.toDataURL('image/jpeg', calidad));
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('No se pudo leer la foto')); };
      img.src = url;
    });
  }
  async function subirFoto(file) {
    const grande = await reducirFoto(file, 1400, 0.72);
    const mini = await reducirFoto(file, 320, 0.7);
    return api('foto-subir', { dataUrl: grande, thumbUrl: mini });
  }

  function encabezado(titulo, volver) {
    return (volver ? '<p><a href="' + volver + '">← Volver</a></p>' : '') + '<h1>' + esc(titulo) + '</h1>';
  }
  function topDerecha() {
    $('#top-der').innerHTML = S.clave ? '<button type="button" id="b-ayuda" aria-label="Ayuda">❓</button> <button type="button" id="b-ajustes" aria-label="Ajustes">⚙️</button>' : '';
    const b = $('#b-ajustes');
    if (b) b.onclick = () => { location.hash = '#ajustes'; };
    const h = $('#b-ayuda');
    if (h) h.onclick = () => { location.hash = '#ayuda'; };
  }

  // ---------- entrada ----------
  function pantallaEntrada(msg) {
    $('#top-der').innerHTML = '';
    const mg = marcaGuardada() || {};
    app.innerHTML = '<div class="entrada-marca">' + (mg.logo ? '<img class="logo-grande" alt="" src="' + mg.logo + '">' : '<div class="ico-grande">🐂</div>') + '<h1>' + esc(mg.nombre || 'Gestión de la cabaña') + '</h1></div>' +
      '<div class="tarjeta"><p>Ingresá la clave de la familia para entrar.</p>' +
      (msg ? '<p class="neg">' + esc(msg) + '</p>' : '') +
      '<form id="f-entrada">' +
      '<label class="campo">Clave<input type="password" id="e-clave" autocomplete="current-password" autocapitalize="off"></label>' +
      '<label class="campo">¿Quién está cargando? (para saber quién anotó cada gasto)<input type="text" id="e-quien" placeholder="Ej.: Papá, Mamá, Nacho" value="' + esc(S.quien) + '"></label>' +
      '<button class="btn" type="submit">Entrar</button></form></div>';
    $('#f-entrada').onsubmit = async ev => {
      ev.preventDefault();
      const clave = $('#e-clave').value;
      if (!clave) return;
      S.clave = clave;
      S.quien = $('#e-quien').value.trim();
      const btn = $('#f-entrada button'); btn.disabled = true; btn.textContent = 'Entrando…';
      try {
        await api('auth');
        LS.set('gc-clave', clave); LS.set('gc-quien', S.quien);
        await cargarTodo();
        enrutar();
      } catch (e) {
        S.clave = '';
        pantallaEntrada(e.clave ? 'La clave no es correcta.' : e.message);
      }
    };
  }

  // ---------- inicio ----------
  function resumenMes() {
    const p = G.periodo('mes');
    const delMes = S.movs.filter(m => G.enPeriodo(m, p));
    const out = [];
    ['UYU', 'USD'].forEach(mon => {
      const r = G.resumen(delMes, mon, 1);
      if (r.n) out.push({ mon, r });
    });
    return out;
  }
  function filasMov(lista, conAnimal) {
    return lista.map(m =>
      '<a class="mov" href="#mov/' + esc(m.id) + '"><div class="izq"><div class="cat">' + (m.tipo === 'ajuste' ? '🤝 ' : '') + esc(m.categoria) + (m.verificado ? ' <span class="ver" title="Verificado">✔</span>' : '') + '</div>' +
      '<div class="sub">' + (m.ref ? '#' + esc(m.ref) + ' · ' : '') + esc(G.fechaCorta(m.fecha)) + (m.detalle ? ' · ' + esc(m.detalle) : '') + (m.contraparte ? ' · ' + esc(m.contraparte) : '') +
      (conAnimal && m.animalId ? ' · 🐂 ' + esc(nombreAnimal(m.animalId)) : '') + (S.config.usaLotes && m.loteId && nombreLote(m.loteId) ? ' · 📦 ' + esc(nombreLote(m.loteId)) : '') + (m.pagadoPor ? ' · 💵 ' + esc(m.pagadoPor) : (m.por ? ' · 👤 ' + esc(m.por) : '')) + '</div></div>' +
      (m.fotoId ? '<img class="miniatura" alt="" loading="lazy" src="' + urlFoto(m.fotoId, m.fs, true) + '">' : '') +
      '<div class="imp ' + (m.tipo === 'gasto' && m.monto > 0 ? 'g' : m.tipo === 'gasto' ? 'i' : m.tipo === 'ajuste' ? 'a' : 'i') + '">' + (m.tipo === 'ingreso' ? '+' : (m.tipo === 'gasto' ? m.monto > 0 : m.monto >= 0) ? (m.tipo === 'gasto' ? '−' : '+') : (m.tipo === 'gasto' ? '+' : '−')) + esc(monto(Object.assign({}, m, { monto: Math.abs(m.monto) }))) + '</div></a>').join('');
  }
  function pantallaInicio() {
    const res = resumenMes();
    const ult = S.movs.slice().sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : (a.modificado || '') < (b.modificado || '') ? 1 : -1)).slice(0, 5);
    app.innerHTML =
      '<h1>' + (S.quien ? 'Hola, ' + esc(S.quien) : 'Hola') + ' 👋</h1>' +
      '<div class="grilla">' +
      '<a class="grande g-gasto" href="#gasto"><span class="ico">🧾</span>Cargar un gasto</a>' +
      '<a class="grande g-ingreso" href="#ingreso"><span class="ico">💰</span>Cargar un ingreso</a>' +
      '<a class="grande g-animal" href="#animales"><span class="ico">🐂</span>Animales</a>' +
      '<a class="grande g-result" href="#panel"><span class="ico">📈</span>Panel</a></div>' +
      '<div class="grilla" style="margin-top:12px"><a class="grande g-sec" href="#resultados">📊 Resultados en detalle</a><a class="grande g-sec" href="#movs">📋 Ver todos los movimientos</a></div>' +
      '<div class="grilla" style="margin-top:12px">' +
      '<a class="grande g-sec" href="#ajustes">⚙️ Ajustes</a>' + ((S.config.personas || []).length >= 2 ? '<a class="grande g-sec" href="#socios">🤝 Cuenta entre socios</a>' : '') + '</div>' +
      (S.config.usaLotes ? '<a class="grande g-animal" href="#lotes" style="margin-top:12px;display:block"><span class="ico">📦</span>Lotes de hacienda</a>' : '') +
      '<a class="btn sec" href="#ayuda" style="margin-top:12px">❓ Cómo se usa esta app</a>' +
      '<h2>Este mes (' + esc(G.mesLargo(G.hoy().slice(0, 7))) + ')</h2>' +
      (res.length ? res.map(x => '<div class="tarjeta"><div class="nota">' + (x.mon === 'USD' ? 'Dólares' : 'Pesos') + '</div><div class="cifras">' +
        '<div class="cifra"><small>Ingresos</small><b class="pos">' + esc(G.fmtMonto(x.r.ingresos, x.mon)) + '</b></div>' +
        '<div class="cifra"><small>Gastos</small><b class="neg">' + esc(G.fmtMonto(x.r.gastos, x.mon)) + '</b></div>' +
        '<div class="cifra"><small>Resultado</small><b class="' + (x.r.resultado >= 0 ? 'pos' : 'neg') + '">' + esc(G.fmtMonto(x.r.resultado, x.mon)) + '</b></div></div></div>').join('')
        : '<p class="nota">Todavía no hay movimientos este mes.</p>') +
      (ult.length ? '<h2>Lo último que se cargó</h2><div class="tarjeta">' + filasMov(ult, true) + '</div>' : '');
  }

  // ---------- cargar / editar un movimiento ----------
  function pantallaMov(tipo, mov, animalPre, lotePre) {
    const edit = !!mov;
    const esGasto = tipo === 'gasto';
    const cats = esGasto ? S.config.catGasto : S.config.catIngreso;
    const m = mov || { id: nuevoId(), tipo, fecha: G.hoy(), monto: '', moneda: LS.get('gc-moneda') || 'UYU', categoria: '', detalle: '', contraparte: '', animalId: animalPre || '', loteId: lotePre || '', fotoId: '' };
    const est = { moneda: m.moneda, categoria: m.categoria, fotoId: m.fotoId, fs: m.fs || '', fotoNueva: null, guardando: false };
    const contrapartes = Array.from(new Set(S.movs.filter(x => x.tipo === tipo && x.contraparte).map(x => x.contraparte))).slice(0, 60);
    const animalesOpc = S.animales.slice().sort((a, b) => (a.estado === 'Activo' ? 0 : 1) - (b.estado === 'Activo' ? 0 : 1) || a.nombre.localeCompare(b.nombre));

    app.innerHTML = encabezado((edit ? 'Modificar ' : 'Cargar ') + (esGasto ? 'un gasto' : 'un ingreso'), edit ? '#movs' : '#inicio') +
      '<form id="f-mov">' +
      '<label class="campo monto">Monto<input id="m-monto" type="text" inputmode="decimal" autocomplete="off" placeholder="0" value="' + esc(m.monto === '' ? '' : String(Math.abs(m.monto)).replace('.', ',')) + '"></label>' + (m.monto < 0 ? '<p class="nota">Este movimiento es un descuento o devolución (resta del gasto).</p>' : '') +
      '<div class="seg ' + (esGasto ? 'rojo' : '') + '" id="m-moneda"><button type="button" data-v="UYU">$ Pesos</button><button type="button" data-v="USD">US$ Dólares</button></div>' +
      '<div class="campo">' + (esGasto ? '¿En qué fue el gasto?' : '¿Qué tipo de ingreso es?') + '<div class="chips" id="m-cats"></div></div>' +
      '<label class="campo">Fecha<input id="m-fecha" type="date" value="' + esc(m.fecha) + '"></label>' +
      '<label class="campo">' + (esGasto ? 'Proveedor o lugar de la compra (opcional)' : 'Comprador o quién pagó (opcional)') + '<input id="m-contra" type="text" list="dl-contra" autocomplete="off" value="' + esc(m.contraparte) + '"></label>' +
      '<datalist id="dl-contra">' + contrapartes.map(c => '<option value="' + esc(c) + '">').join('') + '</datalist>' +
      '<label class="campo">Detalle (opcional)<input id="m-detalle" type="text" autocomplete="off" placeholder="' + (esGasto ? 'Ej.: 20 fardos de pasto' : 'Ej.: venta del toro Pampero') + '" value="' + esc(m.detalle) + '"></label>' +
      (S.config.usaLotes ? '<label class="campo">¿Es de un lote? (opcional)<select id="m-lote"><option value="">No, es un gasto general</option>' +
        S.lotes.slice().sort((x, y) => (x.estado === 'Activo' ? 0 : 1) - (y.estado === 'Activo' ? 0 : 1) || x.nombre.localeCompare(y.nombre)).map(l => '<option value="' + esc(l.id) + '"' + (l.id === m.loteId ? ' selected' : '') + '>' + esc(l.nombre) + (l.estado !== 'Activo' ? ' (cerrado)' : '') + '</option>').join('') + '</select></label>' : '') +
      '<label class="campo">¿Es para un animal en particular? (opcional)<select id="m-animal"><option value="">No, es un gasto general</option>' +
      animalesOpc.map(a => '<option value="' + esc(a.id) + '"' + (a.id === m.animalId ? ' selected' : '') + '>' + esc(a.nombre) + (a.estado !== 'Activo' ? ' (' + esc(a.estado.toLowerCase()) + ')' : '') + '</option>').join('') + '</select></label>' +
      ((S.config.personas || []).length ? '<label class="campo">' + (esGasto ? '¿Quién lo pagó?' : '¿Quién cobró?') + '<select id="m-socio"><option value="">—</option>' + S.config.personas.map(n => '<option value="' + esc(n) + '"' + (n === m.pagadoPor ? ' selected' : '') + '>' + esc(n) + '</option>').join('') + '</select></label>' : '') +
      '<label class="campo">N° de comprobante / fila de la planilla vieja (opcional)<input id="m-ref" type="text" autocomplete="off" value="' + esc(m.ref || '') + '"></label>' +
      '<label class="check" style="border:none"><input type="checkbox" id="m-verif"' + (m.verificado ? ' checked' : '') + '> <span><b>Verificado</b> <span class="nota">(tengo el comprobante y está controlado)</span></span></label>' +
      '<div class="campo">Foto del comprobante (opcional)<label class="btn-foto" id="m-fotobtn"><input type="file" id="m-foto" accept="image/*"><span id="m-fototxt">📷 Sacar o elegir una foto</span></label><div class="foto-prev" id="m-prev"></div></div>' +
      (edit && m.por ? '<p class="nota">Cargado por <b>' + esc(m.por) + '</b>' + (m.creado ? ' el ' + esc(G.fechaCorta(m.creado.slice(0, 10))) : '') + (m.modificadoPor ? ' · última modificación de <b>' + esc(m.modificadoPor) + '</b>' : '') + '.</p>' : '') +
      '<p class="neg" id="m-error"></p>' +
      '<button class="btn ' + (esGasto ? 'gasto' : '') + '" type="submit" id="m-guardar">' + (edit ? 'Guardar los cambios' : 'Guardar') + '</button>' +
      (edit ? '<button class="btn peligro" type="button" id="m-borrar">Eliminar este movimiento</button>' : '') +
      '</form>';

    function pintarMoneda() { app.querySelectorAll('#m-moneda button').forEach(b => b.classList.toggle('on', b.dataset.v === est.moneda)); }
    function pintarCats() {
      const lista = cats.slice();
      if (est.categoria && !lista.includes(est.categoria)) lista.push(est.categoria);
      $('#m-cats').innerHTML = lista.map(c => '<button type="button" class="chip' + (c === est.categoria ? ' on' : '') + '" data-c="' + esc(c) + '">' + esc(c) + '</button>').join('');
      app.querySelectorAll('#m-cats .chip').forEach(b => { b.onclick = () => { est.categoria = b.dataset.c; pintarCats(); }; });
    }
    function pintarFoto() {
      const prev = $('#m-prev');
      if (est.fotoNueva) prev.innerHTML = '<img alt="Foto" src="' + est.fotoNueva.vista + '"><button class="btn sec mini" type="button" id="m-quitarfoto" style="margin-top:8px">Quitar foto</button>';
      else if (est.fotoId) prev.innerHTML = '<img alt="Foto" src="' + urlFoto(est.fotoId, est.fs, false) + '" id="m-fotoact"><button class="btn sec mini" type="button" id="m-quitarfoto" style="margin-top:8px">Quitar foto</button>';
      else prev.innerHTML = '';
      const q = $('#m-quitarfoto'); if (q) q.onclick = () => { est.fotoNueva = null; est.fotoId = ''; pintarFoto(); };
      const fa = $('#m-fotoact'); if (fa) fa.onclick = () => abrirVisor(fa.src);
      $('#m-fototxt').textContent = (est.fotoNueva || est.fotoId) ? '📷 Cambiar la foto' : '📷 Sacar o elegir una foto';
    }
    pintarMoneda(); pintarCats(); pintarFoto();
    app.querySelectorAll('#m-moneda button').forEach(b => { b.onclick = () => { est.moneda = b.dataset.v; pintarMoneda(); }; });

    $('#m-foto').onchange = async ev => {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      try {
        const vista = await reducirFoto(f, 700, 0.6);
        est.fotoNueva = { file: f, vista };
        pintarFoto();
      } catch (e) { aviso('No se pudo leer esa foto. Probá con otra.', true); }
      ev.target.value = '';
    };

    if (edit) $('#m-borrar').onclick = async () => {
      if (!confirm('¿Eliminar este movimiento? No se puede deshacer.')) return;
      try {
        await api('movs', { accion: 'borrar', id: m.id });
        S.movs = S.movs.filter(x => x.id !== m.id);
        aviso('Eliminado');
        location.hash = '#movs';
      } catch (e) { aviso(e.message, true); }
    };

    $('#f-mov').onsubmit = async ev => {
      ev.preventDefault();
      if (est.guardando) return;
      const err = $('#m-error'); err.textContent = '';
      const negativo = edit && Number(m.monto) < 0; // descuentos o devoluciones: conservan el signo
      const valor = G.parseMonto($('#m-monto').value) * (negativo ? -1 : 1);
      if (!(Math.abs(valor) > 0)) { err.textContent = 'Escribí el monto.'; $('#m-monto').focus(); return; }
      if (!est.categoria) { err.textContent = 'Elegí en qué fue (tocá una de las opciones).'; return; }
      if (!$('#m-fecha').value) { err.textContent = 'Falta la fecha.'; return; }
      est.guardando = true;
      const btn = $('#m-guardar'); btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        let fotoId = est.fotoId, fs = est.fs;
        if (est.fotoNueva) {
          btn.textContent = 'Subiendo la foto…';
          const r = await subirFoto(est.fotoNueva.file);
          fotoId = r.id; fs = r.s;
          est.fotoNueva = null; est.fotoId = fotoId; est.fs = fs; // si falla el guardado, no se vuelve a subir
        }
        btn.textContent = 'Guardando…';
        const nuevo = {
          id: m.id, tipo, fecha: $('#m-fecha').value, monto: valor, moneda: est.moneda, categoria: est.categoria,
          detalle: $('#m-detalle').value, contraparte: $('#m-contra').value, animalId: $('#m-animal').value, loteId: $('#m-lote') ? $('#m-lote').value : (m.loteId || ''), fotoId,
          por: S.quien, creado: m.creado,
          ref: $('#m-ref').value, verificado: $('#m-verif').checked, pagadoPor: $('#m-socio') ? $('#m-socio').value : (m.pagadoPor || ''), tc: m.tc || 0
        };
        const r = await api('movs', { accion: 'guardar', mov: nuevo });
        const i = S.movs.findIndex(x => x.id === r.mov.id);
        if (i >= 0) S.movs[i] = r.mov; else S.movs.push(r.mov);
        LS.set('gc-moneda', est.moneda);
        await proponerVendido(r.mov);
        if (edit) { aviso('Cambios guardados ✅'); location.hash = '#movs'; }
        else pantallaGuardado(r.mov);
      } catch (e) {
        est.guardando = false; btn.disabled = false; btn.textContent = edit ? 'Guardar los cambios' : 'Guardar';
        err.textContent = e.message;
      }
    };
  }

  // Si se cargó la venta de un animal, ofrece marcarlo como vendido.
  async function proponerVendido(m) {
    if (m.tipo !== 'ingreso' || !m.animalId || !/venta/i.test(m.categoria)) return;
    const a = animalPorId(m.animalId);
    if (!a || a.estado !== 'Activo') return;
    if (!confirm('¿Marcar a "' + a.nombre + '" como vendido?')) return;
    try {
      const r = await api('animales', { accion: 'guardar', animal: Object.assign({}, a, { estado: 'Vendido', fechaBaja: m.fecha }) });
      Object.assign(a, r.animal);
    } catch (e) { aviso('No se pudo actualizar el animal: ' + e.message, true); }
  }

  function pantallaGuardado(m) {
    app.innerHTML = '<div class="ok-grande"><div class="tilde">✅</div><h1>Guardado</h1>' +
      '<p>' + esc(m.categoria) + ' · <b>' + esc(monto(m)) + '</b><br><span class="nota">' + esc(G.fechaCorta(m.fecha)) + '</span></p></div>' +
      '<a class="btn ' + (m.tipo === 'gasto' ? 'gasto' : '') + '" href="#' + m.tipo + '" id="b-otro">Cargar otro ' + (m.tipo === 'gasto' ? 'gasto' : 'ingreso') + '</a>' +
      '<a class="btn sec" href="#inicio">Volver al inicio</a>';
    $('#b-otro').onclick = ev => { ev.preventDefault(); location.hash = '#' + m.tipo; pantallaMov(m.tipo); };
  }

  // ---------- lista de movimientos ----------
  const filtroMovs = { mes: 'todos', tipo: 'todos', texto: '', por: 'todos' };
  function pantallaMovs() {
    app.innerHTML = encabezado('Movimientos', '#inicio') +
      '<div class="fila"><select id="f-mes" class="ancho" style="flex:1;margin:0"></select></div>' +
      '<div class="chips" id="f-tipo"></div><div class="chips" id="f-por"></div>' +
      '<input class="ancho" id="f-texto" type="search" placeholder="Buscar por detalle, proveedor, categoría…" value="' + esc(filtroMovs.texto) + '" style="margin-top:10px">' +
      '<div class="tarjeta" id="f-lista"></div>' +
      '<p class="nota" id="f-total"></p>';
    const meses = Array.from(new Set(S.movs.map(m => m.fecha.slice(0, 7)))).sort().reverse();
    $('#f-mes').innerHTML = '<option value="todos">Todos los meses</option>' + meses.map(ym => '<option value="' + ym + '"' + (ym === filtroMovs.mes ? ' selected' : '') + '>' + esc(G.mesLargo(ym)) + '</option>').join('');
    const tipos = [['todos', 'Todos'], ['gasto', 'Gastos'], ['ingreso', 'Ingresos'], ['ajuste', 'Ajustes'], ['sinver', 'Sin verificar']];
    function pintar() {
      $('#f-tipo').innerHTML = tipos.map(t => '<button type="button" class="chip sm' + (filtroMovs.tipo === t[0] ? ' on' : '') + '" data-t="' + t[0] + '">' + t[1] + '</button>').join('');
      app.querySelectorAll('#f-tipo .chip').forEach(b => { b.onclick = () => { filtroMovs.tipo = b.dataset.t; pintar(); }; });
      const quienes = Array.from(new Set(S.movs.map(m => m.por).filter(Boolean))).sort();
      $('#f-por').innerHTML = quienes.length > 1 ? ['todos'].concat(quienes).map(n => '<button type="button" class="chip sm' + (filtroMovs.por === n ? ' on' : '') + '" data-p="' + esc(n) + '">' + (n === 'todos' ? '👤 Todos' : esc(n)) + '</button>').join('') : '';
      app.querySelectorAll('#f-por .chip').forEach(b => { b.onclick = () => { filtroMovs.por = b.dataset.p; pintar(); }; });
      const q = filtroMovs.texto.trim().toLowerCase();
      let lista = S.movs.filter(m => (filtroMovs.por === 'todos' || m.por === filtroMovs.por) && (filtroMovs.mes === 'todos' || m.fecha.slice(0, 7) === filtroMovs.mes) && (filtroMovs.tipo === 'todos' || (filtroMovs.tipo === 'sinver' ? !m.verificado && m.tipo !== 'ajuste' : m.tipo === filtroMovs.tipo)) &&
        (!q || [m.categoria, m.detalle, m.contraparte, m.por, m.ref, m.pagadoPor, nombreAnimal(m.animalId)].join(' ').toLowerCase().includes(q)));
      lista.sort((a, b) => (a.fecha < b.fecha ? 1 : a.fecha > b.fecha ? -1 : 0));
      $('#f-lista').innerHTML = lista.length ? filasMov(lista.slice(0, 300), true) : '<p class="nota">No hay movimientos con ese filtro.</p>';
      const tot = ['UYU', 'USD'].map(mon => { const r = G.resumen(lista, mon, 1); return r.n ? mon === 'USD' ? 'US$: ' + G.fmtMonto(r.resultado, 'USD') : '$: ' + G.fmtMonto(r.resultado, 'UYU') : ''; }).filter(Boolean);
      $('#f-total').textContent = lista.length + ' movimientos' + (lista.length > 300 ? ' (se muestran los 300 más recientes)' : '') + (tot.length ? ' · Resultado: ' + tot.join(' · ') : '');
    }
    $('#f-mes').onchange = ev => { filtroMovs.mes = ev.target.value; pintar(); };
    $('#f-texto').oninput = ev => { filtroMovs.texto = ev.target.value; pintar(); };
    pintar();
  }

  // ---------- animales ----------
  const filtroAnim = { estado: 'Activo' };
  function pantallaAnimales() {
    app.innerHTML = encabezado('Animales', '#inicio') +
      '<a class="btn" href="#animal/nuevo" style="margin-top:0">➕ Agregar un animal</a>' +
      '<a class="btn sec" href="#importar" style="margin-top:10px">📥 Importar lecturas del bastón</a>' +
      '<div class="chips" id="a-fil"></div><div class="tarjeta" id="a-lista"></div>';
    function pintar() {
      const op = [['Activo', 'En el campo'], ['Vendido', 'Vendidos'], ['Fallecido', 'Fallecidos'], ['todos', 'Todos']];
      $('#a-fil').innerHTML = op.map(o => '<button type="button" class="chip sm' + (filtroAnim.estado === o[0] ? ' on' : '') + '" data-e="' + o[0] + '">' + o[1] + '</button>').join('');
      app.querySelectorAll('#a-fil .chip').forEach(b => { b.onclick = () => { filtroAnim.estado = b.dataset.e; pintar(); }; });
      const lista = S.animales.filter(a => filtroAnim.estado === 'todos' || a.estado === filtroAnim.estado).sort((a, b) => a.nombre.localeCompare(b.nombre));
      $('#a-lista').innerHTML = lista.length ? lista.map(a =>
        '<a class="mov" href="#animal/' + esc(a.id) + '"><div class="izq"><div class="cat">' + esc(a.nombre) + '</div>' +
        '<div class="sub">' + [a.categoria || a.especie, a.raza, a.caravana ? 'Caravana ' + a.caravana : ''].filter(Boolean).map(esc).join(' · ') + '</div></div>' +
        (a.fotoId ? '<img class="miniatura" alt="" loading="lazy" src="' + urlFoto(a.fotoId, a.fs, true) + '">' : '') +
        '<span class="badge ' + a.estado.toLowerCase() + '">' + esc(a.estado) + '</span></a>').join('') : '<p class="nota">No hay animales en esta lista.</p>';
    }
    pintar();
  }

  const CATEG_ANIMAL = { Bovino: ['Toro', 'Vaca', 'Vaquillona', 'Novillo', 'Ternero', 'Ternera'], Ovino: ['Carnero', 'Oveja', 'Borrego', 'Borrega', 'Cordero', 'Cordera'], Otro: [] };
  function pantallaAnimal(id) {
    const nuevo = id === 'nuevo';
    const a = nuevo ? { id: nuevoId(), nombre: '', especie: 'Bovino', categoria: '', caravana: '', raza: '', nacimiento: '', origen: '', estado: 'Activo', fechaBaja: '', notas: '', fotoId: '', fs: '' } : animalPorId(id);
    if (!a) { app.innerHTML = encabezado('Animal', '#animales') + '<p>No se encontró ese animal.</p>'; return; }
    const est = { fotoId: a.fotoId, fs: a.fs || '', fotoNueva: null, guardando: false };
    const campo = (rot, idc, val, extra) => '<label class="campo">' + rot + '<input id="' + idc + '" type="text" autocomplete="off" value="' + esc(val) + '" ' + (extra || '') + '></label>';
    app.innerHTML = encabezado(nuevo ? 'Agregar un animal' : a.nombre, '#animales') +
      '<form id="f-animal">' +
      campo('Nombre o identificación', 'a-nombre', a.nombre, 'placeholder="Ej.: Pampero"') +
      '<label class="campo">Especie<select id="a-especie">' + ['Bovino', 'Ovino', 'Otro'].map(e => '<option' + (e === a.especie ? ' selected' : '') + '>' + e + '</option>').join('') + '</select></label>' +
      '<label class="campo">Categoría<input id="a-cat" type="text" list="dl-cat" autocomplete="off" value="' + esc(a.categoria) + '" placeholder="Toro, Oveja, Cordero…"></label><datalist id="dl-cat"></datalist>' +
      campo('Caravana / RP (opcional)', 'a-caravana', a.caravana) +
      campo('Raza (opcional)', 'a-raza', a.raza) +
      '<label class="campo">Fecha de nacimiento (opcional)<input id="a-nac" type="date" value="' + esc(a.nacimiento) + '"></label>' +
      campo('Origen: de dónde vino (opcional)', 'a-origen', a.origen, 'placeholder="Ej.: nacido en el campo / comprado a …"') +
      '<label class="campo">Estado<select id="a-estado">' + ['Activo', 'Vendido', 'Fallecido'].map(e => '<option' + (e === a.estado ? ' selected' : '') + '>' + e + '</option>').join('') + '</select></label>' +
      '<label class="campo" id="a-baja-w">Fecha de la venta o baja<input id="a-baja" type="date" value="' + esc(a.fechaBaja) + '"></label>' +
      '<label class="campo">Notas (opcional)<textarea id="a-notas">' + esc(a.notas) + '</textarea></label>' +
      '<div class="campo">Foto del animal (opcional)<label class="btn-foto"><input type="file" id="a-foto" accept="image/*"><span id="a-fototxt">📷 Sacar o elegir una foto</span></label><div class="foto-prev" id="a-prev"></div></div>' +
      '<p class="neg" id="a-error"></p>' +
      '<button class="btn" type="submit" id="a-guardar">' + (nuevo ? 'Guardar el animal' : 'Guardar los cambios') + '</button>' +
      (nuevo ? '' : '<button class="btn peligro" type="button" id="a-borrar">Eliminar este animal</button>') + '</form>' +
      (nuevo ? '' : '<div id="a-movs"></div>');

    function pintarCat() {
      $('#dl-cat').innerHTML = (CATEG_ANIMAL[$('#a-especie').value] || []).map(c => '<option value="' + c + '">').join('');
    }
    function pintarBaja() { $('#a-baja-w').classList.toggle('oculto', $('#a-estado').value === 'Activo'); }
    function pintarFoto() {
      const prev = $('#a-prev');
      const src = est.fotoNueva ? est.fotoNueva.vista : est.fotoId ? urlFoto(est.fotoId, est.fs, false) : '';
      prev.innerHTML = src ? '<img alt="Foto" src="' + src + '"><button class="btn sec mini" type="button" id="a-quitar" style="margin-top:8px">Quitar foto</button>' : '';
      const q = $('#a-quitar'); if (q) q.onclick = () => { est.fotoNueva = null; est.fotoId = ''; pintarFoto(); };
      $('#a-fototxt').textContent = src ? '📷 Cambiar la foto' : '📷 Sacar o elegir una foto';
    }
    $('#a-especie').onchange = pintarCat; $('#a-estado').onchange = pintarBaja;
    pintarCat(); pintarBaja(); pintarFoto();
    $('#a-foto').onchange = async ev => {
      const f = ev.target.files && ev.target.files[0];
      if (!f) return;
      try { est.fotoNueva = { file: f, vista: await reducirFoto(f, 700, 0.6) }; pintarFoto(); } catch (e) { aviso('No se pudo leer esa foto.', true); }
      ev.target.value = '';
    };

    if (!nuevo) {
      $('#a-borrar').onclick = async () => {
        const n = S.movs.filter(m => m.animalId === a.id).length;
        if (!confirm('¿Eliminar a "' + a.nombre + '"?' + (n ? '\n\nTiene ' + n + ' movimientos asociados: no se borran, quedan como gastos o ingresos generales.' : ''))) return;
        try {
          await api('animales', { accion: 'borrar', id: a.id });
          S.animales = S.animales.filter(x => x.id !== a.id);
          S.movs.forEach(m => { if (m.animalId === a.id) m.animalId = ''; });
          aviso('Animal eliminado'); location.hash = '#animales';
        } catch (e) { aviso(e.message, true); }
      };
      const mm = S.movs.filter(m => m.animalId === a.id).sort((x, y) => (x.fecha < y.fecha ? 1 : -1));
      const monedas = ['UYU', 'USD'].map(mon => ({ mon, r: G.resumen(mm, mon, 1) })).filter(x => x.r.n);
      $('#a-movs').innerHTML = '<h2>Gastos e ingresos de este animal</h2>' +
        (monedas.length ? monedas.map(x => '<div class="tarjeta"><div class="cifras"><div class="cifra"><small>Ingresos ' + x.mon + '</small><b class="pos">' + esc(G.fmtMonto(x.r.ingresos, x.mon)) + '</b></div>' +
          '<div class="cifra"><small>Gastos ' + x.mon + '</small><b class="neg">' + esc(G.fmtMonto(x.r.gastos, x.mon)) + '</b></div>' +
          '<div class="cifra"><small>Resultado</small><b class="' + (x.r.resultado >= 0 ? 'pos' : 'neg') + '">' + esc(G.fmtMonto(x.r.resultado, x.mon)) + '</b></div></div></div>').join('') +
          '<div class="tarjeta">' + filasMov(mm, false) + '</div>' : '<p class="nota">Todavía no hay gastos ni ingresos cargados para este animal.</p>') +
        '<div class="grilla"><a class="btn gasto" href="#gasto?animal=' + esc(a.id) + '">🧾 Cargar un gasto</a><a class="btn" href="#ingreso?animal=' + esc(a.id) + '">💰 Cargar un ingreso</a></div>';
    }

    $('#f-animal').onsubmit = async ev => {
      ev.preventDefault();
      if (est.guardando) return;
      const err = $('#a-error'); err.textContent = '';
      if (!$('#a-nombre').value.trim()) { err.textContent = 'Escribí el nombre o la identificación del animal.'; return; }
      est.guardando = true;
      const btn = $('#a-guardar'); btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        let fotoId = est.fotoId, fs = est.fs;
        if (est.fotoNueva) { const r = await subirFoto(est.fotoNueva.file); fotoId = r.id; fs = r.s; est.fotoNueva = null; est.fotoId = fotoId; est.fs = fs; }
        const datos = {
          id: a.id, nombre: $('#a-nombre').value, especie: $('#a-especie').value, categoria: $('#a-cat').value, caravana: $('#a-caravana').value,
          raza: $('#a-raza').value, nacimiento: $('#a-nac').value, origen: $('#a-origen').value, estado: $('#a-estado').value,
          fechaBaja: $('#a-estado').value === 'Activo' ? '' : $('#a-baja').value, notas: $('#a-notas').value, fotoId
        };
        const r = await api('animales', { accion: 'guardar', animal: datos });
        const i = S.animales.findIndex(x => x.id === r.animal.id);
        if (i >= 0) S.animales[i] = r.animal; else S.animales.push(r.animal);
        aviso('Guardado ✅');
        location.hash = '#animales';
      } catch (e) {
        est.guardando = false; btn.disabled = false; btn.textContent = nuevo ? 'Guardar el animal' : 'Guardar los cambios';
        err.textContent = e.message;
      }
    };
  }

  // ---------- importar lecturas de caravanas ----------
  function pantallaImportar() {
    const est = { lect: null, marcados: new Set(), subiendo: false };
    app.innerHTML = encabezado('Importar lecturas del bastón', '#animales') +
      '<p class="nota">Cargá el archivo (TXT o CSV) que sale del lector, o pegá la lista de números. La app detecta los números, <b>saltea los que ya existen</b> y te muestra todo antes de dar de alta.</p>' +
      '<div class="tarjeta"><h2 style="margin-top:0">1. Datos para todo el lote</h2>' +
      '<label class="campo">Especie<select id="i-esp"><option>Bovino</option><option>Ovino</option><option>Otro</option></select></label>' +
      '<label class="campo">Categoría (opcional)<input id="i-cat" type="text" list="dl-icat" autocomplete="off" placeholder="Toro, Oveja, Vaquillona…"></label><datalist id="dl-icat"></datalist>' +
      '<label class="campo">Raza (opcional)<input id="i-raza" type="text" autocomplete="off"></label>' +
      (S.config.usaLotes ? '<label class="campo">Lote (opcional)<select id="i-lote"><option value="">Sin lote</option>' + S.lotes.filter(l => l.estado === 'Activo').map(l => '<option value="' + esc(l.id) + '">' + esc(l.nombre) + '</option>').join('') + '</select></label>' : '') +
      '<label class="campo">Origen (opcional)<input id="i-origen" type="text" autocomplete="off" placeholder="Ej.: nacido en el campo"></label>' +
      '<p class="nota">Después se puede corregir animal por animal. Si el lote es mezclado, importá por tandas (por ejemplo, primero los bovinos y después los ovinos).</p></div>' +
      '<div class="tarjeta"><h2 style="margin-top:0">2. Las lecturas</h2>' +
      '<div class="campo">Archivo del lector<label class="btn-foto"><input type="file" id="i-arch" accept=".txt,.csv,.tsv,.log,text/plain,text/csv"><span>📄 Elegir el archivo</span></label></div>' +
      '<label class="campo">…o pegá la lista acá<textarea id="i-texto" style="min-height:120px" placeholder="982000123456789&#10;982000123456790"></textarea></label>' +
      '<button class="btn" type="button" id="i-revisar">Revisar las lecturas</button></div>' +
      '<div id="i-res"></div>';
    const catEsp = { Bovino: ['Toro', 'Vaca', 'Vaquillona', 'Novillo', 'Ternero', 'Ternera'], Ovino: ['Carnero', 'Oveja', 'Borrego', 'Borrega', 'Cordero', 'Cordera'], Otro: [] };
    const pintarCat = () => { $('#dl-icat').innerHTML = (catEsp[$('#i-esp').value] || []).map(c => '<option value="' + c + '">').join(''); };
    $('#i-esp').onchange = pintarCat; pintarCat();

    $('#i-arch').onchange = async ev => {
      const f = ev.target.files && ev.target.files[0]; if (!f) return;
      try {
        $('#i-texto').value = await f.text();
        $('span', ev.target.parentNode).textContent = '📄 ' + f.name;
        aviso('Archivo leído. Tocá "Revisar las lecturas".');
      } catch (e) { aviso('No se pudo leer el archivo.', true); }
    };

    $('#i-revisar').onclick = async () => {
      try { const r = await api('animales'); S.animales = r.animales; } catch (e) { /* se usa lo que ya estaba cargado; el servidor igual controla duplicados */ }
      const texto = $('#i-texto').value;
      const lect = G.leerLecturas(texto);
      if (!lect.items.length) { $('#i-res').innerHTML = '<p class="neg">No encontré números de caravana. Revisá el archivo o la lista pegada.</p>'; return; }
      lect.nuevos = []; lect.existen = []; lect.parecidos = [];
      for (const it of lect.items) {
        const d = G.buscarDuplicado(it.norm, S.animales);
        if (!d) lect.nuevos.push(it);
        else if (d.tipo === 'igual') lect.existen.push({ it, animal: d.animal });
        else lect.parecidos.push({ it, animal: d.animal });
      }
      est.lect = lect; est.marcados = new Set();
      pintarRes();
    };

    function pintarRes() {
      const L = est.lect, cont = $('#i-res');
      const cortos = L.nuevos.filter(x => !x.largo).length;
      const nAlta = L.nuevos.length + est.marcados.size;
      cont.innerHTML = '<h2>3. Revisá antes de dar de alta</h2><div class="tarjeta"><div class="cifras">' +
        '<div class="cifra"><small>Nuevos</small><b class="pos">' + L.nuevos.length + '</b></div>' +
        '<div class="cifra"><small>Ya existen</small><b>' + L.existen.length + '</b></div>' +
        '<div class="cifra"><small>Repetidos</small><b>' + L.repetidos + '</b></div></div>' +
        '<p class="nota">Leídos: ' + (L.items.length + L.repetidos) + ' líneas con número' + (L.repetidos ? ' · ' + L.repetidos + ' repetidos en el archivo (se cuentan una sola vez)' : '') + (L.ignoradas ? ' · ' + L.ignoradas + ' líneas sin número ignoradas' : '') + '.</p></div>' +
        (L.parecidos.length ? '<div class="tarjeta"><h2 style="margin-top:0">⚠️ Posibles duplicados (' + L.parecidos.length + ')</h2><p class="nota">Estos números se parecen a un animal que ya está cargado (uno corto contra el número largo completo). <b>No se dan de alta</b> salvo que los marques.</p>' +
          L.parecidos.map((p, i) => '<label class="check"><input type="checkbox" data-i="' + i + '"' + (est.marcados.has(p.it.norm) ? ' checked' : '') + '> <span><b>' + esc(p.it.numero) + '</b><br><span class="nota">Se parece a ' + esc(p.animal.nombre) + ' (' + esc(p.animal.caravana) + ')</span></span></label>').join('') + '</div>' : '') +
        (L.existen.length ? '<details class="tarjeta"><summary><b>Ya existen y se saltean (' + L.existen.length + ')</b></summary>' +
          L.existen.slice(0, 200).map(x => '<div class="nota">' + esc(x.it.numero) + ' → ' + esc(x.animal.nombre) + (x.animal.estado !== 'Activo' ? ' (' + esc(x.animal.estado.toLowerCase()) + ')' : '') + '</div>').join('') + '</details>' : '') +
        (L.nuevos.length ? '<details class="tarjeta"><summary><b>Se van a dar de alta (' + L.nuevos.length + ')</b></summary>' +
          L.nuevos.slice(0, 300).map(x => '<div class="nota">' + esc(x.numero) + (x.largo ? '' : ' · número corto') + '</div>').join('') + '</details>' : '') +
        (cortos ? '<p class="nota">ℹ️ ' + cortos + ' lecturas no tienen el formato largo de 15 dígitos. Revisá que sean caravanas y no otros datos del archivo (como fechas u horas).</p>' : '') +
        '<p class="nota">Cada animal queda con el nombre provisorio <b>"Nº" + los últimos 6 dígitos</b> (por ejemplo, Nº 456789) y el número completo en el campo caravana. Después podés ponerle el nombre real.</p>' +
        '<p class="neg" id="i-error"></p>' +
        '<button class="btn" type="button" id="i-alta"' + (nAlta ? '' : ' disabled') + '>' + (nAlta ? 'Dar de alta ' + nAlta + ' animales' : 'No hay animales nuevos para dar de alta') + '</button>';
      cont.querySelectorAll('input[data-i]').forEach(cb => { cb.onchange = () => { const p = L.parecidos[Number(cb.dataset.i)]; if (cb.checked) est.marcados.add(p.it.norm); else est.marcados.delete(p.it.norm); pintarRes(); window.scrollTo(0, document.body.scrollHeight); }; });
      const b = $('#i-alta'); if (b && nAlta) b.onclick = alta;
    }

    async function alta() {
      if (est.subiendo) return; est.subiendo = true;
      const L = est.lect, btn = $('#i-alta'); btn.disabled = true; btn.textContent = 'Dando de alta…';
      const base = { especie: $('#i-esp').value, categoria: $('#i-cat').value.trim(), raza: $('#i-raza').value.trim(), loteId: $('#i-lote') ? $('#i-lote').value : '', origen: $('#i-origen').value.trim(), estado: 'Activo' };
      const items = L.nuevos.concat(L.parecidos.filter(p => est.marcados.has(p.it.norm)).map(p => p.it));
      const lote = items.map(it => Object.assign({ id: nuevoId(), nombre: G.nombreDeLectura(it), caravana: it.numero }, base));
      let creados = 0, omitidos = [];
      try {
        for (let i = 0; i < lote.length; i += 200) {
          const r = await api('animales', { accion: 'importar', animales: lote.slice(i, i + 200) });
          creados += r.creados; omitidos = omitidos.concat(r.omitidos);
          btn.textContent = 'Dando de alta… ' + Math.min(i + 200, lote.length) + ' de ' + lote.length;
        }
        const a = await api('animales'); S.animales = a.animales;
        app.innerHTML = '<div class="ok-grande"><div class="tilde">✅</div><h1>' + creados + ' animales dados de alta</h1>' +
          (omitidos.length ? '<p class="nota">' + omitidos.length + ' se saltearon porque ya existían.</p>' : '') +
          '<p class="nota">Tienen nombre provisorio (Nº + últimos 6 dígitos). Entrá a cada ficha para ponerle el nombre real, la raza y la fecha de nacimiento.</p></div>' +
          '<a class="btn" href="#animales">Ver los animales</a><a class="btn sec" href="#importar" id="i-otro">Importar otro archivo</a>';
        $('#i-otro').onclick = ev => { ev.preventDefault(); pantallaImportar(); };
      } catch (e) {
        est.subiendo = false;
        try { const a = await api('animales'); S.animales = a.animales; } catch (x) { /* nada */ }
        $('#i-error').textContent = 'Se cortó: ' + e.message + '. Tocá "Revisar las lecturas" de nuevo: los que ya se dieron de alta se saltean solos.';
        btn.disabled = false; btn.textContent = 'Reintentar';
        btn.onclick = () => { $('#i-revisar').click(); };
      }
    }
  }

  // ---------- resultados ----------
  const estR = { periodo: 'anio', vista: null, desde: '', hasta: '' };
  function pantallaResultados() {
    const hayUSD = S.movs.some(m => m.moneda === 'USD'), hayUYU = S.movs.some(m => m.moneda === 'UYU');
    if (!estR.vista) estR.vista = hayUSD && hayUYU ? 'TODO_UYU' : hayUSD ? 'USD' : 'UYU';
    app.innerHTML = encabezado('Resultados', '#inicio') +
      '<div class="chips" id="r-per"></div>' +
      '<div class="fila" id="r-rango" style="margin-top:8px"></div>' +
      '<label class="campo">Ver en<select id="r-vista"></select></label>' +
      '<div id="r-cuerpo"></div>';
    const pers = [['mes', 'Este mes'], ['mes-anterior', 'Mes anterior'], ['anio', 'Este año'], ['anio-anterior', 'Año anterior'], ['12m', 'Últimos 12 meses'], ['todo', 'Todo'], ['otro', 'Elegir fechas']];
    const vistas = [['UYU', 'Solo pesos ($)'], ['USD', 'Solo dólares (US$)'], ['TODO_UYU', 'Todo en pesos (convertido)'], ['TODO_USD', 'Todo en dólares (convertido)']];
    $('#r-vista').innerHTML = vistas.map(v => '<option value="' + v[0] + '"' + (v[0] === estR.vista ? ' selected' : '') + '>' + v[1] + '</option>').join('');
    $('#r-vista').onchange = ev => { estR.vista = ev.target.value; pintar(); };

    function pintar() {
      $('#r-per').innerHTML = pers.map(p => '<button type="button" class="chip sm' + (estR.periodo === p[0] ? ' on' : '') + '" data-p="' + p[0] + '">' + p[1] + '</button>').join('');
      app.querySelectorAll('#r-per .chip').forEach(b => { b.onclick = () => { estR.periodo = b.dataset.p; pintar(); }; });
      $('#r-rango').innerHTML = estR.periodo === 'otro'
        ? '<label class="campo" style="flex:1;margin:0">Desde<input type="date" id="r-d" value="' + esc(estR.desde) + '"></label><label class="campo" style="flex:1;margin:0">Hasta<input type="date" id="r-h" value="' + esc(estR.hasta) + '"></label>' : '';
      if (estR.periodo === 'otro') { $('#r-d').onchange = e => { estR.desde = e.target.value; pintar(); }; $('#r-h').onchange = e => { estR.hasta = e.target.value; pintar(); }; }
      const p = estR.periodo === 'otro' ? { desde: estR.desde || null, hasta: estR.hasta || null } : G.periodo(estR.periodo);
      const movs = S.movs.filter(m => G.enPeriodo(m, p));
      const tc = S.config.tc, v = estR.vista, mon = G.monedaDeVista(v);
      const res = G.resumen(movs, v, tc);
      const cuerpo = $('#r-cuerpo');
      if (!res.n) { cuerpo.innerHTML = '<p class="nota" style="margin-top:14px">No hay movimientos en este período' + (v === 'UYU' || v === 'USD' ? ' en esa moneda' : '') + '.</p>'; return; }
      const ind = G.indicadores(movs, S.animales, p, v, tc);
      const cg = G.porCategoria(movs, 'gasto', v, tc), ci = G.porCategoria(movs, 'ingreso', v, tc);
      const pm = G.porMes(movs, v, tc), pa = G.porAnimal(movs, S.animales, v, tc);
      const f = n => G.fmtMonto(n, mon);
      const rl = S.config.usaLotes ? resultadosPorLote(movs, v, tc) : [];
      const barras = (lista, cls) => lista.map(c => '<div class="barra-fila"><div class="t"><span>' + esc(c.categoria) + '</span><b>' + esc(f(c.total)) + ' <span class="nota">(' + Math.round(c.pct * 100) + '%)</span></b></div><div class="barra ' + cls + '"><i style="width:' + Math.max(2, Math.round(c.pct * 100)) + '%"></i></div></div>').join('');
      const maxMes = Math.max(1, ...pm.map(x => Math.max(x.gastos, x.ingresos)));
      cuerpo.innerHTML =
        (v.indexOf('TODO') === 0 ? '<p class="nota" style="margin-top:12px">Los montos en la otra moneda se convirtieron con un tipo de cambio de ' + esc(G.fmtNum(tc, 2)) + ' pesos por dólar (se cambia en Ajustes).</p>' : '') +
        '<div class="tarjeta"><div class="cifras">' +
        '<div class="cifra"><small>Ingresos</small><b class="pos">' + esc(f(res.ingresos)) + '</b></div>' +
        '<div class="cifra"><small>Gastos</small><b class="neg">' + esc(f(res.gastos)) + '</b></div>' +
        '<div class="cifra"><small>Resultado</small><b class="' + (res.resultado >= 0 ? 'pos' : 'neg') + '">' + esc(f(res.resultado)) + '</b></div></div></div>' +
        '<h2>Indicadores</h2><div class="tarjeta"><table class="t"><tbody>' +
        '<tr><td>Gasto promedio por mes</td><td><b>' + esc(f(ind.gastoMensual)) + '</b></td></tr>' +
        '<tr><td>Ingreso promedio por mes</td><td><b>' + esc(f(ind.ingresoMensual)) + '</b></td></tr>' +
        (ind.mayorGasto ? '<tr><td>Mayor rubro de gasto</td><td><b>' + esc(ind.mayorGasto.categoria) + ' (' + Math.round(ind.mayorGasto.pct * 100) + '%)</b></td></tr>' : '') +
        (ind.margen !== null ? '<tr><td>Margen (resultado / ingresos)</td><td><b>' + Math.round(ind.margen * 100) + '%</b></td></tr>' : '') +
        '<tr><td>Animales en el campo</td><td><b>' + ind.animalesActivos + '</b></td></tr>' +
        (ind.gastoPorCabeza !== null ? '<tr><td>Gasto por animal en el campo</td><td><b>' + esc(f(ind.gastoPorCabeza)) + '</b></td></tr>' : '') +
        '</tbody></table></div>' +
        (cg.length ? '<h2>En qué se gasta</h2><div class="tarjeta">' + barras(cg, '') + '</div>' : '') +
        (ci.length ? '<h2>De dónde vienen los ingresos</h2><div class="tarjeta">' + barras(ci, 'ing') + '</div>' : '') +
        (pm.length > 1 ? '<h2>Mes a mes</h2><div class="tarjeta"><div class="meses">' + pm.map(x => '<div class="mes"><div class="pares"><i class="g" title="Gastos" style="height:' + Math.round(x.gastos / maxMes * 120) + 'px"></i><i class="i" title="Ingresos" style="height:' + Math.round(x.ingresos / maxMes * 120) + 'px"></i></div>' + esc(G.mesTexto(x.mes)) + '</div>').join('') + '</div><div class="leyenda"><b class="g">■</b> Gastos &nbsp; <b class="i">■</b> Ingresos</div></div>' : '') +
        (pa.length ? '<h2>Resultado por animal</h2><div class="tarjeta"><table class="t"><thead><tr><th>Animal</th><th>Gastos</th><th>Ingresos</th><th>Resultado</th></tr></thead><tbody>' +
          pa.map(x => '<tr><td><a href="#animal/' + esc(x.animalId) + '">' + esc(x.animal.nombre) + '</a></td><td>' + esc(f(x.gastos)) + '</td><td>' + esc(f(x.ingresos)) + '</td><td class="' + (x.resultado >= 0 ? 'pos' : 'neg') + '"><b>' + esc(f(x.resultado)) + '</b></td></tr>').join('') +
          '</tbody></table><p class="nota">Incluye solo los movimientos que se marcaron como "para un animal en particular".</p></div>' : '') +
        (S.config.usaLotes && rl.length ? '<h2>Resultado por lote</h2><div class="tarjeta"><table class="t"><thead><tr><th>Lote</th><th>Gastos</th><th>Ingresos</th><th>Resultado</th></tr></thead><tbody>' +
          rl.map(x => '<tr><td><a href="#lote/' + esc(x.lote.id) + '">' + esc(x.lote.nombre) + '</a></td><td>' + esc(f(x.i.gastos)) + '</td><td>' + esc(f(x.i.ingresos)) + '</td><td class="' + (x.i.resultado >= 0 ? 'pos' : 'neg') + '"><b>' + esc(f(x.i.resultado)) + '</b></td></tr>').join('') + '</tbody></table></div>' : '') +
        '<button class="btn sec" type="button" id="r-csv">⬇️ Descargar los movimientos (para Excel)</button>';
      $('#r-csv').onclick = () => descargar('movimientos.csv', G.aCsv(movs, S.animales, S.lotes), 'text/csv;charset=utf-8');
    }
    pintar();
  }

  function descargar(nombre, texto, tipo) {
    const blob = new Blob([texto], { type: tipo });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = nombre;
    document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 2000);
  }

  // ---------- ajustes ----------
  function pantallaAjustes() {
    const c = S.config;
    app.innerHTML = encabezado('Ajustes', '#inicio') +
      '<form id="f-aj">' +
      '<label class="campo">Nombre del establecimiento<input id="j-nombre" type="text" value="' + esc(c.nombre) + '"></label>' +
      '<label class="check" style="border:none"><input type="checkbox" id="j-lotes"' + (c.usaLotes ? ' checked' : '') + '> <span><b>Manejar lotes de hacienda</b> (invernada)<br><span class="nota">Agrega los lotes con pesadas y su resultado: ganancia diaria de peso, costo por kilo y margen por cabeza.</span></span></label>' +
      '<button type="button" class="btn sec mini" id="j-plantilla" style="margin:6px 0 12px">Usar los rubros de invernada</button>' +
      '<div class="campo">Logo (opcional)<div class="logo-edit"><div id="j-logoprev"></div><label class="btn-foto"><input type="file" id="j-logo" accept="image/*"><span>🖼️ Elegir el logo</span></label></div></div>' +
      '<div class="campo">Color de la app<div class="chips" id="j-colores"></div><label class="campo" style="margin-top:8px">O elegí otro color<input type="color" id="j-color" value="' + esc(c.color || '#2f6b3a') + '" style="height:46px;padding:2px"></label></div>' +
      '<label class="campo">Tipo de cambio (pesos por dólar) para los resultados "todo en una moneda"<input id="j-tc" type="text" inputmode="decimal" value="' + esc(String(c.tc).replace('.', ',')) + '"></label>' +
      '<label class="campo">Socios (uno por línea, hasta 10). Se usan para saber quién pagó o cobró cada movimiento y para la cuenta entre socios.<textarea id="j-soc" style="min-height:70px">' + esc((c.personas || []).join('\n')) + '</textarea></label>' +
      '<label class="campo">Tipos de gasto (uno por línea)<textarea id="j-cg" style="min-height:170px">' + esc(c.catGasto.join('\n')) + '</textarea></label>' +
      '<label class="campo">Tipos de ingreso (uno por línea)<textarea id="j-ci" style="min-height:110px">' + esc(c.catIngreso.join('\n')) + '</textarea></label>' +
      '<p class="nota">Si cambiás el nombre de un tipo, los movimientos ya cargados conservan el nombre anterior.</p>' +
      '<p class="neg" id="j-error"></p><button class="btn" type="submit" id="j-guardar">Guardar los ajustes</button></form>' +
      '<h2>Carga inicial</h2><p class="nota">Para cargar de una vez los movimientos de una planilla anterior (archivo preparado).</p><a class="btn sec" href="#importarmovs">📥 Importar movimientos históricos</a>' +
      '<h2>Copia de seguridad</h2><p class="nota">Descarga todo lo cargado (movimientos, animales y ajustes) en un archivo. Conviene hacerlo de vez en cuando y guardarlo en el Drive. Las fotos no van en el archivo.</p>' +
      '<button class="btn sec" type="button" id="j-backup">⬇️ Descargar copia de seguridad</button>' +
      '<h2>Esta sesión</h2><p class="nota">Cargás como: <b>' + esc(S.quien || '(sin nombre)') + '</b></p>' +
      '<button class="btn sec" type="button" id="j-nombre-q">Cambiar mi nombre</button>' +
      '<button class="btn peligro" type="button" id="j-salir">Salir y olvidar la clave en este teléfono</button>';
    const est = { logo: c.logo || '', color: c.color || '#2f6b3a' };
    const PRESET = [['Verde campo', '#2f6b3a'], ['Oliva', '#6b7340'], ['Marrón', '#5a4636'], ['Azul', '#2f4f7a'], ['Bordó', '#7a2f3a'], ['Gris', '#4a5560']];
    function pintarMarcaAj() {
      $('#j-logoprev').innerHTML = est.logo ? '<img class="logo-prev" alt="Logo" src="' + est.logo + '"><br><button type="button" class="btn sec mini" id="j-logoq" style="margin-top:6px">Quitar el logo</button>' : '<span class="nota">Sin logo</span>';
      const q = $('#j-logoq'); if (q) q.onclick = () => { est.logo = ''; pintarMarcaAj(); };
      $('#j-colores').innerHTML = PRESET.map(p => '<button type="button" class="chip sm' + (est.color.toLowerCase() === p[1] ? ' on' : '') + '" data-c="' + p[1] + '"><i class="punto" style="background:' + p[1] + '"></i>' + p[0] + '</button>').join('');
      app.querySelectorAll('#j-colores .chip').forEach(b => { b.onclick = () => { est.color = b.dataset.c; $('#j-color').value = est.color; aplicarMarca({ nombre: $('#j-nombre').value, logo: est.logo, color: est.color }); pintarMarcaAj(); }; });
    }
    pintarMarcaAj();
    $('#j-plantilla').onclick = () => {
      if (!confirm('¿Reemplazar los tipos de gasto e ingreso por los de invernada? Los movimientos ya cargados no se tocan.')) return;
      $('#j-cg').value = ['Compra de hacienda', 'Pasturas y verdeos', 'Ración y suplementos', 'Sanidad / veterinario', 'Flete', 'Comisiones y gastos de venta', 'Arrendamiento', 'Personal / jornales', 'Combustible', 'Mantenimiento (alambrados, aguadas)', 'Impuestos y tasas', 'Otros'].join('\n');
      $('#j-ci').value = ['Venta de hacienda', 'Otros'].join('\n');
      $('#j-lotes').checked = true;
    };
    $('#j-color').oninput = ev => { est.color = ev.target.value; aplicarMarca({ nombre: $('#j-nombre').value, logo: est.logo, color: est.color }); pintarMarcaAj(); };
    $('#j-logo').onchange = async ev => {
      const f = ev.target.files && ev.target.files[0]; if (!f) return;
      try { est.logo = await logoAData(f); pintarMarcaAj(); aplicarMarca({ nombre: $('#j-nombre').value, logo: est.logo, color: est.color }); } catch (e) { aviso(e.message, true); }
      ev.target.value = '';
    };
    $('#f-aj').onsubmit = async ev => {
      ev.preventDefault();
      const err = $('#j-error'); err.textContent = '';
      const tc = G.parseMonto($('#j-tc').value);
      if (!(tc > 0)) { err.textContent = 'El tipo de cambio tiene que ser un número mayor a cero.'; return; }
      const lineas = id => $(id).value.split('\n').map(x => x.trim()).filter(Boolean);
      const btn = $('#j-guardar'); btn.disabled = true; btn.textContent = 'Guardando…';
      try {
        const r = await api('config', { config: { nombre: $('#j-nombre').value, usaLotes: $('#j-lotes').checked, logo: est.logo, color: est.color, tc, catGasto: lineas('#j-cg'), catIngreso: lineas('#j-ci'), personas: lineas('#j-soc') } });
        S.config = r.config; aplicarMarca(S.config);
        aviso('Ajustes guardados ✅'); location.hash = '#inicio';
      } catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = 'Guardar los ajustes'; }
    };
    $('#j-backup').onclick = () => descargar('copia-' + G.hoy() + '.json', JSON.stringify({ fecha: new Date().toISOString(), config: S.config, animales: S.animales, lotes: S.lotes, movimientos: S.movs }, null, 1), 'application/json');
    $('#j-nombre-q').onclick = () => { const n = prompt('¿Cómo te llamás? (así queda anotado quién cargó cada gasto)', S.quien); if (n !== null) { S.quien = n.trim(); LS.set('gc-quien', S.quien); pantallaAjustes(); } };
    $('#j-salir').onclick = () => { if (confirm('¿Salir? La próxima vez vas a tener que ingresar la clave de nuevo.')) cerrarSesion(); };
  }


  // ---------- lotes de hacienda (invernada) ----------
  function vistaDeLote(l) {
    const mm = S.movs.filter(m => m.loteId === l.id);
    const usd = mm.some(m => m.moneda === 'USD'), uyu = mm.some(m => m.moneda === 'UYU');
    return usd && uyu ? 'TODO_UYU' : usd ? 'USD' : 'UYU';
  }
  function resultadosPorLote(movs, v, tc) {
    return S.lotes.map(l => ({ lote: l, i: G.indicadoresLote(l, movs, v, tc) })).filter(x => x.i.n).sort((x, y) => y.i.resultado - x.i.resultado);
  }
  const kg = n => (n === null || n === undefined || !isFinite(n)) ? '—' : G.fmtNum(n, Math.abs(n) >= 100 ? 0 : 1) + ' kg';

  const filtroLotes = { estado: 'Activo' };
  function pantallaLotes() {
    app.innerHTML = encabezado('Lotes de hacienda', '#inicio') +
      '<a class="btn" href="#lote/nuevo" style="margin-top:0">➕ Agregar un lote</a>' +
      '<div class="chips" id="l-fil"></div><div id="l-lista"></div>';
    function pintar() {
      const op = [['Activo', 'En el campo'], ['Cerrado', 'Cerrados'], ['todos', 'Todos']];
      $('#l-fil').innerHTML = op.map(o => '<button type="button" class="chip sm' + (filtroLotes.estado === o[0] ? ' on' : '') + '" data-e="' + o[0] + '">' + o[1] + '</button>').join('');
      app.querySelectorAll('#l-fil .chip').forEach(b => { b.onclick = () => { filtroLotes.estado = b.dataset.e; pintar(); }; });
      const lista = S.lotes.filter(l => filtroLotes.estado === 'todos' || l.estado === filtroLotes.estado).sort((x, y) => (x.fechaEntrada < y.fechaEntrada ? 1 : -1));
      $('#l-lista').innerHTML = lista.length ? lista.map(l => {
        const v = vistaDeLote(l), mon = G.monedaDeVista(v), i = G.indicadoresLote(l, S.movs, v, S.config.tc);
        return '<a class="tarjeta lote-tj" href="#lote/' + esc(l.id) + '"><div class="t"><b>' + esc(l.nombre) + '</b><span class="badge ' + (l.estado === 'Activo' ? 'activo' : 'vendido') + '">' + (l.estado === 'Activo' ? 'En el campo' : 'Cerrado') + '</span></div>' +
          '<div class="nota">' + i.cabezas + ' animales' + (i.diasCampo !== null ? ' · ' + i.diasCampo + ' días' : '') + (i.ult ? ' · último peso ' + kg(i.ult.pesoProm) : '') + (i.gdp !== null ? ' · ' + G.fmtNum(i.gdp, 2) + ' kg/día' : '') + '</div>' +
          (i.n ? '<div class="nota">Resultado hasta ahora: <b class="' + (i.resultado >= 0 ? 'pos' : 'neg') + '">' + esc(G.fmtMonto(i.resultado, mon)) + '</b></div>' : '') + '</a>';
      }).join('') : '<p class="nota" style="margin-top:14px">No hay lotes en esta lista.</p>';
    }
    pintar();
  }

  function pantallaLote(id) {
    const nuevo = id === 'nuevo';
    const base = nuevo ? { id: nuevoId(), nombre: '', cantidad: '', cantidadActual: '', fechaEntrada: G.hoy(), pesoEntrada: '', estado: 'Activo', fechaCierre: '', notas: '', pesadas: [] } : lotePorId(id);
    if (!base) { app.innerHTML = encabezado('Lote', '#lotes') + '<p>No se encontró ese lote.</p>'; return; }
    const l = JSON.parse(JSON.stringify(base));
    const num = v => v === '' || v === undefined ? '' : String(v).replace('.', ',');
    const campoN = (rot, idc, val, ph) => '<label class="campo">' + rot + '<input id="' + idc + '" type="text" inputmode="decimal" autocomplete="off" value="' + esc(num(val)) + '"' + (ph ? ' placeholder="' + ph + '"' : '') + '></label>';
    app.innerHTML = encabezado(nuevo ? 'Agregar un lote' : l.nombre, '#lotes') +
      '<form id="f-lote">' +
      '<label class="campo">Nombre del lote<input id="l-nombre" type="text" autocomplete="off" value="' + esc(l.nombre) + '" placeholder="Ej.: Novillos marzo 2026"></label>' +
      campoN('Cantidad de animales que entraron', 'l-cant', l.cantidad) +
      campoN('Cantidad actual (si hubo bajas; si no, dejalo vacío)', 'l-act', l.cantidadActual === l.cantidad ? '' : l.cantidadActual) +
      '<label class="campo">Fecha de entrada<input id="l-fecha" type="date" value="' + esc(l.fechaEntrada) + '"></label>' +
      campoN('Peso promedio de entrada (kg por animal)', 'l-peso', l.pesoEntrada, 'Ej.: 310') +
      '<label class="campo">Estado<select id="l-estado"><option value="Activo"' + (l.estado === 'Activo' ? ' selected' : '') + '>En el campo</option><option value="Cerrado"' + (l.estado === 'Cerrado' ? ' selected' : '') + '>Cerrado (ya se vendió)</option></select></label>' +
      '<label class="campo" id="l-cierre-w">Fecha de cierre<input id="l-cierre" type="date" value="' + esc(l.fechaCierre) + '"></label>' +
      '<label class="campo">Notas (opcional)<textarea id="l-notas">' + esc(l.notas) + '</textarea></label>' +
      '<p class="neg" id="l-error"></p><button class="btn" type="submit" id="l-guardar">' + (nuevo ? 'Guardar el lote' : 'Guardar los cambios') + '</button>' +
      (nuevo ? '' : '<button class="btn peligro" type="button" id="l-borrar">Eliminar este lote</button>') + '</form>' +
      (nuevo ? '' : '<div id="l-resto"></div>');
    const pintarCierre = () => $('#l-cierre-w').classList.toggle('oculto', $('#l-estado').value === 'Activo');
    $('#l-estado').onchange = pintarCierre; pintarCierre();

    function datos() {
      const n = G.parseMonto;
      const cant = Math.round(n($('#l-cant').value));
      const act = $('#l-act').value.trim() ? Math.round(n($('#l-act').value)) : cant;
      return { id: l.id, nombre: $('#l-nombre').value, cantidad: cant, cantidadActual: act, fechaEntrada: $('#l-fecha').value, pesoEntrada: n($('#l-peso').value) || 0,
        estado: $('#l-estado').value, fechaCierre: $('#l-cierre').value, notas: $('#l-notas').value, pesadas: l.pesadas };
    }
    async function guardar(msgOk) {
      const r = await api('lotes', { accion: 'guardar', lote: datos() });
      const i = S.lotes.findIndex(x => x.id === r.lote.id);
      if (i >= 0) S.lotes[i] = r.lote; else S.lotes.push(r.lote);
      return r.lote;
    }
    $('#f-lote').onsubmit = async ev => {
      ev.preventDefault();
      const err = $('#l-error'); err.textContent = '';
      if (!$('#l-nombre').value.trim()) { err.textContent = 'Escribí el nombre del lote.'; return; }
      if (!(G.parseMonto($('#l-cant').value) > 0)) { err.textContent = 'Escribí cuántos animales tiene el lote.'; return; }
      const btn = $('#l-guardar'); btn.disabled = true; btn.textContent = 'Guardando…';
      try { const lote = await guardar(); aviso('Guardado ✅'); location.hash = nuevo ? '#lote/' + lote.id : '#lotes'; }
      catch (e) { err.textContent = e.message; btn.disabled = false; btn.textContent = nuevo ? 'Guardar el lote' : 'Guardar los cambios'; }
    };
    if (nuevo) return;
    $('#l-borrar').onclick = async () => {
      const n = S.movs.filter(m => m.loteId === l.id).length;
      if (!confirm('¿Eliminar el lote "' + l.nombre + '"?' + (n ? '\n\nTiene ' + n + ' movimientos: no se borran, quedan como gastos o ingresos generales.' : ''))) return;
      try { await api('lotes', { accion: 'borrar', id: l.id }); S.lotes = S.lotes.filter(x => x.id !== l.id); S.movs.forEach(m => { if (m.loteId === l.id) m.loteId = ''; }); aviso('Lote eliminado'); location.hash = '#lotes'; }
      catch (e) { aviso(e.message, true); }
    };

    function pintarResto() {
      const lote = lotePorId(l.id) || l;
      const v = vistaDeLote(lote), mon = G.monedaDeVista(v), f = x => G.fmtMonto(x, mon), tc = S.config.tc;
      const i = G.indicadoresLote(lote, S.movs, v, tc);
      const mm = S.movs.filter(m => m.loteId === lote.id).sort((x, y) => (x.fecha < y.fecha ? 1 : -1));
      const fila = (t, val) => '<tr><td>' + t + '</td><td><b>' + val + '</b></td></tr>';
      $('#l-resto').innerHTML =
        '<h2>Resultado del lote</h2><div class="hero ' + (i.resultado >= 0 ? 'bien' : 'mal') + '"><small>' + (lote.estado === 'Cerrado' ? 'Resultado final' : 'Resultado hasta ahora (gastos e ingresos cargados)') + '</small><b>' + esc(f(i.resultado)) + '</b></div>' +
        '<div class="tarjeta"><table class="t"><tbody>' +
        fila('Animales', i.cabezas) +
        fila('Días en el campo', i.diasCampo === null ? '—' : i.diasCampo) +
        fila('Peso de entrada', kg(lote.pesoEntrada || null)) +
        fila('Último peso' + (i.ult ? ' (' + esc(G.fechaCorta(i.ult.fecha)) + ')' : ''), kg(i.ult ? i.ult.pesoProm : null)) +
        fila('Kilos ganados por animal', kg(i.kgGanadosCab)) +
        fila('Ganancia diaria', i.gdp === null ? '—' : G.fmtNum(i.gdp, 2) + ' kg/día') +
        fila('Kilos producidos (total)', kg(i.kgProd)) +
        fila('Gastos', esc(f(i.gastos))) + fila('Ingresos', esc(f(i.ingresos))) +
        fila('Resultado por animal', i.margenCabeza === null ? '—' : esc(f(i.margenCabeza))) +
        fila('Costo por kilo ganado', i.costoKg === null ? '—' : esc(f(i.costoKg)) + '/kg') +
        '</tbody></table><p class="nota">El costo por kilo ganado no cuenta la compra de la hacienda (rubros que dicen "compra"). Se calcula con la última pesada.' + (v.indexOf('TODO') === 0 ? ' Los dólares se convirtieron a pesos con el tipo de cambio de Ajustes.' : '') + '</p></div>' +
        '<h2>Pesadas</h2><div class="tarjeta">' +
        ((lote.pesadas || []).length ? '<table class="t"><thead><tr><th>Fecha</th><th>Pesados</th><th>Promedio</th><th></th></tr></thead><tbody>' + lote.pesadas.map(p => '<tr><td>' + esc(G.fechaCorta(p.fecha)) + '</td><td>' + (p.cantidad || '—') + '</td><td><b>' + esc(kg(p.pesoProm)) + '</b></td><td><button type="button" class="btn sec mini" data-p="' + esc(p.id) + '" style="margin:0">✕</button></td></tr>').join('') + '</tbody></table>' : '<p class="nota">Todavía no hay pesadas.</p>') +
        '<form id="f-pes"><label class="campo">Fecha de la pesada<input id="p-fecha" type="date" value="' + G.hoy() + '"></label>' +
        '<label class="campo">Cuántos animales se pesaron<input id="p-cant" type="text" inputmode="numeric" autocomplete="off" placeholder="' + lote.cantidadActual + '"></label>' +
        '<label class="campo">Peso promedio (kg por animal)<input id="p-peso" type="text" inputmode="decimal" autocomplete="off"></label>' +
        '<p class="neg" id="p-error"></p><button class="btn" type="submit" style="margin-top:6px">Agregar la pesada</button></form></div>' +
        '<h2>Gastos e ingresos de este lote</h2>' +
        '<div class="grilla"><a class="btn gasto" href="#gasto?lote=' + esc(lote.id) + '">🧾 Cargar un gasto</a><a class="btn" href="#ingreso?lote=' + esc(lote.id) + '">💰 Cargar un ingreso</a></div>' +
        (mm.length ? '<div class="tarjeta">' + filasMov(mm, true) + '</div>' : '<p class="nota">Todavía no hay gastos ni ingresos cargados para este lote.</p>');
      app.querySelectorAll('button[data-p]').forEach(b => { b.onclick = async () => {
        if (!confirm('¿Borrar esta pesada?')) return;
        l.pesadas = (lotePorId(l.id).pesadas || []).filter(p => p.id !== b.dataset.p);
        try { await guardarPesadas(); pintarResto(); } catch (e) { aviso(e.message, true); }
      }; });
      $('#f-pes').onsubmit = async ev => {
        ev.preventDefault();
        const err = $('#p-error'); err.textContent = '';
        const peso = G.parseMonto($('#p-peso').value), fecha = $('#p-fecha').value;
        if (!(peso > 0)) { err.textContent = 'Escribí el peso promedio.'; return; }
        if (!fecha) { err.textContent = 'Falta la fecha.'; return; }
        l.pesadas = (lotePorId(l.id).pesadas || []).concat([{ id: nuevoId(), fecha, cantidad: Math.round(G.parseMonto($('#p-cant').value)) || 0, pesoProm: peso }]);
        try { await guardarPesadas(); aviso('Pesada agregada ✅'); pintarResto(); } catch (e) { err.textContent = e.message; }
      };
    }
    async function guardarPesadas() { // guarda solo las pesadas, sin tocar lo que se esté escribiendo arriba
      const actual = lotePorId(l.id);
      const r = await api('lotes', { accion: 'guardar', lote: Object.assign({}, actual, { pesadas: l.pesadas }) });
      const i = S.lotes.findIndex(x => x.id === r.lote.id); S.lotes[i] = r.lote;
    }
    pintarResto();
  }

  // ---------- panel gráfico ----------
  const estP = { periodo: 'anio', desde: '', hasta: '' };
  const COLORES = ['#2f6b3a', '#a8742a', '#3d5a80', '#b3402f', '#7a9e7e', '#d4a24c', '#6b7fa3', '#c97b6b', '#8a8a7a'];
  function donaSVG(lista) {
    let acum = 0;
    const arcos = lista.map((c, i) => {
      const pct = c.pct * 100;
      const a = '<circle r="15.915" cx="21" cy="21" fill="none" stroke="' + COLORES[i % COLORES.length] + '" stroke-width="7" stroke-dasharray="' + pct.toFixed(3) + ' ' + (100 - pct).toFixed(3) + '" stroke-dashoffset="' + (25 - acum).toFixed(3) + '"/>';
      acum += pct; return a;
    }).join('');
    return '<svg viewBox="0 0 42 42" class="dona" role="img" aria-label="Gastos por rubro"><circle r="15.915" cx="21" cy="21" fill="none" stroke="#ece9df" stroke-width="7"/>' + arcos + '</svg>';
  }
  function pantallaPanel() {
    const hayUSD = S.movs.some(m => m.moneda === 'USD'), hayUYU = S.movs.some(m => m.moneda === 'UYU');
    if (!estR.vista) estR.vista = hayUSD && hayUYU ? 'TODO_UYU' : hayUSD ? 'USD' : 'UYU';
    app.innerHTML = encabezado('Panel', '#inicio') +
      '<div class="chips" id="p-per"></div><div id="p-rango" class="fila" style="gap:10px;margin-bottom:10px"></div>' +
      '<label class="campo">Ver en<select id="p-vista"></select></label><div id="p-cuerpo"></div>' +
      '<a class="btn sec" href="#resultados">Ver el detalle completo en Resultados</a>';
    const pers = [['mes', 'Este mes'], ['mes-anterior', 'Mes anterior'], ['anio', 'Este año'], ['anio-anterior', 'Año anterior'], ['12m', 'Últimos 12 meses'], ['todo', 'Todo'], ['otro', 'Elegir fechas']];
    const anios = Array.from(new Set(S.movs.map(m => m.fecha.slice(0, 4)))).sort().reverse();
    const vistas = [['UYU', 'Solo pesos ($)'], ['USD', 'Solo dólares (US$)'], ['TODO_UYU', 'Todo en pesos (convertido)'], ['TODO_USD', 'Todo en dólares (convertido)']];
    $('#p-vista').innerHTML = vistas.map(v => '<option value="' + v[0] + '"' + (v[0] === estR.vista ? ' selected' : '') + '>' + v[1] + '</option>').join('');
    $('#p-vista').onchange = ev => { estR.vista = ev.target.value; pintar(); };
    function pintar() {
      $('#p-per').innerHTML = pers.map(p => '<button type="button" class="chip sm' + (estP.periodo === p[0] ? ' on' : '') + '" data-p="' + p[0] + '">' + p[1] + '</button>').join('');
      app.querySelectorAll('#p-per .chip').forEach(b => { b.onclick = () => { estP.periodo = b.dataset.p; pintar(); }; });
      $('#p-rango').innerHTML = estP.periodo === 'otro'
        ? '<label class="campo" style="flex:1 1 100%;margin:0">Ejercicio (año completo)<select id="p-anio"><option value="">—</option>' + anios.map(a => '<option value="' + a + '"' + (estP.desde === a + '-01-01' && estP.hasta === a + '-12-31' ? ' selected' : '') + '>' + a + '</option>').join('') + '</select></label>' +
          '<label class="campo" style="flex:1;margin:0">Desde<input type="date" id="p-d" value="' + esc(estP.desde) + '"></label><label class="campo" style="flex:1;margin:0">Hasta<input type="date" id="p-h" value="' + esc(estP.hasta) + '"></label>' : '';
      if (estP.periodo === 'otro') {
        $('#p-anio').onchange = e => { const a = e.target.value; estP.desde = a ? a + '-01-01' : ''; estP.hasta = a ? a + '-12-31' : ''; pintar(); };
        $('#p-d').onchange = e => { estP.desde = e.target.value; pintar(); };
        $('#p-h').onchange = e => { estP.hasta = e.target.value; pintar(); };
      }
      const tc = S.config.tc, v = estR.vista, mon = G.monedaDeVista(v), f = n => G.fmtMonto(n, mon);
      const per = estP.periodo === 'otro' ? { desde: estP.desde || null, hasta: estP.hasta || null } : G.periodo(estP.periodo);
      const movs = S.movs.filter(m => G.enPeriodo(m, per));
      const cuerpo = $('#p-cuerpo');
      const res = G.resumen(movs, v, tc);
      if (!res.n) { cuerpo.innerHTML = '<p class="nota" style="margin-top:14px">Todavía no hay movimientos en este período' + (v === 'UYU' || v === 'USD' ? ' en esa moneda' : '') + '.</p>'; return; }
      // comparación con el período anterior equivalente
      const prevNombre = { mes: 'mes-anterior', anio: 'anio-anterior' }[estP.periodo];
      let comp = '';
      if (prevNombre) {
        const rp = G.resumen(S.movs.filter(m => G.enPeriodo(m, G.periodo(prevNombre))), v, tc);
        if (rp.n) {
          const d = res.resultado - rp.resultado;
          comp = '<div class="comp ' + (d >= 0 ? 'pos' : 'neg') + '">' + (d >= 0 ? '▲ ' : '▼ ') + esc(f(Math.abs(d))) + ' ' + (d >= 0 ? 'mejor' : 'peor') + ' que el ' + (estP.periodo === 'mes' ? 'mes anterior' : 'año anterior') + '</div>';
        }
      }
      const pos = res.resultado >= 0;
      const tot = res.ingresos + res.gastos;
      const pI = tot ? Math.round(res.ingresos / tot * 100) : 0;
      const cg = G.porCategoria(movs, 'gasto', v, tc);
      const top = cg.slice(0, 6), resto = cg.slice(6);
      if (resto.length) top.push({ categoria: 'Otros rubros', total: resto.reduce((a, c) => a + c.total, 0), pct: resto.reduce((a, c) => a + c.pct, 0) });
      const pm = G.porMes(movs, v, tc);
      const pa = G.porAnimal(movs, S.animales, v, tc).slice().sort((a, b) => b.resultado - a.resultado);
      const maxA = Math.max(1, ...pa.map(x => Math.abs(x.resultado)));
      const rlp = S.config.usaLotes ? resultadosPorLote(movs, v, tc) : [];
      const maxL = Math.max(1, ...rlp.map(x => Math.abs(x.i.resultado)));
      // barras mes a mes (SVG)
      let barras = '';
      if (pm.length > 1) {
        const W = 340, H = 150, base = 130, n = pm.length, ancho = W / n;
        const mx = Math.max(1, ...pm.map(x => Math.max(x.gastos, x.ingresos)));
        const bw = Math.min(16, ancho * 0.36);
        barras = '<svg viewBox="0 0 ' + W + ' ' + H + '" class="grafico" role="img" aria-label="Ingresos y gastos mes a mes">' +
          '<line x1="0" y1="' + base + '" x2="' + W + '" y2="' + base + '" stroke="#d9d6cb"/>' +
          pm.map((x, i) => {
            const cx = ancho * i + ancho / 2, hi = Math.round(x.ingresos / mx * 105), hg = Math.round(x.gastos / mx * 105);
            return '<rect x="' + (cx - bw - 1) + '" y="' + (base - hi) + '" width="' + bw + '" height="' + hi + '" rx="3" fill="#2f6b3a"/>' +
              '<rect x="' + (cx + 1) + '" y="' + (base - hg) + '" width="' + bw + '" height="' + hg + '" rx="3" fill="#b3402f"/>' +
              (n <= 6 || i % 2 === 0 ? '<text x="' + cx + '" y="146" text-anchor="middle" font-size="9" fill="#6a7468">' + esc(G.mesTexto(x.mes)) + '</text>' : '');
          }).join('') + '</svg>' +
          '<div class="leyenda"><b style="color:#2f6b3a">■</b> Ingresos &nbsp; <b style="color:#b3402f">■</b> Gastos</div>';
      }
      cuerpo.innerHTML =
        '<div class="hero ' + (pos ? 'bien' : 'mal') + '"><small>' + (pos ? 'Ganancia del período' : 'Pérdida del período') + '</small><b>' + esc(f(res.resultado)) + '</b>' + comp + '</div>' +
        '<div class="tarjeta"><div class="cifras"><div class="cifra"><small>Entró</small><b class="pos">' + esc(f(res.ingresos)) + '</b></div><div class="cifra"><small>Salió</small><b class="neg">' + esc(f(res.gastos)) + '</b></div></div>' +
        '<div class="dosbarra" title="Ingresos vs gastos"><i style="width:' + pI + '%"></i></div><div class="nota" style="display:flex;justify-content:space-between"><span>Ingresos ' + pI + '%</span><span>Gastos ' + (100 - pI) + '%</span></div></div>' +
        (top.length ? '<h2>En qué se va la plata</h2><div class="tarjeta"><div class="dona-fila">' + donaSVG(top) + '<div class="dona-leyenda">' +
          top.map((c, i) => '<div><i style="background:' + COLORES[i % COLORES.length] + '"></i><span>' + esc(c.categoria) + '</span><b>' + Math.round(c.pct * 100) + '%</b></div>').join('') + '</div></div></div>' : '') +
        (barras ? '<h2>Mes a mes</h2><div class="tarjeta">' + barras + '</div>' : '') +
        (S.config.usaLotes && rlp.length ? '<h2>Cómo le fue a cada lote</h2><div class="tarjeta">' + rlp.slice(0, 8).map(x =>
          '<a class="ani-fila" href="#lote/' + esc(x.lote.id) + '"><div class="t"><span>' + esc(x.lote.nombre) + '</span><b class="' + (x.i.resultado >= 0 ? 'pos' : 'neg') + '">' + esc(f(x.i.resultado)) + '</b></div>' +
          '<div class="barra ' + (x.i.resultado >= 0 ? 'ing' : '') + '"><i style="width:' + Math.max(3, Math.round(Math.abs(x.i.resultado) / maxL * 100)) + '%"></i></div></a>').join('') + '</div>' : '') +
        (pa.length ? '<h2>Cómo le fue a cada animal</h2><div class="tarjeta">' + pa.slice(0, 8).map(x =>
          '<a class="ani-fila" href="#animal/' + esc(x.animalId) + '"><div class="t"><span>' + esc(x.animal.nombre) + '</span><b class="' + (x.resultado >= 0 ? 'pos' : 'neg') + '">' + esc(f(x.resultado)) + '</b></div>' +
          '<div class="barra ' + (x.resultado >= 0 ? 'ing' : '') + '"><i style="width:' + Math.max(3, Math.round(Math.abs(x.resultado) / maxA * 100)) + '%"></i></div></a>').join('') + '</div>' : '') +
        (v.indexOf('TODO') === 0 ? '<p class="nota">Convertido a ' + (mon === 'USD' ? 'dólares' : 'pesos') + ' con un tipo de cambio de ' + esc(G.fmtNum(tc, 2)) + ' (se cambia en Ajustes).</p>' : '');
    }
    pintar();
  }

  // ---------- ajuste entre socios (solo lectura + borrar) ----------
  function pantallaAjuste(m) {
    app.innerHTML = encabezado('Ajuste entre socios', '#movs') +
      '<div class="tarjeta"><p><b>' + esc(m.categoria) + '</b></p><p>' + (m.monto < 0 ? '−' : '+') + esc(G.fmtMonto(Math.abs(m.monto), m.moneda)) + ' · ' + esc(G.fechaCorta(m.fecha)) + '</p>' +
      (m.pagadoPor ? '<p>Socio: <b>' + esc(m.pagadoPor) + '</b></p>' : '') + (m.detalle ? '<p>' + esc(m.detalle) + '</p>' : '') + (m.ref ? '<p class="nota">Comprobante de la planilla vieja: #' + esc(m.ref) + '</p>' : '') + '</div>' +
      '<p class="nota">Un ajuste no es gasto ni ingreso del negocio: solo mueve la cuenta entre los socios. Si está mal, eliminalo y cargalo de nuevo.</p>' +
      '<button class="btn peligro" type="button" id="a-del">Eliminar este ajuste</button>';
    $('#a-del').onclick = async () => {
      if (!confirm('¿Eliminar este ajuste?')) return;
      try { await api('movs', { accion: 'borrar', id: m.id }); S.movs = S.movs.filter(x => x.id !== m.id); aviso('Ajuste eliminado'); location.hash = '#movs'; } catch (e) { aviso(e.message, true); }
    };
  }

  // ---------- cuenta entre socios ----------
  const estSoc = { vista: 'TODO_USD', hasta: '' };
  function pantallaSocios() {
    const socios = S.config.personas || [];
    app.innerHTML = encabezado('Cuenta entre socios', '#inicio') +
      '<label class="campo">Mostrar en<select id="s-vista"><option value="TODO_USD">Todo en dólares</option><option value="TODO_UYU">Todo en pesos</option><option value="USD">Solo lo cargado en dólares</option><option value="UYU">Solo lo cargado en pesos</option></select></label>' +
      '<div id="s-res"></div>' +
      '<p class="nota">Cada socio suma lo que cobró y resta lo que pagó (más los ajustes). El resultado total se reparte en partes iguales y la diferencia es el saldo: <b>positivo</b> = tiene de más y le debe al otro; <b>negativo</b> = tiene a favor.</p>';
    $('#s-vista').value = estSoc.vista;
    function pintar() {
      const r = G.cuentaSocios(S.movs, socios, estSoc.vista, S.config.tc);
      const mon = G.monedaDeVista(estSoc.vista);
      const f = n => esc(G.fmtMonto(n, mon, 2));
      $('#s-res').innerHTML = '<div class="tarjeta"><div class="cifras"><div class="cifra"><small>Resultado total</small><b class="' + (r.resultado >= 0 ? 'pos' : 'neg') + '">' + f(r.resultado) + '</b></div><div class="cifra"><small>Parte de cada uno</small><b>' + f(r.parte) + '</b></div></div></div>' +
        r.filas.map(x => '<div class="tarjeta"><h2 style="margin-top:0">' + esc(x.socio) + '</h2>' +
          '<div class="fila-d"><span>Cobró</span><b>' + f(x.cobrado) + '</b></div><div class="fila-d"><span>Pagó</span><b>' + f(x.pagado) + '</b></div>' +
          (x.ajustes ? '<div class="fila-d"><span>Ajustes</span><b>' + f(x.ajustes) + '</b></div>' : '') +
          '<div class="fila-d"><span>Neto</span><b>' + f(x.neto) + '</b></div>' +
          '<div class="fila-d"><span><b>Saldo</b></span><b class="' + (x.saldo > 0 ? 'neg' : 'pos') + '">' + f(x.saldo) + '</b></div></div>').join('') +
        (r.sinSocio ? '<p class="nota">' + r.sinSocio + ' movimientos no tienen socio asignado y no entran en la cuenta.</p>' : '');
    }
    $('#s-vista').onchange = ev => { estSoc.vista = ev.target.value; pintar(); };
    pintar();
  }

  // ---------- importar movimientos históricos (carga inicial) ----------
  function pantallaImportarMovs() {
    app.innerHTML = encabezado('Importar movimientos históricos', '#ajustes') +
      '<p class="nota">Elegí el archivo <b>carga-inicial.json</b>. Antes de cargar nada se muestra un resumen por año para controlarlo. Si se corta, se puede repetir: lo ya cargado se saltea solo.</p>' +
      '<label class="btn-foto"><input type="file" id="im-arch" accept=".json,application/json"><span>📂 Elegir el archivo</span></label><div id="im-res"></div>';
    $('#im-arch').onchange = async ev => {
      const f = ev.target.files && ev.target.files[0]; if (!f) return;
      let d;
      try { d = JSON.parse(await f.text()); } catch (e) { $('#im-res').innerHTML = '<p class="neg">El archivo no se pudo leer.</p>'; return; }
      if (!d || !Array.isArray(d.movs)) { $('#im-res').innerHTML = '<p class="neg">Este archivo no tiene movimientos.</p>'; return; }
      const ya = new Set(S.movs.map(m => m.id));
      const nuevos = d.movs.filter(m => !ya.has(m.id));
      const anios = Array.from(new Set(d.movs.map(m => m.fecha.slice(0, 4)))).sort();
      const fila = (tit, lista) => { const r = G.resumen(lista, 'TODO_USD', S.config.tc); return '<tr><td>' + tit + '</td><td class="num">' + G.fmtNum(r.ingresos, 0) + '</td><td class="num">' + G.fmtNum(r.gastos, 0) + '</td><td class="num">' + G.fmtNum(r.resultado, 0) + '</td></tr>'; };
      $('#im-res').innerHTML = '<h2>Resumen (en US$)</h2><div class="tarjeta" style="overflow-x:auto"><table class="tabla"><tr><th>Año</th><th>Ingresos</th><th>Gastos</th><th>Resultado</th></tr>' +
        anios.map(a => fila(a, d.movs.filter(m => m.fecha.slice(0, 4) === a))).join('') + fila('<b>Total</b>', d.movs) + '</table></div>' +
        '<p class="nota">' + d.movs.length + ' movimientos en el archivo · ' + d.movs.filter(m => m.tipo === 'ajuste').length + ' ajustes entre socios · ' + d.movs.filter(m => m.verificado).length + ' verificados · ' + (d.lotes || []).length + ' lotes.<br><b>' + nuevos.length + '</b> son nuevos' + (nuevos.length < d.movs.length ? ' (' + (d.movs.length - nuevos.length) + ' ya estaban cargados)' : '') + '.</p>' +
        '<p class="neg" id="im-err"></p><button class="btn" type="button" id="im-go"' + (nuevos.length || (d.lotes || []).length ? '' : ' disabled') + '>Importar ahora</button>';
      $('#im-go').onclick = async () => {
        const btn = $('#im-go'); btn.disabled = true;
        try {
          btn.textContent = 'Preparando ajustes…';
          const c = S.config, une = (a, b, n) => Array.from(new Set((a || []).concat(b || []))).slice(0, n);
          const cfg = Object.assign({}, c, { personas: une(c.personas, d.socios, 10), catGasto: une(c.catGasto, (d.categorias || {}).gasto, 40), catIngreso: une(c.catIngreso, (d.categorias || {}).ingreso, 40), usaLotes: c.usaLotes || (d.lotes || []).length > 0 });
          S.config = (await api('config', { config: cfg })).config;
          const lotes = d.lotes || [];
          for (let i = 0; i < lotes.length; i++) { btn.textContent = 'Lotes ' + (i + 1) + ' de ' + lotes.length + '…'; await api('lotes', { accion: 'guardar', lote: lotes[i] }); }
          let creados = 0, salteados = 0;
          const por = S.quien || 'Carga inicial';
          for (let i = 0; i < d.movs.length; i += 100) {
            btn.textContent = 'Movimientos ' + Math.min(i + 100, d.movs.length) + ' de ' + d.movs.length + '…';
            const r = await api('movs', { accion: 'importar', movs: d.movs.slice(i, i + 100).map(m => Object.assign({ por }, m)) });
            creados += r.creados; salteados += r.salteados;
            if (r.errores && r.errores.length) throw new Error('Hay movimientos con error (#' + (r.errores[0].ref || '?') + '): ' + r.errores[0].error);
          }
          const [m2, l2] = await Promise.all([api('movs'), api('lotes')]);
          S.movs = m2.movs; S.lotes = l2.lotes;
          $('#im-res').innerHTML = '<div class="ok-grande"><div class="tilde">✅</div><h1>Listo</h1><p>' + creados + ' movimientos cargados' + (salteados ? ' · ' + salteados + ' ya estaban' : '') + '.</p></div><a class="btn" href="#resultados">Ver resultados</a><a class="btn sec" href="#socios">Ver cuenta entre socios</a>';
        } catch (e) { $('#im-err').textContent = 'Se cortó: ' + e.message + '. Tocá de nuevo "Importar ahora": lo ya cargado se saltea.'; btn.disabled = false; btn.textContent = 'Importar ahora'; }
      };
    };
  }

  // ---------- ayuda ----------
  function pantallaAyuda() {
    LS.set('gc-ayuda-vista', '1');
    const paso = (ico, tit, txt) => '<div class="tarjeta"><h2 style="margin-top:0">' + ico + ' ' + tit + '</h2>' + txt + '</div>';
    app.innerHTML = encabezado('Cómo se usa esta app', '#inicio') +
      '<p class="nota">Una guía corta para empezar. Podés volver acá cuando quieras tocando el ❓ de arriba.</p>' +
      paso('🏠', 'La pantalla de inicio', '<p>Tiene cuatro botones grandes: <b>Cargar un gasto</b>, <b>Cargar un ingreso</b>, <b>Animales</b> y <b>Panel</b>. Abajo se ve cómo viene el mes y lo último que se cargó.</p>') +
      paso('🧾', 'Cargar un gasto', '<ol><li>Tocá <b>Cargar un gasto</b>.</li><li>Escribí el <b>monto</b> (con coma para los centavos: 1250,50).</li><li>Elegí si es en <b>pesos</b> o en <b>dólares</b>.</li><li>Tocá <b>en qué fue</b> (alimentación, sanidad, etc.).</li><li>Si querés, escribí el proveedor y un detalle, y sacale una <b>foto al comprobante</b>.</li><li>Tocá <b>Guardar</b>. Aparece el tilde verde ✅.</li></ol><p class="nota">Lo único obligatorio es el monto y en qué fue. La fecha viene puesta con la de hoy: si el gasto fue otro día, cambiala.</p>') +
      paso('💰', 'Cargar un ingreso', '<p>Igual que un gasto, pero con el botón <b>Cargar un ingreso</b>: ventas de animales, premios de exposiciones, servicios, etc.</p>') +
      paso('🐂', 'Gastos de un animal en particular', '<p>En el gasto o ingreso aparece la pregunta <b>"¿Es para un animal en particular?"</b>. Si elegís uno, después se ve cuánto costó y cuánto dejó ese animal. Si es un gasto de todo el campo, dejalo en "No, es un gasto general".</p><p>Si cargás la <b>venta</b> de un animal, la app pregunta si lo marca como vendido.</p>') +
      paso('📋', 'Animales', '<p>Tocá <b>Animales → Agregar un animal</b> y completá nombre, especie y lo que sepas (caravana, raza, nacimiento, foto). Tocando un animal se ven sus gastos e ingresos y se puede cambiar su estado: en el campo, vendido o fallecido.</p>') +
      (S.config.usaLotes ? paso('📦', 'Lotes de hacienda', '<p>Un <b>lote</b> es un grupo de animales que entró junto. Tocá <b>Lotes de hacienda → Agregar un lote</b> y poné cuántos son, la fecha y el peso promedio de entrada. Cada tanto agregá una <b>pesada</b> (cuántos pesaste y el promedio). Al cargar un gasto o un ingreso, elegí a qué lote pertenece. En la ficha del lote ves la ganancia diaria de peso, el costo por kilo ganado y el resultado por animal.</p>') : '') +
      paso('📥', 'Cargar muchos animales de una vez', '<p>Si tenés el archivo (TXT o CSV) que sale del lector de caravanas, entrá a <b>Animales → Importar lecturas del bastón</b>. Elegí el archivo o pegá la lista de números. La app te muestra cuántos son nuevos y cuáles <b>ya existen</b> (esos se saltean, no se duplican) y recién ahí los das de alta.</p>') +
      ((S.config.personas || []).length >= 2 ? paso('🤝', 'Socios, comprobantes verificados y ajustes', '<p>En cada gasto o ingreso se anota <b>quién lo pagó o cobró</b>, el <b>n° de comprobante</b> (para ubicarlo en la planilla vieja) y si está <b>verificado</b> (✔). En <b>Ver todos los movimientos</b> el filtro <b>Sin verificar</b> muestra lo pendiente.</p><p><b>Cuenta entre socios</b> (en el inicio) muestra cuánto cobró y pagó cada uno y el saldo para quedar parejos. Los <b>ajustes</b> (🤝) son netos entre socios: mueven la cuenta pero no cuentan como gasto ni ingreso.</p>') : '') +
      paso('✏️', 'Me equivoqué, ¿cómo lo corrijo?', '<p>Entrá a <b>Ver todos los movimientos</b>, tocá el que querés cambiar y corregilo, o tocá <b>Eliminar</b> al final. Se puede buscar por palabra o filtrar por mes.</p>') +
      paso('📈', 'El Panel', '<p>Es la pantalla para ver cómo viene todo de un vistazo: si hay ganancia o pérdida, en qué se va la plata, cómo fue cada mes y cómo le fue a cada animal. Elegí arriba el período que querés mirar.</p>') +
      paso('📊', 'Resultados en detalle', '<p>Elegí el período (este mes, este año, últimos 12 meses…) y se ve cuánto entró, cuánto salió y el <b>resultado</b>. Más abajo: en qué se gasta más, de dónde vienen los ingresos, mes a mes y el resultado de cada animal.</p><p>Si hay pesos y dólares, se puede ver todo convertido a una sola moneda. El tipo de cambio se ajusta en <b>Ajustes</b>.</p>') +
      paso('📱', 'Dejarla como una app en el celular', '<p>En Safari tocá el botón de <b>Compartir</b> (el cuadrado con la flecha) y elegí <b>Agregar a pantalla de inicio</b>. Así se abre con un toque, como cualquier app.</p>') +
      paso('🔑', 'Entrar y salir', '<p>La clave se pide una sola vez en cada celular. Todos los que cargan usan la misma clave, pero cada uno pone <b>su nombre</b> para saber quién anotó cada cosa. Si algo no carga, revisá que haya señal e intentá de nuevo: no se pierde lo ya guardado.</p>') +
      paso('💾', 'Copia de seguridad', '<p>En <b>Ajustes</b> hay un botón para descargar una copia de todo. Conviene hacerla de vez en cuando y guardarla en el Drive.</p>') +
      '<a class="btn" href="#inicio">Entendido, ir al inicio</a>';
  }

  // ---------- navegación ----------
  function enrutar() {
    if (!S.clave) { pantallaEntrada(); return; }
    if (!S.cargado) { cargarTodo().then(enrutar).catch(e => { if (e.clave) cerrarSesion('La clave no es correcta.'); else app.innerHTML = '<p class="neg">' + esc(e.message) + '</p><button class="btn" onclick="location.reload()">Reintentar</button>'; }); return; }
    topDerecha();
    if (!LS.get('gc-ayuda-vista') && !location.hash) { location.hash = '#ayuda'; return; }
    const [ruta, consulta] = (location.hash.slice(1) || 'inicio').split('?');
    const q = new URLSearchParams(consulta || '');
    const partes = ruta.split('/');
    window.scrollTo(0, 0);
    switch (partes[0]) {
      case 'gasto': case 'ingreso': pantallaMov(partes[0], null, q.get('animal') || '', q.get('lote') || ''); break;
      case 'socios': pantallaSocios(); break;
      case 'importarmovs': pantallaImportarMovs(); break;
      case 'mov': { const m = S.movs.find(x => x.id === partes[1]); if (m && m.tipo === 'ajuste') pantallaAjuste(m); else if (m) pantallaMov(m.tipo, m); else location.hash = '#movs'; break; }
      case 'movs': pantallaMovs(); break;
      case 'animales': pantallaAnimales(); break;
      case 'lotes': pantallaLotes(); break;
      case 'lote': pantallaLote(partes[1] || 'nuevo'); break;
      case 'importar': pantallaImportar(); break;
      case 'animal': pantallaAnimal(partes[1] || 'nuevo'); break;
      case 'resultados': pantallaResultados(); break;
      case 'ajustes': pantallaAjustes(); break;
      case 'ayuda': pantallaAyuda(); break;
      case 'panel': pantallaPanel(); break;
      default: pantallaInicio();
    }
  }
  window.addEventListener('hashchange', enrutar);
  const mg0 = marcaGuardada(); if (mg0) aplicarMarca(mg0);
  enrutar();
  if (!S.clave) cargarMarcaPublica().then(m => { if (m && !S.clave && !$('#e-clave').value) pantallaEntrada(); });
})();
