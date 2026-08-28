/**
 * Archivos: si el proyecto puede guardarlos, y cómo se usan desde la app.
 *
 * Roble no guarda los archivos. Cada proyecto apunta a un bucket compatible
 * con S3 —Cloudflare R2, Amazon S3, Backblaze B2, MinIO— y los bytes van
 * directo entre la app y ese bucket; Roble solo firma un permiso temporal y
 * lleva la metadata.
 *
 * Aquí no se configura nada a propósito. Conectar el bucket exige la clave
 * secreta del proveedor, y eso lo hace una persona en la consola: ni el
 * agente necesita verla, ni conviene que pase por una herramienta. Lo que sí
 * hace falta es poder responder «¿por qué falla `files.upload()`?» sin
 * adivinar, que casi siempre es que nadie conectó el bucket todavía.
 */

export async function readStorageStatus(client) {
  return client.get('/storage/status');
}

/** Cómo se usa desde la app, una vez que hay bucket. */
export function usageHint() {
  return [
    'Desde la app, los archivos cuelgan de `files`:',
    '',
    '  // JavaScript',
    "  const { fileId } = await db.files.upload({ fileName: 'foto.jpg', data: blob });",
    '  const { downloadUrl } = await db.files.getDownloadUrl(fileId);',
    '',
    '  // Dart',
    "  final fileId = await db.files.upload(fileName: 'foto.jpg', data: bytes);",
    '  final bytes = await db.files.download(fileId);',
    '',
    'Dos cosas que no se ven en la firma:',
    '- Las URL de descarga caducan a los pocos minutos. Pide una nueva al',
    '  mostrar el archivo; no las guardes en una tabla ni en el estado.',
    '- Borrar solo lo puede hacer quien subió el archivo.',
  ].join('\n');
}

export function describeStatus(status) {
  if (!status?.configured) {
    return [
      'Este proyecto NO tiene bucket conectado, así que los archivos no ',
      'funcionan todavía: cualquier `files.upload()` va a fallar.',
      '',
      'Lo conecta una persona en la consola, en Configuración → Almacenamiento,',
      'con las credenciales de un bucket compatible con S3 (Cloudflare R2,',
      'Amazon S3, Backblaze B2 o un MinIO propio).',
      '',
      'No es algo que se arregle desde el código ni desde aquí: hasta que',
      'alguien lo conecte, no escribas lógica que dependa de archivos.',
      status?.detail ? `\nDetalle del servidor: ${status.detail}` : '',
    ]
      .filter(Boolean)
      .join('\n');
  }

  const prefijo = status.keyPrefix
    ? `\nLos archivos de este proyecto van bajo el prefijo "${status.keyPrefix}/".`
    : '';

  return [
    `Bucket conectado: "${status.bucketName}".${prefijo}`,
    '',
    usageHint(),
  ].join('\n');
}
