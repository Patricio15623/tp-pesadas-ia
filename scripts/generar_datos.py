"""
Genera el set de DATOS FICTICIOS del simulador.

Nada de este archivo proviene de la planta real: proveedores, avicolas, granjas, choferes,
patentes y pesos son inventados. La semilla fija hace que el resultado sea siempre el mismo.

El FORMATO si es el del sistema de pesadas real (operaciones con peso_inicial, peso_final,
neto_total, cargas y descuentos de calidad; lecturas de camaras ENTRADA / SALIDA), para que la
simulacion se comporte como la planta.

Uso:
    python scripts/generar_datos.py
Salida:
    datos/pesadas_ficticias.json
    simulador/datos.js   (la misma informacion, para el simulador web)
"""
import json
import random
from datetime import date, datetime, timedelta
from pathlib import Path

random.seed(2026)

# Proveedores de materia prima: (producto, neto tipico)
PROVEEDORES = {
    "ACOPIO LOS TRES OMBUES": ("MAIZ", 29500),
    "CEREALERA DEMO SUR": ("SOJA", 28000),
    "AGRO PAMPA FICTICIA": ("EXPELLER DE SOJA", 27000),
    "SEMILLAS EL CARDO AZUL": ("TRIGO", 30000),
}
# Avicolas clientes y sus granjas de destino
AVICOLAS = {
    "AVICOLA LOS COLIBRIES": ["GRANJA NORTE", "GRANJA SUR", "GRANJA LA LOMADA"],
    "GRANJA DEMO EL ALBA": ["EL ALBA 1", "EL ALBA 2"],
}
ALIMENTOS = [("D01", "INICIADOR"), ("D02", "CRECIMIENTO"), ("D03", "TERMINADOR")]
TRANSPORTES = ["TRANSPORTE DEMO SRL", "FLETES LA RUTA", "LOGISTICA EJEMPLO"]

# Parametros de calidad (misma estructura que la tabla del sistema real).
# La humedad base es la de fabrica; el limite de recepcion arranca VACIO (sin aviso) y lo define
# la planta. Aca solo MAIZ tiene un limite cargado, como ejemplo, para mostrar las dos situaciones.
PARAMETROS = [
    {"producto": "EXPELLER", "orden": 1, "humedad_base": 13.5, "limite_rechazo": None},
    {"producto": "SOJA",     "orden": 2, "humedad_base": 13.5, "limite_rechazo": None},
    {"producto": "MAIZ",     "orden": 3, "humedad_base": 14.5, "limite_rechazo": 18.0},
    {"producto": "TRIGO",    "orden": 4, "humedad_base": 14.0, "limite_rechazo": None},
]

# Camiones ficticios: patente serie "ZZ" (no emitida), tara habitual, chofer, acoplado
CAMIONES = [(f"ZZ{100 + i:03d}{chr(65 + i)}A", random.randint(14200, 16800), f"CHOFER {i + 1:02d}", f"ZZ{500 + i:03d}{chr(65 + i)}B")
            for i in range(12)]


def r20(kg):
    """La balanza trabaja con division de 20 kg."""
    return int(round(kg / 20.0) * 20)


def hhmm(dt):
    return dt.strftime("%H:%M")


def operacion_ingreso(nro, dia, ini, camion, prov, humedad, neto, tara):
    patente, _, chofer, acoplado = camion
    producto = PROVEEDORES[prov][0]
    bruto = tara + neto
    salida = ini + timedelta(minutes=random.randint(25, 70))
    return {
        "nro": nro, "tipo": "INGRESO", "estado": "CERRADA", "fecha": dia.isoformat(),
        "hora_entrada": hhmm(ini), "hora_salida": hhmm(salida),
        "patente": patente, "acoplado": acoplado, "chofer": chofer, "transporte": random.choice(TRANSPORTES),
        "proveedor": prov, "avicola": "", "producto_cod": "", "producto_nom": producto,
        "humedad": humedad, "aplica_merma": False, "desc_otros": 0,
        "peso_inicial": bruto, "peso_final": tara, "neto_total": neto,
        "cargas": [{"orden": 1, "granja": "", "producto_cod": "", "producto_nom": producto,
                    "peso_balanza": tara, "neto": neto, "hora": hhmm(salida)}],
        "operario": "OPERADOR DEMO",
    }


