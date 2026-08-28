# Changelog del plugin `roble`

El número lo llevan el plugin y su servidor MCP en paralelo: `roble_version`
dice los dos, y si no coinciden es que la instalación quedó a medias.

## 1.0.0

Primera versión numerada. Lo anterior se distribuyó sin número, así que si
`roble_version` no responde o dice algo distinto de esto, tienes una
instalación previa a este esquema y toca actualizar.

### Servidor MCP

- **`roble_schema_read`**, **`roble_schema_plan`** y **`roble_schema_apply`**:
  leer el esquema del proyecto y ajustarlo a lo que la app necesita. Aditivo se
  aplica; destructivo se propone y lo decide una persona.
- **`roble_queries_list`** y **`roble_query_create`**: consultas guardadas, la
  vía por la que una app lee lo que su rol no puede leer directo, y la opción
  por defecto para cualquier lectura que cruce tablas o agregue — la API de
  Roble no hace joins.
- **`roble_version`**: qué versión corre, de dónde sale la configuración y
  contra qué proyecto apunta.
- **Memoria entre sesiones** en `roble.schema.json`: distingue una columna que
  nunca se creó de una que alguien borró a propósito, y no deshace la segunda.
- **Configuración por directorio** en `.roble.mcp.env`, que gana sobre el
  entorno para poder trabajar en varios proyectos a la vez. Avisa si el archivo
  no está en el `.gitignore`.
- **`user_system` y `saved_queries` son intocables**, y `_id` se ignora al
  escribir y se muestra al leer.
- **Pide un token de escritura** con instrucciones concretas en vez de devolver
  un 403, cuando lo que falta es alcance.
- Sin dependencias en tiempo de ejecución: solo Node 20.

### Skills

- `use-roble` (Flutter) y `use-roble-client` (JS/TS), al día con el tiempo real
  por colecciones del árbol JSON: `watchTable` y `watchRecord` quedaron
  obsoletos y el servidor los rechaza.

### Requisitos

Los tokens de acceso de proyecto necesitan `app-roble` v1.8.0 o superior y
`db-service-roble` v1.7.0 o superior. Contra un backend anterior, el MCP
responde 401 porque la funcionalidad no existe allí.
