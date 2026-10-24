// Pruebas automaticas de las reglas. Uso: node scripts/test_reglas.js
const assert = require("assert");
const path = require("path");
const R = require(path.join(__dirname, "..", "simulador", "reglas.js"));
const S = require(path.join(__dirname, "..", "simulador", "simulacion.js"));
const D = require(path.join(__dirname, "..", "datos", "pesadas_ficticias.json"));

let ok = 0;
function prueba(nombre, fn) {
  try { fn(); ok++; console.log("OK    " + nombre); }
  catch (e) { console.log("FALLA " + nombre + "\n      " + e.message); process.exitCode = 1; }
}

const PASOS = S.procesarLecturas(D.lecturas_camaras).pasos;
const P = D.en_planta;
const codigos = r => r.alertas.map(a => a.codigo);
const mas40 = h => { const [a, b] = h.split(":").map(Number); const m = a * 60 + b + 40; return String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };

// Cierra el camion i de "en planta" con los valores sugeridos (o los que se pasen) y lo evalua
function cerrar(i, extra, extraEvento) {
  const ab = P[i];
  const o = Object.assign({ hora_salida: mas40(ab.hora_entrada) }, extra || {});
  if (ab.tipo === "INGRESO") { if (o.tara === undefined) o.tara = ab.tara_sugerida; }
  else if (!o.cargas) { let acc = ab.peso_inicial; o.cargas = ab.cargas_previstas.map(c => ({ ...c, peso_balanza: (acc += c.neto_sugerido) })); }
  const ev = Object.assign(S.armarEvento(S.cerrarOperacion(ab, o), D, D.historial, PASOS), extraEvento || {});
  return R.evaluar(ev);
}

/* ── Formato y modelo de datos ── */
prueba("fmtKg con separador de miles", () => {
  assert.strictEqual(R.fmtKg(27980), "27.980");
  assert.strictEqual(R.fmtKg(980), "980");
});
prueba("Bruto y tara segun tipo (como el sistema real)", () => {
  assert.deepStrictEqual(R.brutoTara({ tipo: "INGRESO", peso_inicial: 40000, peso_final: 15000 }), { bruto: 40000, tara: 15000 });
  assert.deepStrictEqual(R.brutoTara({ tipo: "EGRESO", peso_inicial: 15000, peso_final: 40000 }), { bruto: 40000, tara: 15000 });
});
prueba("Parametro por nombre: EXPELLER DE SOJA toma EXPELLER, no SOJA", () => {
  assert.strictEqual(R.parametroDeProducto(D.parametros, "EXPELLER DE SOJA").producto, "EXPELLER");
  assert.strictEqual(R.parametroDeProducto(D.parametros, "SOJA").producto, "SOJA");
  assert.strictEqual(R.parametroDeProducto(D.parametros, "GIRASOL"), null);
});
prueba("Egreso: neto = suma de cargas, una por granja", () => {
  const r = cerrar(4);
  assert.strictEqual(r.cifras.neto, 9200 + 10400 + 8100);
  assert.strictEqual(r.cifras_texto.cargas.length, 3);
  assert.strictEqual(r.nivel, "NORMAL", JSON.stringify(r.alertas));
});

/* ── Calidad ── */
prueba("Caso normal sin alertas (la camara leyo bien la patente)", () => {
  const r = cerrar(0);
  assert.strictEqual(r.nivel, "NORMAL", JSON.stringify(r.alertas));
});
prueba("Merma informativa por defecto (no descuenta, como el sistema real)", () => {
  const r = cerrar(1);
  assert.ok(codigos(r).includes("MERMA_INFORMATIVA"));
  const pct = Math.round((15.2 - 13.5) / (100 - 13.5) * 10000) / 100;
  assert.strictEqual(r.cifras.merma_kg, Math.round(r.cifras.neto * pct / 100));
  assert.strictEqual(r.cifras.neto_final, r.cifras.neto - r.cifras.desc_kg);
});
prueba("Merma aplicada: descuenta kilos", () => {
  const r = cerrar(1, { aplica_merma: true });
  assert.ok(codigos(r).includes("MERMA_HUMEDAD"));
  assert.strictEqual(r.cifras.neto_final, r.cifras.neto - r.cifras.desc_kg - r.cifras.merma_kg);
});
prueba("Descuentos de calidad: otros % + conceptos", () => {
  const r = cerrar(1);
  assert.ok(codigos(r).includes("DESCUENTO_CALIDAD"));
  assert.strictEqual(r.cifras.desc_pct, 0.8);
  assert.strictEqual(r.cifras.desc_kg, Math.round(r.cifras.neto * 0.8 / 100));
});
prueba("Humedad sobre el limite cargado => CRITICO", () => {
  const r = cerrar(2);
  assert.strictEqual(r.nivel, "CRITICO");
  assert.strictEqual(r.alertas[0].codigo, "HUMEDAD_SOBRE_LIMITE");
});
prueba("Limite vacio => sin alerta de rechazo (como el sistema real)", () => {
  const r = cerrar(1, { humedad: 25 });
  assert.ok(!codigos(r).includes("HUMEDAD_SOBRE_LIMITE"));
});

