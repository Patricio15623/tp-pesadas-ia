/*
 * REGLAS DEL AVISO DE PESADA CERRADA
 * ---------------------------------------------------------------
 * Este archivo es la UNICA fuente de las reglas. Lo usan:
 *   - el simulador web (simulador/index.html);
 *   - el flujo de n8n (scripts/armar_flujo.py lo copia dentro de los nodos Code);
 *   - las pruebas automaticas (scripts/test_reglas.js).
 *
 * El formato de la operacion es el MISMO que usa el sistema de pesadas real
 * (peso_inicial, peso_final, neto_total, cargas, descuentos de calidad...), para que
 * el dia de mañana el sistema pueda enviar su JSON a este flujo sin adaptaciones.
 *
 * Division de tareas (criterio del proyecto):
 *   - Las CUENTAS y las ALERTAS las hace este codigo (deterministico, auditable).
 *   - La IA solo REDACTA el aviso a partir de estas cifras ya calculadas.
 *   - Despues se VALIDA el texto de la IA: si inventa un numero o se olvida
 *     de la patente o el neto, se descarta y se manda la plantilla fija.
 */

var REGLAS_VERSION = "4.3";

var UMBRALES = {
  desvio_neto_pct: 15,       // neto vs promedio del proveedor / avicola
  desvio_tara_pct: 3,        // tara vs tara habitual del camion
  permanencia_min: 120,      // minutos en planta
  hora_inicio: "06:00",      // horario habitual de recepcion
  hora_fin: "20:00",
  tolerancia_cargas_kg: 20,  // suma de cargas vs (bruto - tara): division de la balanza
  ventana_camara_antes: 15,  // minutos antes de la entrada en que se busca la lectura de la camara
  ventana_camara_despues: 10,
  largo_max_aviso: 900       // caracteres del mensaje de Telegram
};

/* Camaras de patentes: mismo criterio que el sistema real */
var ANPR = {
  unificar_min: 5,   // la OTRA camara lee la misma patente dentro de N minutos = mismo paso (una fila)
  repetido_s: 20     // la MISMA camara la relee dentro de N segundos = repetido (se ignora)
};

var SEVERIDAD = { INFO: 1, ATENCION: 2, CRITICO: 3 };
var EMOJI = { NORMAL: "✅", INFO: "ℹ️", ATENCION: "⚠️", CRITICO: "🛑" };
var CONCEPTOS = [["desc_olor", "olor"], ["desc_amoh", "amohosado"], ["desc_cham", "chamico"],
                 ["desc_bich", "bichos"], ["desc_vola", "volatil"]];

var PROMPT_SISTEMA = [
  "Sos el asistente de la balanza de una planta de alimento balanceado.",
  "Tu unica tarea es redactar un aviso breve para Telegram sobre un evento de la balanza (una pesada cerrada o un camion que no se peso).",
  "",
  "REGLAS OBLIGATORIAS:",
  "1. Usa SOLO los datos del JSON que te paso. No calcules ni inventes cifras: copia los kilos exactamente como vienen en 'cifras_texto'.",
  "2. Siempre inclui la patente. Si 'cifras_texto' trae NETO, incluilo.",
  "3. Si hay alertas, listalas de la mas grave a la menos grave, una por linea, en lenguaje simple. No antepongas la severidad (CRITICO, ATENCION, INFO): el emoji de la primera linea ya indica el nivel.",
  "4. Si el nivel es ATENCION o CRITICO, cerra con una linea que empiece con 👉 y una accion concreta para una persona (revisar, llamar, controlar). Nunca digas que el sistema rechaza o aprueba: decide una persona.",
  "5. Texto plano para Telegram, sin Markdown ni asteriscos. Terminá siempre el mensaje completo. Maximo 16 lineas y 800 caracteres. Español rioplatense con tildes, tono profesional y directo.",
  "",
  "FORMATO (respetalo; deja una linea en blanco entre bloques y omiti lo que no venga en los datos):",
  "<emoji del nivel: NORMAL ✅, INFO ℹ️, ATENCION ⚠️, CRITICO 🛑> <TIPO> CERRADO · <PATENTE>",
  "N° <nro> · <hora entrada> → <hora salida>",
  "",
  "🏭 <proveedor>   (en un EGRESO: 🐔 <avicola>)",
  "🌾 <producto> · humedad <humedad>",
  "",
  "⚖️ Bruto <bruto> · Tara <tara>",
  "📦 NETO <neto>   (si hay neto final: → final <neto_final>)",
  "   🚚 <una linea por carga, solo en egresos>",
  "",
  "🔎 Para revisar:   (si el nivel es ATENCION o CRITICO; si es INFO: 📝 Observaciones:)",
  "• <alerta>",
  "",
  "👉 <sugerencia>",
  "",
  "Si no hay alertas, en lugar de ese bloque poné 'Sin observaciones.'. Para un CAMION SIN PESAR la primera linea es '<emoji> CAMIÓN SIN PESAR · <PATENTE>' y despues va directo el bloque de alertas."
].join("\n");

