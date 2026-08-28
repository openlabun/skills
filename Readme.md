# skills

Marketplace de plugins de Claude Code de Uninorte OpenLab.

## Instalar

```
/plugin marketplace add openlabun/skills
/plugin install roble@openlab
```

Reinicia Claude Code después de instalar, para que descubra las skills.

## Actualizar

Un plugin ya instalado **no se entera solo** de que el repo cambió. Para traer
la versión nueva:

```
/plugin marketplace update openlab
```

Y reinicia Claude Code: el servidor MCP corre como proceso hijo del editor, así
que hasta que no se relance sigue ejecutando el código viejo aunque los
archivos ya estén actualizados.

### En qué versión estoy

Pregúntaselo al propio MCP —«¿qué versión de roble tengo?»— o llama a
`roble_version`. Responde algo así:

```
roble-mcp 1.0.0
plugin roble 1.0.0
corriendo desde /Users/tu/.claude/plugins/roble/mcp

configuración: /ruta/de/tu/proyecto/.roble.mcp.env
proyecto: miproyecto_ab12cd34ef
servidor: https://roble-api.test-openlab.uninorte.edu.co
```

Si esa herramienta no existe, tienes una instalación anterior al versionado:
actualiza. El detalle de qué trae cada versión está en
[`plugins/roble/CHANGELOG.md`](plugins/roble/CHANGELOG.md).

Las dos versiones van en paralelo a propósito. Si no coinciden, la instalación
quedó a medias y conviene reinstalar el plugin.

Funciona en cualquier equipo: el marketplace es este repo, así que basta con
tener acceso a él. Para actualizar, `/plugin marketplace update openlab`.

## Qué trae

### `roble`

Integrar los clientes de Roble en un proyecto. Dos skills, y Claude carga la
que corresponda según lo que pidas:

| Skill | Para |
|---|---|
| `use-roble` | El paquete [`roble`](https://pub.dev/packages/roble) en una app **Flutter** |
| `use-roble-client` | [`roble-client`](https://www.npmjs.com/package/roble-client) en **JavaScript o TypeScript** — Node, navegador, React, React Native |

Cada skill empieza preguntando lo que hace falta saber: si se empieza **desde
cero** o se **migra** algo que ya existe, desde qué, y qué parte de Roble se
necesita.

Ambas traen un **smoke** que verifica la conexión contra el servidor real
—cuentas, base de datos, árbol JSON y tiempo real— antes de escribir código
de la app. Registra una cuenta desechable y la borra al terminar, así que no
deja rastro. Si el smoke pasa, el siguiente fallo está en la app y no en el
cableado, que ahorra la mitad de la depuración.

### El servidor MCP

El plugin trae además un **servidor MCP** (`plugins/roble/mcp`) que deja al
agente leer el esquema de un proyecto y ajustarlo a lo que la app necesita, sin
salir del editor a hacer clics en la consola.

| Herramienta | Qué hace |
|---|---|
| `roble_schema_read` | Tablas, columnas, tipos y filas estimadas |
| `roble_schema_plan` | Compara con el esquema que la app necesita. No toca nada |
| `roble_schema_apply` | Aplica **solo** lo aditivo: crear tablas, añadir columnas opcionales |

La regla: aditivo se aplica, destructivo se propone. Borrar una columna o
cambiar un tipo pierde datos, así que el plan lo describe y lo deja para una
persona.

Se autentica con un **token de acceso de proyecto** (`roble_pat_…`) que se
genera en la consola, en Configuración → Tokens de acceso. Elige el alcance de
solo lectura salvo que quieras que el agente cree tablas.

No tiene dependencias en tiempo de ejecución: habla JSON-RPC por stdin/stdout
y solo necesita Node 20. Detalles y smoke en
[`plugins/roble/mcp/README.md`](plugins/roble/mcp/README.md).

## Usarlas sin Claude Code

El formato es abierto: cada skill es una carpeta con un `SKILL.md` —markdown
con frontmatter— y sus scripts. Otro agente que soporte Agent Skills la carga
tal cual; a un LLM sin soporte se le puede pasar el `SKILL.md` como contexto.

Los smokes (`smoke.mjs`, `smoke_test.dart`) son scripts normales: se corren
con `node` y `flutter test`, sin agente de por medio.

## Estructura

```
.claude-plugin/marketplace.json     catálogo
plugins/roble/
  .claude-plugin/plugin.json        nombre y versión del plugin
  CHANGELOG.md                      qué trae cada versión
  .mcp.json                         declara el servidor MCP
  mcp/                              servidor MCP, sin dependencias
  skills/use-roble/                 Flutter
  skills/use-roble-client/          JavaScript
```
