"""
Simula el cierre de una pesada y la envia al webhook de n8n, igual que lo haria el sistema real
(mismo formato de operacion: peso_inicial, peso_final, neto_total, cargas, calidad, lecturas de camara).
Solo usa la libreria estandar de Python (no hay que instalar nada).

Configuracion (archivo .env en la raiz del repo, NO se sube a GitHub):
    WEBHOOK_URL=https://TU-INSTANCIA.app.n8n.cloud/webhook/pesada-cerrada
    CLAVE=la-clave-configurada-en-n8n

Uso:
    python scripts/simular_cierre.py                   -> lista los camiones en planta y las camaras
    python scripts/simular_cierre.py 3                 -> cierra el camion 3 con los pesos sugeridos
    python scripts/simular_cierre.py 1 --tara 16100    -> ingreso con tara tipeada a mano
    python scripts/simular_cierre.py 2 --humedad 17.2 --aplicar-merma --otros 1.5
    python scripts/simular_cierre.py 5 --salida 14:30
    python scripts/simular_cierre.py --sin-pesar       -> avisa el camion que paso por la camara y no se peso
    python scripts/simular_cierre.py 3 --solo-ver      -> muestra el JSON sin enviarlo
"""
import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
UNIFICAR_MIN, REPETIDO_S = 5, 20          # mismas reglas de camaras que el sistema real
VENTANA_ANTES, VENTANA_DESPUES = 15, 10   # minutos alrededor de la entrada (como reglas.js)


def leer_env():
    env = {}
    archivo = RAIZ / ".env"
    if archivo.exists():
        for linea in archivo.read_text(encoding="utf-8").splitlines():
            if "=" in linea and not linea.strip().startswith("#"):
                k, v = linea.split("=", 1)
                env[k.strip()] = v.strip().strip('"').strip("'")
    env.update({k: v for k, v in os.environ.items() if k in ("WEBHOOK_URL", "CLAVE")})
    return env


def seg(h):
    p = [int(x) for x in h.split(":")]
    return p[0] * 3600 + p[1] * 60 + (p[2] if len(p) > 2 else 0)


def procesar_lecturas(crudas):
    """Unifica las lecturas crudas de las camaras en pasos (como el sistema real)."""
    pasos = []
    for l in crudas:
        pat, t = l["patente"], seg(l["hora"])
        accion = "nuevo"
        if pat != "UNKNOWN":
            for f in reversed(pasos):
                if f["patente"] != pat:
                    continue
                dif = t - seg(f["hora"])
                if dif < 0 or dif > UNIFICAR_MIN * 60:
                    break
                if l["camara"] in [c.strip() for c in f["camara"].split("→")]:
                    accion = "repetido" if dif < REPETIDO_S else "nuevo"
                    break
                f["camara"] = f["camara"] + " → " + l["camara"]
                accion = "unificado"
                break
        if accion == "nuevo":
            pasos.append({"hora": l["hora"], "patente": pat, "camara": l["camara"], "confianza": l.get("confianza", 0)})
    return pasos


def lecturas_cercanas(pasos, hora_entrada):
    m = seg(hora_entrada) / 60
    return [p for p in pasos if p["camara"].startswith("ENTRADA")
            and m - VENTANA_ANTES <= seg(p["hora"]) / 60 <= m + VENTANA_DESPUES]


def contexto(historial, op):
    """Promedio de neto del proveedor/avicola y tara habitual del camion (como reglas.js)."""
    clave = "proveedor" if op["tipo"] == "INGRESO" else "avicola"
    netos = [h["neto_total"] for h in historial if h["tipo"] == op["tipo"] and h.get(clave) and h.get(clave) == op.get(clave)]
    taras = [h["peso_final"] if h["tipo"] == "INGRESO" else h["peso_inicial"] for h in historial if h["patente"] == op["patente"]]
    return {"neto_promedio": round(sum(netos) / len(netos)) if netos else None, "pesadas_previas": len(netos),
            "tara_habitual": round(sum(taras) / len(taras)) if taras else None, "taras_previas": len(taras)}


def mas_minutos(h, m):
    t = seg(h) // 60 + m
    return f"{t // 60:02d}:{t % 60:02d}"