/* ───────────── utilidades ───────────── */
function _num(v) {
  if (v === null || v === undefined || v === "") return null;
  var n = Number(v);
  return isFinite(n) ? n : null;
}
function fmtKg(n) {
  var s = String(Math.round(Math.abs(n))), out = "";
  while (s.length > 3) { out = "." + s.slice(-3) + out; s = s.slice(0, -3); }
  return (n < 0 ? "-" : "") + s + out;
}
function fmtPct(n) { return String(Math.round(n * 100) / 100).replace(".", ","); }
function _minutos(h) {
  if (!h || !/^\d{1,2}:\d{2}(:\d{2})?$/.test(h)) return null;
  var p = h.split(":");
  return Number(p[0]) * 60 + Number(p[1]) + (p[2] ? Number(p[2]) / 60 : 0);
}
function _segundos(h) { var m = _minutos(h); return m === null ? null : Math.round(m * 60); }
function normPatente(p) { return String(p || "").toUpperCase().replace(/[\s.\-]/g, ""); }

/* Distancia de edicion (para detectar lecturas dudosas: 0 por O, 1 por I...) */
function distancia(a, b) {
  a = a || ""; b = b || "";
  var d = [], i, j;
  for (i = 0; i <= a.length; i++) { d[i] = [i]; }
  for (j = 0; j <= b.length; j++) { d[0][j] = j; }
  for (i = 1; i <= a.length; i++) for (j = 1; j <= b.length; j++)
    d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return d[a.length][b.length];
}

/* Parametro de calidad que corresponde a un nombre de producto libre
   (como en el sistema real: se busca la palabra dentro del nombre, respetando el orden:
   "EXPELLER DE SOJA" toma EXPELLER y no SOJA). */
function parametroDeProducto(parametros, productoNom) {
  if (!productoNom || !parametros) return null;
  var p = String(productoNom).toUpperCase();
  var lista = Array.isArray(parametros) ? parametros.slice() :
    Object.keys(parametros).map(function (k, i) { return Object.assign({ producto: k, orden: i }, parametros[k]); });
  lista.sort(function (a, b) { return (a.orden || 0) - (b.orden || 0); });
  for (var i = 0; i < lista.length; i++) if (p.indexOf(lista[i].producto) >= 0) return lista[i];
  return null;
}

/* Bruto y tara segun el tipo (igual que el sistema real):
   INGRESO: entra lleno (peso_inicial = bruto) y sale vacio (peso_final = tara).
   EGRESO:  entra vacio (peso_inicial = tara) y sale cargado (peso_final = bruto). */
function brutoTara(op) {
  var ini = _num(op.peso_inicial), fin = _num(op.peso_final);
  return op.tipo === "EGRESO" ? { bruto: fin, tara: ini } : { bruto: ini, tara: fin };
}

/* ───────────── camaras de patentes ───────────── */
/* Registra una lectura cruda de camara en la lista de pasos, con las mismas reglas del sistema real.
   lectura = { hora: "HH:MM:SS", patente, camara: "ENTRADA"|"SALIDA", confianza }
   Devuelve "nuevo", "unificado" o "repetido". */
