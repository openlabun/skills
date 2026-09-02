---
name: use-roble
description: Integrar el paquete roble (Roble de Uninorte OpenLab) en una app Flutter. Usar para añadir autenticación, base de datos, árbol JSON, archivos, login con Google o tiempo real de Roble, para empezar una app desde cero, o para migrar una que ya habla con Roble con http a mano. Incluye un smoke que verifica la conexión contra el servidor real.
---

# Integrar el paquete `roble`

Cliente de Roble para Flutter. Este documento es para **añadirlo a una app que
no lo tiene**, o para migrar una que ya habla con Roble a mano.

**Empieza preguntando**, porque el camino cambia mucho:

1. ¿**Desde cero** o **migrando** algo que ya existe?
2. Si migra: ¿desde `http`/`dio` crudos, o desde una versión anterior?
3. ¿Qué necesita: solo cuentas, datos, archivos, login social, tiempo real, o
   todo?
4. ¿A qué plataformas apunta? Android e iOS piden configuración nativa para
   el login con Google; web no.

## Instalar

```bash
flutter pub add roble
```

Verificado con `roble 1.9.0` y Flutter 3.47.0.

En Android, `android/app/src/main/AndroidManifest.xml` necesita, dentro de
`<manifest>`:

```xml
<uses-permission android:name="android.permission.INTERNET" />
```

## Verificar que funciona: el smoke

**Hazlo antes de escribir nada de la app.** Prueba conexión, cuentas, árbol
JSON y tiempo real de una pasada, contra el servidor real, y **limpia lo que
crea**: registra una cuenta desechable y la borra al terminar.

`smoke_test.dart` está **junto a este SKILL.md**. Cópialo a `test/` del
proyecto que estás integrando y córrelo desde ahí:

```bash
cp "$SKILL_DIR/smoke_test.dart" test/smoke_test.dart
ROBLE_CONTRACT_ID=tu_contrato flutter test test/smoke_test.dart --reporter expanded
```

**Ojo:** si instalaste esto como plugin, el fichero ya está junto a este
SKILL.md y `$SKILL_DIR` lo resuelve. Si no, está en
`github.com/openlabun/skills`, en `plugins/roble/skills/use-roble/`.

Salida real de una corrida buena:

```
00:00 +0: sin sesión: los proveedores son públicos
  proveedores: google
00:00 +1: flujo completo con una cuenta desechable
  login -> userId=b2216b68-2a77-4547-aea6-96052913852f role=user
  push -> mtbqbkod_Xvs1tz1sykVdXt1zaop3
  tiempo real: llegó el cambio
00:05 +2: All tests passed!
```

`ROBLE_BASE_URL` cambia el host; por omisión apunta al de pruebas de OpenLab.

Se corre con `flutter test` y no con `dart run` a propósito: el paquete
importa `package:flutter`, así que necesita el SDK de Flutter para arrancar.

Si el smoke pasa, el problema que venga después está en el código de la app,
no en la conexión.

## Empezar desde cero

Un cliente, **creado una sola vez** y compartido:

```dart
final db = RobleApiDataBase(
  config: RobleApiConfig.fromContract(
    baseUrl: 'https://roble-api.test-openlab.uninorte.edu.co',
    contractId: 'miproyecto_ab12cd34',
  ),
);
```

Crearlo en cada pantalla da a cada copia su propia sesión.

Al arrancar, antes de decidir qué pantalla mostrar:

```dart
if (await db.restoreSession()) {
  // pantalla principal
} else {
  // login
}
```

Eso sirve para decidir una vez. Para que la app **siga** la sesión —y se entere
de que se cayó— usa `authStateChanges`, más abajo.

Lo demás —cuentas, tablas, árbol JSON, tiempo real, qué devuelve cada
método— está en el README del paquete. No lo repitas aquí.

### Login con Google

Una llamada, y el paquete elige el camino según la plataforma:

```dart
final usuario = await db.signInWithGoogle();
```

Hace falta, además:

