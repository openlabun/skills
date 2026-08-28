import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeType, planSchema, applyPlan, readSchema } from '../src/schema.mjs';

const tabla = (over = {}) => ({
  table: 'tareas',
  description: null,
  rowsEstimated: 0,
  columns: [
    { name: '_id', type: 'uuid', nullable: false, isPrimary: true },
    { name: 'titulo', type: 'text', nullable: true, isPrimary: false },
  ],
  ...over,
});

test('normaliza los sinónimos que devuelve Postgres', () => {
  assert.equal(normalizeType('integer'), 'int');
  assert.equal(normalizeType('character varying'), 'varchar');
  assert.equal(normalizeType('varchar(50)'), 'varchar');
  assert.equal(normalizeType('numeric(10, 2)'), 'numeric');
  assert.equal(normalizeType('TIMESTAMP WITHOUT TIME ZONE'), 'timestamp');
  assert.equal(normalizeType('bool'), 'boolean');
});

test('un esquema que ya coincide no propone nada', () => {
  const plan = planSchema(
    [tabla()],
    [{ table: 'tareas', columns: [{ name: 'titulo', type: 'text' }] }],
  );
  assert.equal(plan.steps.length, 0);
});

test('int e integer no cuentan como cambio de tipo', () => {
  const plan = planSchema(
    [tabla({ columns: [{ name: 'prioridad', type: 'integer', nullable: true }] })],
    [{ table: 'tareas', columns: [{ name: 'prioridad', type: 'int' }] }],
  );
  assert.equal(plan.steps.length, 0);
});

test('crear una tabla que no existe es seguro', () => {
  const plan = planSchema([], [{ table: 'notas', columns: [{ name: 'valor', type: 'int' }] }]);
  assert.equal(plan.safe.length, 1);
  assert.equal(plan.safe[0].action, 'create_table');
  assert.equal(plan.unsafe.length, 0);
});

test('no se declara _id: Roble la añade sola', () => {
  const plan = planSchema(
    [],
    [{ table: 'notas', columns: [{ name: '_id', type: 'uuid' }, { name: 'valor', type: 'int' }] }],
  );
  assert.deepEqual(
    plan.safe[0].columns.map((c) => c.name),
    ['valor'],
  );
});

test('añadir una columna opcional es seguro aunque la tabla tenga filas', () => {
  const plan = planSchema(
    [tabla({ rowsEstimated: 500 })],
    [
      {
        table: 'tareas',
        columns: [
          { name: 'titulo', type: 'text' },
          { name: 'nota', type: 'text' },
        ],
      },
    ],
  );
  assert.equal(plan.safe.length, 1);
  assert.equal(plan.safe[0].action, 'add_column');
  assert.equal(plan.safe[0].column.nullable, true);
});

test('una columna obligatoria sobre una tabla con filas NO es segura', () => {
  const plan = planSchema(
    [tabla({ rowsEstimated: 500 })],
    [
      {
        table: 'tareas',
        columns: [
          { name: 'titulo', type: 'text' },
          { name: 'autorId', type: 'text', nullable: false },
        ],
      },
    ],
  );
  assert.equal(plan.safe.length, 0);
  assert.equal(plan.unsafe.length, 1);
  assert.match(plan.unsafe[0].reason, /ya tiene filas/);
});

test('sobre una tabla vacía, obligatoria sí es segura', () => {
  const plan = planSchema(
    [tabla({ rowsEstimated: 0 })],
    [
      {
        table: 'tareas',
        columns: [
          { name: 'titulo', type: 'text' },
          { name: 'autorId', type: 'text', nullable: false },
        ],
      },
    ],
  );
  assert.equal(plan.safe.length, 1);
  assert.equal(plan.safe[0].column.nullable, false);
});

test('cambiar un tipo nunca es seguro', () => {
  const plan = planSchema(
    [tabla()],
    [{ table: 'tareas', columns: [{ name: 'titulo', type: 'int' }] }],
  );
  assert.equal(plan.unsafe.length, 1);
  assert.equal(plan.unsafe[0].action, 'change_column_type');
});

