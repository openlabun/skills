# `roble-mcp`

Servidor MCP de [Roble](https://roble.openlab.uninorte.edu.co) (Uninorte
OpenLab). Deja que un agente lea el esquema de un proyecto y lo ajuste a lo
que la app necesita, sin salir del editor a hacer clics en la consola.

## Qué hace, y qué no

| Herramienta | Qué hace |
|---|---|
| `roble_schema_read` | Tablas, columnas, tipos y filas estimadas |
| `roble_schema_plan` | Compara con el esquema que la app necesita. No toca nada |
| `roble_schema_apply` | Aplica **solo** lo aditivo: crear tablas, añadir columnas opcionales |

La regla es una sola: **aditivo se aplica, destructivo se propone.** Borrar una
columna, cambiar un tipo o exigir `NOT NULL` sobre una tabla con filas pierde
datos, así que el plan lo describe y lo deja para una persona. `apply` no llama
nunca a `delete-table` ni a `drop-column`; hay un test que lo fija.

## Instalar

Viene con el plugin:

```
/plugin marketplace add openlabun/skills
/plugin install roble@openlab
```

Suelto, en cualquier cliente MCP: clona el repo y apunta al archivo. No hace
falta instalar nada — el servidor no tiene dependencias en tiempo de
ejecución, solo Node 20 o superior.

```json
{
  "mcpServers": {
    "roble": {
      "command": "node",
      "args": ["/ruta/a/skills/plugins/roble/mcp/src/index.mjs"]
    }
  }
}
```

El servidor habla JSON-RPC por stdin/stdout sin librerías: el editor lo lanza
como proceso hijo y lo mata al cerrar. No escucha en ningún puerto, no se
despliega y no hay contenedor.

El SDK oficial de MCP está solo como dependencia de desarrollo, para que el
smoke lo pruebe hablando como un cliente de verdad.

## La configuración: `.roble.mcp.env`

Un archivo por proyecto, en su raíz. Copia [`.roble.mcp.env.example`](.roble.mcp.env.example):

```bash
ROBLE_BASE_URL=https://roble-api.test-openlab.uninorte.edu.co
ROBLE_CONTRACT_ID=miproyecto_ab12cd34ef
ROBLE_TOKEN=roble_pat_...
```

**Añádelo al `.gitignore`.** Lleva un token dentro; si se te olvida, el MCP te
lo dice en la respuesta de la primera herramienta que uses.

Tres detalles que lo hacen cómodo con varios proyectos a la vez:

- **Se busca hacia arriba** desde el directorio de trabajo, así que funciona
  igual abriendo el editor en la raíz o en una subcarpeta.
- **Gana sobre el entorno.** Un `export` global que quedó de otra sesión no
  secuestra el proyecto que tienes delante. Lo que el archivo no defina sí se
  toma del entorno.
- **El snapshot va junto al archivo**, o sea en la raíz del proyecto, no en la
  subcarpeta desde la que lanzaras el editor.

Se relee en cada llamada, así que cambiar de token no obliga a reiniciar el
editor.

## El token

`ROBLE_TOKEN` es un **token de acceso de proyecto**, no la contraseña ni el
token de sesión de la consola. Se genera en la consola de Roble, en
**Configuración → Tokens de acceso**, y se muestra una sola vez.

Elige el alcance a conciencia:

- **Solo lectura** para explorar y planear. Es el default, y con él
  `roble_schema_apply` falla diciendo por qué.
- **Lectura y escritura** solo cuando quieras que el agente cree tablas.

El token vale para un proyecto y hereda tu rol en él: si dejas de ser
colaborador, deja de funcionar. Ponlo en el entorno, nunca dentro del
repositorio — el prefijo `roble_pat_` está pensado para que los escáneres de
secretos de GitHub lo detecten si se te escapa.

## Verificar que funciona

```bash
npm run smoke
```

Toma la configuración del `.roble.mcp.env` como el servidor, o del entorno si
prefieres pasarla a mano.

Habla por stdio como lo haría el editor, crea una tabla desechable y la borra
al terminar aunque algo falle en medio. Comprueba, entre otras cosas, que
`apply` **no** borra una columna que sobra ni cambia un tipo.

