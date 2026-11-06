# Guía de diseño de interfaz — PyroStudio

> **Estado:** normativa visual del producto.  
> **Sistema visual:** Forja.  
> **Referencia de experiencia:** pantalla inicial PyroStudio y workspaces analíticos rediseñados.  
> **Objetivo:** ofrecer una aplicación de escritorio para bases de datos con la claridad de un IDE profesional, la densidad de una herramienta técnica y una identidad propia.

Esta guía aplica a **todas las vistas nuevas y existentes**, componentes compartidos, modales, paneles y estados de la aplicación. No es una propuesta opcional ni una colección de inspiración: es el criterio de aceptación visual para cualquier cambio de interfaz.

## 1. Dirección de producto

PyroStudio debe sentirse como un entorno de trabajo de bases de datos, no como un sitio web de marketing ni como un conjunto de dashboards genéricos.

- **Profesional y técnico:** jerarquía clara, información precisa, controles previsibles y densidad bien administrada.
- **Identidad propia:** grafito, superficies Forja y naranja PyroStudio. La referencia funcional es JetBrains/DataGrip, pero no se copian su interfaz ni sus convenciones exactas.
- **Orientado a tareas:** cada vista debe hacer evidente qué objeto se está inspeccionando, qué contexto está activo y cuál es la acción principal.
- **Consistente:** una misma acción, estado o control debe verse y comportarse igual en toda la aplicación.
- **Sobrio:** la estructura se consigue con tipografía, alineación, espaciado, superficies y bordes; no con decoración.

## 2. Principios no negociables

1. **Preservar la funcionalidad.** Un rediseño no autoriza a eliminar, simplificar ni reemplazar lógica, handlers, hooks, stores, servicios, contratos, atajos, confirmaciones, validaciones, estados de carga o flujos existentes.
2. **Diseñar alrededor de la tarea principal.** La composición depende del trabajo de la vista: explorar, editar, comparar, diagnosticar o ejecutar. No convertir todas las pantallas en dashboards.
3. **Jerarquía antes que decoración.** Título y contexto → acción principal → controles relacionados → resultado o contenido → acciones secundarias.
4. **Datos reales, nunca métricas inventadas.** Las métricas, contadores, estados y etiquetas deben proceder del modelo existente. Si no hay información, mostrar un estado vacío explícito.
5. **Revelado progresivo.** Mostrar primero lo necesario; agrupar acciones secundarias y poco frecuentes en menús o paneles contextuales.
6. **Densidad legible.** Optimizar el espacio sin comprimir controles, tablas, etiquetas ni zonas de interacción.
7. **Responsive real.** La vista debe seguir siendo operable en ventanas estrechas, no limitarse a reducir su escala.
8. **Accesibilidad integrada.** Teclado, foco visible, etiquetas, contraste, semántica y movimiento reducido forman parte del diseño.

## 3. Sistema visual Forja

### 3.1 Tokens obligatorios

Usar los tokens semánticos definidos en `src/App.css` y las primitivas de `src/components/ui/styles.ts`.

| Función | Token / utilidad |
|---|---|
| Fondo general | `bg-canvas` |
| Superficie base | `bg-surface` |
| Superficie elevada | `bg-raised` |
| Elemento elevado / selección secundaria | `bg-elevated` |
| Hover | `bg-hover` |
| Bordes | `border-line`, `border-line-strong` |
| Texto principal | `text-fg` |
| Texto secundario | `text-fg-muted` |
| Texto terciario | `text-fg-subtle` |
| Acción y selección principal | `bg-accent`, `text-accent-text`, `bg-accent-soft` |
| Estados semánticos | `text-success`, `text-warning`, `text-danger`, `text-info` |

No crear colores de marca locales, ni codificar colores literales por componente. Los tokens deben resolver automáticamente los temas claro y oscuro. No usar ramas `isLight` para duplicar estilos si existe un token semántico equivalente.

### 3.2 Acento y color semántico

- El **naranja** identifica la acción principal de la vista, el elemento seleccionado y los puntos de atención de marca.
- Verde, ámbar, rojo y azul informan estados o categorías de datos; no son colores decorativos.
- El color semántico debe aplicarse preferentemente a texto, icono, punto, borde o indicador localizado. Evitar grandes fondos saturados.
- Excepción controlada: las diferencias de esquema, planes EXPLAIN, salud, operaciones destructivas y cambios pendientes pueden usar color para codificar datos. Debe mantenerse una leyenda o etiqueta comprensible.
- Los iconos de objetos deben usar `ObjectIcon` (`src/components/objectIcons.tsx`) y su codificación estable.

### 3.3 Tipografía y números

