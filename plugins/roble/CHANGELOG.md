# Changelog del plugin `roble`

El número lo llevan el plugin y su servidor MCP en paralelo: `roble_version`
dice los dos, y si no coinciden es que la instalación quedó a medias.

## 1.2.1

### Skills

- **Los dos smokes comprobaban el tiempo real de una forma que no podía pasar.**
  Se suscribían a una colección recién inventada y le escribían después, pero el
  servidor rechaza suscribirse a una colección que todavía no existe
  (`REALTIME_UNKNOWN_COLLECTION`, en `stream.gateway.ts`) y una colección nace
  al escribir en ella. El resultado era un «AVISO tiempo real: no llegó ningún
  cambio» que parecía un fallo del servidor y era de orden — justo el mensaje
  que uno lee cuando está depurando un problema de tiempo real de verdad.

  Ahora el primer push crea la colección, la suscripción va después, y el
  cambio que se espera por el socket es un segundo push. Verificado contra
  producción: los dos pasan.

- El smoke de JS registra `onError` **dentro del objeto de opciones**, que es
  donde `watch` lo busca. Suelto como tercer argumento no se registraba, así que
  un rechazo del servidor se perdía en silencio y solo se veía la ausencia de
  eventos.

## 1.2.0

### Skills

- **`use-roble` y `use-roble-client` se ponen al día con los paquetes
  publicados**: `roble 1.9.0` y `roble-client@3.8.0`. Documentaban 1.4.0 y
  3.5.0, cuatro y tres versiones por detrás de lo que instala `pub add` o
  `npm install`, así que quien seguía el skill leía instrucciones de una API
  anterior a la que acababa de bajar.

- **La sesión como un flujo**, que es el hueco grande que quedaba:
  `authStateChanges` en Flutter, `onAuthStateChanged` en JS, y
  `onSessionExpired` en ambos. Es la forma idiomática de decidir qué pantalla
  pintar, y los skills seguían enseñando a resolverlo con un `restoreSession()`
  y un `if`.

  Con ello, `RobleAuthReason`: `signedOut` y `expired` dejan los dos sin
  sesión, pero solo uno merece un «tu sesión caducó», y sin el motivo la app no
  puede distinguirlos.

- **El único cambio que puede obligar a tocar código** queda anotado en la guía
  de migración de Flutter: en 1.9.0, `RobleAuthState.user` pasa de
  `Map<String, dynamic>?` a `RobleUser?`. `currentUser()` no cambia.

### Requisitos

Nada nuevo del lado del servidor: son APIs de cliente sobre lo que el backend
ya hacía.

## 1.1.0

### Servidor MCP

- **`roble_storage_status`**: si el proyecto tiene un bucket conectado. Sin él,
  las funciones de archivos no están disponibles para la aplicación, así que es
  lo primero que hay que mirar antes de escribir código que suba nada.

### Skills

- `use-roble` y `use-roble-client` cubren ahora los archivos: subida y descarga
  con URLs firmadas contra el bucket del proyecto.

### Requisitos

El almacenamiento necesita `app-roble` v1.9.0 o superior y `db-service-roble`
v1.8.0 o superior.

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
