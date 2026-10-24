"""
Arma el flujo de n8n (n8n/flujo_aviso_pesada.json) a partir de simulador/reglas.js.

Por que un script: las reglas viven en UN solo archivo (reglas.js). Este script las copia
dentro de los nodos "Code" del flujo, asi el simulador y n8n calculan exactamente lo mismo.

Uso:
    python scripts/armar_flujo.py                 -> n8n/flujo_aviso_pesada.json (IA: Claude, de Anthropic)
                                                     y n8n/flujo_aviso_pesada_gemini.json (alternativa gratuita)
    python scripts/armar_flujo.py --prueba URL [destino] [claude|gemini]
                                                  -> variante de prueba local: la IA y Telegram
                                                     se reemplazan por un servidor simulado en URL
El flujo NO contiene claves ni tokens: se cargan como credenciales dentro de n8n.
"""
import json
import sys
import uuid
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
REGLAS = (RAIZ / "simulador" / "reglas.js").read_text(encoding="utf-8")

# Proveedores de IA. Solo cambia como se arma el pedido y donde viene el texto en la respuesta.
IAS = {
    "claude": {
        "nombre": "CLAUDE",
        "modelo": "claude-haiku-5-5",
        "url": "https://api.anthropic.com/v1/messages",
        "credencial": "Header Auth: nombre x-api-key, valor = API key de Anthropic (console.anthropic.com).",
        "headers": [{"name": "anthropic-version", "value": "2023-06-01"}],
        "cuerpo": """{
    model: MODELO_IA, max_tokens: 2000,
    system: PROMPT_SISTEMA,
    messages: [{ role: "user", content: resultado.prompt_usuario }]
  }""",
    },
    "gemini": {
        "nombre": "GEMINI",
        "modelo": "gemini-2.5-flash",
        "url": "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
        "credencial": "Header Auth: nombre x-goog-api-key, valor = API key de Google AI Studio.",
        "headers": [],
        "cuerpo": """{
    systemInstruction: { parts: [{ text: PROMPT_SISTEMA }] },
    contents: [{ role: "user", parts: [{ text: resultado.prompt_usuario }] }],
    generationConfig: { temperature: 0.3, maxOutputTokens: 800, thinkingConfig: { thinkingBudget: 0 } }
  }""",
    },
}

CODIGO_ENTRADA = REGLAS + r"""

// ===================== NODO: REGLAS Y CONTROL DE ACCESO =====================
// Clave que tiene que mandar el simulador (campo "clave").
// CAMBIAR dentro de n8n. No se sube al repositorio con el valor real.
const CLAVE_ESPERADA = "CAMBIAR_ESTA_CLAVE";
const MODELO_IA = "__MODELO__";

const body = $input.first().json.body || {};
let autorizado = true, error = "";
if (CLAVE_ESPERADA === "CAMBIAR_ESTA_CLAVE") { autorizado = false; error = "El flujo no tiene configurada la clave (nodo Reglas)."; }
else if (body.clave !== CLAVE_ESPERADA) { autorizado = false; error = "Clave incorrecta."; }
else if (["PESADA_CERRADA", "CAMION_SIN_PESAR"].indexOf(body.evento) < 0) { autorizado = false; error = "Evento no reconocido."; }

const evento = Object.assign({}, body);
delete evento.clave;  // la clave no sigue viajando por el flujo
const resultado = autorizado ? evaluar(evento) : null;

return [{ json: {
  autorizado, error, evento, resultado,
  cuerpo_ia: autorizado ? __CUERPO__ : null
} }];
"""

CODIGO_VALIDAR = REGLAS + r"""

// ===================== NODO: VALIDAR LO QUE ESCRIBIO LA IA =====================
// Si la IA no respondio, invento una cifra, omitio la patente o el neto, se usa la plantilla fija.
const r = $("Reglas y control de acceso").first().json.resultado;
const resp = $input.first().json || {};
let texto = "";
try {
  if (Array.isArray(resp.content))   // Claude (Anthropic)
    texto = resp.content.filter(b => b.type === "text").map(b => b.text || "").join("").trim();
  else                               // Gemini (Google)
    texto = (resp.candidates[0].content.parts || []).map(p => p.text || "").join("").trim();
} catch (e) { texto = ""; }

let usarIA = false, motivo = "";
// Respuesta cortada por el limite de tokens (Claude: stop_reason; Gemini: finishReason)
const cortada = resp.stop_reason === "max_tokens" ||
  (Array.isArray(resp.candidates) && resp.candidates[0] && resp.candidates[0].finishReason === "MAX_TOKENS");
if (resp.error) {
  motivo = "La IA no respondio: " + String(resp.error.message || JSON.stringify(resp.error)).slice(0, 160);
} else if (cortada) {
  motivo = "El texto de la IA llego cortado (limite de tokens).";
} else {
  const v = validarTextoIA(texto, r);
  usarIA = v.ok; motivo = v.motivo;
}

return [{ json: {
  mensaje: usarIA ? texto : r.plantilla,
  origen: usarIA ? "IA (__NOMBRE_IA__)" : "PLANTILLA (RESPALDO)",
  motivo_respaldo: usarIA ? "" : motivo,
  texto_ia_descartado: usarIA ? null : (texto || null),
  nivel: r.nivel,
  alertas: r.alertas,
  cifras: r.cifras
} }];
"""


def nodo(nombre, tipo, version, pos, parametros, **extra):
    n = {"parameters": parametros, "id": str(uuid.uuid5(uuid.NAMESPACE_URL, "tp-pesadas/" + nombre)),
         "name": nombre, "type": tipo, "typeVersion": version, "position": pos}
    n.update(extra)
    return n