def operacion_egreso(nro, dia, ini, camion, avicola, tara, netos):
    patente, _, chofer, acoplado = camion
    granjas = random.sample(AVICOLAS[avicola], k=min(len(netos), len(AVICOLAS[avicola])))
    cargas, acumulado, t = [], tara, ini
    for i, neto in enumerate(netos):
        acumulado += neto
        t += timedelta(minutes=random.randint(8, 15))
        cod, nom = random.choice(ALIMENTOS)
        cargas.append({"orden": i + 1, "granja": granjas[i % len(granjas)], "producto_cod": cod, "producto_nom": nom,
                       "peso_balanza": acumulado, "neto": neto, "hora": hhmm(t)})
    return {
        "nro": nro, "tipo": "EGRESO", "estado": "CERRADA", "fecha": dia.isoformat(),
        "hora_entrada": hhmm(ini), "hora_salida": hhmm(t + timedelta(minutes=5)),
        "patente": patente, "acoplado": acoplado, "chofer": chofer, "transporte": random.choice(TRANSPORTES),
        "proveedor": "", "avicola": avicola, "producto_cod": "", "producto_nom": "",
        "humedad": None, "aplica_merma": False, "desc_otros": 0,
        "peso_inicial": tara, "peso_final": acumulado, "neto_total": sum(netos),
        "cargas": cargas, "operario": "OPERADOR DEMO",
    }


