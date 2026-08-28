import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSnapshot, writeSnapshot, indexSnapshot, snapshotPath } from '../src/snapshot.mjs';
import { planSchema } from '../src/schema.mjs';

const dir = () => mkdtemp(join(tmpdir(), 'roble-snap-'));

const esquema = [
  {
    table: 'tareas',
    columns: [
      { name: '_id', type: 'uuid', nullable: false },
      { name: 'titulo', type: 'text', nullable: true },
    ],
    rowsEstimated: 0,
  },
];

test('sin archivo devuelve null, que es la primera vez y no un error', async () => {
  assert.equal(await readSnapshot(join(await dir(), 'no-existe.json')), null);
});

test('un archivo corrupto no rompe: se sigue sin memoria', async () => {
  const path = join(await dir(), 'roble.schema.json');
  await writeFile(path, '{ esto no es json');
  assert.equal(await readSnapshot(path), null);
});

test('una versión desconocida se ignora en vez de malinterpretarse', async () => {
  const path = join(await dir(), 'roble.schema.json');
  await writeFile(path, JSON.stringify({ version: 99, tables: [] }));
  assert.equal(await readSnapshot(path), null);
  // La v1 no llevaba `removed`, así que su memoria no se puede aplicar.
  await writeFile(path, JSON.stringify({ version: 1, tables: [] }));
  assert.equal(await readSnapshot(path), null);
});

test('lo que escribe se puede volver a leer', async () => {
  const path = join(await dir(), 'roble.schema.json');
  await writeSnapshot(esquema, { contractId: 'proyecto_x', path });

  const leido = await readSnapshot(path);
  assert.equal(leido.contractId, 'proyecto_x');
  assert.equal(leido.tables[0].table, 'tareas');
});

test('guarda la forma, no los datos: nada de filas ni tamaños', async () => {
  const path = join(await dir(), 'roble.schema.json');
  await writeSnapshot(esquema, { contractId: 'proyecto_x', path });

  const crudo = await readFile(path, 'utf8');
  assert.ok(!crudo.includes('rowsEstimated'));
  assert.ok(!crudo.includes('size'));
});

test('ordena tablas y columnas para que el diff de git no sea ruido', async () => {
  const path = join(await dir(), 'roble.schema.json');
  const desordenado = [
    { table: 'z', columns: [{ name: 'b' }, { name: 'a' }] },
    { table: 'a', columns: [{ name: 'x' }] },
  ];
  const escrito = await writeSnapshot(desordenado, { contractId: 'p', path });

  assert.deepEqual(escrito.tables.map((t) => t.table), ['a', 'z']);
  assert.deepEqual(escrito.tables[1].columns.map((c) => c.name), ['a', 'b']);
});

test('sin memoria, una tabla que falta se crea sin más', () => {
  const plan = planSchema([], [{ table: 'notas', columns: [{ name: 'v', type: 'int' }] }]);
  assert.equal(plan.safe.length, 1);
});

test('una tabla dada de baja NO se recrea sola', () => {
  const memoria = indexSnapshot({ version: 2, tables: [], removed: [{ table: 'notas' }] });
  const plan = planSchema([], [{ table: 'notas', columns: [{ name: 'v', type: 'int' }] }], memoria);

  assert.equal(plan.safe.length, 0);
  assert.match(plan.unsafe[0].reason, /dada de baja/);
});

test('una columna dada de baja NO se vuelve a añadir sola', () => {
  const memoria = indexSnapshot({
    version: 2,
    tables: [{ table: 'tareas', columns: [{ name: 'titulo' }] }],
    removed: [{ table: 'tareas', column: 'borrada' }],
  });
  const plan = planSchema(
    esquema,
    [
      {
        table: 'tareas',
        columns: [
          { name: 'titulo', type: 'text' },
          { name: 'borrada', type: 'text' },
        ],
      },
    ],
    memoria,
  );

  assert.equal(plan.safe.length, 0);
  assert.match(plan.unsafe[0].reason, /lista "removed"/);
});

test('una columna nueva de verdad sigue siendo segura aunque haya memoria', () => {
  const memoria = indexSnapshot({
    version: 2,
    tables: [{ table: 'tareas', columns: [{ name: 'titulo' }] }],
    removed: [],
  });
  const plan = planSchema(
    esquema,
    [
      {
        table: 'tareas',
        columns: [
          { name: 'titulo', type: 'text' },
          { name: 'nota', type: 'text' },
        ],
      },
    ],
    memoria,
  );

  assert.equal(plan.safe.length, 1);
  assert.equal(plan.safe[0].column.name, 'nota');
});

