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

/**
 * Candidatos de tabla para una columna `<algo>_id`.
 *
 * Roble no tiene claves foráneas —`create-table` no acepta `references`—, así
 * que la relación es pura convención de nombres. Esto la adivina para poder
 * avisar de un tipo que no cuadra; nunca para bloquear nada.
 */
function fkCandidates(column) {
  const m = /^(.+?)_id$/.exec(column);
  if (!m) return [];

  const base = m[1];
  const out = new Set([base]);
  if (/[aeiou]$/.test(base)) out.add(`${base}s`);
  else if (/z$/.test(base)) out.add(`${base.slice(0, -1)}ces`);
  else out.add(`${base}es`);
  return [...out];
}

/** El tipo del `_id` de una tabla, o `null` si no se conoce. */
function idType(table) {
  return table?.columns?.find((c) => c.name === '_id')?.type ?? null;
}

/**
 * Tablas que son de Roble, no del proyecto.
 *
 * `saved_queries` guarda las consultas guardadas de la consola, que la esconde
 * de su propia lista de tablas. `user_system` es el espejo de las cuentas: una
 * app la lee, pero su forma la manda el servicio de autenticación.
 *
 * Sin esto, un agente que convierta la lectura del esquema en «lo que la app
 * necesita» propone reestructurarlas —siete pasos destructivos sobre
 * `saved_queries` en la primera prueba contra un proyecto real—. Ninguno se
 * aplicaría, porque son destructivos, pero ensucian el plan y llevan a
 * conclusiones equivocadas.
 */
const INTERNAL_TABLES = new Set(['saved_queries', 'user_system']);

export function isInternalTable(name) {
  return INTERNAL_TABLES.has(name);
}

/** La consola tampoco la lista; leerla solo invita a tocarla. */
const HIDDEN_TABLES = new Set(['saved_queries']);