- Configurar Google **en la consola de Roble** y registrar allí el «destino de
  retorno» de la app.
- Pasar `ssoRedirect` con el nombre de ese destino.
- En iOS, `googleIosClientId`. El Client ID **web** no: ese lo trae Roble.

## La sesión, como un flujo

`db.authStateChanges` emite al entrar, al recuperar una sesión guardada, al
salir y cuando se cae sola. Quien se suscribe **recibe primero el estado
actual**, así que una pantalla puede pintarse desde aquí sin preguntar nada
aparte:

```dart
StreamBuilder<RobleAuthState>(
  stream: db.authStateChanges,
  builder: (_, snap) =>
      snap.data?.isSignedIn ?? false ? const Inicio() : const Login(),
);
```

`db.authState` da el estado de ahora mismo sin esperar al siguiente cambio.

Cada estado dice **por qué** cambió, en `reason`, y eso es lo que un `user`
a secas no cuenta:

| `RobleAuthReason` | Cuándo | Qué merece la persona |
|---|---|---|
| `signedIn` | acaba de entrar | pasar a la app |
| `restored` | se recuperó una sesión guardada | pasar a la app, sin saludar como si acabara de entrar |
| `signedOut` | cerró sesión a propósito | volver al login, callando |
| `expired` | se cayó sola | volver al login **y decir que caducó** |

`signedOut` y `expired` dejan los dos sin sesión, pero solo uno merece un «tu
sesión caducó». Esa distinción es toda la razón de que `reason` exista.

Si solo interesa la caída, `db.onSessionExpired` es un filtro de lo anterior:

```dart
db.onSessionExpired.listen((_) => irALogin());
```

Emite una sola vez por sesión caída aunque fallen varias llamadas a la vez, se
rearma al entrar de nuevo, y **no** emite en `logout()`: cerrar sesión a
propósito no es que se te caiga. A diferencia de `authStateChanges`, no reparte
el estado actual al suscribirse — avisa de lo que pase a partir de ahora.

El perfil llega ya convertido, como `RobleUser`: `userId`, `email`, `name`,
`role`, `extra` y las fechas como `DateTime`. Lo que el paquete todavía no
conozca sigue estando en `raw`, así que un campo nuevo del backend no obliga a
esperar una versión del paquete. `currentUser()` sigue devolviendo el `Map`
tal cual.

## Cómo organizar el proyecto

**Propón por defecto una arquitectura limpia por features**, y di por qué.
No la impongas: si quien pregunta prefiere otra cosa, o la app es un
prototipo de tres pantallas, sigue su camino sin discutir.

```
lib/
  core/
    roble.dart            # el cliente, creado una sola vez
  features/
    auth/
      data/               # implementa el repositorio hablando con Roble
      domain/             # entidades y el contrato del repositorio
      presentation/       # pantallas, widgets, controladores
    tareas/
      data/
      domain/
      presentation/
```

Lo que hace que valga la pena aquí, y no es teoría: **el paquete de Roble se
menciona solo en `data/`**. El `domain/` define qué necesita la feature y el
`data/` lo resuelve con `db.read(...)`, `db.files.upload(...)`, lo que sea.

Eso compra tres cosas concretas en un proyecto con Roble:

- **Las pantallas se prueban sin red.** El `domain/` es el contrato, así que
  en un test se sustituye por uno falso. Sin esto hay que levantar sesión
  real para probar un widget.
- **Un cambio del backend no llega a la interfaz.** Cambiar de una tabla a
  una consulta guardada, o de una URL fija a `files.getDownloadUrl()`, se
  queda en `data/`.
- **Las features no se enredan entre ellas.** Cada carpeta se lee, se mueve
  y se borra sola.

Para una app pequeña, `data/` y `domain/` en el mismo archivo de la feature
es un punto medio razonable. Lo que sí conviene sostener siempre, porque
cuesta poco: **que los widgets no llamen a `db` directo**.

Para decidir rápido según el tamaño:

| Tamaño | Sugerencia |
|---|---|
| Prototipo, 2-3 pantallas | Una carpeta por pantalla y `core/roble.dart`. Sin capas. |
| App real | Features con `data`/`domain`/`presentation`. |
| App con varios que la tocan | Lo anterior, y un test por repositorio. |

## Archivos

`db.files` sube y descarga contra un bucket compatible con S3. Los bytes van
**directo entre la app y el bucket**; Roble solo firma el permiso y lleva la
metadata.

```dart
final fileId = await db.files.upload(
  fileName: 'foto.jpg',
  mimeType: 'image/jpeg',
  data: bytes,           // Uint8List
);

final archivos = await db.files.list();
final bytes = await db.files.download(fileId);
```

El namespace es `files`, no `storage`: `RobleTokenStorage` ya ocupa ese
nombre y es otra cosa —dónde se guarda la sesión, no los archivos—.

**Antes de escribir nada, verifica que el proyecto tenga bucket.** Se conecta
en la consola, en *Configuración → Almacenamiento*. Sin eso, todas las
llamadas fallan y el error no dice que falte configurar el proyecto.

## Migrar desde `http`/`dio` crudos

| Lo que había | Pasa a ser |
|---|---|
| `POST /auth/{c}/login` + guardar tokens a mano | `db.login(email:, password:)` |
| Refrescar el token en un interceptor | nada: el paquete lo hace solo |
| `GET /auth/{c}/me` | `db.currentUser()` |
| `GET /database/{c}/read?tableName=X` | `db.read('X')` |
| `POST /database/{c}/insert-one` | `db.create('X', {...})` |

**Borra el interceptor de refresco.** El paquete reintenta una vez ante un 401
por su cuenta; dos capas compitiendo producen refrescos duplicados.

**Deja de guardar los tokens tú.** El paquete los persiste en el almacenamiento
seguro y los recupera con `restoreSession()`.

## Migrar desde una versión anterior del paquete

Casi todo es aditivo. El único cambio de tipo está en 1.9.0 y solo afecta a
quien ya usaba `authStateChanges`.

- **1.4.0 trajo** `signInWithGoogle()` y el resto del login social v2, `db.json`
  (árbol JSON), `executeQueryByName`, y `role` en el perfil. `role` necesita
  `auth-service` v1.7.8 o más; contra uno anterior llega `null`.
- **1.5.0: el tiempo real escucha colecciones del árbol JSON, no tablas SQL.**
  `watchTable` y `watchRecord` quedan obsoletos: el servidor rechaza esas
  suscripciones con `REALTIME_UNKNOWN_COLLECTION` y ya no entregan nada. Usa
  `db.json.watch` sobre la colección. Requiere `realtime` v0.10.1.

  El cambio es del servidor, así que **quedarse en 1.4.0 no lo evita**: quien no
  actualice tendrá `watchTable` fallando igual, pero sin el aviso del
  analizador.
- **1.6.0 trajo `db.files`.** Requiere `app-roble` v1.9.1 o superior y
  `db-service-roble` v1.8.0 o superior.
- **1.7.0 trajo `db.onSessionExpired`.** Antes, una sesión caída solo se
  deducía cazando `RobleApiAuthException` en el sitio correcto.
- **1.8.0 trajo `db.authStateChanges` y `db.authState`.** `onSessionExpired`
  pasa a ser un filtro de ese flujo, con el mismo comportamiento de 1.7.0.

  `restoreSession()` ahora pide el perfil al comprobar que la sesión sigue
  viva, para poder emitirlo con el estado: una app que lo pedía por su cuenta
  al arrancar puede dejar de hacerlo.
- **1.9.0 trajo `RobleUser`**, el perfil con tipos, y con él **el único cambio
  que puede obligar a tocar código**: `RobleAuthState.user` pasa de
  `Map<String, dynamic>?` a `RobleUser?`. Quien leía `estado.user!['email']`
  pasa a `estado.user!.email`.

  `currentUser()` **no** cambia: sigue devolviendo el `Map` tal cual, así que
  nada de lo que ya funcionaba deja de hacerlo.