function registrarLectura(pasos, lectura) {
  var pat = normPatente(lectura.patente) || "UNKNOWN";
  var t = _segundos(lectura.hora);
  if (pat !== "UNKNOWN") {
    for (var i = pasos.length - 1; i >= 0; i--) {
      var f = pasos[i];
      if (f.patente !== pat) continue;
      var dif = t - _segundos(f.hora);   // como el sistema real: se mide desde la primera lectura del paso
      if (dif < 0 || dif > ANPR.unificar_min * 60) break;
      var camaras = f.camara.split("→").map(function (c) { return c.trim(); });
      if (camaras.indexOf(lectura.camara) >= 0) {
        if (dif < ANPR.repetido_s) return "repetido";  // la misma camara la releyo enseguida
        break;                                          // la misma camara la ve mas tarde: pasada nueva (ida y vuelta)
      }
      f.camara = (f.camara + " → " + lectura.camara).slice(0, 50);  // la otra camara: mismo paso
      return "unificado";
    }
  }
  pasos.push({ hora: lectura.hora, patente: pat, camara: lectura.camara, confianza: lectura.confianza || 0 });
  return "nuevo";
}

/* Lecturas de camara cercanas a la entrada de una operacion (las adjunta el sistema al enviar el evento) */
function lecturasCercanas(pasos, horaEntrada) {
  var m = _minutos(horaEntrada);
  if (m === null) return [];
  return (pasos || []).filter(function (p) {
    // Solo pasos de INGRESO a la planta (la primera camara que lo vio fue la de ENTRADA):
    // la salida de otro camion en el mismo horario no tiene que confundir
    if (String(p.camara || "").indexOf("ENTRADA") !== 0) return false;
    var x = _minutos(p.hora);
    return x !== null && x >= m - UMBRALES.ventana_camara_antes && x <= m + UMBRALES.ventana_camara_despues;
  }).map(function (p) { return { hora: p.hora, patente: p.patente, camara: p.camara, confianza: p.confianza }; });
}

/* Estado de cada paso de camara frente a las operaciones (para detectar camiones sin pesar) */
function controlCamaras(pasos, operaciones) {
  var pats = (operaciones || []).map(function (o) { return normPatente(o.patente); });
  return (pasos || []).map(function (p) {
    if (p.patente === "UNKNOWN") return { paso: p, estado: "SIN PATENTE LEGIBLE" };
    if (pats.indexOf(p.patente) >= 0) return { paso: p, estado: "CON PESADA" };
    for (var i = 0; i < pats.length; i++)
      if (distancia(p.patente, pats[i]) === 1) return { paso: p, estado: "PROBABLE " + pats[i] };
    return { paso: p, estado: "SIN PESADA" };
  });
}

/* ───────────── contexto historico ───────────── */
/* En el sistema real lo calcula la API con la base de datos. En el simulador, con el historial ficticio. */
function calcularContexto(historial, op) {
  var ctx = { neto_promedio: null, pesadas_previas: 0, tara_habitual: null, taras_previas: 0 };
  var clave = op.tipo === "INGRESO" ? "proveedor" : "avicola";
  var netos = [], taras = [];
  (historial || []).forEach(function (h) {
    if (h.tipo === op.tipo && h[clave] && h[clave] === op[clave] && _num(h.neto_total)) netos.push(Number(h.neto_total));
    if (normPatente(h.patente) === normPatente(op.patente)) {
      var t = brutoTara(h).tara;
      if (t) taras.push(t);
    }
  });
  if (netos.length) {
    ctx.neto_promedio = Math.round(netos.reduce(function (a, b) { return a + b; }, 0) / netos.length);
    ctx.pesadas_previas = netos.length;
  }
  if (taras.length) {
    ctx.tara_habitual = Math.round(taras.reduce(function (a, b) { return a + b; }, 0) / taras.length);
    ctx.taras_previas = taras.length;
  }
  return ctx;
}

/* ───────────── evaluacion ───────────── */
function evaluar(evento) {
  if (evento && evento.evento === "CAMION_SIN_PESAR") return evaluarSinPesar(evento);
  return evaluarPesada(evento);
}

function _nuevoResultado() {
  var alertas = [];
  return {
    alertas: alertas,
    alerta: function (codigo, severidad, texto) { alertas.push({ codigo: codigo, severidad: severidad, texto: texto }); }
  };
}

function _cerrarResultado(base, alertas) {
  alertas.sort(function (a, b) { return SEVERIDAD[b.severidad] - SEVERIDAD[a.severidad]; });
  var nivel = "NORMAL";
  alertas.forEach(function (a) { if (nivel === "NORMAL" || SEVERIDAD[a.severidad] > SEVERIDAD[nivel]) nivel = a.severidad; });
  base.reglas_version = REGLAS_VERSION;
  base.nivel = nivel;
  base.alertas = alertas;
  base.plantilla = armarPlantilla(base);
  base.prompt_usuario = armarPromptUsuario(base);
  return base;
}