def generar():
    historial, nro = [], 1000
    hoy = date(2026, 10, 20)
    for d in range(30, 0, -1):
        dia = hoy - timedelta(days=d)
        if dia.weekday() == 6:  # domingos no se recibe
            continue
        for _ in range(random.randint(1, 3)):
            nro += 1
            camion = random.choice(CAMIONES[:10])
            ini = datetime.combine(dia, datetime.min.time()) + timedelta(hours=random.randint(7, 16), minutes=random.randint(0, 59))
            tara = r20(camion[1] + random.randint(-150, 150))
            if random.random() < 0.65:
                prov = random.choice(list(PROVEEDORES))
                producto, neto_tipico = PROVEEDORES[prov]
                base = next(p["humedad_base"] for p in PARAMETROS if p["producto"] in producto)
                historial.append(operacion_ingreso(nro, dia, ini, camion, prov,
                                                   round(random.uniform(base - 1.5, base + 1.2), 1),
                                                   r20(neto_tipico * random.uniform(0.94, 1.06)), tara))
            else:
                avicola = random.choice(list(AVICOLAS))
                n = random.randint(1, 3)
                netos = [r20(random.uniform(24000, 30000) / n) for _ in range(n)]
                historial.append(operacion_egreso(nro, dia, ini, camion, avicola, tara, netos))

    C = CAMIONES
    # Operaciones ABIERTAS: camiones "en planta" esperando el cierre (los usa el simulador)
    en_planta = [
        {"nro": nro + 1, "tipo": "INGRESO", "escenario": "NORMAL",
         "patente": C[0][0], "acoplado": C[0][3], "chofer": C[0][2], "transporte": TRANSPORTES[0],
         "proveedor": "ACOPIO LOS TRES OMBUES", "producto_cod": "", "producto_nom": "MAIZ",
         "hora_entrada": "08:05", "peso_inicial": r20(C[0][1] + 29600), "humedad": 14.1,
         "tara_sugerida": r20(C[0][1])},
        {"nro": nro + 2, "tipo": "INGRESO", "escenario": "HUMEDAD Y DESCUENTOS · LECTURA DUDOSA",
         "patente": C[1][0], "acoplado": C[1][3], "chofer": C[1][2], "transporte": TRANSPORTES[1],
         "proveedor": "CEREALERA DEMO SUR", "producto_cod": "", "producto_nom": "SOJA",
         "hora_entrada": "08:40", "peso_inicial": r20(C[1][1] + 27900), "humedad": 15.2,
         "desc_otros": 0.5, "desc_cham": 0.3, "tara_sugerida": r20(C[1][1])},
        {"nro": nro + 3, "tipo": "INGRESO", "escenario": "HUMEDAD SOBRE LIMITE",
         "patente": C[2][0], "acoplado": C[2][3], "chofer": C[2][2], "transporte": TRANSPORTES[0],
         "proveedor": "ACOPIO LOS TRES OMBUES", "producto_cod": "", "producto_nom": "MAIZ",
         "hora_entrada": "09:15", "peso_inicial": r20(C[2][1] + 29300), "humedad": 18.6,
         "tara_sugerida": r20(C[2][1])},
        {"nro": nro + 4, "tipo": "INGRESO", "escenario": "NETO Y TARA FUERA DE LO HABITUAL · PATENTE NO COINCIDE",
         "patente": C[3][0], "acoplado": C[3][3], "chofer": C[3][2], "transporte": TRANSPORTES[2],
         "proveedor": "AGRO PAMPA FICTICIA", "producto_cod": "", "producto_nom": "EXPELLER DE SOJA",
         "hora_entrada": "10:02", "peso_inicial": r20(C[3][1] + 21000), "humedad": 12.9,
         "tara_sugerida": r20(C[3][1] + 900)},
        {"nro": nro + 5, "tipo": "EGRESO", "escenario": "EGRESO A TRES GRANJAS",
         "patente": C[4][0], "acoplado": C[4][3], "chofer": C[4][2], "transporte": TRANSPORTES[1],
         "avicola": "AVICOLA LOS COLIBRIES", "hora_entrada": "10:30", "peso_inicial": r20(C[4][1]),
         "cargas_previstas": [
             {"granja": "GRANJA NORTE", "producto_cod": "D01", "producto_nom": "INICIADOR", "neto_sugerido": 9200},
             {"granja": "GRANJA SUR", "producto_cod": "D03", "producto_nom": "TERMINADOR", "neto_sugerido": 10400},
             {"granja": "GRANJA LA LOMADA", "producto_cod": "D02", "producto_nom": "CRECIMIENTO", "neto_sugerido": 8100}]},
        {"nro": nro + 6, "tipo": "EGRESO", "escenario": "PERMANENCIA LARGA · SIN PATENTE LEGIBLE",
         "patente": C[5][0], "acoplado": C[5][3], "chofer": C[5][2], "transporte": TRANSPORTES[2],
         "avicola": "GRANJA DEMO EL ALBA", "hora_entrada": "06:10", "peso_inicial": r20(C[5][1]),
         "cargas_previstas": [
             {"granja": "EL ALBA 1", "producto_cod": "D02", "producto_nom": "CRECIMIENTO", "neto_sugerido": 13600},
             {"granja": "EL ALBA 2", "producto_cod": "D02", "producto_nom": "CRECIMIENTO", "neto_sugerido": 13200}]},
    ]

    # Lecturas crudas de las camaras de HOY (como llegan del grabador: una por camara y por lectura).
    # El simulador las procesa con las mismas reglas del sistema real (unificar / repetido).
    lecturas = [
        {"hora": "06:08:50", "patente": "UNKNOWN", "camara": "ENTRADA", "confianza": 0},     # vehiculo sin patente legible
        {"hora": "07:20:05", "patente": C[10][0], "camara": "ENTRADA", "confianza": 96},     # camion que nunca se peso
        {"hora": "07:20:09", "patente": C[10][0], "camara": "SALIDA", "confianza": 94},
        {"hora": "08:03:10", "patente": C[0][0], "camara": "ENTRADA", "confianza": 97},
        {"hora": "08:03:14", "patente": C[0][0], "camara": "SALIDA", "confianza": 95},      # mismo paso -> se unifica
        {"hora": "08:03:18", "patente": C[0][0], "camara": "ENTRADA", "confianza": 96},     # repetido -> se ignora
        {"hora": "08:38:40", "patente": C[1][0][:3] + "O" + C[1][0][4:], "camara": "ENTRADA", "confianza": 71},  # 0 leido como O
        {"hora": "09:13:05", "patente": C[2][0], "camara": "ENTRADA", "confianza": 98},
        {"hora": "09:13:09", "patente": C[2][0], "camara": "SALIDA", "confianza": 97},
        {"hora": "10:00:30", "patente": C[11][0], "camara": "ENTRADA", "confianza": 95},    # otro camion
        {"hora": "10:00:34", "patente": C[11][0], "camara": "SALIDA", "confianza": 93},
        {"hora": "10:28:00", "patente": C[4][0], "camara": "ENTRADA", "confianza": 96},
        {"hora": "10:28:03", "patente": C[4][0], "camara": "SALIDA", "confianza": 95},
    ]

    return {
        "_aviso": "DATOS FICTICIOS generados por scripts/generar_datos.py. No corresponden a ninguna empresa real.",
        "planta": "PLANTA DEMO DE ALIMENTO BALANCEADO",
        "fecha_simulada": "2026-10-21",
        "parametros": PARAMETROS,
        "historial": historial,
        "en_planta": en_planta,
        "lecturas_camaras": lecturas,
    }


if __name__ == "__main__":
    raiz = Path(__file__).resolve().parent.parent
    datos = generar()
    salida = raiz / "datos" / "pesadas_ficticias.json"
    salida.write_text(json.dumps(datos, ensure_ascii=False, indent=2), encoding="utf-8")
    (raiz / "simulador" / "datos.js").write_text(
        "// Generado por scripts/generar_datos.py - DATOS FICTICIOS\nwindow.DATOS = "
        + json.dumps(datos, ensure_ascii=False) + ";\n", encoding="utf-8")
    print(f"OK: {len(datos['historial'])} operaciones de historial, {len(datos['en_planta'])} en planta, "
          f"{len(datos['lecturas_camaras'])} lecturas de camara -> {salida}")
