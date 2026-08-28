import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeTokenInstructions } from '../src/env.mjs';

/** Respuesta del servidor sin levantar uno. */
function fakeFetch(status, body) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  });
}

const { RobleAdminClient } = await import('../src/client.mjs');

const client = () =>
  new RobleAdminClient({
    baseUrl: 'https://x.test',
    contractId: 'proyecto_x',
    token: `roble_pat_0123456789abcdef_${'a'.repeat(43)}`,
  });

test('un 403 por alcance se marca como "hace falta escritura"', async () => {
  global.fetch = fakeFetch(403, {
    message: 'Este token de acceso es de solo lectura y no puede ejecutar operaciones POST',
  });

  const err = await client().post('/x', {}).catch((e) => e);
  assert.equal(err.needsWriteToken, true);
});

test('un 403 por rol NO se marca: otro token no lo arregla', async () => {
  // Un VIEWER escribiendo. Cambiar de token no cambia su rol en el proyecto,
  // así que mandarle a generar otro sería mandarlo a perder el tiempo.
  global.fetch = fakeFetch(403, { message: 'El rol VIEWER no puede ejecutar operaciones POST' });

  const err = await client().post('/x', {}).catch((e) => e);
  assert.equal(err.needsWriteToken, false);
  assert.match(err.message, /depende del rol/);
});

test('un 401 tampoco se confunde con un problema de alcance', async () => {
  global.fetch = fakeFetch(401, { message: 'Token de acceso inválido' });

  const err = await client().get('/x').catch((e) => e);
  assert.equal(err.needsWriteToken, false);
  assert.match(err.message, /vencido, revocado o mal copiado/);
});

test('las instrucciones nombran el archivo real cuando lo hay', () => {
  const texto = writeTokenInstructions({ envFile: '/proyectos/mi-app/.roble.mcp.env' });
  assert.match(texto, /\/proyectos\/mi-app\/\.roble\.mcp\.env/);
  assert.match(texto, /Lectura y escritura/);
});

test('sin archivo, dice cómo crearlo y que se ignore en git', () => {
  const texto = writeTokenInstructions({ envFile: null });
  assert.match(texto, /\.roble\.mcp\.env/);
  assert.match(texto, /gitignore/);
});

test('dice que el de solo lectura sirve para el resto', () => {
  // Si no, la lectura de esto es «tu token no vale», y lo natural sería
  // tirarlo y usar siempre uno de escritura, que es lo contrario de lo que se
  // busca.
  assert.match(writeTokenInstructions({ envFile: '/x/.roble.mcp.env' }), /puedes conservarlo/);
});