/* Evalua una pesada cerrada (formato del sistema real) */
function evaluarPesada(evento) {
  var op = evento || {};
  var R = _nuevoResultado(), alerta = R.alerta;
  var esIng = op.tipo === "INGRESO";
  var bt = brutoTara(op), bruto = bt.bruto, tara = bt.tara;
  var cargas = Array.isArray(op.cargas) ? op.cargas : [];
  var prm = parametroDeProducto(op.parametros, op.producto_nom) || {};
  var ctx = op.contexto || {};

  // 1) Datos minimos
  var faltan = [];
  if (!op.patente) faltan.push("PATENTE");
  if (bruto === null) faltan.push("PESO BRUTO");
  if (tara === null) faltan.push("PESO TARA");
  if (esIng && !op.proveedor) faltan.push("PROVEEDOR");
  if (!esIng && !op.avicola) faltan.push("AVICOLA");
  if (esIng && !op.producto_nom) faltan.push("PRODUCTO");
  if (!esIng) cargas.forEach(function (c) {
    if (!c.granja) faltan.push("GRANJA DE LA CARGA " + c.orden);
    if (!c.producto_nom) faltan.push("PRODUCTO DE LA CARGA " + c.orden);
  });
  if (faltan.length) alerta("DATOS_INCOMPLETOS", "ATENCION", "Faltan datos: " + faltan.join(", ") + ".");

  // 2) Neto: suma de cargas (como el sistema real) o bruto - tara
  var sumaCargas = cargas.reduce(function (a, c) { return a + (_num(c.neto) || 0); }, 0);
  var neto = _num(op.neto_total);
  if (neto === null) neto = cargas.length ? sumaCargas : (bruto !== null && tara !== null ? bruto - tara : null);
  var cifras = { bruto: bruto, tara: tara, neto: neto, merma_kg: 0, desc_kg: 0, neto_final: neto };

  if (bruto !== null && tara !== null && bruto <= tara) {
    alerta("PESO_INCOHERENTE", "CRITICO", "La tara (" + fmtKg(tara) + " kg) es igual o mayor que el bruto (" + fmtKg(bruto) + " kg).");
  } else if (bruto !== null && tara !== null && neto !== null &&
             Math.abs((bruto - tara) - neto) > UMBRALES.tolerancia_cargas_kg) {
    cifras.dif_cargas = Math.abs((bruto - tara) - neto);
    alerta("CARGAS_NO_CIERRAN", "ATENCION", "Las cargas suman " + fmtKg(neto) + " kg pero bruto menos tara da " +
      fmtKg(bruto - tara) + " kg (" + fmtKg(cifras.dif_cargas) + " kg de diferencia).");
  }

  // 3) Calidad (solo ingresos de materia prima)
  var hum = _num(op.humedad);
  if (esIng && neto !== null && neto > 0) {
    if (hum !== null && prm.humedad_base != null && hum > Number(prm.humedad_base)) {
      var base = Number(prm.humedad_base);
      cifras.merma_pct = Math.round((hum - base) / (100 - base) * 10000) / 100;
      cifras.merma_kg = Math.round(neto * cifras.merma_pct / 100);
      if (op.aplica_merma) {
        alerta("MERMA_HUMEDAD", "INFO", "Humedad " + fmtPct(hum) + " % sobre la base de " + fmtPct(base) + " %: merma aplicada de " + fmtKg(cifras.merma_kg) + " kg.");
      } else {
        alerta("MERMA_INFORMATIVA", "INFO", "Humedad " + fmtPct(hum) + " % sobre la base de " + fmtPct(base) + " %: merma estimada de " + fmtKg(cifras.merma_kg) + " kg (no aplicada).");
      }
    }
    if (hum !== null && prm.limite_rechazo != null && prm.limite_rechazo !== "" && hum > Number(prm.limite_rechazo)) {
      alerta("HUMEDAD_SOBRE_LIMITE", "CRITICO", "Humedad " + fmtPct(hum) + " % supera el límite de recepción de " + fmtPct(Number(prm.limite_rechazo)) + " %.");
    }
    // Descuentos por concepto + "otros %"
    var detalle = [], descPct = _num(op.desc_otros) || 0;
    if (descPct) detalle.push("otros " + fmtPct(descPct) + " %");
    CONCEPTOS.forEach(function (c) {
      var v = _num(op[c[0]]);
      if (v) { descPct += v; detalle.push(c[1] + " " + fmtPct(v) + " %"); }
    });
    if (descPct > 0) {
      cifras.desc_pct = Math.round(descPct * 1000) / 1000;
      cifras.desc_kg = Math.round(neto * descPct / 100);
      alerta("DESCUENTO_CALIDAD", "INFO", "Descuentos de calidad " + fmtPct(descPct) + " % (" + detalle.join(", ") + "): " + fmtKg(cifras.desc_kg) + " kg.");
    }
    cifras.neto_final = neto - cifras.desc_kg - (op.aplica_merma ? cifras.merma_kg : 0);
  }

  // 4) Comparacion con el historial
  if (neto !== null && neto > 0 && ctx.neto_promedio && ctx.pesadas_previas >= 3) {
    var dif = neto - ctx.neto_promedio;
    cifras.neto_promedio = ctx.neto_promedio;
    cifras.dif_neto = Math.abs(dif);
    if (Math.abs(dif) / ctx.neto_promedio * 100 > UMBRALES.desvio_neto_pct) {
      alerta("NETO_DESVIO", "ATENCION", "Neto " + (dif < 0 ? "por debajo" : "por encima") + " de lo habitual: " +
        fmtKg(Math.abs(dif)) + " kg de diferencia contra un promedio de " + fmtKg(ctx.neto_promedio) + " kg (" +
        ctx.pesadas_previas + " pesadas previas).");
    }
  }
  if (tara !== null && ctx.tara_habitual && ctx.taras_previas >= 2) {
    var difT = tara - ctx.tara_habitual;
    cifras.tara_habitual = ctx.tara_habitual;
    cifras.dif_tara = Math.abs(difT);
    if (Math.abs(difT) / ctx.tara_habitual * 100 > UMBRALES.desvio_tara_pct) {
      alerta("TARA_DESVIO", "ATENCION", "Tara " + fmtKg(Math.abs(difT)) + " kg " + (difT > 0 ? "mayor" : "menor") +
        " que la habitual de este camión (" + fmtKg(ctx.tara_habitual) + " kg). Revisar acoplado o carga remanente.");
    }
  }

  // 5) Tiempos
  var mIn = _minutos(op.hora_entrada), mOut = _minutos(op.hora_salida);
  if (mIn !== null && mOut !== null) {
    if (mOut < mIn) {
      alerta("HORARIO_INCOHERENTE", "ATENCION", "La hora de salida (" + op.hora_salida + ") es anterior a la de entrada (" + op.hora_entrada + ").");
    } else {
      var perm = Math.round(mOut - mIn);
      cifras.permanencia_min = perm;
      if (perm > UMBRALES.permanencia_min)
        alerta("PERMANENCIA_LARGA", "ATENCION", "Estuvo " + Math.floor(perm / 60) + " h " + (perm % 60) + " min en planta.");
    }
  }
  if (mOut !== null && (mOut < _minutos(UMBRALES.hora_inicio) || mOut > _minutos(UMBRALES.hora_fin)))
    alerta("FUERA_DE_HORARIO", "INFO", "Cierre fuera del horario habitual (" + op.hora_salida + ").");

  // 6) Camara de patentes: ¿la patente cargada coincide con la que leyo la camara al entrar?
  if (Array.isArray(op.lecturas_camara)) {
    var pat = normPatente(op.patente), lect = op.lecturas_camara;
    var exacta = lect.filter(function (l) { return normPatente(l.patente) === pat; });
    var legibles = lect.filter(function (l) { return normPatente(l.patente) !== "UNKNOWN"; });
    var dudosa = legibles.filter(function (l) { return distancia(normPatente(l.patente), pat) === 1; });
    if (exacta.length) {
      // coincide: nada que avisar
    } else if (dudosa.length) {
      alerta("LECTURA_DUDOSA", "INFO", "La cámara leyó " + dudosa[0].patente + " a las " + dudosa[0].hora.slice(0, 5) +
        " (difiere en un carácter de " + pat + "): probable error de lectura de la cámara.");
    } else if (legibles.length) {
      alerta("PATENTE_NO_COINCIDE", "ATENCION", "La cámara leyó " + legibles.map(function (l) {
        return l.patente + " a las " + l.hora.slice(0, 5); }).join(", ") + " pero la pesada se cargó con " + pat +
        ". Verificar que sea el mismo camión.");
    } else if (lect.length) {
      alerta("SIN_PATENTE_LEGIBLE", "INFO", "La cámara detectó un vehículo a las " + lect[0].hora.slice(0, 5) + " sin poder leer la patente.");
    } else {
      alerta("SIN_LECTURA_CAMARA", "INFO", "La cámara no registró el ingreso de " + pat + ".");
    }
  }

  // Cifras en texto: son las UNICAS que la IA puede usar
  var cifras_texto = {};
  ["bruto", "tara", "neto", "merma_kg", "desc_kg", "neto_final", "neto_promedio", "dif_neto", "tara_habitual", "dif_tara", "dif_cargas"]
    .forEach(function (k) {
      if (cifras[k] == null) return;
      if ((k === "merma_kg" || k === "desc_kg") && !cifras[k]) return;
      if (k === "neto_final" && cifras.neto_final === cifras.neto) return;
      cifras_texto[k] = fmtKg(cifras[k]) + " kg";
    });
  if (!esIng && cargas.length) cifras_texto.cargas = cargas.map(function (c) {
    return (c.granja || "SIN GRANJA") + " · " + (c.producto_nom || "SIN PRODUCTO") + ": " + fmtKg(_num(c.neto) || 0) + " kg";
  });
  if (!esIng) cargas.forEach(function (c) { cifras["carga_" + c.orden] = _num(c.neto) || 0; });

  return _cerrarResultado({
    evento: "PESADA_CERRADA",
    cifras: cifras,
    cifras_texto: cifras_texto,
    datos: {
      nro: op.nro, tipo: op.tipo, patente: op.patente, acoplado: op.acoplado || null, chofer: op.chofer || null,
      transporte: op.transporte || null, proveedor: op.proveedor || null, avicola: op.avicola || null,
      producto: op.producto_nom || null, fecha: op.fecha || null,
      hora_entrada: op.hora_entrada || null, hora_salida: op.hora_salida || null,
      humedad: hum, operario: op.operario || null
    }
  }, R.alertas);
}

