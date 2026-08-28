import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

/**
 * `roble.schema.json`: la memoria del MCP entre sesiones.
 *
 * Guarda dos cosas, y hacen falta las dos:
 *
 * - `tables`: la forma que tenía el esquema la última vez. Distingue una
 *   columna que nunca creamos de una que sí.
 * - `removed`: lo que estuvo y dejó de estar. Sin esta lista la memoria dura
 *   un solo plan: `apply` reescribe el archivo desde el servidor, la columna
 *   borrada desaparece también del snapshot, y la vez siguiente vuelve a
 *   parecer una columna nueva que hay que crear. La protección se evaporaría
 *   sola justo después de haber funcionado una vez.
 *
 * El archivo lo mantiene la herramienta, no la persona, y vive en el
 * repositorio para que la siguiente sesión tenga la misma línea base. Para
 * revivir algo dado de baja se quita su entrada de `removed`: es una edición
 * pequeña y explícita, que es como debe sentirse deshacer una decisión.
 */

const FILE = 'roble.schema.json';
const VERSION = 2;

export function snapshotPath(cwd = process.cwd()) {
  return process.env.ROBLE_SCHEMA_FILE
    ? resolve(process.env.ROBLE_SCHEMA_FILE)
    : resolve(cwd, FILE);
}

/** `null` la primera vez, que es normal y no un error. */
export async function readSnapshot(path = snapshotPath()) {
  let raw;
  try {
    raw = await readFile(path, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return null;
    throw new Error(`No se pudo leer ${path}: ${err.message}`);
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Un archivo corrupto no bloquea el trabajo: se sigue sin memoria, que es
    // la situación de la primera vez.
    return null;
  }

  if (parsed?.version !== VERSION || !Array.isArray(parsed.tables)) return null;
  return { ...parsed, removed: parsed.removed ?? [] };
}

const shape = (schema) =>
  schema
    .map((t) => ({
      table: t.table,
      columns: t.columns
        .map((c) => ({ name: c.name, type: c.type, nullable: c.nullable }))
        .sort((a, b) => a.name.localeCompare(b.name)),
    }))
    .sort((a, b) => a.table.localeCompare(b.table));

/**
 * Calcula qué desapareció entre el snapshot anterior y el esquema de ahora, y
 * lo suma a las bajas que ya estaban registradas.
 */
function computeRemoved(previous, current) {
  const ahora = new Map(current.map((t) => [t.table, new Set(t.columns.map((c) => c.name))]));
  const at = new Date().toISOString();

  // Las bajas anteriores se conservan, salvo que el objeto haya vuelto: si
  // reaparece, dejó de estar dado de baja y estorbaría para siempre.
  const removed = (previous?.removed ?? []).filter((r) =>
    r.column ? !ahora.get(r.table)?.has(r.column) : !ahora.has(r.table),
  );

  const yaRegistrado = new Set(removed.map((r) => `${r.table}.${r.column ?? ''}`));

  for (const t of previous?.tables ?? []) {
    if (!ahora.has(t.table)) {
      if (!yaRegistrado.has(`${t.table}.`)) removed.push({ table: t.table, at });
      continue;
    }
    for (const c of t.columns ?? []) {
      if (ahora.get(t.table).has(c.name)) continue;
      if (yaRegistrado.has(`${t.table}.${c.name}`)) continue;
      removed.push({ table: t.table, column: c.name, at });
    }
  }

  return removed.sort((a, b) =>
    `${a.table}.${a.column ?? ''}`.localeCompare(`${b.table}.${b.column ?? ''}`),
  );
}

export async function writeSnapshot(schema, { contractId, previous = null, path = snapshotPath() } = {}) {
  const body = {
    version: VERSION,
    contractId,
    updatedAt: new Date().toISOString(),
    // Solo la forma, no los datos: nada de filas ni tamaños, que cambian solos
    // y llenarían el diff de git de ruido.
    tables: shape(schema),
    removed: computeRemoved(previous, schema),
  };

  await writeFile(path, JSON.stringify(body, null, 2) + '\n', 'utf8');
  return body;
}

/** La memoria en la forma en que el plan la consulta. */
export function indexSnapshot(snapshot) {
  const known = new Map();
  const removedColumns = new Set();
  const removedTables = new Set();

  for (const t of snapshot?.tables ?? []) {
    known.set(t.table, new Set((t.columns ?? []).map((c) => c.name)));
  }
  for (const r of snapshot?.removed ?? []) {
    if (r.column) removedColumns.add(`${r.table}.${r.column}`);
    else removedTables.add(r.table);
  }

  return { known, removedColumns, removedTables };
}