def cerrar(ab, a, datos, pasos):
    op = {k: v for k, v in ab.items() if k not in ("escenario", "tara_sugerida", "cargas_previstas")}
    op.update(estado="CERRADA", fecha=datos["fecha_simulada"], operario="OPERADOR DEMO",
              hora_salida=a.salida or mas_minutos(ab["hora_entrada"], 200 if "PERMANENCIA" in ab["escenario"] else 40))
    if ab["tipo"] == "INGRESO":
        tara = a.tara or ab["tara_sugerida"]
        op.update(peso_final=tara, neto_total=ab["peso_inicial"] - tara, aplica_merma=a.aplicar_merma,
                  humedad=a.humedad if a.humedad is not None else ab.get("humedad"))
        for k in ("desc_otros", "desc_olor", "desc_amoh", "desc_cham", "desc_bich", "desc_vola"):
            op[k] = op.get(k, 0)
        if a.otros is not None:
            op["desc_otros"] = a.otros
        op["cargas"] = [{"orden": 1, "granja": "", "producto_cod": "", "producto_nom": ab["producto_nom"],
                         "peso_balanza": tara, "neto": op["neto_total"], "hora": op["hora_salida"]}]
    else:
        acumulado, cargas = ab["peso_inicial"], []
        for i, c in enumerate(ab["cargas_previstas"], 1):
            acumulado += c["neto_sugerido"]
            cargas.append({"orden": i, "granja": c["granja"], "producto_cod": c["producto_cod"],
                           "producto_nom": c["producto_nom"], "peso_balanza": acumulado, "neto": c["neto_sugerido"],
                           "hora": op["hora_salida"]})
        op.update(cargas=cargas, peso_final=acumulado, neto_total=sum(c["neto"] for c in cargas),
                  humedad=None, aplica_merma=False)
    op.update(evento="PESADA_CERRADA", origen="SCRIPT simular_cierre.py", planta=datos["planta"],
              parametros=datos["parametros"], contexto=contexto(datos["historial"], op),
              lecturas_camara=lecturas_cercanas(pasos, op["hora_entrada"]))
    return op


def enviar(ev):
    env = leer_env()
    url, clave = env.get("WEBHOOK_URL"), env.get("CLAVE")
    if not url:
        print("Falta WEBHOOK_URL en el archivo .env (ver .env.example). Usá --solo-ver para ver el JSON.")
        return 1
    req = urllib.request.Request(url, data=json.dumps({**ev, "clave": clave}).encode("utf-8"),
                                 headers={"Content-Type": "application/json"}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            resp = json.loads(r.read().decode("utf-8"))
    except urllib.error.HTTPError as e:
        print(f"n8n respondio HTTP {e.code}: {e.read().decode('utf-8', 'replace')[:300]}")
        return 1
    except Exception as e:
        print(f"No se pudo conectar con n8n: {e}")
        return 1
    print(f"NIVEL: {resp.get('nivel')}   REDACTO: {resp.get('origen')}   TELEGRAM: "
          f"{'ENVIADO' if resp.get('telegram_enviado') else 'NO ENVIADO'}")
    if resp.get("motivo_respaldo"):
        print(f"Motivo del respaldo: {resp['motivo_respaldo']}")
    print("-" * 60 + "\n" + resp.get("mensaje", "") + "\n" + "-" * 60)
    return 0


def main():
    datos = json.loads((RAIZ / "datos" / "pesadas_ficticias.json").read_text(encoding="utf-8"))
    pasos = procesar_lecturas(datos["lecturas_camaras"])
    ap = argparse.ArgumentParser(description="Simula el cierre de una pesada (datos ficticios).")
    ap.add_argument("camion", nargs="?", type=int, help="numero de camion de la lista")
    ap.add_argument("--tara", type=int, help="ingreso: tara tipeada a mano")
    ap.add_argument("--humedad", type=float)
    ap.add_argument("--aplicar-merma", action="store_true", help="la merma por humedad descuenta kilos")
    ap.add_argument("--otros", type=float, help="descuento de calidad 'otros %%'")
    ap.add_argument("--salida", help="hora de salida HH:MM")
    ap.add_argument("--sin-pesar", action="store_true", help="aviso de camion que paso por la camara y no se peso")
    ap.add_argument("--solo-ver", action="store_true", help="muestra el JSON y no lo envia")
    a = ap.parse_args()

    if a.sin_pesar:
        pesadas = {h["patente"] for h in datos["historial"]} | {p["patente"] for p in datos["en_planta"]}
        sin = [p for p in pasos if p["patente"] != "UNKNOWN" and p["patente"] not in pesadas
               and not any(sum(x != y for x, y in zip(p["patente"], q)) == 1 for q in pesadas)]
        ev = {"evento": "CAMION_SIN_PESAR", "origen": "SCRIPT simular_cierre.py", "planta": datos["planta"],
              "patente": sin[0]["patente"], "hora": sin[0]["hora"], "camara": sin[0]["camara"]}
    elif not a.camion:
        print("CAMIONES EN PLANTA (datos ficticios):")
        for i, p in enumerate(datos["en_planta"], 1):
            quien = p.get("proveedor") or p.get("avicola")
            print(f"  {i}. {p['tipo']:<8} {p['patente']}  {quien:<24} -> {p['escenario']}")
        print("\nCAMARAS (pasos del dia):")
        for p in pasos:
            print(f"  {p['hora']}  {p['patente']:<8} {p['camara']}")
        print("\nEjemplos: python scripts/simular_cierre.py 3     |     python scripts/simular_cierre.py --sin-pesar")
        return 0
    else:
        ev = cerrar(datos["en_planta"][a.camion - 1], a, datos, pasos)

    if a.solo_ver:
        print(json.dumps(ev, ensure_ascii=False, indent=2))
        return 0
    return enviar(ev)


if __name__ == "__main__":
    sys.exit(main())