/* Camion que paso por la camara y no tiene pesada */
function evaluarSinPesar(e) {
  var R = _nuevoResultado();
  var pat = normPatente(e.patente);
  R.alerta("CAMION_SIN_PESAR", "ATENCION", "La cámara registró " + pat + " a las " + String(e.hora || "").slice(0, 5) +
    " (" + (e.camara || "cámara") + ") y no hay ninguna pesada abierta ni cerrada con esa patente" +
    (e.minutos ? " después de " + e.minutos + " minutos" : "") + ".");
  return _cerrarResultado({
    evento: "CAMION_SIN_PESAR", cifras: {}, cifras_texto: {},
    datos: { tipo: "CAMION SIN PESAR", patente: pat, hora_lectura: e.hora || null, camara: e.camara || null }
  }, R.alertas);
}

/* ───────────── textos ───────────── */
/* Mensaje fijo (sin IA). Se usa en el modo demo y como respaldo si la IA falla. */
function armarPlantilla(r) {
  var d = r.datos, c = r.cifras_texto, l = [], grave = r.nivel === "ATENCION" || r.nivel === "CRITICO";
  if (r.evento === "CAMION_SIN_PESAR") {
    l.push(EMOJI[r.nivel] + " CAMIÓN SIN PESAR · " + d.patente);
  } else {
    var ing = d.tipo === "INGRESO";
    l.push(EMOJI[r.nivel] + " " + (d.tipo || "PESADA") + " CERRADO · " + (d.patente || "SIN PATENTE"));
    l.push((d.nro ? "N° " + d.nro : "") + (d.hora_entrada ? " · " + d.hora_entrada + " → " + (d.hora_salida || "--") : ""));
    l.push("");
    if (ing) {
      l.push("🏭 " + (d.proveedor || "SIN PROVEEDOR"));
      l.push("🌾 " + (d.producto || "SIN PRODUCTO") + (d.humedad != null ? " · humedad " + String(d.humedad).replace(".", ",") + " %" : ""));
    } else {
      l.push("🐔 " + (d.avicola || "SIN AVÍCOLA"));
    }
    l.push("");
    l.push("⚖️ Bruto " + (c.bruto || "-") + " · Tara " + (c.tara || "-"));
    l.push("📦 NETO " + (c.neto || "-") + (c.neto_final ? " → final " + c.neto_final : ""));
    if (c.cargas) c.cargas.forEach(function (x) { l.push("   🚚 " + x); });
  }
  if (r.alertas.length) {
    l.push("");
    l.push(grave ? "🔎 Para revisar:" : "📝 Observaciones:");
    r.alertas.forEach(function (a) { l.push("• " + a.texto); });
  } else if (r.evento !== "CAMION_SIN_PESAR") {
    l.push(""); l.push("Sin observaciones.");
  }
  if (grave) {
    l.push("");
    l.push("👉 " + (r.evento === "CAMION_SIN_PESAR" ? "Verificar en portería si el camión sigue en planta y por qué no pasó por la balanza."
                                               : "Revisar la pesada antes de liberar la documentación."));
  }
  return l.join("\n");
}