- Fuente de interfaz: sistema por defecto; Maple Mono es opcional y seleccionable.
- Código, SQL, identificadores técnicos y métricas alineadas: fuente monoespaciada.
- Escala de referencia: 11 px para metadatos, 12 px para cuerpo denso y controles, 14 px para títulos de sección. Los títulos principales pueden crecer cuando la jerarquía lo justifique.
- Usar `tabular-nums` en contadores, tamaños, porcentajes y métricas cambiantes.
- Sentence case en títulos y etiquetas; evitar encabezados enteramente en mayúsculas y `tracking` decorativo.

### 3.4 Superficies, bordes y elevación

- Canvas para el área de trabajo; surface para contenido persistente; raised para paneles y grupos; elevated para selección o subcapas.
- Los bordes separan regiones y delimitan controles. Mantener radios consistentes y moderados.
- Las sombras se reservan a elementos flotantes reales, como menús y modales. No añadir sombras a cada tarjeta.
- Prohibidos gradientes, brillos, sombras de color, desenfoque decorativo, hover con escalado y animaciones pulsantes.
- No añadir contenedores tipo tarjeta cuando un divisor, una banda de título o el espacio sea suficiente.

## 4. Composición de vistas

### 4.1 Shell y estructura común

- Mantener consistencia con header, explorador/sidebar, pestañas, área de trabajo y barra de estado.
- Cada vista debe declarar una raíz semántica `pyro-view` y, cuando aplique, una clase específica de workspace.
- Identificar regiones relevantes con atributos `data-*` descriptivos, no con selectores estructurales.
- Las barras de herramientas deben usar `data-view-toolbar` o un atributo equivalente y agrupar acciones por frecuencia e importancia.
- Mantener el contenido dentro del área disponible; el scroll debe pertenecer a la región correcta y no al shell completo.

### 4.2 Dashboard y vistas analíticas

Adecuado para resumen de servidor, almacenamiento, diagnóstico y salud.

- Abrir con contexto: base de datos/servidor, estado y propósito del panel.
- Priorizar entre 3 y 5 indicadores realmente útiles; evitar una cuadrícula interminable de tarjetas.
- Las métricas principales deben ser comparables, tener unidades y conservar alineación numérica.
- Las gráficas deben responder una pregunta y convivir con su contexto; no añadir charts por decoración.
- Actividad, salud y alertas deben tener jerarquía propia. Los estados críticos no deben depender únicamente del color.
- Las tablas detalladas siguen siendo contenido central cuando aportan más valor que una visualización.
- La actualización, exportación y navegación a vistas de detalle se conservan como acciones explícitas.

### 4.3 Comparación y sincronización

Adecuado para Schema Diff y Data Compare.

- Representar **origen** y **destino** como dos contextos equivalentes y visualmente distinguibles, con dirección de flujo inequívoca.
- Mantener visibles los identificadores de conexión, base de datos, esquema o tabla que intervienen.
- El control de comparación debe ser la acción primaria y debe comunicar cuándo no está disponible.
- Después de comparar, mostrar un resumen compacto de diferencias antes del detalle.
- Clasificar cambios con semántica estable: agregado, eliminado, modificado, idéntico o error.
- Los filtros y acciones sobre resultados deben permanecer próximos al contenido al que afectan.
- La generación de SQL, revisión con IA, copia, descarga y ejecución deben conservar sus confirmaciones y advertencias de riesgo.
- No ocultar información de truncamiento, límites de resultados, columnas excluidas o duración de la operación.

### 4.4 Workspaces de edición y exploración

No transformar SQL Editor, Table Viewer, Object Browser, Index Manager, diagramas ni diseñadores en dashboards.

- El editor de código, grid, árbol de objetos o canvas es el protagonista.
- Las herramientas deben estar cerca del objeto o selección a la que afectan.
- Los paneles laterales son contextuales y plegables cuando proceda.
- Mantener tablas densas, selección, edición, navegación y menús contextuales sin añadir capas decorativas.
- Compartir componentes y patrones siempre que exista paridad funcional.

### 4.5 Formularios y configuración

- Agrupar campos por propósito y orden de dependencia.
- Etiquetas persistentes por encima de controles; no depender de placeholders como única etiqueta.
- Alinear controles relacionados y usar ancho completo cuando mejore la lectura.
- Explicar campos técnicos o riesgosos cerca del campo, sin saturar la vista.
- Acciones primarias y secundarias deben conservar jerarquía y posición consistentes.

### 4.6 Modales, paneles y estados

- Reutilizar `Modal`, `ConfirmModal`, `EmptyState`, `Spinner` y `RightDock` cuando corresponda.
- Modales con título, descripción/contexto, contenido desplazable y acciones claras.
- Cancelar a la izquierda de la acción principal o agrupado de forma consistente; acciones al extremo derecho.
- Cargas, errores, estados vacíos y éxito deben explicar qué sucede y qué puede hacer el usuario.
- No usar `alert()`, `confirm()` ni `prompt()` nativos.

