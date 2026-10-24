/*
 * SIMULADOR DEL TP — logica de las dos pantallas (balanza y tablero) y de lo propio del TP.
 * Las reglas del aviso estan en reglas.js (la misma fuente que usa n8n). Todos los datos son ficticios.
 */

// ───────────────────────── Utilidades ─────────────────────────
const D = window.DATOS;
const $ = (id) => document.getElementById(id);
const val = (id) => $(id).value;
const num = (id) => { const v = $(id).value; return v === "" ? null : Number(v); };
const fmt = (n) => fmtKg(Number(n) || 0);
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
// Mayusculas, sin tildes, conserva la Ñ (mismo criterio que el sistema real)
const txt = (s) => String(s == null ? "" : s).toUpperCase().replace(/Ñ/g, "\u0001").normalize("NFD")
  .replace(/[̀-ͯ]/g, "").replace(/\u0001/g, "Ñ").replace(/\s+/g, " ").trim();
const pat = (s) => txt(s).replace(/[\s.\-]/g, "");
const hhmm = (min) => String(Math.floor(min / 60) % 24).padStart(2, "0") + ":" + String(Math.round(min) % 60).padStart(2, "0");
const aMin = (h) => { const p = (h || "0:0").split(":").map(Number); return p[0] * 60 + p[1]; };
const ahora = () => new Date().toTimeString().slice(0, 5);
const ahoraSeg = () => new Date().toTimeString().slice(0, 8);
const isoLocal = (d) => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
const HOY = isoLocal(new Date());
const dmy = (iso) => { const p = String(iso || "").split("-"); return p.length === 3 ? p[2] + "/" + p[1] + "/" + p[0] : iso; };
const nro6 = (n) => String(n || 0).padStart(6, "0");
const guardarLS = (k, v) => { try { localStorage.setItem(k, v); } catch (e) {} };
const leerLS = (k) => { try { return localStorage.getItem(k); } catch (e) { return null; } };
const borrarLS = (k) => { try { localStorage.removeItem(k); } catch (e) {} };

function toast(msg, color) {   // aviso de la pantalla de balanza
  document.querySelectorAll(".toast-b").forEach(t => t.remove());
  const d = document.createElement("div"); d.className = "toast-b"; d.textContent = msg;
  d.style.background = color || "#43a047"; document.body.appendChild(d); setTimeout(() => d.remove(), 3200);
}
function toastT(msg) {          // aviso del tablero
  const t = $("toast-t"); t.textContent = msg; t.classList.add("show"); setTimeout(() => t.classList.remove("show"), 2500);
}

// ───────────────────────── Estado ─────────────────────────
let abiertas, cerradas, rechazados, pasos, params, logs, avisos, nroSig, opActual, presSel = "", motivoRech = "", rechOp = null;
let dataAvic = [], calOp = null, corrOp = null, pantallaPrevia = "balanza";

/* Calidad y netos de una operacion cerrada (mismo criterio que el sistema real) */
function calcNetos(op) {
  const neto = Number(op.neto_total) || 0, esIng = op.tipo === "INGRESO";
  const prm = esIng ? parametroDeProducto(params, op.producto_nom) : null;
  let mermaPct = 0;
  if (esIng && prm && op.humedad != null && op.humedad > prm.humedad_base)
    mermaPct = Math.round((op.humedad - prm.humedad_base) / (100 - prm.humedad_base) * 10000) / 100;
  const descPct = esIng ? ["desc_otros", "desc_olor", "desc_amoh", "desc_cham", "desc_bich", "desc_vola"].reduce((s, k) => s + (Number(op[k]) || 0), 0) : 0;
  op.merma_pct = mermaPct; op.merma_kg = Math.round(neto * mermaPct / 100);
  op.desc_pct = Math.round(descPct * 1000) / 1000; op.desc_kg = Math.round(neto * descPct / 100);
  op.neto_final = neto - op.desc_kg - (op.aplica_merma ? op.merma_kg : 0);
  return op;
}

function log(evento, patente, detalle, operario) {
  const d = new Date();
  logs.unshift({ ts: dmy(isoLocal(d)) + " " + d.toTimeString().slice(0, 8), evento, patente: patente || "", detalle, operario: operario || "OPERADOR DEMO" });
}

function reiniciar(avisar) {
  // El historial ficticio se corre en el calendario para que termine ayer (asi "hoy" y "este mes" tienen sentido)
  const dias = Math.round((new Date(HOY + "T12:00") - new Date(D.fecha_simulada + "T12:00")) / 86400000);
  const correr = (iso) => { const d = new Date(iso + "T12:00"); d.setDate(d.getDate() + dias); return isoLocal(d); };
  params = JSON.parse(JSON.stringify(D.parametros)).map(p => Object.assign(p, { actualizado_en: "", actualizado_por: "" }));
  cerradas = JSON.parse(JSON.stringify(D.historial)).map(o => calcNetos(Object.assign(o, { fecha: correr(o.fecha) })));
  abiertas = JSON.parse(JSON.stringify(D.en_planta)).map(o => Object.assign(o, {
    fecha: HOY, cargas: [], ejemplo: true,
    salida_simulada: hhmm(aMin(o.hora_entrada) + (o.escenario.indexOf("PERMANENCIA") >= 0 ? 200 : 38))
  }));
  rechazados = []; logs = []; avisos = [];
  pasos = procesarLecturas(D.lecturas_camaras).pasos;
  nroSig = Math.max(...D.en_planta.map(o => o.nro)) + 1;
  log("INICIO", "", "DEMO CARGADA: " + cerradas.length + " OPERACIONES DE HISTORIAL Y " + abiertas.length + " CAMIONES EN PLANTA (DATOS FICTICIOS)", "SISTEMA");
  refrescarTodo();
  if (avisar) toast("DEMO REINICIADA", "#37474f");
}
function refrescarTodo() { cargarAbiertas(); cargarHistorial(); pintarTP(); if (document.body.classList.contains("ver-tablero")) recargarTablero(); }