## `roble.schema.json`

Después de cada `apply`, el servidor escribe un snapshot en la raíz del
proyecto (o donde diga `ROBLE_SCHEMA_FILE`). Lo mantiene la herramienta, no
tú, y va al repositorio: es lo que le da memoria al plan entre sesiones.

Sin él, una diferencia se puede leer de dos maneras opuestas: una columna que
falta puede ser una que nunca se creó, o una que alguien borró a propósito
desde la consola. Con él, lo segundo se detecta y **no** se deshace solo.

```json
{
  "version": 2,
  "contractId": "miproyecto_ab12cd34ef",
  "updatedAt": "2026-08-28T00:26:54.138Z",
  "tables": [{ "table": "notas", "columns": [{ "name": "valor", "type": "numeric", "nullable": false }] }],
  "removed": [{ "table": "notas", "column": "observacion", "at": "2026-08-28T00:26:53.433Z" }]
}
```

`removed` es la lista de bajas. Si quieres revivir algo que está ahí, quita su
entrada y vuelve a aplicar: es una edición pequeña y explícita, que es como
debe sentirse deshacer una decisión.

Guarda la forma y no los datos —ni filas ni tamaños— para que el diff de git
no sea ruido.

## La clave primaria y `_id`

Roble añade `_id uuid` a toda tabla, y **no se declara**: el plan la ignora al
comparar y al crear, así que mandarla en el esquema deseado no rompe nada.

Quién es la clave lo decide lo que declares:

| Lo que pides | Lo que queda |
|---|---|
| Ninguna columna con `primary: true` | `_id` es la clave primaria |
| Alguna con `primary: true` | Esa es la clave; `_id` sigue existiendo, `NOT NULL` |

Ese reparto lo hace el servidor, no el MCP. Solo se puede declarar **al crear
la tabla**: pedir una clave nueva sobre una que ya existe reescribe la tabla
entera, así que el plan lo propone y no lo aplica.

## Claves foráneas: no existen

`create-table` no acepta `references`, así que `curso_id` apuntando a
`cursos._id` es pura convención de nombres. Nada impide guardar ahí un id que
no existe.

El MCP no puede crear una restricción que la plataforma no ofrece, pero sí
avisa cuando los tipos no van a cruzar:

```
Avisos, no bloquean nada:
  ~ "notas.curso_id" parece apuntar a "cursos._id", que es uuid, pero se
    declara text. Roble no tiene claves foráneas, así que nadie lo va a
    impedir: simplemente no van a cruzar al consultar.
```

Adivina la tabla destino del nombre (`curso_id` → `curso` o `cursos`, con el
plural español). Si no encuentra exactamente una, calla: afirmar algo sería
inventar. Es un aviso, nunca un bloqueo — la convención es del proyecto, no de
la plataforma.

## Tablas que el MCP no toca

`user_system` y `saved_queries` son de Roble, no del proyecto: su forma la
gobierna la plataforma. Cualquier paso que las mencione se descarta entero, se
pida lo que se pida.

`saved_queries` además no aparece al leer el esquema, igual que la consola la
esconde de su lista. `user_system` sí aparece, porque una app necesita saber
que existe y qué columnas tiene para referenciar `user_id`; lo que no puede es
reestructurarla.

Sin esto, un agente que convierta la lectura del esquema en «lo que la app
necesita» propone reestructurarlas: en la primera prueba contra un proyecto
real salieron siete pasos destructivos sobre `saved_queries`. Ninguno se
habría aplicado —son destructivos—, pero ensucian el plan y llevan a
conclusiones equivocadas.

## Tipos que Roble acepta

`text`, `int`, `bigint`, `smallint`, `numeric`, `real`, `double precision`,
`date`, `timestamp`, `timestamp with time zone`, `time`, `json`, `jsonb`,
`boolean`, `uuid`, `serial`, `varchar(n)`, `geography`.

No declares `_id`: Roble la añade sola como clave primaria, y el plan la
ignora tanto al crear como al comparar.