/* ── Historial y pesos ── */
prueba("Neto y tara fuera de lo habitual", () => {
  const r = cerrar(3);
  assert.ok(codigos(r).includes("NETO_DESVIO"));
  assert.ok(codigos(r).includes("TARA_DESVIO"));
});
prueba("Tara mayor que bruto => CRITICO", () => {
  const r = cerrar(0, { tara: 99999 });
  assert.ok(codigos(r).includes("PESO_INCOHERENTE"));
  assert.strictEqual(r.nivel, "CRITICO");
});
prueba("Cargas que no cierran con bruto - tara", () => {
  const r = cerrar(4, {}, { neto_total: 25000 });
  assert.ok(codigos(r).includes("CARGAS_NO_CIERRAN"));
});
prueba("Egreso con carga sin granja => datos incompletos", () => {
  const ab = P[4]; let acc = ab.peso_inicial;
  const cargas = ab.cargas_previstas.map(c => ({ ...c, peso_balanza: (acc += c.neto_sugerido) }));
  cargas[1].granja = "";
  const r = cerrar(4, { cargas });
  assert.ok(codigos(r).includes("DATOS_INCOMPLETOS"));
});

/* ── Tiempos ── */
prueba("Permanencia larga", () => assert.ok(codigos(cerrar(5, { hora_salida: "09:30" })).includes("PERMANENCIA_LARGA")));
prueba("Salida anterior a la entrada", () => assert.ok(codigos(cerrar(0, { hora_salida: "07:00" })).includes("HORARIO_INCOHERENTE")));
prueba("Fuera de horario", () => assert.ok(codigos(cerrar(0, { hora_salida: "22:10" })).includes("FUERA_DE_HORARIO")));