// ───────────────────────── Reloj ─────────────────────────
function reloj() {
  const d = new Date();
  $("reloj").textContent = d.toTimeString().slice(0, 5);
  $("fecha").textContent = d.toLocaleDateString("es-AR", { weekday: "short", day: "2-digit", month: "2-digit" }).toUpperCase();
  $("reloj-t").textContent = d.toLocaleDateString("es-AR", { weekday: "long", day: "numeric", month: "long" }) + "  " + d.toLocaleTimeString("es-AR", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

// ───────────────────────── Pantallas ─────────────────────────
function verPantalla(p) {
  document.body.classList.remove("ver-balanza", "ver-tablero", "ver-comp");
  document.body.classList.add("ver-" + p);
  $("tp-v-balanza").className = p === "balanza" ? "on" : "";
  $("tp-v-tablero").className = p === "tablero" ? "on" : "";
  document.title = (p === "tablero" ? "TABLERO" : "INGRESO Y EGRESO") + " — SISTEMA DE PESADAS (SIMULADOR TP)";
  if (p === "tablero") recargarTablero();
  try { history.replaceState(null, "", location.pathname + location.search + (p === "tablero" ? "#tablero" : "")); } catch (e) {}
  cerrarTP(); window.scrollTo(0, 0);
}

// ───────────────────────── Balanza simulada (en la planta llega del indicador) ─────────────────────────
let pesoBal = 0, timerBal = null, estable = true;
function ponerPeso(kg) {
  const obj = Math.max(0, Math.round(kg / 20) * 20); let n = 0; clearInterval(timerBal); estable = false;
  timerBal = setInterval(() => {
    n++;
    pesoBal = Math.max(0, obj + (n < 8 ? Math.round((Math.random() - 0.5) * 800 / n / 20) * 20 : 0));
    if (n >= 8) { clearInterval(timerBal); estable = true; }
    pintarBalanza();
  }, 160);
}
function pintarBalanza() {
  $("b-disp").textContent = fmt(pesoBal);
  const e = $("b-est"); e.textContent = !estable ? "INESTABLE" : (pesoBal ? "ESTABLE ✓" : "VACÍA"); e.className = "tp-est " + (estable ? "ok" : "in");
  const h = $("est-bal");
  h.textContent = "BALANZA " + fmt(pesoBal) + " KG" + (estable ? (pesoBal ? " · ESTABLE" : "") : " · INESTABLE");
  h.className = "hl " + (estable ? "ok" : "in");
  // Como en el sistema real: el campo de peso visible toma la lectura estable, salvo que se haya tipeado a mano
  if (estable && pesoBal) document.querySelectorAll("#pb input.pb").forEach(inp => {
    if (inp.offsetParent !== null && !inp.dataset.editado) { inp.value = pesoBal; if (inp.id === "m-peso") netoModal(); }
  });
}

// ═════════════════════════ PANTALLA DE LA BALANZA ═════════════════════════
function irVista(v) {
  document.querySelectorAll("#pb .vista").forEach(e => e.classList.remove("on"));
  $("vista-" + v).classList.add("on");
  document.querySelectorAll("#pb nav button").forEach(b => b.classList.remove("on"));
  $("tab-" + v).classList.add("on");
  if (v === "planta") cargarAbiertas();
  if (v === "historial") cargarHistorial();
}
function toggleCalidad() {
  const c = $("cal-campos"); c.classList.toggle("on");
  $("cal-flecha").innerHTML = c.classList.contains("on") ? "&#9662;" : "&#9656;";
}
function refrescarCalidad() {
  const h = num("i-hum"), prm = parametroDeProducto(params, txt(val("i-prod")));
  $("cal-resumen").textContent = h ? "HUM " + h + "%" + (num("i-desc") ? " · DESC " + num("i-desc") + "%" : "") : (num("i-desc") ? "DESC " + num("i-desc") + "%" : "");
  const m = $("cal-merma"); m.textContent = "";
  if (h && prm && h > prm.humedad_base) {
    const pct = Math.round((h - prm.humedad_base) / (100 - prm.humedad_base) * 10000) / 100;
    m.textContent = "MERMA ESTIMADA " + String(pct).replace(".", ",") + " % (BASE " + prm.humedad_base + " %)" +
      ($("i-aplica-merma").checked ? " — SE DESCUENTA" : " — INFORMATIVA") +
      (prm.limite_rechazo != null && h > prm.limite_rechazo ? " · ⚠ SOBRE EL LÍMITE DE RECEPCIÓN: EVALUAR RECHAZO" : "");
  } else if (h && !prm) m.textContent = "CARGAR EL PRODUCTO PARA CALCULAR LA MERMA";
}
function limpiar(p) {
  document.querySelectorAll("#vista-" + (p === "i" ? "ingreso" : "egreso") + " input").forEach(i => {
    if (i.type === "checkbox") i.checked = false; else if (!i.disabled) i.value = ""; delete i.dataset.editado;
  });
  if (p === "i") { presSel = ""; document.querySelectorAll("#i-pres .pres").forEach(x => x.classList.remove("on")); refrescarCalidad(); }
}

/* Al registrar el ingreso, la camara de ENTRADA lee la patente (segun el modo elegido en el boton TP) */
function lecturaEntrada(patente, hora) {
  const modo = val("b-cam"); let leida = patente;
  if (modo === "nada") leida = "UNKNOWN";
  if (modo === "dudosa") { const i = patente.search(/0/); leida = i >= 0 ? patente.slice(0, i) + "O" + patente.slice(i + 1) : patente.slice(0, -1) + (patente.slice(-1) === "A" ? "B" : "A"); }
  if (modo === "otra") leida = "ZZ" + String(Math.floor(200 + Math.random() * 700)) + "XA";
  registrarLectura(pasos, { hora, patente: leida, camara: "ENTRADA", confianza: modo === "dudosa" ? 68 : 95 });
  if (leida !== "UNKNOWN") registrarLectura(pasos, { hora: hora.slice(0, 6) + String(Math.min(59, Number(hora.slice(6)) + 4)).padStart(2, "0"), patente: leida, camara: "SALIDA", confianza: 93 });
  pasos.sort((a, b) => a.hora < b.hora ? -1 : 1);
}

function iniciar(tipo) {
  const ing = tipo === "INGRESO", p = ing ? "i" : "e";
  const patente = pat(val(p + "-patente")), peso = num(p + "-peso"), faltan = [];
  if (!patente) faltan.push("PATENTE");
  if (ing && !txt(val("i-proveedor"))) faltan.push("PROVEEDOR");
  if (!txt(val(p + "-avicola"))) faltan.push("AVICOLA");
  if (ing && !txt(val("i-prod"))) faltan.push("PRODUCTO");
  if (!peso) faltan.push(ing ? "PESO BRUTO" : "TARA");
  if (faltan.length) { toast("FALTA: " + faltan.join(", "), "#c62828"); return; }
  if (abiertas.some(o => pat(o.patente) === patente)) { toast("ESA PATENTE YA ESTÁ EN PLANTA", "#c62828"); return; }
  const hora = ahoraSeg();
  const op = {
    nro: nroSig++, tipo, estado: "ABIERTA", fecha: HOY, hora_entrada: hora.slice(0, 5), patente,
    acoplado: pat(val(p + "-acoplado")), chofer: txt(val(p + "-chofer")), transporte: txt(val(p + "-transporte")),
    proveedor: ing ? txt(val("i-proveedor")) : "", avicola: txt(val(p + "-avicola")),
    producto_cod: ing ? txt(val("i-cod")) : "", producto_nom: ing ? txt(val("i-prod")) : "",
    destino: ing ? txt(val("i-destino")) : "", presentacion: ing ? presSel : "",
    observaciones: txt(val(p + "-obs")), peso_inicial: peso, cargas: [], operario: "OPERADOR DEMO"
  };
  if (ing) Object.assign(op, {
    humedad: num("i-hum"), temperatura: num("i-temp"), ph_valor: num("i-ph"), aplica_merma: $("i-aplica-merma").checked,
    desc_otros: num("i-desc") || 0, desc_olor: num("i-d-olor") || 0, desc_amoh: num("i-d-amoh") || 0,
    desc_cham: num("i-d-cham") || 0, desc_bich: num("i-d-bich") || 0, desc_vola: num("i-d-vola") || 0
  });
  abiertas.unshift(op);
  lecturaEntrada(patente, hora);
  log("AVIC_INICIO", patente, tipo + " · " + (ing ? op.proveedor + " · " + op.producto_nom + " · BRUTO " : op.avicola + " · TARA ") + fmt(peso) + " KG · N° " + nro6(op.nro));
  limpiar(p); ponerPeso(0);
  toast((ing ? "INGRESO REGISTRADO" : "DESPACHO INICIADO") + " — " + patente);
  irVista("planta"); pintarTP();
}

function cargarAbiertas() {
  const cont = $("lista");
  $("pill").textContent = abiertas.length;
  if (!abiertas.length) { cont.innerHTML = '<div class="vacio">NO HAY OPERACIONES ABIERTAS</div>'; return; }
  cont.innerHTML = abiertas.map((o, idx) => {
    const esIng = o.tipo === "INGRESO";
    const ultimo = o.cargas.length ? o.cargas[o.cargas.length - 1].peso_balanza : o.peso_inicial;
    const total = o.cargas.reduce((s, c) => s + c.neto, 0);
    const filas = o.cargas.map(c => '<div class="op-carga"><span class="n">' + c.orden + '</span><span class="g">' + esc(c.granja || "—") + '</span>' +
      '<span class="p">' + (c.producto_nom ? esc((c.producto_cod ? c.producto_cod + " " : "") + c.producto_nom) : '<span style="color:var(--r);">SIN PRODUCTO</span>') + '</span>' +
      '<span class="k">' + fmt(c.neto) + ' KG</span></div>').join("");
    const listo = esIng ? o.cargas.length === 1 : o.cargas.length > 0;
    return '<div class="op ' + (esIng ? "" : "egr") + '"><div class="op-top">' +
      '<span class="op-tag">' + (esIng ? "ING" : "EGR") + '</span><span class="op-nro">N° ' + nro6(o.nro) + '</span>' +
      '<div class="op-datos"><div class="op-pat">' + esc(o.patente) + '</div>' +
      '<div class="op-sub">' + esc(o.chofer || "—") + ' · ' + esc(esIng ? o.proveedor : o.avicola) + (esIng && o.producto_nom ? ' · ' + esc(o.producto_nom) : '') +
      (esIng && o.destino ? ' → ' + esc(o.destino) : '') + (esIng && o.presentacion ? ' (' + esc(o.presentacion) + ')' : '') + ' · ' + o.hora_entrada + '</div></div>' +
      '<div class="op-tot"><div class="et">' + (esIng ? "BRUTO INICIAL" : "TARA INICIAL") + '</div><div class="kg">' + fmt(o.peso_inicial) + '</div></div></div>' +
      (o.cargas.length ? '<div class="op-cargas">' + filas +
        '<div class="op-carga" style="border-top:2px solid #ddd;margin-top:4px;padding-top:8px;"><span class="g" style="font-weight:900;">TOTAL ' + (esIng ? "DESCARGADO" : "CARGADO") + '</span>' +
        '<span class="p">BALANZA: ' + fmt(ultimo) + ' KG</span><span class="k" style="font-size:15px;">' + fmt(total) + ' KG</span></div></div>' : '') +
      '<div class="op-btns">' +
      (esIng && o.cargas.length ? '' : '<button class="btn ' + (esIng ? "v" : "vd") + '" onclick="abrirCarga(' + idx + ')">' + (esIng ? "REGISTRAR TARA" : "AGREGAR CARGA") + '</button>') +
      (listo ? '<button class="btn g" onclick="cerrarOp(' + idx + ')">CERRAR Y EMITIR</button>' : '<button class="btn g" onclick="anular(' + idx + ')">ANULAR</button>') +
      '<button class="btn r" onclick="abrirRechazo(' + idx + ')" title="Rechazar camion">RECHAZAR</button>' +
      '</div></div>';
  }).join("");
}
function anular(idx) {
  const o = abiertas[idx];
  if (!confirm("¿ANULAR LA OPERACIÓN DE " + o.patente + "? NO QUEDA REGISTRADA COMO PESADA.")) return;
  abiertas.splice(idx, 1); log("AVIC_ANULADA", o.patente, "N° " + nro6(o.nro) + " ANULADA ANTES DE PESAR");
  cargarAbiertas(); pintarTP(); toast("OPERACIÓN ANULADA", "#37474f");
}

// Modal: tara (ingreso) o carga por granja (egreso)
function abrirCarga(idx) {
  const o = abiertas[idx]; opActual = o;
  const esIng = o.tipo === "INGRESO";
  const anterior = o.cargas.length ? o.cargas[o.cargas.length - 1].peso_balanza : o.peso_inicial;
  $("m-titulo").textContent = o.patente + "  ·  N° " + nro6(o.nro);
  $("m-sub").textContent = (esIng ? "BRUTO" : "PESO ANTERIOR") + ": " + fmt(anterior) + " KG";
  $("m-label").textContent = esIng ? "TARA (CAMION VACIO)" : "PESO EN BALANZA";
  $("m-neto-lbl").textContent = esIng ? "NETO DESCARGADO" : "NETO DE ESTA CARGA";
  $("m-campos").style.display = esIng ? "none" : "block";
  const inp = $("m-peso"); inp.value = ""; delete inp.dataset.editado;
  const prev = !esIng && o.cargas_previstas ? o.cargas_previstas[o.cargas.length] : null;
  $("m-granja").value = prev ? prev.granja : ""; $("m-cod").value = prev ? prev.producto_cod : ""; $("m-prod").value = prev ? prev.producto_nom : "";
  $("m-neto").textContent = "—";
  $("modal").classList.add("on");
  // En los casos de ejemplo el camion "sube" solo a la balanza con el peso previsto
  if (o.ejemplo) ponerPeso(esIng ? o.tara_sugerida : anterior + (prev ? prev.neto_sugerido : 9000));
  else if (pesoBal) pintarBalanza();
}
function netoModal() {
  if (!opActual) return;
  const esIng = opActual.tipo === "INGRESO", v = Number(val("m-peso"));
  const anterior = opActual.cargas.length ? opActual.cargas[opActual.cargas.length - 1].peso_balanza : opActual.peso_inicial;
  $("m-neto").textContent = v ? fmt(esIng ? anterior - v : v - anterior) + " KG" : "—";
}
function confirmarCarga() {
  const o = opActual, esIng = o.tipo === "INGRESO", v = Number(val("m-peso"));
  const anterior = o.cargas.length ? o.cargas[o.cargas.length - 1].peso_balanza : o.peso_inicial;
  if (!v) { toast("FALTA EL PESO", "#c62828"); return; }
  if (!esIng && (!txt(val("m-granja")) || !txt(val("m-prod")))) { toast("FALTA GRANJA O PRODUCTO", "#c62828"); return; }
  const c = {
    orden: o.cargas.length + 1, granja: esIng ? "" : txt(val("m-granja")),
    producto_cod: esIng ? (o.producto_cod || "") : txt(val("m-cod")), producto_nom: esIng ? o.producto_nom : txt(val("m-prod")),
    peso_balanza: v, neto: esIng ? anterior - v : v - anterior, hora: o.ejemplo ? o.salida_simulada : ahora()
  };
  o.cargas.push(c);
  log("AVIC_CARGA", o.patente, esIng ? "TARA " + fmt(v) + " KG · NETO " + fmt(c.neto) + " KG" : "CARGA " + c.orden + " · " + c.granja + " · " + c.producto_nom + " · " + fmt(c.neto) + " KG");
  cerrarModal("modal"); ponerPeso(0); cargarAbiertas();
  toast(esIng ? "TARA REGISTRADA" : "CARGA " + c.orden + " REGISTRADA");
}
function cerrarModal(id) { $(id).classList.remove("on"); if (id === "modal") opActual = null; }

/* Cierre: arma la operacion con el formato del sistema real, emite y genera el aviso */
function cerrarOp(idx) {
  const ab = abiertas[idx];
  const op = JSON.parse(JSON.stringify(ab));
  ["escenario", "tara_sugerida", "cargas_previstas", "ejemplo", "salida_simulada"].forEach(k => delete op[k]);
  op.estado = "CERRADA"; op.hora_salida = ab.ejemplo ? ab.salida_simulada : ahora();
  op.peso_final = op.cargas[op.cargas.length - 1].peso_balanza;
  op.neto_total = op.cargas.reduce((s, c) => s + c.neto, 0);
  if (op.tipo === "EGRESO") { op.humedad = null; op.aplica_merma = false; }
  ["desc_otros", "desc_olor", "desc_amoh", "desc_cham", "desc_bich", "desc_vola"].forEach(k => { if (op[k] == null) op[k] = 0; });
  calcNetos(op);
  abiertas.splice(idx, 1);
  registrarLectura(pasos, { hora: ab.ejemplo ? op.hora_salida + ":05" : ahoraSeg(), patente: op.patente, camara: "SALIDA", confianza: 95 });
  pasos.sort((a, b) => a.hora < b.hora ? -1 : 1);
  const ev = armarEvento(op, { planta: D.planta, parametros: params }, cerradas, pasos, "SIMULADOR");
  cerradas.push(op);
  log("AVIC_CIERRE", op.patente, op.tipo + " NETO " + fmt(op.neto_total) + " KG · CARGAS " + op.cargas.length + " · COMP " + nro6(op.nro) +
    (op.merma_kg || op.desc_kg ? " | MERMA " + op.merma_pct + "% (" + fmt(op.merma_kg) + " KG) DESC " + op.desc_pct + "% (" + fmt(op.desc_kg) + " KG) → FINAL " + fmt(op.neto_final) + " KG" : ""));
  toast("OPERACION CERRADA — COMPROBANTE N° " + nro6(op.nro));
  cargarAbiertas(); irVista("historial"); pintarTP();
  procesar(ev, op);
}

// Rechazo
function abrirRechazo(idx) {
  rechOp = abiertas[idx]; motivoRech = "";
  $("mr-sub").textContent = rechOp.patente + " · N° " + nro6(rechOp.nro) + " · " + (rechOp.tipo === "INGRESO" ? rechOp.proveedor : rechOp.avicola);
  $("mr-obs").value = "";
  document.querySelectorAll("#mr-motivos .pres").forEach(b => b.classList.remove("on"));
  $("modal-rech").classList.add("on");
}
function confirmarRechazo() {
  if (!motivoRech) { toast("ELEGÍ EL MOTIVO DEL RECHAZO", "#c62828"); return; }
  const o = rechOp, i = abiertas.indexOf(o);
  if (i >= 0) abiertas.splice(i, 1);
  Object.assign(o, { estado: "RECHAZADA", motivo_rechazo: motivoRech, observaciones: txt(val("mr-obs")), hora_salida: ahora() });
  rechazados.unshift(o);
  log("AVIC_RECHAZO", o.patente, "N° " + nro6(o.nro) + " · " + motivoRech + (o.observaciones ? " · " + o.observaciones : ""));
  cerrarModal("modal-rech"); cargarAbiertas(); pintarTP();
  toast("CAMIÓN RECHAZADO — " + o.patente, "#c62828");
}

// Historial (ultimas 200 cerradas)
function historialOrdenado() { return cerradas.slice().sort((a, b) => b.nro - a.nro).slice(0, 200); }
function cargarHistorial() {
  const cont = $("hist"), rows = historialOrdenado();
  if (!rows.length) { cont.innerHTML = '<div class="vacio">SIN OPERACIONES CERRADAS</div>'; return; }
  cont.innerHTML = '<table class="tabla-hist"><thead><tr><th>N°</th><th>FECHA</th><th>TIPO</th><th>PATENTE</th><th>DESTINO / ORIGEN</th><th class="r">NETO KG</th><th></th></tr></thead><tbody>' +
    rows.map(o => {
      const esIng = o.tipo === "INGRESO", ref = esIng ? (o.proveedor || "—") : (o.avicola || "—");
      const det = esIng ? (o.producto_nom || "") + (o.destino ? " → " + o.destino : "") : o.cargas.length + " GRANJA" + (o.cargas.length > 1 ? "S" : "");
      return '<tr><td><strong>' + nro6(o.nro) + '</strong></td>' +
        '<td>' + dmy(o.fecha) + '<br><span style="color:#888;font-size:11px;">' + o.hora_entrada + ' - ' + (o.hora_salida || "—") + '</span></td>' +
        '<td><span class="op-tag" style="background:' + (esIng ? "#e8f5e9" : "#e0f2f1") + ';">' + (esIng ? "ING" : "EGR") + '</span></td>' +
        '<td><strong>' + esc(o.patente) + '</strong>' + (o.acoplado ? '<br><span style="color:#888;font-size:11px;">' + esc(o.acoplado) + '</span>' : '') + '</td>' +
        '<td>' + esc(ref) + '<br><span style="color:#888;font-size:11px;">' + esc(det) + '</span></td>' +
        '<td class="r"><strong style="font-size:15px;">' + fmt(o.neto_total) + '</strong></td>' +
        '<td style="white-space:nowrap;"><button class="btn-imp" onclick="corregirHist(' + o.nro + ')" title="Corregir producto o granja" style="margin-right:4px;">&#9998;</button>' +
        '<button class="btn-imp" onclick="imprimirNro(' + o.nro + ')" title="Imprimir comprobante">&#128424;</button></td></tr>';
    }).join("") + '</tbody></table>';
}
const opPorNro = (n) => cerradas.find(o => o.nro === n);

// Correccion de datos (los pesos no se modifican)
function corregirHist(n) {
  const o = opPorNro(n); if (!o) return; corrOp = o;
  $("mc-titulo").textContent = "CORREGIR DATOS · N° " + nro6(o.nro);
  $("mc-sub").textContent = o.patente + " · " + (o.tipo === "INGRESO" ? o.proveedor : o.avicola);
  const campo = (id, lbl, v) => '<div class="f" style="margin-bottom:10px;"><label>' + lbl + '</label><input id="' + id + '" value="' + esc(v || "") + '"></div>';
  $("mc-campos").innerHTML = o.tipo === "INGRESO"
    ? '<div class="par-prod">' + campo("mc-cod", "COD", o.producto_cod) + campo("mc-prod", "PRODUCTO", o.producto_nom) + '</div>' + campo("mc-dest", "DESTINO", o.destino)
    : o.cargas.map((c, i) => '<div style="font-size:11px;font-weight:900;color:#888;margin:6px 0;">CARGA ' + c.orden + ' · ' + fmt(c.neto) + ' KG</div>' +
        '<div class="grilla">' + campo("mc-g-" + i, "GRANJA", c.granja) + campo("mc-p-" + i, "PRODUCTO", c.producto_nom) + '</div>').join("");
  $("mc-motivo").value = "";
  $("modal-corr").classList.add("on");
}
function guardarCorreccion() {
  const o = corrOp, motivo = txt(val("mc-motivo"));
  if (!motivo) { toast("FALTA EL MOTIVO DE LA CORRECCIÓN", "#c62828"); return; }
  const antes = JSON.stringify(o.tipo === "INGRESO" ? [o.producto_cod, o.producto_nom, o.destino] : o.cargas.map(c => [c.granja, c.producto_nom]));
  if (o.tipo === "INGRESO") { o.producto_cod = txt(val("mc-cod")); o.producto_nom = txt(val("mc-prod")); o.destino = txt(val("mc-dest")); calcNetos(o); }
  else o.cargas.forEach((c, i) => { c.granja = txt(val("mc-g-" + i)); c.producto_nom = txt(val("mc-p-" + i)); });
  log("AVIC_CORRECCION", o.patente, "N° " + nro6(o.nro) + " · " + motivo + " · ANTES " + antes);
  cerrarModal("modal-corr"); cargarHistorial(); toast("CORRECCIÓN GUARDADA");
}

// Comprobante media A4 x2 (original y duplicado)
function imprimirNro(n) { const o = opPorNro(n); if (o) comprobante(o); }
function comprobante(o) {
  const esIng = o.tipo === "INGRESO", bt = brutoTara(o), neto = o.neto_total;
  const filas = esIng ? "" : o.cargas.map(c => '<tr><td>' + c.orden + '</td><td>' + esc(c.granja || "—") + '</td><td>' + esc(c.producto_cod || "") + '</td><td>' + esc(c.producto_nom || "—") + '</td><td class="r">' + fmt(c.neto) + '</td></tr>').join("");
  const dato = (k, v) => '<div class="cp-dato"><span class="k">' + k + '</span><span class="v">' + esc(v || "—") + '</span></div>';
  const bloque = (copia) => '<div class="comp"><div class="cp-marca">' + copia + '</div>' +
    '<div class="cp-cab"><div class="emp">REGISTRO DE PESADA</div><div class="tipo">' + (esIng ? "INGRESO — MATERIA PRIMA" : "EGRESO — ALIMENTO PRODUCIDO") + '</div></div>' +
    '<div class="cp-meta"><span>COMPROBANTE N° <b>' + nro6(o.nro) + '</b></span><span>' + dmy(o.fecha) + ' · ENT ' + o.hora_entrada + ' · SAL ' + (o.hora_salida || "—") + '</span></div>' +
    '<div class="cp-datos">' + dato("PATENTE CHASIS", o.patente) + dato("ACOPLADO", o.acoplado) + dato("CHOFER", o.chofer) +
    (esIng ? dato("PROVEEDOR", o.proveedor) + dato("AVICOLA", o.avicola) + dato("PRODUCTO", o.producto_nom) + dato("TRANSPORTE", o.transporte)
           : dato("AVICOLA", o.avicola) + dato("TRANSPORTE", o.transporte)) + '</div>' +
    (esIng ? '' : '<table class="cp-tabla"><thead><tr><th>#</th><th>GRANJA DESTINO</th><th>COD.</th><th>PRODUCTO</th><th class="r">NETO KG</th></tr></thead><tbody>' + filas + '</tbody></table>') +
    '<div class="cp-pesos"><div class="cp-peso"><div class="k">BRUTO</div><div class="v">' + fmt(bt.bruto) + '</div></div>' +
    '<div class="cp-peso"><div class="k">TARA</div><div class="v">' + fmt(bt.tara) + '</div></div>' +
    '<div class="cp-peso neto"><div class="k">NETO KG</div><div class="v">' + fmt(neto) + '</div></div></div>' +
    '<div class="cp-firmas"><div class="cp-firma">FIRMA OPERARIO</div><div class="cp-firma">FIRMA CHOFER</div></div></div>';
  $("hoja").innerHTML = bloque("ORIGINAL") + bloque("DUPLICADO");
  pantallaPrevia = document.body.classList.contains("ver-tablero") ? "tablero" : "balanza";
  document.body.classList.add("ver-comp"); window.scrollTo(0, 0);
}
function volverComp() { document.body.classList.remove("ver-comp"); if (pantallaPrevia === "balanza") irVista("historial"); }
window.onafterprint = () => { if (document.body.classList.contains("ver-comp")) volverComp(); };

// ═════════════════════════ TABLERO (PC ADMINISTRATIVA) ═════════════════════════
function irVistaT(v) {
  document.querySelectorAll("#pt .view").forEach(e => e.classList.remove("activo"));
  $("vt-" + v).classList.add("activo");
  document.querySelectorAll("#pt .nav-item").forEach(n => n.classList.toggle("activo", n.dataset.v === v));
  $("pt").classList.toggle("vista-compacta", v === "patentes" || v === "logs");
  ({ avicola: cargarAvicolaT, pendientes: cargarPendientesT, rechazados: cargarRechazadosT, patentes: cargarPatentesT, logs: cargarLogsT, parametros: cargarParametrosT })[v]();
}
function recargarTablero() {
  cargarKPIT(); cargarAvicolaT(); cargarPendientesT(); cargarRechazadosT(); cargarPatentesT(); cargarLogsT(); cargarParametrosT();
}
function cargarKPIT() {
  const hoy = cerradas.filter(o => o.fecha === HOY), mes = cerradas.filter(o => o.fecha.slice(0, 7) === HOY.slice(0, 7));
  $("kpi-n").textContent = hoy.length;
  $("kpi-n-sub").textContent = hoy.filter(o => o.tipo === "INGRESO").length + " ingresos · " + hoy.filter(o => o.tipo === "EGRESO").length + " egresos";
  $("kpi-planta").textContent = abiertas.length;
  $("kpi-mes").textContent = mes.length;
  $("kpi-rech").textContent = rechazados.filter(o => o.fecha === HOY).length;
  $("badge-pend").textContent = abiertas.length;
}
function cargarAvicolaT() {
  const quien = txt(val("fa-quien")), tipo = val("fa-tipo"), desde = val("fa-desde"), hasta = val("fa-hasta");
  let rows = cerradas.slice().sort((a, b) => b.nro - a.nro);
  if (quien) rows = rows.filter(o => (o.proveedor || "").includes(quien) || (o.avicola || "").includes(quien));
  if (tipo) rows = rows.filter(o => o.tipo === tipo);
  if (desde) rows = rows.filter(o => o.fecha >= desde);
  if (hasta) rows = rows.filter(o => o.fecha <= hasta);
  dataAvic = rows;
  $("dl-quien").innerHTML = [...new Set(cerradas.flatMap(o => [o.proveedor, o.avicola]).filter(Boolean))].sort().map(v => '<option value="' + esc(v) + '">').join("");
  $("cnt-avic").textContent = rows.length + " operaciones"; $("badge-avic").textContent = rows.length;
  cargarKPIT(); pintarTotalesT(rows);
  const tb = $("body-avic");
  if (!rows.length) { tb.innerHTML = '<tr><td colspan="11" class="empty"><div class="empty-ico">&#8645;</div><div>Sin operaciones en el periodo</div></td></tr>'; return; }
  tb.innerHTML = rows.map((o, i) => {
    const esIng = o.tipo === "INGRESO";
    const tag = esIng ? '<span style="background:#e8f5e9;color:#2e7d32;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">ING</span>'
                      : '<span style="background:#eceff1;color:#37474f;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:700;">EGR</span>';
    const sinProd = esIng ? !o.producto_nom : o.cargas.some(c => !(c.producto_nom || "").trim());
    const det = esIng ? (o.producto_nom || '<span style="color:#c62828;font-weight:700;">SIN PRODUCTO</span>') + (o.destino ? ' <span style="color:#999;">&rarr; ' + esc(o.destino) + '</span>' : '') + (o.presentacion ? ' <span style="color:#999;font-size:11px;">(' + esc(o.presentacion) + ')</span>' : '')
                      : o.cargas.length + ' granja' + (o.cargas.length !== 1 ? 's' : '') + (sinProd ? ' <span style="color:#c62828;font-weight:700;">· FALTA PRODUCTO</span>' : '');
    const cargasHtml = esIng ? '' : '<div style="padding:10px 14px;background:#fafafa;border-top:1px solid #eee;"><table style="width:auto;font-size:12px;"><thead><tr><th>#</th><th>Granja</th><th>Cod.</th><th>Producto</th><th class="r">Balanza</th><th class="r">Neto</th><th>Hora</th></tr></thead><tbody>' +
      o.cargas.map(c => '<tr><td>' + c.orden + '</td><td><strong>' + esc(c.granja || "--") + '</strong></td><td style="color:#888;">' + esc(c.producto_cod || "") + '</td><td>' + esc(c.producto_nom || "--") + '</td><td class="r">' + fmt(c.peso_balanza) + '</td><td class="r"><strong>' + fmt(c.neto) + '</strong></td><td style="color:#888;">' + (c.hora || "") + '</td></tr>').join("") + '</tbody></table></div>';
    const pesos = esIng ? 'Bruto ' + fmt(o.peso_inicial) + ' &middot; Tara ' + fmt(o.peso_final) : 'Tara ' + fmt(o.peso_inicial) + ' &middot; Final ' + fmt(o.peso_final);
    const calidad = esIng && (o.humedad != null || o.desc_pct) ? ' &middot; Humedad ' + (o.humedad != null ? o.humedad + '%' : '--') + (o.merma_kg ? ' (merma ' + o.merma_pct + '% = ' + fmt(o.merma_kg) + ' kg' + (o.aplica_merma ? ', aplicada' : ', informativa') + ')' : '') + (o.desc_pct ? ' &middot; Descuentos ' + o.desc_pct + '% = ' + fmt(o.desc_kg) + ' kg' : '') : '';
    const base = o.neto_total - (o.neto_final || o.neto_total);
    return '<tr class="fila" onclick="toggleAvic(this,' + i + ')">' +
      '<td style="color:#999;font-size:12px;">' + nro6(o.nro) + '</td><td><strong>' + dmy(o.fecha) + '</strong></td>' +
      '<td style="color:#666;">' + o.hora_entrada + '</td><td style="color:#666;">' + (o.hora_salida || "--") + '</td><td>' + tag + '</td>' +
      '<td><strong style="font-size:15px;">' + esc(o.patente) + '</strong>' + (o.acoplado ? '<br><span style="color:#999;font-size:11px;">' + esc(o.acoplado) + '</span>' : '') + '</td>' +
      '<td style="font-size:13px;">' + esc(o.chofer || "--") + '</td><td>' + esc(esIng ? o.proveedor : o.avicola) + '</td><td style="font-size:13px;">' + det + '</td>' +
      '<td class="neto">' + fmt(o.neto_final || o.neto_total) + (base > 0 ? '<br><span style="font-size:11px;color:#ff8f00;font-weight:600;">base ' + fmt(o.neto_total) + ' &minus; ' + fmt(base) + '</span>' : '') + '</td>' +
      '<td style="white-space:nowrap;">' +
        (esIng ? '<button class="btn-imp" onclick="event.stopPropagation();abrirCalidad(' + i + ')" title="Cargar control de calidad" style="margin-right:4px;">&#128167;</button>' : '') +
        '<button class="btn-imp" onclick="event.stopPropagation();informePDF(' + i + ')" title="' + (esIng ? 'Informe de calidad y descuentos (PDF)' : 'Detalle de despacho (PDF)') + '" style="margin-right:4px;">&#128196;</button>' +
        '<button class="btn-imp" onclick="event.stopPropagation();comprobante(dataAvic[' + i + '])" title="Imprimir comprobante">&#128424;</button></td></tr>' +
      '<tr class="detalle-row" id="deta-' + i + '" style="display:none;"><td colspan="11" style="padding:0;"><div style="padding:10px 14px;font-size:12px;color:#666;white-space:normal;">' + pesos + (o.transporte ? ' &middot; Transporte: ' + esc(o.transporte) : '') + calidad + '</div>' + cargasHtml + '</td></tr>';
  }).join("");
}
function toggleAvic(tr, i) { const d = $("deta-" + i), v = d.style.display !== "none"; d.style.display = v ? "none" : "table-row"; tr.classList.toggle("expandida", !v); }
function totalesT(rows) {
  const t = { ing: 0, egr: 0, kgIng: 0, kgEgr: 0 };
  rows.forEach(o => { const kg = Number(o.neto_final || o.neto_total || 0); if (o.tipo === "INGRESO") { t.ing++; t.kgIng += kg; } else { t.egr++; t.kgEgr += kg; } });
  return t;
}
function pintarTotalesT(rows) {
  const f = $("foot-avic"); if (!rows.length) { f.innerHTML = ""; return; }
  const t = totalesT(rows), partes = [];
  if (t.ing) partes.push("INGRESOS: " + t.ing + " &middot; " + fmt(t.kgIng) + " KG");
  if (t.egr) partes.push("EGRESOS: " + t.egr + " &middot; " + fmt(t.kgEgr) + " KG");
  f.innerHTML = '<tr><td colspan="9">TOTAL: ' + rows.length + ' OPERACIONES &nbsp;|&nbsp; ' + partes.join(" &nbsp;|&nbsp; ") + '</td><td class="r neto">' + (t.ing && t.egr ? "" : fmt(t.kgIng + t.kgEgr)) + '</td><td></td></tr>';
}
function cargarPendientesT() {
  $("cnt-pend").textContent = abiertas.length; $("badge-pend").textContent = abiertas.length;
  const div = $("pend-body");
  if (!abiertas.length) { div.innerHTML = '<div class="empty"><div class="empty-ico">&#128667;</div><div>No hay camiones en planta</div></div>'; return; }
  div.innerHTML = '<div class="pend-grid">' + abiertas.map(o => {
    const esIng = o.tipo === "INGRESO", cargado = o.cargas.reduce((s, c) => s + c.neto, 0);
    const cargasTxt = o.cargas.length ? o.cargas.map(c => '<div class="pend-fila" style="font-size:12px;">&nbsp;&nbsp;' + c.orden + '. ' + esc(c.granja || "--") + ' &middot; ' + esc(c.producto_nom || "--") + ' &middot; <strong>' + fmt(c.neto) + ' kg</strong></div>').join("")
                                      : '<div class="pend-fila" style="font-size:12px;color:#999;">&nbsp;&nbsp;Sin cargas todav&#237;a</div>';
    return '<div class="pend-card" style="border-left:5px solid ' + (esIng ? "#43a047" : "#37474f") + ';">' +
      '<div class="pend-patente">' + esc(o.patente) + '<span class="tag" style="font-size:11px;margin-left:8px;background:' + (esIng ? "#e8f5e9" : "#eceff1") + ';color:' + (esIng ? "#2e7d32" : "#37474f") + ';">' + o.tipo + '</span><span style="font-size:11px;margin-left:6px;color:#888;font-weight:700;">N° ' + nro6(o.nro) + '</span></div>' +
      '<div class="pend-fila">' + (esIng ? "&#127968; <strong>" + esc(o.proveedor || "--") + "</strong>" : "&#128020; <strong>" + esc(o.avicola || "--") + "</strong>") + '</div>' +
      (esIng ? '<div class="pend-fila">&#127981; ' + esc(o.producto_nom || "--") + (o.destino ? " &rarr; " + esc(o.destino) : "") + '</div>' : '') +
      '<div class="pend-fila">&#128101; ' + esc(o.chofer || "--") + '</div>' +
      '<div class="pend-fila">&#128337; <strong>' + o.hora_entrada + '</strong> &middot; ' + dmy(o.fecha) + '</div>' +
      '<div class="pend-peso">' + fmt(o.peso_inicial) + ' kg ' + (esIng ? "bruto" : "tara") + (cargado ? ' &middot; ' + (esIng ? "descargado" : "cargado") + ' ' + fmt(cargado) + ' kg' : '') + '</div>' +
      (esIng ? '' : cargasTxt) + '</div>';
  }).join("") + '</div>';
}
function cargarRechazadosT() {
  $("cnt-rech").textContent = rechazados.length;
  $("body-rech").innerHTML = rechazados.length ? rechazados.map(o => '<tr><td><strong>' + dmy(o.fecha) + '</strong></td><td style="color:#666;">' + o.hora_salida + '</td><td><strong>' + esc(o.patente) + '</strong></td>' +
    '<td>' + esc(o.tipo === "INGRESO" ? o.proveedor : o.avicola) + '</td><td>' + esc(o.producto_nom || "--") + '</td><td class="r">' + (o.humedad != null ? o.humedad : "--") + '</td>' +
    '<td><span class="log-evento log-rechazo">' + esc(o.motivo_rechazo) + '</span></td><td>' + esc(o.operario) + '</td><td style="font-size:13px;color:#666;">' + esc(o.observaciones || "") + '</td></tr>').join("")
    : '<tr><td colspan="9" class="empty"><div class="empty-ico">&#9940;</div><div>Sin camiones rechazados</div></td></tr>';
}
function cargarPatentesT() {
  const f = pat(val("fp-pat"));
  const rows = pasos.slice().reverse().filter(p => !f || p.patente.includes(f));
  $("cnt-pat").textContent = rows.length;
  $("body-pat").innerHTML = rows.length ? rows.map(p => {
    const conf = p.confianza || 0, color = conf >= 80 ? "#2e7d32" : conf >= 50 ? "#f9a825" : "#c62828";
    const patTxt = p.patente !== "UNKNOWN" ? '<strong style="font-size:15px;letter-spacing:.5px;">' + esc(p.patente) + '</strong>' : '<span style="color:#c62828;font-size:13px;">SIN LECTURA</span>';
    return '<tr><td><strong>' + dmy(HOY) + '</strong></td><td style="color:#666;">' + p.hora + '</td><td>' + patTxt + '</td><td style="font-size:13px;color:#666;">' + esc(p.camara) + '</td>' +
      '<td class="r"><span style="color:' + color + ';font-weight:700;">' + (conf ? conf + "%" : "--") + '</span></td><td><span style="color:#ccc;font-size:12px;">--</span></td></tr>';
  }).join("") : '<tr><td colspan="6" class="empty"><div class="empty-ico">&#128247;</div><div>Sin capturas para esa b&#250;squeda</div></td></tr>';
}
function cargarLogsT() {
  $("cnt-logs").textContent = logs.length + " eventos";
  const cls = (e) => /INICIO$/.test(e) && e !== "INICIO" ? "log-entrada" : /CIERRE/.test(e) ? "log-salida" : /RECHAZO|ANULADA/.test(e) ? "log-rechazo" : /CORRECCION|CALIDAD|PARAMETRO/.test(e) ? "log-correccion" : "log-default";
  $("body-logs").innerHTML = logs.map(l => '<tr><td style="color:#666;font-size:13px;">' + l.ts + '</td><td><span class="log-evento ' + cls(l.evento) + '">' + esc(l.evento) + '</span></td>' +
    '<td><strong>' + esc(l.patente || "--") + '</strong></td><td style="font-size:13px;white-space:normal;">' + esc(l.detalle) + '</td><td style="font-size:13px;">' + esc(l.operario) + '</td></tr>').join("");
}
function cargarParametrosT() {
  $("body-param").innerHTML = params.map((x, i) => '<tr><td><b>' + x.producto + '</b></td>' +
    '<td><input class="f-inp" id="pb-' + i + '" type="number" step="0.1" value="' + x.humedad_base + '" style="width:100px;"></td>' +
    '<td><input class="f-inp" id="pl-' + i + '" type="number" step="0.1" value="' + (x.limite_rechazo == null ? "" : x.limite_rechazo) + '" placeholder="SIN L&Iacute;MITE" style="width:130px;"></td>' +
    '<td style="font-size:12px;color:#777;">' + (x.actualizado_en || "") + (x.actualizado_por ? ' &middot; ' + x.actualizado_por : '') + '</td>' +
    '<td><button class="btn-export" onclick="guardarParametroT(' + i + ')">GUARDAR</button></td></tr>').join("");
}
function guardarParametroT(i) {
  const x = params[i], base = parseFloat(val("pb-" + i)), limTxt = val("pl-" + i).trim(), lim = limTxt === "" ? null : parseFloat(limTxt);
  if (isNaN(base)) { alert("CARGAR LA HUMEDAD BASE."); return; }
  const motivo = prompt("MOTIVO DEL CAMBIO DE " + x.producto + " (QUEDA EN LOS LOGS):");
  if (!motivo || !motivo.trim()) return;
  const antes = "BASE " + x.humedad_base + " / LIMITE " + (x.limite_rechazo == null ? "SIN LIMITE" : x.limite_rechazo);
  x.humedad_base = base; x.limite_rechazo = lim; x.actualizado_en = dmy(HOY) + " " + ahora(); x.actualizado_por = "TABLERO";
  log("PARAMETRO", "", x.producto + ": " + antes + " → BASE " + base + " / LIMITE " + (lim == null ? "SIN LIMITE" : lim) + " · " + txt(motivo), "TABLERO");
  alert(x.producto + " ACTUALIZADO."); cargarParametrosT();
}
// Control de calidad desde el tablero (como en el sistema real)
function abrirCalidad(i) {
  calOp = dataAvic[i]; if (!calOp) return;
  $("cal-titulo").textContent = "Control de calidad — N° " + nro6(calOp.nro);
  $("cal-sub").textContent = calOp.patente + " · " + (calOp.producto_nom || "sin producto") + " · neto base " + fmt(calOp.neto_total) + " kg";
  $("mcal-hum").value = calOp.humedad == null ? "" : calOp.humedad;
  $("mcal-otros").value = calOp.desc_otros || "";
  $("mcal-aplica").checked = !!calOp.aplica_merma; $("mcal-motivo").value = "";
  previewCalidad(); $("modal-calidad").classList.add("on");
}
function previewCalidad() {
  const tmp = calcNetos(Object.assign({}, calOp, { humedad: num("mcal-hum"), desc_otros: num("mcal-otros") || 0, aplica_merma: $("mcal-aplica").checked }));
  $("mcal-prev").innerHTML = "MERMA " + tmp.merma_pct + "% = " + fmt(tmp.merma_kg) + " KG " + (tmp.aplica_merma ? "(SE DESCUENTA)" : "(INFORMATIVA)") +
    "<br>DESCUENTOS " + tmp.desc_pct + "% = " + fmt(tmp.desc_kg) + " KG<br>NETO FINAL: <span style='color:#43a047;font-size:16px;'>" + fmt(tmp.neto_final) + " KG</span>";
}
function guardarCalidad() {
  const motivo = txt(val("mcal-motivo"));
  if (!motivo) { alert("CARGAR EL MOTIVO."); return; }
  Object.assign(calOp, { humedad: num("mcal-hum"), desc_otros: num("mcal-otros") || 0, aplica_merma: $("mcal-aplica").checked });
  calcNetos(calOp);
  log("AVIC_CALIDAD", calOp.patente, "N° " + nro6(calOp.nro) + " · HUM " + (calOp.humedad == null ? "--" : calOp.humedad) + "% · OTROS " + calOp.desc_otros + "% · MERMA " + (calOp.aplica_merma ? "APLICADA" : "INFORMATIVA") + " → NETO FINAL " + fmt(calOp.neto_final) + " KG · " + motivo, "TABLERO");
  cerrarModalT(); cargarAvicolaT(); toastT("Calidad guardada");
}
function cerrarModalT() { $("modal-calidad").classList.remove("on"); }

/* PDF (jsPDF): se carga de internet solo la primera vez que se usa */
function conPDF(fn) {
  if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API.autoTable) return fn();
  const cargar = (src) => new Promise((ok, mal) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = mal; document.head.appendChild(s); });
  toastT("Preparando PDF...");
  cargar("https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.2/jspdf.umd.min.js")
    .then(() => cargar("https://cdnjs.cloudflare.com/ajax/libs/jspdf-autotable/3.8.4/jspdf.plugin.autotable.min.js"))
    .then(fn).catch(() => alert("PARA GENERAR EL PDF HACE FALTA CONEXIÓN A INTERNET."));
}
function exportarPDF() {
  if (!dataAvic.length) { alert("NO HAY OPERACIONES PARA EXPORTAR."); return; }
  conPDF(() => {
    const doc = new window.jspdf.jsPDF({ orientation: "landscape", unit: "mm", format: "a4" });
    const tipo = val("fa-tipo"), titulo = tipo === "INGRESO" ? "CONTROL DE MATERIA PRIMA" : tipo === "EGRESO" ? "CONTROL DE EGRESO" : "INGRESOS Y EGRESOS";
    doc.setFontSize(15); doc.text(titulo, 14, 14);
    doc.setFontSize(9); doc.text("PERIODO: " + (val("fa-desde") ? dmy(val("fa-desde")) : "INICIO") + " A " + (val("fa-hasta") ? dmy(val("fa-hasta")) : "HOY") + (val("fa-quien") ? " · " + txt(val("fa-quien")) : "") + " · DATOS FICTICIOS (SIMULADOR TP)", 14, 20);
    doc.autoTable({
      startY: 24, styles: { fontSize: 8 }, headStyles: { fillColor: [67, 160, 71] },
      head: [["N°", "FECHA", "ENT.", "SAL.", "TIPO", "PATENTE", "PROVEEDOR / AVICOLA", "PRODUCTO / GRANJAS", "NETO KG"]],
      body: dataAvic.map(o => [nro6(o.nro), dmy(o.fecha), o.hora_entrada, o.hora_salida || "", o.tipo === "INGRESO" ? "ING" : "EGR", o.patente,
        o.tipo === "INGRESO" ? o.proveedor : o.avicola, o.tipo === "INGRESO" ? o.producto_nom : o.cargas.length + " GRANJAS", fmt(o.neto_final || o.neto_total)])
    });
    const t = totalesT(dataAvic);
    doc.setFontSize(10); doc.text("TOTAL: " + dataAvic.length + " OPERACIONES · INGRESOS " + t.ing + " (" + fmt(t.kgIng) + " KG) · EGRESOS " + t.egr + " (" + fmt(t.kgEgr) + " KG)", 14, doc.lastAutoTable.finalY + 8);
    doc.save("reporte_ingresos_egresos.pdf");
  });
}
function informePDF(i) {
  const o = dataAvic[i]; if (!o) return;
  conPDF(() => {
    const doc = new window.jspdf.jsPDF({ unit: "mm", format: "a4" }), esIng = o.tipo === "INGRESO", bt = brutoTara(o);
    doc.setFontSize(15); doc.text(esIng ? "CONTROL DE MATERIA PRIMA" : "CONTROL DE EGRESO", 14, 16);
    doc.setFontSize(9); doc.text("COMPROBANTE N° " + nro6(o.nro) + " · " + dmy(o.fecha) + " · ENT " + o.hora_entrada + " · SAL " + (o.hora_salida || "--") + " · DATOS FICTICIOS", 14, 22);
    const datos = [["PATENTE", o.patente], ["CHOFER", o.chofer || "--"], [esIng ? "PROVEEDOR" : "AVICOLA", esIng ? o.proveedor : o.avicola],
      ["BRUTO", fmt(bt.bruto) + " KG"], ["TARA", fmt(bt.tara) + " KG"], ["NETO", fmt(o.neto_total) + " KG"]];
    if (esIng) datos.splice(3, 0, ["PRODUCTO", o.producto_nom || "--"]), datos.push(["HUMEDAD", o.humedad != null ? o.humedad + " %" : "--"],
      ["MERMA", o.merma_pct + " % = " + fmt(o.merma_kg) + " KG (" + (o.aplica_merma ? "APLICADA" : "INFORMATIVA") + ")"], ["DESCUENTOS", o.desc_pct + " % = " + fmt(o.desc_kg) + " KG"], ["NETO FINAL", fmt(o.neto_final) + " KG"]);
    doc.autoTable({ startY: 28, theme: "grid", styles: { fontSize: 10 }, columnStyles: { 0: { fontStyle: "bold", cellWidth: 45 } }, body: datos });
    if (!esIng) doc.autoTable({ startY: doc.lastAutoTable.finalY + 6, styles: { fontSize: 9 }, headStyles: { fillColor: [55, 71, 79] },
      head: [["#", "GRANJA", "COD.", "PRODUCTO", "NETO KG"]], body: o.cargas.map(c => [c.orden, c.granja, c.producto_cod || "", c.producto_nom, fmt(c.neto)]) });
    doc.save((esIng ? "informe_calidad_" : "detalle_despacho_") + nro6(o.nro) + "_" + o.patente + ".pdf");
  });
}