function armarPromptUsuario(r) {
  // La humedad va escrita con coma decimal, como el resto del aviso
  var datos = JSON.parse(JSON.stringify(r.datos));
  if (typeof datos.humedad === "number") datos.humedad = fmtPct(datos.humedad) + " %";
  return "Redacta el aviso para este evento de la balanza. Datos (JSON):\n" + JSON.stringify({
    evento: r.evento, nivel: r.nivel, datos: datos, cifras_texto: r.cifras_texto,
    alertas: r.alertas.map(function (a) { return a.severidad + ": " + a.texto; })
  }, null, 2);
}

/* Control del texto que devuelve la IA. Si no pasa, se usa la plantilla. */
function validarTextoIA(texto, r) {
  if (!texto || typeof texto !== "string") return { ok: false, motivo: "La IA no devolvio texto." };
  var t = texto.trim();
  if (t.length > UMBRALES.largo_max_aviso) return { ok: false, motivo: "Texto demasiado largo (" + t.length + " caracteres)." };
  if (r.datos.patente && normPatente(t).indexOf(normPatente(r.datos.patente)) < 0)
    return { ok: false, motivo: "No menciona la patente." };
  if (r.cifras_texto.neto && t.indexOf(r.cifras_texto.neto.replace(" kg", "")) < 0)
    return { ok: false, motivo: "No incluye el neto exacto." };
  // Toda cifra seguida de "kg" tiene que existir en las cifras calculadas
  var permitidas = {};
  Object.keys(r.cifras).forEach(function (k) {
    if (typeof r.cifras[k] === "number") permitidas[String(Math.abs(Math.round(r.cifras[k])))] = true;
  });
  var re = /(\d{1,3}(?:\.\d{3})+|\d+)\s*kg/gi, m;
  while ((m = re.exec(t)) !== null) {
    if (!permitidas[m[1].replace(/\./g, "")]) return { ok: false, motivo: "Cifra no calculada por el sistema: " + m[0] + "." };
  }
  if (/\*\*|__|```/.test(t)) return { ok: false, motivo: "Uso formato Markdown." };
  // En ATENCION o CRITICO tiene que cerrar con la sugerencia (si falta, el texto pudo llegar cortado)
  if ((r.nivel === "ATENCION" || r.nivel === "CRITICO") && t.indexOf("👉") < 0)
    return { ok: false, motivo: "Falta la sugerencia final (texto incompleto)." };
  return { ok: true, motivo: "" };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    evaluar: evaluar, calcularContexto: calcularContexto, validarTextoIA: validarTextoIA, armarPlantilla: armarPlantilla,
    registrarLectura: registrarLectura, lecturasCercanas: lecturasCercanas, controlCamaras: controlCamaras,
    parametroDeProducto: parametroDeProducto, brutoTara: brutoTara, distancia: distancia, normPatente: normPatente,
    fmtKg: fmtKg, PROMPT_SISTEMA: PROMPT_SISTEMA, UMBRALES: UMBRALES, ANPR: ANPR, REGLAS_VERSION: REGLAS_VERSION
  };
}