test('distingue una columna que pusimos nosotros de una ajena', () => {
  const nuestra = indexSnapshot({
    version: 2,
    tables: [{ table: 'tareas', columns: [{ name: 'titulo' }] }],
    removed: [],
  });
  const conMemoria = planSchema(esquema, [{ table: 'tareas', columns: [] }], nuestra);
  assert.match(conMemoria.unsafe[0].reason, /la app dejó de usarla/);

  const sinMemoria = planSchema(esquema, [{ table: 'tareas', columns: [] }]);
  assert.match(sinMemoria.unsafe[0].reason, /no la creamos nosotros/);
});

test('la baja sobrevive al siguiente apply, que es lo que fallaba', async () => {
  const path = join(await dir(), 'roble.schema.json');

  // 1. Se aplica un esquema con la columna.
  const conColumna = [
    { table: 'notas', columns: [{ name: 'valor', type: 'numeric' }, { name: 'obs', type: 'text' }] },
  ];
  const primero = await writeSnapshot(conColumna, { contractId: 'p', path });

  // 2. Alguien la borra desde la consola: el servidor ya no la tiene.
  const sinColumna = [{ table: 'notas', columns: [{ name: 'valor', type: 'numeric' }] }];
  await writeSnapshot(sinColumna, { contractId: 'p', previous: primero, path });

  const tras = await readSnapshot(path);
  assert.deepEqual(tras.removed, [{ table: 'notas', column: 'obs', at: tras.removed[0].at }]);

  // 3. El siguiente apply vuelve a escribir, y la baja sigue ahí: antes se
  //    perdía justo aquí y la columna reaparecía como novedad.
  await writeSnapshot(sinColumna, { contractId: 'p', previous: tras, path });
  const final = await readSnapshot(path);
  assert.equal(final.removed.length, 1);

  const memoria = indexSnapshot(final);
  const plan = planSchema(
    [{ table: 'notas', rowsEstimated: 0, columns: [{ name: 'valor', type: 'numeric' }] }],
    [{ table: 'notas', columns: [{ name: 'valor', type: 'numeric' }, { name: 'obs', type: 'text' }] }],
    memoria,
  );
  assert.equal(plan.safe.length, 0);
});

test('si el objeto vuelve, deja de estar dado de baja', async () => {
  const path = join(await dir(), 'roble.schema.json');
  const con = [{ table: 'notas', columns: [{ name: 'obs', type: 'text' }] }];
  const sin = [{ table: 'notas', columns: [] }];

  const a = await writeSnapshot(con, { contractId: 'p', path });
  const b = await writeSnapshot(sin, { contractId: 'p', previous: a, path });
  assert.equal(b.removed.length, 1);

  // Reaparece porque alguien la volvió a crear: dejarla en la lista la
  // bloquearía para siempre.
  const c = await writeSnapshot(con, { contractId: 'p', previous: b, path });
  assert.equal(c.removed.length, 0);
});

test('la baja se detecta ya en el mismo plan, antes de reescribir nada', () => {
  // Es el caso real: alguien borra la columna en la consola y se planea acto
  // seguido. `removed` todavía está vacío porque nadie ha escrito el snapshot
  // desde entonces; la constancia está en las columnas vivas del snapshot.
  const memoria = indexSnapshot({
    version: 2,
    tables: [{ table: 'notas', columns: [{ name: 'valor' }, { name: 'obs' }] }],
    removed: [],
  });
  const plan = planSchema(
    [{ table: 'notas', rowsEstimated: 0, columns: [{ name: 'valor', type: 'numeric' }] }],
    [{ table: 'notas', columns: [{ name: 'valor', type: 'numeric' }, { name: 'obs', type: 'text' }] }],
    memoria,
  );

  assert.equal(plan.safe.length, 0);
  assert.equal(plan.unsafe[0].action, 'add_column');
});

test('una tabla que el snapshot tenía viva y el servidor perdió tampoco se recrea', () => {
  const memoria = indexSnapshot({
    version: 2,
    tables: [{ table: 'notas', columns: [{ name: 'valor' }] }],
    removed: [],
  });
  const plan = planSchema([], [{ table: 'notas', columns: [{ name: 'valor', type: 'numeric' }] }], memoria);

  assert.equal(plan.safe.length, 0);
});

test('el snapshot va a la raíz del proyecto, no a la subcarpeta de trabajo', () => {
  assert.equal(
    snapshotPath({ projectDir: '/proyectos/mi-app' }),
    '/proyectos/mi-app/roble.schema.json',
  );
  // ROBLE_SCHEMA_FILE sigue mandando cuando se indica.
  assert.equal(
    snapshotPath({ projectDir: '/proyectos/mi-app', schemaFile: '/otro/sitio.json' }),
    '/otro/sitio.json',
  );
});