// ═════════════════════════ LO PROPIO DEL TP ═════════════════════════
function abrirTP(sec) {
  $("tp-panel").classList.add("on"); pintarTP();
  if (sec) setTimeout(() => $(sec).scrollIntoView({ behavior: "smooth", block: "start" }), 50);
}
function subirCamion() { const v = Number(val("b-peso")) || 0; if (!v) { toast("PONÉ EL PESO EN KG", "#c62828"); $("b-peso").focus(); return; } ponerPeso(v); }
function verGuia() { $("guia").classList.add("on"); }
function cerrarGuia() { $("guia").classList.remove("on"); guardarLS("tp_guia_vista", "1"); }
function cerrarTP() { $("tp-panel").classList.remove("on"); }
function opsDelDia() { return abiertas.concat(cerradas.filter(o => o.fecha === HOY), rechazados); }
function pintarTP() {
  const ctrl = controlCamaras(pasos, opsDelDia()).map((c, i) => Object.assign(c, { i })).filter(c => c.estado === "SIN PESADA");
  $("tp-sin-pesar").innerHTML = ctrl.length ? ctrl.map(c => '<div class="tp-fila" style="justify-content:space-between;border:1px solid #ffe0b2;background:#fff8f0;border-radius:6px;padding:6px 8px;">' +
    '<span style="font-size:12px;"><b>' + esc(c.paso.patente) + '</b> · ' + c.paso.hora.slice(0, 5) + ' · ' + esc(c.paso.camara) + '</span>' +
    '<button class="tp-btn nar" onclick="avisarSinPesar(' + c.i + ')">AVISAR</button></div>').join("") : '<p style="color:#2e7d32;">Ninguno.</p>';
  $("tp-n-av").textContent = avisos.length ? "(" + avisos.length + ")" : "";
  $("tb-n-sp").textContent = ctrl.length; $("tb-sp").className = "tb-btn " + (ctrl.length ? "nar" : "g");
  $("tb-n-av").textContent = avisos.length;
  $("tp-avisos").innerHTML = avisos.length ? avisos.map((a, i) => '<div class="tp-aviso" onclick="verAviso(' + i + ')"><span>' + a.hora + ' · <b>' + esc(a.ev.patente) + '</b> · ' + (a.ev.tipo || "CAMIÓN SIN PESAR") + '</span><span class="nivel ' + a.local.nivel + '">' + a.local.nivel + '</span></div>').join("")
    : '<p>Todavía no hay avisos. Cerrá una pesada en EN PLANTA.</p>';
}
function avisarSinPesar(i) {
  const c = controlCamaras(pasos, opsDelDia())[i];
  cerrarTP();
  log("AVISO_TP", c.paso.patente, "CAMION SIN PESAR (CAMARA " + c.paso.hora + " · " + c.paso.camara + ")", "SISTEMA");
  procesar({ evento: "CAMION_SIN_PESAR", origen: "SIMULADOR", planta: D.planta, patente: c.paso.patente, hora: c.paso.hora, camara: c.paso.camara }, null);
}