Después de subir de versión, corre el smoke antes de tocar la app.

## Gotchas

- **Bajo `flutter test` la sesión no persiste, y nadie te avisa.** El
  almacenamiento seguro es un plugin nativo y ahí no está registrado; el
  paquete se lo traga y `restoreSession()` devuelve `false` sin lanzar. En
  pruebas, **inyecta un `RobleTokenStorage` en memoria** — el smoke trae uno
  listo para copiar.

- **El tiempo real necesita ~1,5 s para abrir el socket.** Si escribes
  inmediatamente después de `watch()`, el evento se pierde: la suscripción aún
  no existía. El smoke espera a propósito antes de hacer `push`.

- **Cancela la suscripción al salir de la pantalla.** Un
  `StreamSubscription` sin `cancel()` deja el socket abierto.

- **`authState.user` puede ser `null` con sesión iniciada.**
  `restoreSession(verify: false)` carga los tokens sin llamar al servidor, así
  que no hay perfil que emitir. Para saber si hay sesión mira `isSignedIn`, no
  `user`: leer `user!` ahí revienta en el arranque y solo en ese camino.

- **`authStateChanges` reparte el estado actual al suscribirse;
  `onSessionExpired` no.** El primero sirve para pintar una pantalla desde
  cero; el segundo es un aviso de lo que pase a partir de ahora, así que
  suscribirse tarde no recupera una caída ya ocurrida.

- **Escuchar exige sesión iniciada.**

- **Con GetX, registra con `fenix: true`.** Un `Get.lazyPut` sin `fenix`
  consume su fábrica al descartar la ruta, y volver a entrar a la pantalla
  falla con «not found». Pasa con el cliente y con todo lo que cuelgue de él.

- **`register()` puede crear la cuenta sin verificar el correo.** Depende de
  la configuración del proyecto. No asumas que hace falta el código.

- **`role` es `null` si nadie asignó rol.** No es un error.

- **`id` y `userId` no son lo mismo** en el perfil. `userId` es el del
  usuario, el que referencian tus tablas; `id` es el de la fila del perfil.

- **Los archivos exigen un bucket conectado en la consola.** Es config del
  proyecto, no del código: sin ella `files.upload()` falla siempre. Si el
  proyecto es nuevo, esto es lo primero que hay que mirar.

- **`files`, no `storage`.** `RobleTokenStorage` es la sesión; los archivos
  cuelgan de `db.files`.

- **Las URL de descarga caducan a los pocos minutos.** No las guardes en el
  estado ni en tu base: pide una nueva al mostrar el archivo, o usa
  `download()`, que la pide y trae los bytes.

- **Un archivo que no termina de subir no aparece en `list()`.** La subida
  son tres pasos y `upload()` los hace por ti; si el de en medio falla, la
  fila queda pendiente y se ignora. No es que la lista esté rota.

## Troubleshooting

| Síntoma | Causa | Arreglo |
|---|---|---|
| `restoreSession()` siempre `false` en pruebas | el almacenamiento seguro no existe ahí | inyecta un `RobleTokenStorage` en memoria |
| El smoke falla en «proveedores» | `contractId` o `baseUrl` mal | cópialos de la consola de Roble |
| `AVISO tiempo real: no llegó ningún cambio` | el socket no llegó a suscribirse | sube la espera antes del `push` |
| «not found» al reentrar a una pantalla | `lazyPut` sin `fenix` | `fenix: true` en toda la cadena |
| 401 en todo tras un rato | sesión caducada | escucha `db.onSessionExpired` y lleva al login; detectarlo por el 401 en cada pantalla llega tarde |
| 403 en `publicRead` | la tabla no está marcada como pública | márcala en la consola |
| 404 en `executeQueryByName` | no existe esa consulta guardada | créala en la consola, por nombre |
| `state inválido o expirado` en login social | el destino de retorno no coincide | registra la URL exacta en la consola y pásala en `ssoRedirect` |
