// Lógica pura (sin pantalla): períodos, totales, resultados e indicadores.
// Se usa en el navegador y también se puede probar en Node.
(function (root) {
  'use strict';
  const pad = n => String(n).padStart(2, '0');
  const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];

  function hoy() {
    const d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function ultimoDiaDelMes(y, m) { return new Date(y, m, 0).getDate(); } // m = 1..12

  // Períodos predefinidos -> {desde, hasta} (null = sin límite)
  function periodo(nombre, hoyStr) {
    hoyStr = hoyStr || hoy();
    const y = Number(hoyStr.slice(0, 4)), m = Number(hoyStr.slice(5, 7));
    if (nombre === 'mes') return { desde: y + '-' + pad(m) + '-01', hasta: y + '-' + pad(m) + '-' + pad(ultimoDiaDelMes(y, m)) };
    if (nombre === 'mes-anterior') {
      const py = m === 1 ? y - 1 : y, pm = m === 1 ? 12 : m - 1;
      return { desde: py + '-' + pad(pm) + '-01', hasta: py + '-' + pad(pm) + '-' + pad(ultimoDiaDelMes(py, pm)) };
    }
    if (nombre === 'anio') return { desde: y + '-01-01', hasta: y + '-12-31' };
    if (nombre === 'anio-anterior') return { desde: (y - 1) + '-01-01', hasta: (y - 1) + '-12-31' };
    if (nombre === '12m') {
      const dy = y - 1, dm = m + 1 > 12 ? 1 : m + 1, dyy = m + 1 > 12 ? y : dy;
      return { desde: dyy + '-' + pad(dm) + '-01', hasta: y + '-' + pad(m) + '-' + pad(ultimoDiaDelMes(y, m)) };
    }
    return { desde: null, hasta: null }; // todo
  }

  function enPeriodo(m, p) {
    return (!p.desde || m.fecha >= p.desde) && (!p.hasta || m.fecha <= p.hasta);
  }

  // Vista de moneda: 'UYU' | 'USD' (solo esa moneda) | 'TODO_USD' | 'TODO_UYU' (convierte con el tipo de cambio)
  // Los ajustes entre socios no cuentan como gasto ni ingreso: valor() los deja afuera.
  // Si el movimiento tiene su propio tipo de cambio (m.tc, el del BCU del día) se usa ese.
  function valorBruto(m, vista, tc) {
    if (vista === 'UYU' || vista === 'USD') return m.moneda === vista ? m.monto : null;
    tc = Number(m.tc) > 0 ? Number(m.tc) : (Number(tc) || 1);
    if (vista === 'TODO_USD') return m.moneda === 'USD' ? m.monto : m.monto / tc;
    if (vista === 'TODO_UYU') return m.moneda === 'UYU' ? m.monto : m.monto * tc;
    return null;
  }
  function valor(m, vista, tc) {
    if (m.tipo === 'ajuste') return null;
    return valorBruto(m, vista, tc);
  }
  // Cuenta entre socios: cada uno suma lo que cobró y resta lo que pagó (y los ajustes).
  // saldo > 0: tiene de más; saldo < 0: tiene a favor.
  function cuentaSocios(movs, socios, vista, tc) {
    const f = new Map(socios.map(n => [n, { socio: n, cobrado: 0, pagado: 0, ajustes: 0 }]));
    let sinSocio = 0, ing = 0, gas = 0;
    for (const m of movs) {
      const v = valorBruto(m, vista, tc);
      if (v === null) continue;
      const quien = m.pagadoPor || '';
      if (m.tipo === 'ajuste') { if (f.has(quien)) f.get(quien).ajustes += v; continue; }
      if (m.tipo === 'ingreso') ing += v; else gas += v;
      if (!f.has(quien)) { sinSocio++; continue; }
      if (m.tipo === 'ingreso') f.get(quien).cobrado += v; else f.get(quien).pagado += v;
    }
    const n = socios.length || 1, parte = (ing - gas) / n;
    const filas = [...f.values()].map(x => {
      const neto = x.cobrado - x.pagado - x.ajustes;
      return { socio: x.socio, cobrado: r2(x.cobrado), pagado: r2(x.pagado), ajustes: r2(x.ajustes), neto: r2(neto), saldo: r2(neto - parte) };
    });
    return { filas, resultado: r2(ing - gas), parte: r2(parte), sinSocio };
  }
  function monedaDeVista(vista) { return vista === 'USD' || vista === 'TODO_USD' ? 'USD' : 'UYU'; }

  const r2 = n => Math.round(n * 100) / 100;

  function resumen(movs, vista, tc) {
    let ing = 0, gas = 0, n = 0;
    for (const m of movs) {
      const v = valor(m, vista, tc);
      if (v === null) continue;
      n++;
      if (m.tipo === 'ingreso') ing += v; else gas += v;
    }
    return { ingresos: r2(ing), gastos: r2(gas), resultado: r2(ing - gas), n };
  }

  function porCategoria(movs, tipo, vista, tc) {
    const mapa = new Map();
    let total = 0;
    for (const m of movs) {
      if (m.tipo !== tipo) continue;
      const v = valor(m, vista, tc);
      if (v === null) continue;
      mapa.set(m.categoria, (mapa.get(m.categoria) || 0) + v);
      total += v;
    }
    return Array.from(mapa.entries())
      .map(([categoria, t]) => ({ categoria, total: r2(t), pct: total ? t / total : 0 }))
      .sort((a, b) => b.total - a.total);
  }

  function siguienteMes(ym) {
    let y = Number(ym.slice(0, 4)), m = Number(ym.slice(5, 7)) + 1;
    if (m > 12) { m = 1; y++; }
    return y + '-' + pad(m);
  }
  // Un renglón por mes (también los meses sin movimientos) entre el primero y el último.
  function porMes(movs, vista, tc) {
    const filas = new Map();
    let min = null, max = null;
    for (const m of movs) {
      const v = valor(m, vista, tc);
      if (v === null) continue;
      const ym = m.fecha.slice(0, 7);
      if (!min || ym < min) min = ym;
      if (!max || ym > max) max = ym;
      const f = filas.get(ym) || { mes: ym, ingresos: 0, gastos: 0 };
      if (m.tipo === 'ingreso') f.ingresos += v; else f.gastos += v;
      filas.set(ym, f);
    }
    const out = [];
    if (!min) return out;
    for (let ym = min; ym <= max; ym = siguienteMes(ym)) {
      const f = filas.get(ym) || { mes: ym, ingresos: 0, gastos: 0 };
      out.push({ mes: ym, ingresos: r2(f.ingresos), gastos: r2(f.gastos), resultado: r2(f.ingresos - f.gastos) });
    }
    return out;
  }

  // Resultado por animal: solo los movimientos que se marcaron "para este animal".
  function porAnimal(movs, animales, vista, tc) {
    const nombres = new Map(animales.map(a => [a.id, a]));
    const mapa = new Map();
    for (const m of movs) {
      if (!m.animalId) continue;
      const v = valor(m, vista, tc);
      if (v === null) continue;
      const f = mapa.get(m.animalId) || { animalId: m.animalId, gastos: 0, ingresos: 0 };
      if (m.tipo === 'ingreso') f.ingresos += v; else f.gastos += v;
      mapa.set(m.animalId, f);
    }
    return Array.from(mapa.values()).map(f => ({
      animalId: f.animalId,
      animal: nombres.get(f.animalId) || { id: f.animalId, nombre: '(animal eliminado)' },
      gastos: r2(f.gastos), ingresos: r2(f.ingresos), resultado: r2(f.ingresos - f.gastos)
    })).sort((a, b) => a.resultado - b.resultado);
  }

  function cantidadMeses(p, movs) {
    let d = p.desde, h = p.hasta;
    if (!d || !h) {
      const fs = movs.map(m => m.fecha).sort();
      if (!fs.length) return 0;
      d = d || fs[0]; h = h || fs[fs.length - 1];
    }
    const hoyYm = hoy().slice(0, 7);
    let hm = h.slice(0, 7); if (hm > hoyYm && p.hasta) hm = hoyYm > d.slice(0, 7) ? hoyYm : d.slice(0, 7);
    return (Number(hm.slice(0, 4)) - Number(d.slice(0, 4))) * 12 + Number(hm.slice(5, 7)) - Number(d.slice(5, 7)) + 1;
  }

  function indicadores(movs, animales, p, vista, tc) {
    const res = resumen(movs, vista, tc);
    const meses = Math.max(1, cantidadMeses(p, movs));
    const activos = animales.filter(a => a.estado === 'Activo').length;
    const cats = porCategoria(movs, 'gasto', vista, tc);
    return {
      gastoMensual: r2(res.gastos / meses),
      ingresoMensual: r2(res.ingresos / meses),
      meses,
      animalesActivos: activos,
      gastoPorCabeza: activos ? r2(res.gastos / activos) : null,
      mayorGasto: cats[0] || null,
      margen: res.ingresos > 0 ? res.resultado / res.ingresos : null
    };
  }

  // ---------- formatos ----------
  function fmtNum(n, dec) {
    const neg = n < 0;
    const s = Math.abs(n).toFixed(dec === undefined ? 2 : dec);
    let [ent, fr] = s.split('.');
    ent = ent.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
    return (neg ? '-' : '') + ent + (fr ? ',' + fr : '');
  }
  function fmtMonto(n, moneda, dec) {
    const pref = moneda === 'USD' ? 'US$ ' : '$ ';
    const d = dec !== undefined ? dec : (Math.abs(n) >= 1000 ? 0 : 2);
    const neg = n < 0;
    return (neg ? '-' : '') + pref + fmtNum(Math.abs(n), d);
  }
  function fechaCorta(f) { return f ? f.slice(8, 10) + '/' + f.slice(5, 7) + '/' + f.slice(0, 4) : ''; }
  function mesTexto(ym) { return MESES[Number(ym.slice(5, 7)) - 1].slice(0, 3) + ' ' + ym.slice(2, 4); }
  function mesLargo(ym) { return MESES[Number(ym.slice(5, 7)) - 1] + ' ' + ym.slice(0, 4); }

  function csvCelda(v) {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",;\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }
  // Movimientos en CSV (separador ";", coma decimal: se abre bien en Excel en español).
  function aCsv(movs, animales, lotes) {
    const nom = new Map(animales.map(a => [a.id, a.nombre]));
    const lot = new Map((lotes || []).map(x => [x.id, x.nombre]));
    const filas = [['Fecha', 'Tipo', 'Categoría', 'Detalle', 'Proveedor / Comprador', 'Animal', 'Lote', 'Moneda', 'Monto', 'Cargó', 'N° comprobante', 'Verificado', 'Pagó / cobró']];
    for (const m of movs.slice().sort((a, b) => (a.fecha < b.fecha ? -1 : 1))) {
      filas.push([m.fecha, m.tipo === 'gasto' ? 'Gasto' : m.tipo === 'ajuste' ? 'Ajuste' : 'Ingreso', m.categoria, m.detalle, m.contraparte,
        nom.get(m.animalId) || '', lot.get(m.loteId) || '', m.moneda, String(m.monto).replace('.', ','), m.por, m.ref || '', m.verificado ? 'Sí' : '', m.pagadoPor || '']);
    }
    return '﻿' + filas.map(f => f.map(csvCelda).join(';')).join('\r\n');
  }

  // Lee un monto tal como lo escribe la persona: "1500", "1.500", "1.500,50", "1500.5", "1500,5".
  function parseMonto(txt) {
    let s = String(txt || '').replace(/[^\d.,]/g, '');
    if (!s) return NaN;
    if (s.indexOf(',') >= 0) s = s.replace(/\./g, '').replace(',', '.');
    else if (/^\d{1,3}(\.\d{3})+$/.test(s)) s = s.replace(/\./g, '');
    const n = Number(s);
    return isFinite(n) ? n : NaN;
  }


  // ---- Lecturas de caravanas (archivo TXT/CSV del bastón o lista pegada) ----
  // Compara sin importar espacios, puntos o guiones.
  const normCaravana = s => String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');

  // Devuelve { items:[{numero, norm, largo}], repetidos, ignoradas }.
  // Busca en cada línea el número electrónico (15 dígitos, ej. 982 000123456789); si no hay,
  // toma el primer dato que parezca un número de caravana. Los repetidos del archivo se juntan.
  function leerLecturas(texto) {
    const lineas = String(texto || '').replace(/^﻿/, '').split(/\r\n|\n|\r/);
    const vistos = new Set(), items = [];
    let repetidos = 0, ignoradas = 0;
    for (const crudo of lineas) {
      const linea = crudo.trim();
      if (!linea) continue;
      let numero = '', largo = false;
      const m = linea.match(/(?<!\d)0?(\d{3})[ .\-_]?(\d{12})(?!\d)/);
      if (m) { numero = m[1] + m[2]; largo = true; }
      else {
        for (const tk of linea.split(/[,;\t|]/)) {
          const t = tk.trim().replace(/^["']|["']$/g, '');
          if (/[\/:]/.test(t)) continue;                 // fechas y horas
          const dig = (t.match(/\d/g) || []).length;
          if (dig >= 4 && t.length <= 20) { numero = t; break; }
        }
      }
      if (!numero) { ignoradas++; continue; }
      const norm = normCaravana(numero);
      if (vistos.has(norm)) { repetidos++; continue; }
      vistos.add(norm);
      items.push({ numero, norm, largo });
    }
    return { items, repetidos, ignoradas };
  }

  // Compara una lectura con los animales ya cargados.
  // 'igual' = misma caravana; 'parecido' = un número corto que coincide con el final del largo (o al revés).
  function buscarDuplicado(norm, animales) {
    const soloNum = /^\d+$/.test(norm);
    let parecido = null;
    for (const a of animales) {
      const n = normCaravana(a.caravana);
      if (!n) continue;
      if (n === norm) return { tipo: 'igual', animal: a };
      if (!parecido && soloNum && /^\d+$/.test(n)) {
        const [corto, largo] = n.length < norm.length ? [n, norm] : [norm, n];
        if (corto.length >= 6 && largo.endsWith(corto)) parecido = { tipo: 'parecido', animal: a };
      }
    }
    return parecido;
  }

  // Nombre provisorio del animal: "Nº " + últimos 6 dígitos (o el número si es corto).
  function nombreDeLectura(it) {
    return 'Nº ' + (it.largo ? it.norm.slice(-6) : it.numero);
  }

  // ---- Lotes (invernada) ----
  function diasEntre(a, b) {
    const t = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
    return Math.round((t(b) - t(a)) / 86400000);
  }
  // Números de un lote: resultado, costo por kilo ganado, ganancia diaria, etc.
  // El costo por kilo ganado NO incluye la compra de la hacienda (rubros que dicen "compra").
  function indicadoresLote(lote, movs, vista, tc, hoyStr) {
    let ing = 0, gas = 0, gasSinCompra = 0, n = 0;
    for (const m of movs) {
      if (m.loteId !== lote.id) continue;
      const v = valor(m, vista, tc);
      if (v === null) continue;
      n++;
      if (m.tipo === 'ingreso') ing += v;
      else { gas += v; if (!/compra/i.test(m.categoria)) gasSinCompra += v; }
    }
    const cab = lote.cantidadActual || lote.cantidad;
    const pes = lote.pesadas || [];
    const ult = pes.length ? pes[pes.length - 1] : null;
    const fin = lote.estado === 'Cerrado' && lote.fechaCierre ? lote.fechaCierre : (hoyStr || hoy());
    const diasCampo = lote.fechaEntrada ? Math.max(0, diasEntre(lote.fechaEntrada, fin)) : null;
    let kgGanadosCab = null, gdp = null, kgProd = null, costoKg = null;
    if (ult && lote.pesoEntrada > 0) {
      kgGanadosCab = ult.pesoProm - lote.pesoEntrada;
      const d = lote.fechaEntrada ? diasEntre(lote.fechaEntrada, ult.fecha) : 0;
      if (d > 0) gdp = kgGanadosCab / d;
      kgProd = kgGanadosCab * cab;
      if (kgProd > 0) costoKg = gasSinCompra / kgProd;
    }
    return { n, ingresos: r2(ing), gastos: r2(gas), resultado: r2(ing - gas), gastosSinCompra: r2(gasSinCompra), cabezas: cab,
      margenCabeza: cab ? r2((ing - gas) / cab) : null, ult, diasCampo, kgGanadosCab, gdp, kgProd, costoKg };
  }

  const api = { diasEntre, indicadoresLote, normCaravana, leerLecturas, buscarDuplicado, nombreDeLectura, parseMonto, hoy, periodo, enPeriodo, valor, monedaDeVista, resumen, porCategoria, porMes, porAnimal, indicadores,
    fmtNum, fmtMonto, fechaCorta, mesTexto, mesLargo, aCsv, cantidadMeses };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  api.cuentaSocios = cuentaSocios;
  root.Gestion = api;
})(typeof window !== 'undefined' ? window : globalThis);
