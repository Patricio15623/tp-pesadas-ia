/*
 * SIMULACION de la operacion de la balanza (solo para el simulador y las pruebas).
 * Arma una operacion CERRADA con el mismo formato que el sistema real y el evento que se envia a n8n.
 */

/* En el navegador las reglas estan en window; en Node se cargan con require */
function _R() {
  return (typeof window === "undefined" && typeof require !== "undefined") ? require("./reglas.js") : window;
}

/* Cierra una operacion abierta.
   INGRESO: una carga con el peso del camion vacio (tara).
   EGRESO:  una carga por granja; cada pesada acumula sobre la anterior. */
function cerrarOperacion(ab, o) {
  o = o || {};
  var op = JSON.parse(JSON.stringify(ab));
  delete op.escenario; delete op.tara_sugerida; delete op.cargas_previstas;
  op.estado = "CERRADA";
  op.fecha = o.fecha || op.fecha || "2026-10-21";
  op.hora_salida = o.hora_salida;
  op.operario = o.operario || "OPERADOR DEMO";
  if (op.tipo === "INGRESO") {
    var tara = Number(o.tara);
    op.humedad = o.humedad !== undefined ? o.humedad : (op.humedad != null ? op.humedad : null);
    op.aplica_merma = !!o.aplica_merma;
    ["desc_otros", "desc_olor", "desc_amoh", "desc_cham", "desc_bich", "desc_vola"].forEach(function (k) {
      if (o[k] !== undefined) op[k] = o[k];
      if (op[k] == null) op[k] = 0;
    });
    op.peso_final = tara;
    op.neto_total = Number(op.peso_inicial) - tara;
    op.cargas = [{ orden: 1, granja: "", producto_cod: op.producto_cod || "", producto_nom: op.producto_nom || "",
                   peso_balanza: tara, neto: op.neto_total, hora: (o.hora_salida || "").slice(0, 5) }];
  } else {
    var acumulado = Number(op.peso_inicial);
    op.cargas = (o.cargas || []).map(function (c, i) {
      var neto = Number(c.peso_balanza) - acumulado;
      acumulado = Number(c.peso_balanza);
      return { orden: i + 1, granja: c.granja || "", producto_cod: c.producto_cod || "", producto_nom: c.producto_nom || "",
               peso_balanza: Number(c.peso_balanza), neto: neto, hora: c.hora || (o.hora_salida || "").slice(0, 5) };
    });
    op.peso_final = acumulado;
    op.neto_total = op.cargas.reduce(function (a, c) { return a + c.neto; }, 0);
    op.humedad = null; op.aplica_merma = false;
  }
  return op;
}

/* Evento que viaja a n8n: la operacion cerrada + lo que en el sistema real aporta la API
   (parametros de calidad, contexto historico y lecturas de camara alrededor de la entrada). */
function armarEvento(op, datos, historial, pasos, origen) {
  var ev = JSON.parse(JSON.stringify(op));
  ev.evento = "PESADA_CERRADA";
  ev.origen = origen || "SIMULADOR";
  ev.planta = datos.planta;
  ev.parametros = datos.parametros;
  ev.contexto = _R().calcularContexto(historial, ev);
  ev.lecturas_camara = _R().lecturasCercanas(pasos, ev.hora_entrada);
  return ev;
}

/* Procesa las lecturas crudas del dia con las reglas de unificacion */
function procesarLecturas(crudas) {
  var pasos = [], resultados = [];
  (crudas || []).forEach(function (l) { resultados.push({ lectura: l, resultado: _R().registrarLectura(pasos, l) }); });
  return { pasos: pasos, resultados: resultados };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { cerrarOperacion: cerrarOperacion, armarEvento: armarEvento, procesarLecturas: procesarLecturas };
}