## 5. Componentes y primitivas compartidas

Usar las primitivas de `src/components/ui/styles.ts` antes de crear estilos locales:

- `primaryBtn`, `secondaryBtn`, `ghostBtn`, `iconBtn`
- `dangerBtn`, `dangerGhostBtn`
- `inputClass`, `fieldLabel`, `selectClass`
- `cardClass`, `sectionLabel`, `menuPanel`, `menuItem`, `tabClass`

Crear una nueva primitiva solo si resuelve un patrón repetido y bien definido. No copiar estilos de botón o formulario en cada vista.

## 6. Interacción y estados

Cada control debe tener estados coherentes: normal, hover, focus-visible, activo/seleccionado, deshabilitado, cargando y error cuando aplique.

- Mantener anillos de foco visibles y navegación completa por teclado.
- No usar el color como único indicador.
- Botones de icono deben tener `aria-label` o `title` útil.
- Los elementos clicables deben ser semánticamente interactivos y tener foco.
- Respetar `prefers-reduced-motion`.
- Las acciones destructivas requieren advertencia y confirmación explícita mediante los mecanismos globales de UI.
- No bloquear la interfaz con operaciones sin indicador de progreso.

## 7. Responsive y escalado

- Escritorio: aprovechar el ancho para comparación lado a lado, tablas y paneles.
- Ventanas medianas: permitir que toolbars, métricas y formularios se reorganicen sin solaparse.
- Ventanas estrechas: apilar origen/destino, convertir barras de acciones en filas envolventes y permitir scroll horizontal únicamente en tablas o contenido que lo requiera.
- No ocultar acciones esenciales en breakpoints.
- Probar al menos 320–480 px, 760–1024 px y escritorio; revisar también escalado DPI.

## 8. Reglas CSS y mantenimiento

- Usar tokens Forja existentes; antes de introducir una variable, verificar que esté declarada.
- Preferir clases semánticas y atributos `data-*` para identificar regiones.
- Evitar `:nth-child()`, `:first-child` y selectores dependientes del orden del JSX, especialmente con contenido condicional.
- Evitar selectores globales que afecten componentes no relacionados.
- No introducir `!important` para resolver conflictos de especificidad.
- Mantener estilos responsive y de tema dentro del mismo ámbito semántico.
- No añadir dependencias visuales sin necesidad demostrable.

## 9. Qué no hacer

- No convertir cada vista en un tablero de tarjetas.
- No añadir KPIs, actividad, gráficas o badges si no aportan información verificable.
- No introducir paletas locales, gradientes, brillos, sombras ornamentales ni fondos saturados.
- No usar etiquetas pasivas en forma de pastillas de colores.
- No reemplazar tablas o editores densos por componentes simplificados.
- No modificar lógica de negocio para conseguir un resultado visual.
- No utilizar capturas, imágenes o maquetas estáticas como sustituto de la interfaz funcional.

## 10. Checklist de aceptación para cada cambio visual

- [ ] Se inspeccionaron el componente completo, sus dependencias y estados condicionales antes de editar.
- [ ] Se preservaron handlers, hooks, stores, servicios, contratos, shortcuts, confirmaciones y validaciones.
- [ ] La vista comunica con claridad contexto, tarea principal y acción primaria.
- [ ] Usa tokens Forja y se ve correctamente en temas claro y oscuro.
- [ ] Los colores semánticos comunican estados reales y no decoración.
- [ ] La composición no añade tarjetas ni gráficas innecesarias.
- [ ] Loading, empty, error, success y disabled mantienen un diseño coherente.
- [ ] Teclado, foco, etiquetas, contraste y movimiento reducido son adecuados.
- [ ] La vista funciona en ventana estrecha, mediana y escritorio.
- [ ] Se ejecutaron typecheck, tests y build aplicables; se registran explícitamente las validaciones pendientes.

## 11. Archivos de referencia

- Tokens y estilos globales: `src/App.css`.
- Primitivas compartidas: `src/components/ui/styles.ts`.
- Shell: `src/App.tsx` y componentes de navegación.
- Pantalla inicial de referencia: `src/components/WelcomeView.tsx`.
- Workspaces analíticos: `src/components/DashboardTab.tsx`, `src/components/SchemaDiffTab.tsx` y `src/components/DataCompareTab.tsx`.

**Criterio final:** una vista PyroStudio está bien diseñada cuando permite entender el contexto y ejecutar la tarea con rapidez, precisión y confianza, no cuando contiene más decoración.