test('una columna que sobra se reporta, nunca se borra', () => {
  const plan = planSchema([tabla()], [{ table: 'tareas', columns: [] }]);
  assert.equal(plan.unsafe.length, 1);
  assert.equal(plan.unsafe[0].action, 'drop_column');
  assert.equal(plan.unsafe[0].column, 'titulo');
  assert.equal(plan.safe.length, 0);
});

test('_id nunca se propone para borrar', () => {
  const plan = planSchema([tabla()], [{ table: 'tareas', columns: [{ name: 'titulo', type: 'text' }] }]);
  assert.equal(plan.steps.length, 0);
});

test('una tabla del proyecto que el esquema pedido no menciona se deja en paz', () => {
  const plan = planSchema([tabla(), tabla({ table: 'otra' })], [
    { table: 'tareas', columns: [{ name: 'titulo', type: 'text' }] },
  ]);
  assert.equal(plan.steps.length, 0);
});

test('apply solo ejecuta los pasos seguros', async () => {
  const llamadas = [];
  const client = { post: async (path, body) => llamadas.push({ path, body }) };

  const plan = planSchema(
    [tabla()],
    [
      {
        table: 'tareas',
        columns: [{ name: 'nota', type: 'text' }],
      },
    ],
  );
  // titulo sobra (unsafe) y nota falta (safe).
  assert.equal(plan.safe.length, 1);
  assert.equal(plan.unsafe.length, 1);

  const res = await applyPlan(client, plan);

  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].path, '/add-column');
  assert.equal(res.applied.length, 1);
  assert.equal(res.skipped.length, 1);
  assert.equal(res.failed.length, 0);
});

test('un paso que falla no impide los demás', async () => {
  let n = 0;
  const client = {
    post: async () => {
      if (++n === 1) throw new Error('boom');
    },
  };
  const plan = planSchema([], [
    { table: 'a', columns: [{ name: 'x', type: 'text' }] },
    { table: 'b', columns: [{ name: 'y', type: 'text' }] },
  ]);

  const res = await applyPlan(client, plan);

  assert.equal(res.failed.length, 1);
  assert.equal(res.applied.length, 1);
});

test('apply nunca llama a delete-table ni a drop-column', async () => {
  const rutas = [];
  const client = { post: async (path) => rutas.push(path) };
  const plan = planSchema(
    [tabla({ rowsEstimated: 10 })],
    [{ table: 'tareas', columns: [{ name: 'otra', type: 'int', nullable: false }] }],
  );

  await applyPlan(client, plan);

  assert.ok(!rutas.some((r) => /delete|drop/.test(r)), `rutas usadas: ${rutas}`);
});

test('al crear una tabla se respeta lo obligatorio: nace vacía', () => {
  const plan = planSchema([], [
    {
      table: 'notas',
      columns: [
        { name: 'evaluacion_id', type: 'uuid', nullable: false },
        { name: 'observacion', type: 'text' },
      ],
    },
  ]);

  const cols = new Map(plan.safe[0].columns.map((c) => [c.name, c.nullable]));
  assert.equal(cols.get('evaluacion_id'), false);
  assert.equal(cols.get('observacion'), true);
});

test('las tablas internas de Roble se dejan fuera del plan enteras', () => {
  const plan = planSchema(
    [{ table: 'user_system', rowsEstimated: 3, columns: [{ name: 'email', type: 'text' }] }],
    [{ table: 'user_system', columns: [{ name: 'email', type: 'int' }] }],
  );

  // Ni un cambio de tipo ni nada: no es del proyecto.
  assert.equal(plan.safe.length, 0);
  assert.equal(plan.steps.length, 1);
  assert.equal(plan.steps[0].action, 'skip_table');
});

test('saved_queries ni siquiera aparece al leer el esquema', async () => {
  const client = {
    get: async (path) =>
      path === '/usage'
        ? { tables: [{ name: 'saved_queries' }, { name: 'tareas' }] }
        : { columns: [{ name: '_id', type: 'uuid', is_nullable: 'NO', is_primary: true }] },
  };
  const schema = await readSchema(client);
  assert.deepEqual(schema.map((t) => t.table), ['tareas']);
});