export async function readSchema(client) {
  const usage = await client.get('/usage');
  const tables = usage?.tables ?? [];

  const result = [];
  for (const table of tables) {
    const name = table.name ?? table.tableName;
    if (!name || HIDDEN_TABLES.has(name)) continue;

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
const SIN_MEMORIA = { known: new Map(), removedColumns: new Set(), removedTables: new Set() };

export function planSchema(actual, desired, memory = SIN_MEMORIA) {
  const { known, removedColumns, removedTables } = { ...SIN_MEMORIA, ...memory };
  const byTable = new Map(actual.map((t) => [t.table, t]));
  const steps = [];

  for (const want of desired) {
    if (isInternalTable(want.table)) {
      steps.push({
        action: 'skip_table',
        table: want.table,
        safe: false,
        reason:
          `"${want.table}" es una tabla interna de Roble, no del proyecto: su forma ` +
          'la gobierna la plataforma. Se deja fuera del plan entera.',
      });
      continue;
    }

    const have = byTable.get(want.table);
    const columns = (want.columns ?? []).filter((c) => !RESERVED.has(c.name));

    if (!have) {
      // Dos fuentes, y hacen falta las dos. `known` la detecta en el momento:
      // el snapshot la tenía viva y el servidor ya no. `removedTables` la
      // mantiene detectada después, cuando el siguiente apply reescriba el
      // archivo y deje de aparecer entre las vivas.
      const laBorraron = removedTables.has(want.table) || known.has(want.table);

      steps.push({
        action: 'create_table',
        table: want.table,
        safe: !laBorraron,
        reason: laBorraron
          ? `"${want.table}" figura como dada de baja en roble.schema.json: se ` +
            'borró después de crearla. Si de verdad la quieres de vuelta, quita ' +
            'su entrada de la lista "removed" y vuelve a aplicar.'
          : 'La tabla no existe. Crearla no toca datos de nadie.',
        columns: columns.map((c) => ({
          name: c.name,
          type: c.type,
          // Aquí sí se respeta `nullable: false`: la tabla nace vacía, así que
          // no hay filas existentes a las que exigirles un valor que no tienen.
          // Es el mismo criterio que en `add_column`, donde la obligatoriedad
          // solo es segura si la tabla está vacía.
          nullable: c.nullable !== false,
          // Sin ninguna marcada, el servidor hace `_id` la clave primaria. Con
          // alguna, `_id` sigue existiendo como UNIQUE NOT NULL y la clave es
          // la declarada. Ese reparto lo decide el servidor; aquí solo se le
          // pasa la intención en vez de mandar siempre `false`, que dejaba la
          // opción inalcanzable desde el MCP.
          primary: c.primary === true,
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
        // Igual que con las tablas: `known` la caza en caliente y
        // `removedColumns` conserva la constancia después de reescribir.
        const laBorraron =
          removedColumns.has(`${want.table}.${col.name}`) ||
          (known.get(want.table)?.has(col.name) ?? false);

        let safe = !(wantsRequired && hasRows);
        let reason =
          wantsRequired && hasRows
            ? `"${col.name}" se pide obligatoria y "${want.table}" ya tiene filas: ` +
              'las existentes no tendrían valor. Créala opcional, rellénala y ' +
              'luego hazla obligatoria.'
            : 'La columna no existe. Añadirla admitiendo nulos no toca las filas que ya están.';

        // La clave primaria se fija al crear la tabla. Añadir una columna
        // pidiéndola primaria sobre una tabla que ya tiene su `_id` de clave
        // es cambiar la clave, no añadir una columna.
        if (col.primary === true) {
          safe = false;
          reason =
            `"${col.name}" se pide como clave primaria, y "${want.table}" ya existe. ` +
            'La clave se fija al crear la tabla: cambiarla después reescribe la ' +
            'tabla entera. Declárala al crearla, o hazlo desde la consola.';
        }

        if (laBorraron) {
          safe = false;
          reason =
            `"${want.table}.${col.name}" figura como dada de baja en ` +
            'roble.schema.json: se borró después de crearla. Volver a añadirla ' +
            'desharía esa decisión; si la quieres de vuelta, quita su entrada de ' +
            'la lista "removed" y vuelve a aplicar.';
        }

        steps.push({
          action: 'add_column',
          table: want.table,
          column: { name: col.name, type: col.type, nullable: !wantsRequired },
          safe,
          reason,
        });
        continue;
      }

      if (col.primary === true && !existing.isPrimary) {
        steps.push({
          action: 'change_primary_key',
          table: want.table,
          column: col.name,
          safe: false,
          reason:
            `"${want.table}.${col.name}" se pide como clave primaria y no lo es. ` +
            'Cambiar la clave de una tabla con datos es una migración, no un ' +
            'ajuste: se hace a mano y sabiendo lo que hay dentro.',
        });
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

      const laPusimosNosotros = known.get(want.table)?.has(existing.name) ?? false;

      steps.push({
        action: 'drop_column',
        table: want.table,
        column: existing.name,
        safe: false,
        reason: laPusimosNosotros
          ? `"${want.table}.${existing.name}" la aplicamos antes y el esquema nuevo ` +
            'ya no la pide: parece que la app dejó de usarla. Aun así no se borra ' +
            'sola, porque sus datos se van con ella.'
          : `"${want.table}.${existing.name}" está en la base y no en lo pedido, y no ` +
            'la creamos nosotros: puede venir de la consola o de otra herramienta. ' +
            'No se toca.',
      });
    }
  }

  return {
    steps,
    safe: steps.filter((s) => s.safe),
    unsafe: steps.filter((s) => !s.safe),
    warnings: fkWarnings(actual, desired),
  };
}

/**
 * Columnas `<algo>_id` cuyo tipo no cuadra con el `_id` de la tabla a la que
 * su nombre apunta.
 *
 * Es un aviso y no un paso: la convención de nombres es del proyecto, no de la
 * plataforma, y acertar al adivinar la tabla no está garantizado. Solo se avisa
 * cuando la tabla existe y el tipo difiere, que es cuando la comparación va a
 * fallar de verdad al consultar.
 */
export function fkWarnings(actual, desired) {
  const conocidas = new Map(actual.map((t) => [t.table, t]));
  // Las que el propio plan va a crear cuentan: su `_id` será uuid.
  for (const d of desired) if (!conocidas.has(d.table)) conocidas.set(d.table, null);

  const out = [];
  for (const want of desired) {
    if (isInternalTable(want.table)) continue;

    for (const col of want.columns ?? []) {
      const destinos = fkCandidates(col.name).filter((n) => conocidas.has(n) && n !== want.table);
      // Sin destino, o con más de uno, no hay nada que afirmar sin inventar.
      if (destinos.length !== 1) continue;

      const destino = destinos[0];
      // Una tabla que el plan aún no ha creado tendrá `_id uuid`.
      const tipoDestino = idType(conocidas.get(destino)) ?? 'uuid';
      if (normalizeType(col.type) === normalizeType(tipoDestino)) continue;

      out.push({
        table: want.table,
        column: col.name,
        references: destino,
        expected: normalizeType(tipoDestino),
        found: normalizeType(col.type),
        message:
          `"${want.table}.${col.name}" parece apuntar a "${destino}._id", que es ` +
          `${normalizeType(tipoDestino)}, pero se declara ${normalizeType(col.type)}. ` +
          'Roble no tiene claves foráneas, así que nadie lo va a impedir: ' +
          'simplemente no van a cruzar al consultar.',
      });
    }
  }
  return out;
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
            isPrimary: c.primary === true,
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
      failed.push({ step, error: err.message, needsWriteToken: err.needsWriteToken === true });
    }
  }

  return { applied, failed, skipped: plan.unsafe };
}
