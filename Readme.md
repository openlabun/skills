# skills

Marketplace de plugins de Claude Code de Uninorte OpenLab.

## Instalar

```
/plugin marketplace add openlabun/skills
/plugin install roble@openlab
```

Reinicia Claude Code después de instalar, para que descubra las skills.

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

Cada una empieza preguntando lo que hace falta saber: si se empieza **desde
cero** o se **migra** algo que ya existe, desde qué, y qué parte de Roble se
necesita.

Ambas traen un **smoke** que verifica la conexión contra el servidor real
—cuentas, base de datos, árbol JSON y tiempo real— antes de escribir código
de la app. Registra una cuenta desechable y la borra al terminar, así que no
deja rastro. Si el smoke pasa, el siguiente fallo está en la app y no en el
cableado, que ahorra la mitad de la depuración.

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
  .claude-plugin/plugin.json
  skills/use-roble/                 Flutter
  skills/use-roble-client/          JavaScript
```