// Configuracion de n8n (URL y clave pueden venir en el link: ?webhook=...&clave=...)
(function cfgDesdeLink() {
  const q = new URLSearchParams(location.search);
  if (q.get("webhook")) guardarLS("tp_webhook", q.get("webhook"));
  if (q.get("clave")) guardarLS("tp_clave", q.get("clave"));
  if (q.get("webhook") || q.get("clave")) { try { history.replaceState(null, "", location.pathname + location.hash); } catch (e) {} }
})();
function cfg() { return { url: (leerLS("tp_webhook") || "").trim(), clave: (leerLS("tp_clave") || "").trim() }; }
function pintarModo() {
  const c = cfg(); $("cfg-url").value = c.url; $("cfg-clave").value = c.clave;
  $("tp-boton").className = c.url ? "con" : "";
  $("tp-boton").innerHTML = '<span class="pt"></span>' + (c.url ? "N8N ✓" : "DEMO");
  $("tp-boton").title = c.url ? "Los avisos van a n8n: la IA redacta y se envían a Telegram" : "Sin conexión: el aviso lo arma la plantilla fija. Tocá para conectar n8n.";
}
function guardarCfg() {
  const url = val("cfg-url").trim(), clave = val("cfg-clave").trim(), m = $("cfg-msg");
  if (url && !/^https?:\/\//i.test(url)) { m.className = "tp-msg err"; m.textContent = "La URL tiene que empezar con https://"; return; }
  url ? guardarLS("tp_webhook", url) : borrarLS("tp_webhook"); clave ? guardarLS("tp_clave", clave) : borrarLS("tp_clave");
  m.className = "tp-msg ok"; m.textContent = url ? "Guardado. Los próximos avisos se envían a n8n." : "Sin URL: se usa el modo demo.";
  pintarModo();
}
function borrarCfg() { borrarLS("tp_webhook"); borrarLS("tp_clave"); pintarModo(); $("cfg-msg").textContent = ""; }

// Envio del aviso (n8n o modo demo)
async function procesar(ev, op) {
  const local = evaluar(ev), c = cfg();
  const aviso = { ev, op, local, hora: ahora() };
  avisos.unshift(aviso); mostrarAviso(aviso, true);
  if (!c.url) {
    aviso.mensaje = local.plantilla; aviso.origen = "PLANTILLA (MODO DEMO)"; aviso.telegram = null;
  } else {
    try {
      const r = await fetch(c.url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(Object.assign({}, ev, { clave: c.clave })) });
      const d = await r.json().catch(() => ({}));
      if (!r.ok || d.ok === false) {
        aviso.mensaje = local.plantilla; aviso.telegram = false;
        aviso.origen = "PLANTILLA (N8N RESPONDIÓ ERROR: " + (d.error || ("HTTP " + r.status)) + ")";
      } else {
        aviso.mensaje = d.mensaje || local.plantilla; aviso.origen = d.origen || "N8N";
        aviso.motivo = d.motivo_respaldo || ""; aviso.telegram = !!d.telegram_enviado;
      }
    } catch (e) {
      aviso.mensaje = local.plantilla; aviso.origen = "PLANTILLA (SIN CONEXIÓN CON N8N)"; aviso.telegram = false;
    }
  }
  log("AVISO_TP", ev.patente, local.nivel + " · " + aviso.origen + " · TELEGRAM " + (aviso.telegram === null ? "NO (DEMO)" : aviso.telegram ? "ENVIADO" : "NO ENVIADO"), "SISTEMA");
  if ($("ma").classList.contains("on") && avisoVisible === aviso) mostrarAviso(aviso, false);
  pintarTP();
}
let avisoVisible = null;
function htmlAviso(a) {
  if (!a.mensaje) return '<div style="text-align:center;padding:30px;color:#888;font-weight:700;">Enviando a n8n… la IA está redactando el aviso.</div>';
  const tg = a.telegram === null ? "NO SE ENVÍA (MODO DEMO)" : (a.telegram ? "ENVIADO ✓" : "NO ENVIADO");
  return '<div class="tg"><div class="tg-head"><div class="tg-avatar">B</div><div><div class="tg-nombre">Balanza · Avisos</div><div class="tg-sub">bot de Telegram</div></div></div>' +
    '<div class="burbuja">' + esc(a.mensaje) + '<span class="hora">' + a.hora + '</span></div></div>' +
    '<div class="meta">REDACTÓ: ' + esc(a.origen) + (a.motivo ? ' — ' + esc(a.motivo) : '') + '<br>TELEGRAM: ' + tg + ' · REGLAS V' + a.local.reglas_version + '</div>' +
    (a.local.alertas.length ? '<div class="alertas">' + a.local.alertas.map(x => '<div class="' + x.severidad + '"><b>' + x.severidad + '</b> · ' + esc(x.texto) + '</div>').join("") + '</div>' : '') +
    '<details><summary>VER DATOS ENVIADOS (JSON)</summary><pre>' + esc(JSON.stringify(a.ev, null, 2)) + '</pre></details>';
}
function mostrarAviso(a, abrir) {
  avisoVisible = a;
  $("ma-titulo").innerHTML = 'AVISO · ' + esc(a.ev.patente) + ' <span class="nivel ' + a.local.nivel + '">' + a.local.nivel + '</span>';
  $("ma-sub").textContent = (a.ev.evento === "CAMION_SIN_PESAR" ? "CAMIÓN SIN PESAR" : a.ev.tipo + " CERRADO · N° " + nro6(a.ev.nro)) + " · LO VE QUIEN RECIBE EL TELEGRAM";
  $("ma-cuerpo").innerHTML = htmlAviso(a);
  if (abrir) $("ma").classList.add("on");
}
function verAviso(i) { cerrarTP(); mostrarAviso(avisos[i], true); }
function cerrarAviso() { $("ma").classList.remove("on"); }

