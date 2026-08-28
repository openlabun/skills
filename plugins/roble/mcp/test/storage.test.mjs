import { test } from 'node:test';
import assert from 'node:assert/strict';
import { describeStatus, readStorageStatus } from '../src/storage.mjs';

test('pide el estado al endpoint del proyecto', async () => {
  let visto = null;
  await readStorageStatus({
    get: async (path) => {
      visto = path;
      return { configured: true, bucketName: 'b' };
    },
  });
  assert.equal(visto, '/storage/status');
});

test('sin bucket, dice que no se arregla desde el código', async () => {
  const texto = describeStatus({ configured: false });

  // Lo que evita que un agente se ponga a "arreglar" el error escribiendo
  // código: la causa es config del proyecto, no del cliente.
  assert.match(texto, /NO tiene bucket conectado/);
  assert.match(texto, /Configuración → Almacenamiento/);
  assert.match(texto, /no escribas lógica que dependa de archivos/);
});

test('sin bucket, arrastra el detalle del servidor si vino', async () => {
  const texto = describeStatus({
    configured: false,
    detail: 'STORAGE_DEFAULT_BUCKET is not configured',
  });
  assert.match(texto, /STORAGE_DEFAULT_BUCKET/);
});

test('sin bucket y sin detalle, no imprime "undefined"', async () => {
  assert.doesNotMatch(describeStatus({ configured: false }), /undefined/);
});

test('con bucket, nombra el bucket y explica cómo se usa', async () => {
  const texto = describeStatus({ configured: true, bucketName: 'mi-bucket' });

  assert.match(texto, /mi-bucket/);
  assert.match(texto, /files\.upload/);
  // Las dos trampas que no se ven en la firma del método.
  assert.match(texto, /caducan/);
  assert.match(texto, /quien subió el archivo/);
});

test('menciona el prefijo solo cuando lo hay', async () => {
  assert.match(
    describeStatus({ configured: true, bucketName: 'b', keyPrefix: 'proy_123' }),
    /proy_123/,
  );
  assert.doesNotMatch(
    describeStatus({ configured: true, bucketName: 'b', keyPrefix: null }),
    /prefijo/,
  );
});

test('una respuesta vacía se trata como sin configurar, no revienta', async () => {
  assert.match(describeStatus(null), /NO tiene bucket conectado/);
  assert.match(describeStatus(undefined), /NO tiene bucket conectado/);
});