/* ── Camaras de patentes (mismas reglas que el sistema real) ── */
prueba("Camaras: la otra camara dentro de 5 min = mismo paso (una fila)", () => {
  const pasos = [];
  assert.strictEqual(R.registrarLectura(pasos, { hora: "08:00:00", patente: "ZZ999AA", camara: "ENTRADA" }), "nuevo");
  assert.strictEqual(R.registrarLectura(pasos, { hora: "08:00:04", patente: "ZZ999AA", camara: "SALIDA" }), "unificado");
  assert.strictEqual(pasos.length, 1);
  assert.strictEqual(pasos[0].camara, "ENTRADA → SALIDA");
});
prueba("Camaras: la misma camara dentro de 20 s = repetido (se ignora)", () => {
  const pasos = [];
  R.registrarLectura(pasos, { hora: "08:00:00", patente: "ZZ999AA", camara: "ENTRADA" });
  assert.strictEqual(R.registrarLectura(pasos, { hora: "08:00:10", patente: "ZZ999AA", camara: "ENTRADA" }), "repetido");
  assert.strictEqual(pasos.length, 1);
});
prueba("Camaras: la misma camara mas tarde = pasada nueva (ida y vuelta)", () => {
  const pasos = [];
  R.registrarLectura(pasos, { hora: "08:00:00", patente: "ZZ999AA", camara: "ENTRADA" });
  assert.strictEqual(R.registrarLectura(pasos, { hora: "08:02:00", patente: "ZZ999AA", camara: "ENTRADA" }), "nuevo");
  assert.strictEqual(pasos.length, 2);
});
prueba("Camaras: lecturas del dia procesadas (13 crudas -> 7 pasos)", () => {
  assert.strictEqual(PASOS.length, 7);
});
prueba("Patente leida distinta a la cargada => ATENCION", () => {
  const r = cerrar(3);
  assert.ok(codigos(r).includes("PATENTE_NO_COINCIDE"));
});
prueba("Lectura que difiere en un caracter => lectura dudosa (INFO)", () => {
  const r = cerrar(1);
  assert.ok(codigos(r).includes("LECTURA_DUDOSA"));
  assert.ok(!codigos(r).includes("PATENTE_NO_COINCIDE"));
});
prueba("La salida de otro camion en el horario de entrada no confunde", () => {
  const pasos = JSON.parse(JSON.stringify(PASOS));
  R.registrarLectura(pasos, { hora: "09:58:00", patente: "ZZ555ZZ", camara: "SALIDA" });
  const r = cerrar(0, {}, { lecturas_camara: R.lecturasCercanas(pasos, "09:59") });
  assert.ok(!JSON.stringify(r.alertas).includes("ZZ555ZZ"), JSON.stringify(r.alertas));
});
prueba("Vehiculo sin patente legible", () => assert.ok(codigos(cerrar(5)).includes("SIN_PATENTE_LEGIBLE")));
prueba("Sin lectura de camara", () => {
  const r = cerrar(0, {}, { lecturas_camara: [] });
  assert.ok(codigos(r).includes("SIN_LECTURA_CAMARA"));
});
prueba("Control de camaras: detecta el camion que no se peso", () => {
  const ops = D.historial.concat(P);
  const ctrl = R.controlCamaras(PASOS, ops);
  const sin = ctrl.filter(c => c.estado === "SIN PESADA").map(c => c.paso.patente);
  assert.ok(sin.includes("ZZ110KA"), JSON.stringify(ctrl.map(c => c.paso.patente + ":" + c.estado)));
  assert.ok(ctrl.some(c => c.estado === "PROBABLE ZZ101BA"));
});
prueba("Evento CAMION_SIN_PESAR => ATENCION con plantilla", () => {
  const r = R.evaluar({ evento: "CAMION_SIN_PESAR", patente: "ZZ110KA", hora: "07:20:05", camara: "ENTRADA → SALIDA", minutos: 180 });
  assert.strictEqual(r.nivel, "ATENCION");
  assert.ok(R.validarTextoIA(r.plantilla, r).ok);
});

/* ── Validador del texto de la IA ── */
prueba("Validador acepta la plantilla en todos los escenarios", () => {
  P.forEach((p, i) => { const r = cerrar(i); const v = R.validarTextoIA(r.plantilla, r); assert.ok(v.ok, p.escenario + ": " + v.motivo); });
});
prueba("Validador acepta los netos por granja del egreso", () => {
  const r = cerrar(4);
  const t = "✅ EGRESO cerrado " + r.datos.patente + "\nNETO " + r.cifras_texto.neto + "\nGRANJA NORTE 9.200 kg";
  assert.ok(R.validarTextoIA(t, r).ok);
});
prueba("Validador rechaza cifra inventada", () => {
  const r = cerrar(0);
  const v = R.validarTextoIA("✅ INGRESO " + r.datos.patente + "\nNETO " + r.cifras_texto.neto + "\nAhorro 1.500 kg", r);
  assert.ok(!v.ok && v.motivo.includes("1.500 kg"));
});
prueba("Validador rechaza un aviso de ATENCION sin sugerencia (texto cortado)", () => {
  const r = cerrar(3);
  const corto = R.armarPlantilla(r).split("👉")[0];
  const v = R.validarTextoIA(corto, r);
  assert.ok(!v.ok && v.motivo.includes("sugerencia"), v.motivo);
  assert.ok(R.validarTextoIA(R.armarPlantilla(r), r).ok);
});
prueba("Validador rechaza texto sin patente, con Markdown o vacio", () => {
  const r = cerrar(0);
  assert.ok(!R.validarTextoIA("Pesada cerrada. NETO " + r.cifras_texto.neto, r).ok);
  assert.ok(!R.validarTextoIA("**" + r.datos.patente + "** NETO " + r.cifras_texto.neto, r).ok);
  assert.ok(!R.validarTextoIA("", r).ok);
});

console.log("\n" + ok + " pruebas OK");
