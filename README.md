# Mantenimiento RA — Meta Quest 3 y celular Android

App de **realidad mixta** para mantenimiento de maquinaria pesada. Con el Quest 3 ves la máquina real (passthrough) y, a medida que miras las piezas, aparecen **carteles flotantes** con la información de cada componente: estado, próximo servicio, especificaciones, procedimiento paso a paso, checklist y repuestos.

Funciona en el **Meta Quest 3** (realidad mixta) y en **celulares Android** con la cámara (realidad aumentada con ARCore). Es una app **WebXR**: se abre en el navegador del Quest (no hay que instalar APK ni usar Unity). También funciona en la PC como maqueta 3D para preparar y revisar los datos.

## Qué hace

- **Carteles según la mirada**: los componentes dentro de tu campo de visión muestran un cartel compacto (nombre + estado). El que miras de frente se amplía con el plan de mantenimiento y los datos clave. Se escalan con la distancia para leerse igual de cerca y de lejos.
- **Colores de estado**: verde OK, amarillo *atención* (servicio dentro del 10 % final del intervalo o alerta abierta), rojo *crítico* (servicio vencido). Los marcadores con alerta pulsan.
- **Ficha completa** (gatillo o pellizco sobre un cartel): Resumen · Procedimiento paso a paso · Checklist · Repuestos. Al completar el checklist se puede **registrar el servicio** con el horómetro actual (el estado se recalcula).
- **Ubicar el equipo**: apuntas al punto de referencia en el suelo (p. ej. "centro del frente de las orugas") y confirmas. Un contorno 3D del equipo te ayuda a alinear; se afina girando con el stick o con los botones ±2°.
- **Ancla persistente**: la posición se guarda con anclas de WebXR; la próxima vez que entres en el mismo lugar el equipo se ubica solo.
- **Registrar puntos**: modo para que un técnico marque, una sola vez, dónde está cada componente en la máquina real (tocándolo con la punta del control). Luego se **exporta el JSON** para usarlo en otros visores.
- Funciona con **controles o con las manos** (pellizco = clic).
- Filtros: mostrar todos los carteles o solo los que tienen alertas.

## Probar

WebXR necesita HTTPS (o `localhost`).

**En la PC** (modo maqueta):
```bash
git clone https://github.com/ingtecjacosta-sudo/Mantenimiento_ra.git
cd Mantenimiento_ra
python3 -m http.server 8080
# abrir http://localhost:8080
```

**En el Quest 3**, cualquiera de estas opciones:
1. **GitHub Pages** (lo más simple): en el repositorio, *Settings → Pages → Deploy from a branch*, rama `main`, carpeta `/ (root)`. Luego abrir **https://ingtecjacosta-sudo.github.io/Mantenimiento_ra/** en el navegador del Quest o en Chrome del celular.
2. **Por cable USB** con el servidor de arriba corriendo en la PC: `adb reverse tcp:8080 tcp:8080` y abrir `http://localhost:8080` en el Quest (requiere modo desarrollador).
3. Cualquier hosting con HTTPS (Netlify, Vercel, un servidor interno con certificado).

Luego pulsa **Entrar en realidad mixta** y acepta los permisos (seguimiento del espacio / anclas).

> Recomendado: hacer la configuración del espacio del Quest (*Space Setup*) en el lugar de trabajo; mejora la detección del suelo y la estabilidad de las anclas.

## Cargar un equipo desde una foto

Sirve para armar un equipo nuevo (o completar uno existente) sin editar archivos, desde el celular o la PC.

1. **+ Nuevo equipo**: nombre, medidas aproximadas (largo × ancho × alto) y horómetro. En un equipo existente usa **📷 Cargar foto**.
2. **📷 Tomar foto** (abre la cámara) o **🖼️ Galería**: idealmente de costado, con toda la máquina en el cuadro y la cámara a media altura.
3. Elige qué lado muestra la foto (izquierdo, derecho o frente) y toca **Calibrar**. Luego marca 3 puntos: el extremo delantero a nivel del suelo, el extremo trasero y el punto más alto.
4. **+ Agregar componente** y toca la foto donde está la pieza; o elige uno de la lista y tócalo en la foto para ubicarlo.
5. Con la calibración, la app calcula la **posición 3D** de cada componente y aparecen sus carteles en RA. La profundidad no se ve en una foto, así que el cartel queda sobre la cara visible del equipo. En la máquina real, **Registrar puntos** corrige los que haga falta: un punto registrado en RA siempre tiene prioridad sobre el de la foto.
6. La ficha de cada componente tiene una pestaña **Foto** con la pieza marcada.

La foto queda guardada en el dispositivo y **viaja dentro del JSON** al exportar, para compartir el equipo completo con otros celulares o visores.

## Uso en el celular Android

**Requisitos**: Chrome actualizado y un celular compatible con ARCore (la mayoría de gama media/alta desde 2019). Si hace falta, instala **"Servicios de Google Play para RA"** desde Play Store. La app tiene que abrirse desde una dirección **HTTPS** (por ejemplo GitHub Pages, ver arriba).

**Instalarla como app**: abre la dirección en Chrome → menú ⋮ → **Instalar app** (o *Agregar a la pantalla principal*). Queda un ícono como cualquier app y funciona sin conexión después de la primera carga.

