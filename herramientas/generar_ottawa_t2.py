"""Genera el equipo Kalmar Ottawa T2 (4x2, LHD) para la app, a partir del plano de Kalmar
"GEN ARRANGEMENT, OTTAWA T2, LHD" (DSK8504-D, distancias entre ejes 116/126/136 in).

Uso:  python3 herramientas/generar_ottawa_t2.py [116|126|136]
Escribe android/data/kalmar-ottawa-t2.json y lo agrega a android/data/machines.json.

Coordenadas del equipo (metros): origen en el suelo, en el centro del largo total y del ancho.
+Z = frente, +Y = arriba, +X = lado izquierdo del equipo (lado de la cabina en este LHD).
"""
import json
import sys
from pathlib import Path

WB_TABLA = {116: (2.946, 4.851), 126: (3.200, 5.105), 136: (3.454, 5.359)}  # entre ejes, largo total
VOLADIZO_DEL = 1.270   # frente → eje delantero (50 in)
VOLADIZO_TRAS = 0.635  # eje trasero → extremo trasero (25 in)
ANCHO_TOTAL = 2.464    # sobre las duales traseras (97 in)
ANCHO_DEL = 2.273      # sobre las ruedas delanteras (89 in)
ALTO_CABINA = 3.200    # techo de cabina (126 in)
ALTO_ESCAPE = 3.458    # punta del escape (136 in)
DIAM_RUEDA = 1.0516    # 11R22.5 (41.4 in)
ANCHO_RUEDA = 0.28
ALTO_5A_RUEDA = 1.600  # quinta rueda, brazo abajo (63 in)