def armar(url_prueba=None, proveedor="claude"):
    cfg = IAS[proveedor]
    url_ia = (url_prueba.rstrip("/") + "/ia") if url_prueba else cfg["url"]
    codigo_entrada = CODIGO_ENTRADA.replace("__CUERPO__", cfg["cuerpo"]).replace("__MODELO__", cfg["modelo"])

    webhook = nodo("Webhook pesada cerrada", "n8n-nodes-base.webhook", 2, [0, 300], {
        "httpMethod": "POST", "path": "pesada-cerrada", "responseMode": "responseNode",
        "options": {"allowedOrigins": "*"}},
        webhookId=str(uuid.uuid5(uuid.NAMESPACE_URL, "tp-pesadas/webhook")))

    reglas = nodo("Reglas y control de acceso", "n8n-nodes-base.code", 2, [240, 300], {"jsCode": codigo_entrada})

    si = nodo("¿Autorizado?", "n8n-nodes-base.if", 1, [480, 300], {
        "conditions": {"boolean": [{"value1": "={{ $json.autorizado }}", "value2": True}]}})

    rechazo = nodo("Responder rechazo", "n8n-nodes-base.respondToWebhook", 1.1, [720, 480], {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify({ ok: false, error: $json.error }) }}",
        "options": {"responseCode": 401}})

    ia_params = {
        "method": "POST", "url": url_ia,
        "sendBody": True, "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify($json.cuerpo_ia) }}",
        "options": {"timeout": 25000}}
    if cfg["headers"]:
        ia_params.update({"sendHeaders": True, "headerParameters": {"parameters": cfg["headers"]}})
    if not url_prueba:
        ia_params.update({"authentication": "genericCredentialType", "genericAuthType": "httpHeaderAuth"})
    ia = nodo("IA redacta el aviso", "n8n-nodes-base.httpRequest", 4.2, [720, 200], ia_params,
              onError="continueRegularOutput", notes=cfg["nombre"] + " (" + cfg["modelo"] + "). Credencial " + cfg["credencial"])

    nombre_ia = ("SIMULADA, FORMATO " + cfg["nombre"]) if url_prueba else cfg["nombre"]
    codigo_validar = CODIGO_VALIDAR.replace("__NOMBRE_IA__", nombre_ia)
    validar = nodo("Validar texto de la IA", "n8n-nodes-base.code", 2, [960, 200], {"jsCode": codigo_validar})

    if url_prueba:
        telegram = nodo("Enviar a Telegram", "n8n-nodes-base.httpRequest", 4.2, [1200, 200], {
            "method": "POST", "url": url_prueba.rstrip("/") + "/telegram",
            "sendBody": True, "specifyBody": "json",
            "jsonBody": "={{ JSON.stringify({ chat_id: 'PRUEBA', text: $json.mensaje }) }}",
            "options": {}}, onError="continueRegularOutput")
    else:
        telegram = nodo("Enviar a Telegram", "n8n-nodes-base.telegram", 1.2, [1200, 200], {
            "chatId": "CAMBIAR_POR_CHAT_ID",
            "text": "={{ $json.mensaje }}",
            "additionalFields": {"appendAttribution": False}},
            onError="continueRegularOutput", notes="Credencial: token del bot (BotFather). Chat ID del grupo o canal.")

    respuesta = nodo("Responder al simulador", "n8n-nodes-base.respondToWebhook", 1.1, [1440, 200], {
        "respondWith": "json",
        "responseBody": "={{ JSON.stringify(Object.assign({ ok: true, telegram_enviado: !$json.error, "
                        "telegram_error: $json.error ? String($json.error.message || $json.error).slice(0, 160) : null }, "
                        "$('Validar texto de la IA').first().json)) }}",
        "options": {"responseCode": 200}})

    nodos = [webhook, reglas, si, rechazo, ia, validar, telegram, respuesta]
    con = lambda dest: [{"node": dest, "type": "main", "index": 0}]
    conexiones = {
        webhook["name"]: {"main": [con(reglas["name"])]},
        reglas["name"]: {"main": [con(si["name"])]},
        si["name"]: {"main": [con(ia["name"]), con(rechazo["name"])]},
        ia["name"]: {"main": [con(validar["name"])]},
        validar["name"]: {"main": [con(telegram["name"])]},
        telegram["name"]: {"main": [con(respuesta["name"])]},
    }
    return {
        "name": "TP - Aviso inteligente de pesada cerrada" + (" - " + cfg["nombre"]) + (" (PRUEBA LOCAL)" if url_prueba else ""),
        "nodes": nodos, "connections": conexiones,
        "settings": {"executionOrder": "v1"},
        "pinData": {}, "active": False,
        "meta": {"templateCredsSetupCompleted": False},
        "tags": [],
    }


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "--prueba":
        destino = Path(sys.argv[3]) if len(sys.argv) > 3 else RAIZ / "n8n" / "flujo_prueba_local.json"
        proveedor = sys.argv[4] if len(sys.argv) > 4 else "claude"
        destino.write_text(json.dumps(armar(sys.argv[2], proveedor), ensure_ascii=False, indent=2), encoding="utf-8")
        print("OK ->", destino)
    else:
        for proveedor, archivo in (("claude", "flujo_aviso_pesada.json"), ("gemini", "flujo_aviso_pesada_gemini.json")):
            destino = RAIZ / "n8n" / archivo
            destino.write_text(json.dumps(armar(None, proveedor), ensure_ascii=False, indent=2), encoding="utf-8")
            print("OK ->", destino)