1. Toca **Entrar en realidad aumentada** y acepta el permiso de cámara.
2. Mueve el celular despacio apuntando al suelo hasta que aparezca la retícula naranja.
3. Centra la **mira** en el punto de referencia (en la excavadora de ejemplo: el suelo al centro del frente de las orugas) y toca **Ubicar aquí**. Gira con ⟲/⟳ si el contorno no coincide (activa **Guía 3D** para verlo).
4. Recorre la máquina con la cámara: aparecen los carteles. **Toca un cartel** para abrir la ficha (resumen, pasos, checklist, repuestos).
5. **Registrar puntos**: apunta la mira a cada pieza (o acerca el celular a ella) y toca **Marcar**.

> En el celular no hay anclas persistentes: hay que ubicar el equipo cada vez que entras. Los puntos registrados sí quedan guardados.

## Uso en el visor

| Acción | Controles | Manos |
|---|---|---|
| Seleccionar / confirmar | Gatillo | Pellizco índice-pulgar |
| Girar el equipo al ubicarlo | Stick izquierdo/derecho | Botones *Girar* del menú |
| Menú | Panel flotante abajo a la izquierda (te sigue cuando giras) | Igual |

1. **Ubicar equipo** → apunta al punto de referencia y confirma.
2. Recorre la máquina mirando las piezas.
3. Abre la ficha de un componente, sigue el procedimiento y marca el checklist.
4. Primera vez con un equipo nuevo: **Registrar puntos** y después **Exportar JSON** (desde el panel de la PC o del navegador).

## Cargar tus propios equipos

Cada equipo es un JSON en `data/`, listado en `data/machines.json`. Ejemplo: `data/excavadora-20t.json`. También se puede cargar un JSON con el botón **Cargar JSON** o con `?data=URL` en la dirección.

```jsonc
{
  "id": "exc-20t-01",
  "name": "Excavadora 20 t · EX-01",
  "hourMeter": 4820,
  "reference": { "description": "el suelo, al centro del frente de las orugas", "offset": [0, 0, 2.2] },
  "preview": [ { "size": [0.6, 0.9, 4.4], "pos": [1.1, 0.45, 0], "rot": [0, 0, 0], "color": "#2d2d2d" } ],
  "components": [
    {
      "id": "motor", "name": "Motor diésel", "system": "Motor",
      "position": [-0.5, 2.1, -1.1],        // metros, relativo al equipo (null = sin registrar)
      "labelOffset": [-0.7, 0.75, 0],       // dónde flota el cartel respecto a la pieza
      "status": "warn",                     // opcional: fuerza un estado mínimo
      "alerts": ["Fuga leve en sello"],     // opcional
      "specs": { "Aceite": "SAE 15W-40", "Capacidad": "24 L" },
      "maintenance": { "task": "Cambio de aceite", "intervalHours": 500, "lastServiceHours": 4350 },
      "safety": ["Aceite caliente"],
      "procedure": ["Paso 1…", "⚠ Paso con riesgo…"],
      "checklist": ["Ítem 1", "Ítem 2"],
      "parts": [{ "pn": "FLT-OIL-0420", "desc": "Filtro de aceite", "qty": 1 }]
    }
  ]
}
```

**Coordenadas del equipo**: origen en el suelo bajo el centro del equipo, **+Y arriba**, **+Z hacia el frente** (lado del implemento), +X a la derecha de quien mira el equipo de frente. `reference.offset` es el punto que el técnico marca al ubicar el equipo. `preview` son cajas simples para la maqueta y el contorno guía (opcional).

> ⚠ Los datos de la excavadora incluida son **de ejemplo**. Reemplázalos por los valores del manual del fabricante de tu equipo antes de usarlos en campo.

## Estructura

| Archivo | Función |
|---|---|
| `index.html`, `style.css` | Pantalla de inicio / modo PC |
| `js/main.js` | Escena, sesión XR, controles y manos, ubicación, anclas, registro de puntos |
| `js/labels.js` | Carteles de componentes (marcador, línea guía, panel compacto y detallado) |
| `js/ui.js` | Ficha completa, menú flotante y mensajes dentro del visor |
| `js/overlay.js` | Interfaz táctil sobre la cámara (modo celular) |
| `js/photo.js` | Foto de referencia: editor, calibración y cálculo de posiciones 3D |
| `manifest.webmanifest`, `sw.js`, `icons/` | Instalación como app (PWA) y uso sin conexión |
| `js/panel.js` | Paneles 2D (canvas) con botones clicables en 3D |
| `js/data.js` | Estado de mantenimiento, guardado local y exportación |
| `js/preview.js` | Maqueta / contorno guía a partir del JSON |
| `data/` | Equipos |

Los puntos registrados, servicios y checklists se guardan en el navegador de cada visor (`localStorage`). Para compartirlos entre visores, exporta el JSON y reemplaza el archivo en `data/`.

## Próximos pasos posibles

- Reconocimiento automático del equipo con un **código QR** (requiere la API de cámara del Quest, hoy disponible en apps nativas/Unity, no en el navegador).
- Conectar con el **CMMS/ERP** (SAP PM, Maximo, Fracttal…) para leer órdenes de trabajo y horómetros reales, y guardar los servicios en el sistema.
- Telemetría en vivo (temperatura, presión, códigos de falla) vía API del fabricante o un gateway CAN/J1939.
- Fotos y notas de voz por componente; manuales PDF y modelos 3D reales (glTF) del equipo.