def generar(wb_in: int) -> dict:
    wb, largo = WB_TABLA[wb_in]
    zf = largo / 2                 # extremo delantero
    za = zf - VOLADIZO_DEL         # eje delantero
    zr = za - wb                   # eje trasero
    zb = zr - VOLADIZO_TRAS        # extremo trasero
    r = DIAM_RUEDA / 2
    xd = ANCHO_DEL / 2 - ANCHO_RUEDA / 2           # centro rueda delantera
    xt_ext = ANCHO_TOTAL / 2 - ANCHO_RUEDA / 2     # dual trasera exterior
    xt_int = xt_ext - 0.32                         # dual trasera interior
    f = lambda dz: round(zf + dz, 3)   # relativo al frente
    t = lambda dz: round(zr + dz, 3)   # relativo al eje trasero
    R = lambda v: [round(n, 3) for n in v]

    gris, negro, blanco, amarillo = '#8a9099', '#2b2b2b', '#e8eaed', '#d9a400'
    preview = [
        # Cabina (desplazada al lado izquierdo, +X)
        {"size": [1.372, ALTO_CABINA - 1.17, 2.05], "pos": R([0.518, (ALTO_CABINA + 1.17) / 2, f(-1.07)]), "color": blanco},
        # Paragolpes / frente inferior
        {"size": [ANCHO_TOTAL, 0.62, 0.5], "pos": R([0, 0.86, f(-0.25)]), "color": negro},
        # Compartimiento del motor (lado derecho, -X)
        {"size": [1.03, 1.2, 1.51], "pos": R([-0.717, 1.2, f(-0.755)]), "color": gris},
        # Caja del filtro de aire y escape
        {"size": [0.58, 1.23, 0.5], "pos": R([-0.91, 1.95, f(-1.8)]), "color": negro},
        {"size": [0.12, ALTO_ESCAPE - 1.9, 0.12], "pos": R([-0.87, (ALTO_ESCAPE + 1.9) / 2, f(-1.79)]), "color": '#c0c0c0'},
        # Chasis
        {"size": [0.9, 0.35, (f(-1.0) - zb) - 0.3], "pos": R([0, 0.9, (f(-1.0) + zb + 0.3) / 2]), "color": negro},
        # Tanque de combustible (lado izquierdo, +X)
        {"size": [0.36, 0.5, 1.1], "pos": R([1.06, 0.6, f(-2.6)]), "color": negro},
        # Tanque hidráulico (lado derecho, -X)
        {"size": [0.58, 0.6, 0.42], "pos": R([-0.89, 0.9, t(0.98)]), "color": negro},
        # Caja trasera izquierda (DEF / baterías)
        {"size": [0.55, 0.73, 0.53], "pos": R([0.9, 0.74, t(0.99)]), "color": negro},
        # Brazo de elevación (boom) y quinta rueda
        {"size": [0.8, 0.12, 1.17], "pos": R([0, 1.3, t(0.87)]), "rot": [20, 0, 0], "color": amarillo},
        {"size": [0.9, 0.12, 0.89], "pos": R([0, ALTO_5A_RUEDA - 0.06, t(0.18)]), "color": '#3a3a3a'},
        # Plataforma trasera
        {"size": [2.0, 0.4, 0.6], "pos": R([0, 1.0, t(-0.33)]), "color": negro},
    ]
    for x in (xd, -xd):
        preview.append({"shape": "wheel", "size": [ANCHO_RUEDA, DIAM_RUEDA, DIAM_RUEDA], "pos": R([x, r, za]), "color": '#1f1f1f'})
    for x in (xt_ext, xt_int, -xt_int, -xt_ext):
        preview.append({"shape": "wheel", "size": [ANCHO_RUEDA, DIAM_RUEDA, DIAM_RUEDA], "pos": R([x, r, zr]), "color": '#1f1f1f'})

    hint_del = 'en el suelo, del lado de afuera de la rueda, justo debajo del centro de la llanta'
    hint_tras = 'en el suelo, del lado de afuera de la rueda dual exterior, debajo del centro de la llanta'
    ref_points = [
        {"id": "ref-rueda-del-izq", "name": "Rueda delantera izquierda", "hint": hint_del, "ground": True, "position": R([ANCHO_DEL / 2, 0, za])},
        {"id": "ref-rueda-del-der", "name": "Rueda delantera derecha", "hint": hint_del, "ground": True, "position": R([-ANCHO_DEL / 2, 0, za])},
        {"id": "ref-rueda-tras-der", "name": "Rueda trasera derecha (dual)", "hint": hint_tras, "ground": True, "position": R([-ANCHO_TOTAL / 2, 0, zr])},
        {"id": "ref-rueda-tras-izq", "name": "Rueda trasera izquierda (dual)", "hint": hint_tras, "ground": True, "position": R([ANCHO_TOTAL / 2, 0, zr])},
    ]

    LOTO = '⚠ Estacionar en superficie nivelada, freno de estacionamiento aplicado, brazo (boom) abajo, motor apagado y bloqueo y etiquetado (LOTO).'
    VERIF = 'Verificar con el manual de servicio de Kalmar Ottawa T2 de la unidad.'
    izq, der = 0.6, -0.6
    comp = [
        {
            "id": "motor", "name": "Motor diésel", "system": "Motor",
            "position": R([-0.7, 1.15, f(-0.75)]), "labelOffset": [der, 0.55, 0.2],
            "description": "Compartimiento del motor al lado derecho de la cabina (cabina desplazada). " + VERIF,
            "specs": {"Ubicación": "Lado derecho, junto a la cabina", "Aceite": "Según manual del motor", "Acceso": "Tapa lateral derecha"},
            "maintenance": {"task": "Cambio de aceite y filtro de motor", "intervalHours": 500, "lastServiceHours": 0},
            "safety": ["Aceite caliente: esperar a que el motor se enfríe.", "Recolectar el aceite usado."],
            "procedure": [LOTO, "Abrir la tapa del compartimiento del motor.", "Drenar el aceite con el motor tibio.", "Cambiar el filtro (lubricar la junta, apretar a mano según indicación del filtro).",
                          "Reinstalar el tapón de drenaje con junta nueva y rellenar hasta el nivel.", "Arrancar, verificar fugas y presión de aceite; apagar y comprobar nivel.", "Registrar el horómetro del servicio."],
            "checklist": ["LOTO aplicado", "Aceite drenado", "Filtro nuevo", "Nivel correcto", "Sin fugas"],
            "parts": [{"pn": "—", "desc": "Filtro de aceite de motor (ver catálogo Kalmar)", "qty": 1}, {"pn": "—", "desc": "Aceite de motor (litros según manual)", "qty": 1}],
        },
        {
            "id": "filtro-aire", "name": "Filtro de aire", "system": "Admisión",
            "position": R([-0.91, 1.95, f(-1.8)]), "labelOffset": [der, 0.5, 0.2],
            "specs": {"Ubicación": "Caja alta lado derecho, detrás del motor", "Cambio": "Según indicador de restricción"},
            "maintenance": {"task": "Inspección del elemento e indicador de restricción", "intervalHours": 250, "lastServiceHours": 0},
            "procedure": [LOTO, "Abrir la caja del filtro.", "Retirar el elemento primario sin golpearlo.", "Limpiar la carcasa; no retirar el elemento de seguridad salvo cambio.", "Instalar elemento nuevo o inspeccionado y resetear el indicador."],
            "checklist": ["Carcasa limpia", "Elemento sin daños", "Indicador reseteado"],
            "parts": [{"pn": "—", "desc": "Elemento primario de filtro de aire", "qty": 1}],
        },
        {
            "id": "escape", "name": "Escape / postratamiento", "system": "Escape",
            "position": R([-0.87, 2.9, f(-1.79)]), "labelOffset": [der, 0.3, 0.3],
            "specs": {"Altura de la salida": f"{ALTO_ESCAPE:.2f} m"},
            "maintenance": {"task": "Inspección de abrazaderas, fugas y soportes", "intervalHours": 500, "lastServiceHours": 0},
            "safety": ["Superficies muy calientes: no tocar con el motor en marcha o recién apagado."],
            "checklist": ["Sin fugas de gases", "Abrazaderas firmes", "Soportes en buen estado"],
        },
        {
            "id": "radiador", "name": "Radiador y enfriamiento", "system": "Enfriamiento",
            "position": R([0, 0.95, f(-0.4)]), "labelOffset": [0, 0.5, 0.6],
            "specs": {"Ubicación": "Detrás de la parrilla frontal"},
            "maintenance": {"task": "Limpieza de núcleos y revisión de mangueras", "intervalHours": 500, "lastServiceHours": 0},
            "safety": ["No abrir la tapa del radiador con el motor caliente."],
            "procedure": [LOTO, "Con el motor frío, revisar el nivel de refrigerante.", "Soplar los núcleos desde el lado del ventilador.", "Revisar mangueras y abrazaderas."],
            "checklist": ["Nivel OK", "Núcleos limpios", "Mangueras sin daños"],
        },
        {
            "id": "combustible", "name": "Tanque de combustible", "system": "Combustible",
            "position": R([1.06, 0.6, f(-2.6)]), "labelOffset": [izq, 0.45, 0],
            "specs": {"Ubicación": "Lado izquierdo, detrás de la cabina", "Separador de agua": "Drenar a diario"},
            "maintenance": {"task": "Drenaje del separador de agua", "intervalHours": 10, "lastServiceHours": 0},
            "procedure": [LOTO, "Colocar un recipiente bajo el separador.", "Abrir la válvula hasta que salga combustible limpio.", "Cerrar y verificar que no gotee."],
            "checklist": ["Agua drenada", "Sin goteo"],
        },
        {
            "id": "def-baterias", "name": "Caja trasera izquierda (DEF / baterías)", "system": "Eléctrico / Escape",
            "position": R([0.9, 0.85, t(0.99)]), "labelOffset": [izq, 0.45, 0],
            "description": "Confirmar en la unidad qué contiene esta caja (tanque DEF de tapa azul y/o baterías). " + VERIF,
            "specs": {"Ubicación": "Lado izquierdo, delante del eje trasero"},
            "maintenance": {"task": "Inspección de bornes, nivel de DEF y fijaciones", "intervalHours": 250, "lastServiceHours": 0},
            "checklist": ["Bornes limpios y firmes", "Nivel de DEF OK", "Caja y tapas firmes"],
        },
        {
            "id": "hidraulico", "name": "Tanque hidráulico", "system": "Hidráulico",
            "position": R([-0.89, 0.95, t(0.98)]), "labelOffset": [der, 0.45, 0],
            "specs": {"Ubicación": "Lado derecho, delante del eje trasero", "Uso": "Brazo de elevación y dirección"},
            "maintenance": {"task": "Cambio de filtro hidráulico", "intervalHours": 1000, "lastServiceHours": 0},
            "safety": ["Bajar el brazo y liberar la presión antes de abrir el sistema."],
            "procedure": [LOTO, "Bajar el brazo completamente.", "Liberar la presión del tanque.", "Cambiar el filtro de retorno.", "Completar nivel con aceite limpio y verificar fugas."],
            "checklist": ["Brazo abajo", "Presión liberada", "Filtro cambiado", "Nivel OK", "Sin fugas"],
            "parts": [{"pn": "—", "desc": "Filtro hidráulico de retorno", "qty": 1}],
        },
        {
            "id": "quinta-rueda", "name": "Quinta rueda", "system": "Acople",
            "position": R([0, ALTO_5A_RUEDA, t(0.18)]), "labelOffset": [0, 0.45, -0.6],
            "specs": {"Altura (brazo abajo)": f"{ALTO_5A_RUEDA:.2f} m", "Elevación del brazo": "≈ 0.45 m"},
            "maintenance": {"task": "Engrase de la placa y revisión del mecanismo de traba", "intervalHours": 50, "lastServiceHours": 0},
            "safety": ["Nunca trabajar bajo un tráiler levantado sin soporte."],
            "procedure": [LOTO, "Limpiar la placa de grasa vieja y suciedad.", "Engrasar la placa y los puntos de pivote.", "Probar apertura y cierre de la traba (mordaza)."],
            "checklist": ["Placa engrasada", "Traba cierra y abre bien", "Sin fisuras ni desgaste excesivo"],
        },
        {
            "id": "brazo", "name": "Brazo de elevación y cilindros", "system": "Hidráulico",
            "position": R([0.45, 1.25, t(0.87)]), "labelOffset": [izq, 0.4, 0],
            "specs": {"Revisar": "Vástagos sin rayas, sin fugas en sellos"},
            "maintenance": {"task": "Engrase de pivotes del brazo y cilindros", "intervalHours": 50, "lastServiceHours": 0},
            "procedure": [LOTO, "Bajar el brazo.", "Engrasar pivotes del brazo y de los cilindros.", "Revisar vástagos, sellos y mangueras."],
            "checklist": ["Pivotes engrasados", "Sin fugas", "Mangueras sin roces"],
        },
        {
            "id": "conexiones", "name": "Conexiones al tráiler (aire / eléctrica)", "system": "Frenos",
            "position": R([-0.2, 2.0, f(-2.12)]), "labelOffset": [0, 0.45, -0.5],
            "specs": {"Ubicación": "Parte trasera de la cabina"},
            "maintenance": {"task": "Inspección de mangueras, manos de acople y cable", "intervalHours": 10, "lastServiceHours": 0},
            "checklist": ["Mangueras sin cortes", "Sellos de acoples OK", "Cable y enchufe OK"],
        },
        {
            "id": "eje-del", "name": "Eje delantero y dirección", "system": "Dirección",
            "position": R([0.75, r, za]), "labelOffset": [izq, 0.6, 0.2],
            "maintenance": {"task": "Engrase de pivotes (king pins) y terminales", "intervalHours": 250, "lastServiceHours": 0},
            "checklist": ["Pivotes engrasados", "Terminales sin juego", "Neumáticos sin daños"],
        },
        {
            "id": "eje-tras", "name": "Eje trasero y frenos", "system": "Tren motriz",
            "position": R([-0.6, r, zr]), "labelOffset": [der, 0.6, 0],
            "specs": {"Neumáticos": "11R22.5 duales"},
            "maintenance": {"task": "Revisión de nivel del diferencial y ajuste de frenos", "intervalHours": 500, "lastServiceHours": 0},
            "checklist": ["Nivel del diferencial OK", "Frenos ajustados", "Sin fugas en el cubo"],
        },
        {
            "id": "neumaticos", "name": "Neumáticos", "system": "Rodado",
            "position": R([xd, r, za]), "labelOffset": [izq, 0.5, 0.3],
            "specs": {"Medida": "11R22.5", "Diámetro": f"{DIAM_RUEDA * 1000:.0f} mm", "Presión": "Según placa / manual"},
            "maintenance": {"task": "Control de presión y estado", "intervalHours": 10, "lastServiceHours": 0},
            "checklist": ["Presión correcta", "Sin cortes ni deformaciones", "Tuercas de rueda firmes"],
        },
    ]

    return {
        "id": "kalmar-ottawa-t2",
        "name": f'Kalmar Ottawa T2 · WB {wb_in}"',
        "model": f'Terminal tractor Kalmar Ottawa T2 4x2, LHD, entre ejes {wb_in} in ({wb * 1000:.0f} mm)',
        "hourMeter": 0,
        "note": "Medidas del plano Kalmar DSK8504-D (GEN ARRANGEMENT, OTTAWA T2, LHD). Ubicación de componentes estimada desde el plano: confirmar en la unidad. Intervalos de mantenimiento orientativos: " + VERIF,
        "dimensions": R([ANCHO_TOTAL, ALTO_CABINA, largo]),
        "exactDimensions": True,   # medidas de plano de fábrica: al ubicar, la escala queda fija en 1
        "reference": {"description": "las 4 ruedas, donde tocan el suelo", "frontHint": "bajo el paragolpes delantero", "rearHint": "bajo la plataforma trasera"},
        "photoView": None,
        "preview": preview,
        "refPoints": ref_points,
        "components": comp,
    }


def main():
    wb_in = int(sys.argv[1]) if len(sys.argv) > 1 else 126
    data = generar(wb_in)
    data.pop("photoView")
    raiz = Path(__file__).resolve().parent.parent / "android" / "data"
    (raiz / "kalmar-ottawa-t2.json").write_text(json.dumps(data, ensure_ascii=False, indent=2), encoding="utf-8")
    idx_path = raiz / "machines.json"
    idx = json.loads(idx_path.read_text(encoding="utf-8"))
    idx = [m for m in idx if m["id"] != data["id"]]
    idx.insert(0, {"id": data["id"], "name": data["name"], "file": "data/kalmar-ottawa-t2.json"})
    idx_path.write_text(json.dumps(idx, ensure_ascii=False, indent=2), encoding="utf-8")
    print(f'OK: {data["name"]} · largo {data["dimensions"][2]} m · {len(data["components"])} componentes · {len(data["refPoints"])} puntos de referencia')


if __name__ == "__main__":
    main()
