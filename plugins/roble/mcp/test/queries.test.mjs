import { test } from 'node:test';
import assert from 'node:assert/strict';
import { listQueries, createQuery, callHint, paramCount } from '../src/queries.mjs';

test('lee la lista venga como venga envuelta', async () => {
  const fila = { id: '1', name: 'usuarios', query: 'SELECT 1', is_active: true };

  for (const forma of [[fila], { savedQueries: [fila] }, { data: [fila] }]) {
    const r = await listQueries({ get: async () => forma });
    assert.equal(r.length, 1, `falló con ${JSON.stringify(forma).slice(0, 30)}`);
    assert.equal(r[0].name, 'usuarios');
  }
});

test('sin consultas devuelve lista vacía, no revienta', async () => {
  assert.deepEqual(await listQueries({ get: async () => null }), []);
});

test('normaliza is_active venga en snake o camel', async () => {
  const r = await listQueries({
    get: async () => [
      { id: '1', name: 'a', query: 'x', is_active: false },
      { id: '2', name: 'b', query: 'x', isActive: false },
      { id: '3', name: 'c', query: 'x' },
    ],
  });
  assert.deepEqual(r.map((q) => q.isActive), [false, false, true]);
});

test('recorta nombre y consulta antes de mandarlos', async () => {
  let enviado;
  await createQuery(
    { post: async (_p, body) => { enviado = body; return { id: '1', ...body }; } },
    { name: '  usuarios  ', description: '  ', query: '  SELECT 1  ' },
  );
  assert.equal(enviado.name, 'usuarios');
  assert.equal(enviado.query, 'SELECT 1');
  // Una descripción en blanco no se manda como cadena vacía.
  assert.equal(enviado.description, undefined);
});

test('la ayuda de llamada usa el nombre, no el id', () => {
  const hint = callHint('usuarios_publicos');
  assert.match(hint, /executeQueryByName\('usuarios_publicos', \[\]\)/);
  // Los dos clientes, porque el proyecto puede ser de cualquiera de los dos.
  assert.match(hint, /roble-client/);
  assert.match(hint, /Flutter/);
  // Y el aviso que evita la inyección, que es el error caro aquí.
  assert.match(hint, /Nunca concatenes/);
});

test('cuenta los parámetros distintos, no las apariciones', () => {
  assert.equal(paramCount('SELECT 1'), 0);
  assert.equal(paramCount('WHERE a = $1'), 1);
  assert.equal(paramCount('WHERE a = $1 AND b = $2'), 2);
  // El mismo parámetro usado dos veces sigue siendo uno.
  assert.equal(paramCount('WHERE a = $1 OR b = $1'), 1);
  // Y el array se dimensiona por el mayor, no por cuántos hay.
  assert.equal(paramCount('WHERE a = $2'), 2);
});

test('la ayuda dimensiona la llamada según los parámetros', () => {
  const sin = callHint('todos', 'SELECT name FROM user_system');
  assert.match(sin, /executeQueryByName\('todos', \[\]\)/);
  assert.match(sin, /No lleva parámetros/);

  const con = callHint('por_curso', 'SELECT * FROM notas WHERE curso_id = $1 AND periodo = $2');
  assert.match(con, /\[valor1, valor2\]/);
  assert.match(con, /Pide 2 parámetros/);
});

test('con un solo parámetro el texto va en singular', () => {
  assert.match(callHint('x', 'WHERE id = $1'), /Pide 1 parámetro,/);
});