// ───────────────────────── Combos y arranque ─────────────────────────
function cargarCombos() {
  const uniq = (a) => [...new Set(a.filter(Boolean))];
  const opts = (a) => a.map(v => '<option value="' + esc(v) + '">').join("");
  const todas = D.historial.concat(D.en_planta);
  $("dl-prov").innerHTML = opts(uniq(todas.map(h => h.proveedor)));
  $("dl-avi").innerHTML = opts(uniq(todas.map(h => h.avicola)));
  $("dl-prod").innerHTML = opts(uniq(todas.filter(h => h.tipo === "INGRESO").map(h => h.producto_nom)));
  $("dl-chofer").innerHTML = opts(uniq(todas.map(h => h.chofer)));
  $("dl-transp").innerHTML = opts(uniq(todas.map(h => h.transporte)));
  const cargas = todas.flatMap(h => (h.cargas || []).concat(h.cargas_previstas || []));
  $("dl-granja").innerHTML = opts(uniq(cargas.map(c => c.granja)));
  $("dl-alim").innerHTML = opts(uniq(cargas.filter(c => c.granja).map(c => c.producto_nom)));
}
document.getElementById("i-pres").addEventListener("click", e => {
  const b = e.target.closest(".pres"); if (!b) return;
  presSel = presSel === b.dataset.v ? "" : b.dataset.v;
  document.querySelectorAll("#i-pres .pres").forEach(x => x.classList.toggle("on", x.dataset.v === presSel));
});
document.getElementById("mr-motivos").addEventListener("click", e => {
  const b = e.target.closest(".pres"); if (!b) return;
  motivoRech = b.dataset.v;
  document.querySelectorAll("#mr-motivos .pres").forEach(x => x.classList.toggle("on", x === b));
});
document.getElementById("i-prod").addEventListener("input", refrescarCalidad);

reiniciar(false); pintarModo(); cargarCombos(); reloj(); setInterval(reloj, 1000); pintarBalanza();
if (location.hash === "#tablero") verPantalla("tablero");
if (!leerLS("tp_guia_vista")) verGuia();
