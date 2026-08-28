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
      "args": ["/ruta/a/skills/plugins/roble/mcp/src/index.mjs"],
      "env": {
        "ROBLE_BASE_URL": "https://roble.test-openlab.uninorte.edu.co",
        "ROBLE_CONTRACT_ID": "${ROBLE_CONTRACT_ID}",
        "ROBLE_TOKEN": "${ROBLE_TOKEN}"
      }
    }
  }
}
```

El servidor habla JSON-RPC por stdin/stdout sin librerías: el editor lo lanza
como proceso hijo y lo mata al cerrar. No escucha en ningún puerto, no se
despliega y no hay contenedor.

El SDK oficial de MCP está solo como dependencia de desarrollo, para que el
smoke lo pruebe hablando como un cliente de verdad.

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
ROBLE_BASE_URL=https://roble.test-openlab.uninorte.edu.co \
ROBLE_CONTRACT_ID=miproyecto_ab12cd34ef \
ROBLE_TOKEN=roble_pat_... \
npm run smoke
```

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

## Tipos que Roble acepta

`text`, `int`, `bigint`, `smallint`, `numeric`, `real`, `double precision`,
`date`, `timestamp`, `timestamp with time zone`, `time`, `json`, `jsonb`,
`boolean`, `uuid`, `serial`, `varchar(n)`, `geography`.

No declares `_id`: Roble la añade sola como clave primaria, y el plan la
ignora tanto al crear como al comparar.
