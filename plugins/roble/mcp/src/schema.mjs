/**
 * Leer el esquema de un proyecto y compararlo con el que la app necesita.
 *
 * La regla que gobierna todo el módulo: **aditivo se aplica, destructivo se
 * propone**. Crear una tabla o añadir una columna que admite nulos no puede
 * perder datos; cambiar un tipo, quitar una columna o exigir NOT NULL sobre
 * una tabla con filas, sí. Lo segundo se describe y se deja para que lo
 * decida una persona.
 */

/** Tipos que `db-service` acepta, con sus sinónimos de Postgres. */
const TYPE_ALIASES = new Map([
  ['integer', 'int'],
  ['int4', 'int'],
  ['int8', 'bigint'],
  ['int2', 'smallint'],
  ['character varying', 'varchar'],
  ['double precision', 'double precision'],
  ['timestamp without time zone', 'timestamp'],
  ['timestamp with time zone', 'timestamp with time zone'],
  ['timestamptz', 'timestamp with time zone'],
  ['bool', 'boolean'],
  ['float8', 'double precision'],
  ['float4', 'real'],
]);

/**
 * Deja un tipo en su forma comparable.
 *
 * Postgres devuelve `integer` donde el estudiante escribió `int`, y
 * `character varying` donde escribió `varchar(50)`. Sin esto, cada lectura
 * parecería un cambio de tipo pendiente.
 */
export function normalizeType(type) {
  const lower = String(type ?? '').toLowerCase().trim();
  const withoutLength = lower.replace(/\(\s*\d+(\s*,\s*\d+)?\s*\)/, '');
  return TYPE_ALIASES.get(withoutLength) ?? withoutLength;
}

/** La columna que Roble añade sola; nunca se declara ni se toca. */
const RESERVED = new Set(['_id']);

export async function readSchema(client) {
  const usage = await client.get('/usage');
  const tables = usage?.tables ?? [];

  const result = [];
  for (const table of tables) {
    const name = table.name ?? table.tableName;
    if (!name) continue;

    const res = await client.get(`/columns?table=${encodeURIComponent(name)}`);
    result.push({
      table: name,
      description: table.description ?? null,
      rowsEstimated: table.rowsEstimated ?? 0,
      columns: (res?.columns ?? []).map((c) => ({
        name: c.name,
        type: normalizeType(c.type),
        nullable: c.is_nullable === 'YES' || c.is_nullable === true,
        isPrimary: Boolean(c.is_primary),
      })),
    });
  }
  return result;
}

/**
 * Qué habría que hacerle al proyecto para que encaje con `desired`.
 *
 * No toca nada: devuelve los pasos, cada uno marcado `safe` o no, y por qué.
 */
export function planSchema(actual, desired) {
  const byTable = new Map(actual.map((t) => [t.table, t]));
  const steps = [];

  for (const want of desired) {
    const have = byTable.get(want.table);
    const columns = (want.columns ?? []).filter((c) => !RESERVED.has(c.name));

    if (!have) {
      steps.push({
        action: 'create_table',
        table: want.table,
        safe: true,
        reason: 'La tabla no existe. Crearla no toca datos de nadie.',
        columns: columns.map((c) => ({
          name: c.name,
          type: c.type,
          // Se crean admitiendo nulos aunque se pidan obligatorias: una tabla
          // recién creada está vacía, pero mantener la misma regla en todos
          // los caminos evita que el plan dependa de si la tabla ya existía.
          nullable: c.nullable !== false,
        })),
      });
      continue;
    }

    const haveColumns = new Map(have.columns.map((c) => [c.name, c]));

    for (const col of columns) {
      const existing = haveColumns.get(col.name);

      if (!existing) {
        const wantsRequired = col.nullable === false;
        const hasRows = (have.rowsEstimated ?? 0) > 0;

        steps.push({
          action: 'add_column',
          table: want.table,
          column: { name: col.name, type: col.type, nullable: !wantsRequired },
          // Añadir NOT NULL a una tabla con filas falla o rellena basura: las
          // filas que ya están no tienen valor para la columna nueva.
          safe: !(wantsRequired && hasRows),
          reason:
            wantsRequired && hasRows
              ? `"${col.name}" se pide obligatoria y "${want.table}" ya tiene filas: ` +
                'las existentes no tendrían valor. Créala opcional, rellénala y ' +
                'luego hazla obligatoria.'
              : 'La columna no existe. Añadirla admitiendo nulos no toca las filas que ya están.',
        });
        continue;
      }

      if (normalizeType(existing.type) !== normalizeType(col.type)) {
        steps.push({
          action: 'change_column_type',
          table: want.table,
          column: col.name,
          from: existing.type,
          to: normalizeType(col.type),
          safe: false,
          reason:
            `"${want.table}.${col.name}" es ${existing.type} y se pide ` +
            `${normalizeType(col.type)}. Convertir puede fallar o truncar lo que ya hay.`,
        });
      }
    }

    for (const existing of have.columns) {
      if (RESERVED.has(existing.name)) continue;
      if (columns.some((c) => c.name === existing.name)) continue;

      steps.push({
        action: 'drop_column',
        table: want.table,
        column: existing.name,
        safe: false,
        reason:
          `"${want.table}.${existing.name}" está en la base y no en lo pedido. ` +
          'Puede ser una columna que sobra o una que el esquema pedido olvidó: ' +
          'borrarla pierde sus datos, así que se deja como está.',
      });
    }
  }

  return {
    steps,
    safe: steps.filter((s) => s.safe),
    unsafe: steps.filter((s) => !s.safe),
  };
}

/** Aplica únicamente los pasos seguros. Los demás se devuelven sin tocar. */
export async function applyPlan(client, plan) {
  const applied = [];
  const failed = [];

  for (const step of plan.safe) {
    try {
      if (step.action === 'create_table') {
        await client.post('/create-table', {
          tableName: step.table,
          description: null,
          columns: step.columns.map((c) => ({
            name: c.name,
            type: c.type,
            isNullable: c.nullable,
            isPrimary: false,
          })),
        });
      } else if (step.action === 'add_column') {
        await client.post('/add-column', {
          tableName: step.table,
          column: {
            name: step.column.name,
            type: step.column.type,
            isNullable: step.column.nullable,
            isPrimary: false,
          },
        });
      } else {
        throw new Error(`Paso seguro no reconocido: ${step.action}`);
      }
      applied.push(step);
    } catch (err) {
      // No se corta: un paso que falla no debe impedir los que no dependen de
      // él, y el informe dice exactamente cuál quedó a medias.
      failed.push({ step, error: err.message });
    }
  }

  return { applied, failed, skipped: plan.unsafe };
}
