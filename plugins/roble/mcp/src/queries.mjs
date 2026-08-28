/**
 * Consultas guardadas: el camino por el que una app lee lo que su rol no
 * puede leer directo.
 *
 * El caso que lo motiva es la lista de usuarios. `user_system` no se expone a
 * las apps a propósito —daría a cualquier usuario los datos de todos—, así que
 * la vía es que el dueño del proyecto guarde una consulta con los filtros y
 * las columnas que sí quiere publicar, y la app la llame por su nombre.
 *
 * Es seguro por construcción y no por disciplina: el servidor valida que la
 * consulta sea de solo lectura dos veces, al guardarla y otra vez cada vez que
 * se ejecuta. Una consulta guardada no puede escribir aunque alguien edite la
 * fila después.
 */

/** Lo que la consola muestra de una consulta. */
function view(row) {
  return {
    id: row.id,
    name: row.name,
    description: row.description ?? null,
    query: row.query,
    // Desactivada no se puede ejecutar: el servidor la rechaza por nombre y
    // por id, así que es el interruptor para retirarla sin borrarla.
    isActive: row.is_active ?? row.isActive ?? true,
  };
}

export async function listQueries(client) {
  const res = await client.get('/saved-queries');
  const rows = Array.isArray(res) ? res : (res?.savedQueries ?? res?.data ?? []);
  return rows.map(view);
}

export async function createQuery(client, { name, description, query }) {
  const res = await client.post('/saved-queries', {
    name: name.trim(),
    description: description?.trim() || undefined,
    query: query.trim(),
  });
  return res?.id ? view(res) : res;
}

/**
 * Cuántos parámetros distintos usa la consulta.
 *
 * Se cuentan los `$N` para poder mostrar la llamada con su aridad real: un
 * ejemplo con `[]` cuando la consulta pide dos parámetros invita a llamarla
 * mal, y el error sale en tiempo de ejecución.
 */
export function paramCount(query) {
  const encontrados = new Set(
    [...String(query ?? '').matchAll(/\$(\d+)/g)].map((m) => Number(m[1])),
  );
  return encontrados.size === 0 ? 0 : Math.max(...encontrados);
}

/**
 * Cómo se llama desde la app, para poder decírselo a quien la escribe.
 *
 * Se ejecuta **por nombre** y no por id: el id cambia si la consulta se
 * recrea, el nombre lo elige el dueño y se mantiene.
 */
export function callHint(name, query = '') {
  const n = paramCount(query);
  const args = Array.from({ length: n }, (_, i) => `valor${i + 1}`);
  const lista = `[${args.join(', ')}]`;

  const lines = [
    'Desde la app, por nombre:',
    '',
    '  // JavaScript / TypeScript (roble-client)',
    `  const filas = await db.executeQueryByName('${name}', ${lista});`,
    '',
    '  // Flutter (roble)',
    `  final filas = await db.executeQueryByName('${name}', ${lista});`,
  ];

  if (n > 0) {
    lines.push(
      '',
      `Pide ${n} parámetro${n > 1 ? 's' : ''}, en el orden de $1..$${n}. Van en el ` +
        'array, nunca concatenados dentro del SQL: es lo que evita la inyección ' +
        'y lo que deja que el plan de la consulta se reutilice.',
    );
  } else {
    lines.push(
      '',
      'No lleva parámetros. Si la app va a filtrar por algo que cambia —un id, ' +
        'una fecha, un rango—, rehazla con $1, $2… antes que traerse todo y ' +
        'filtrar en el cliente. Nunca concatenes ese valor dentro del SQL: ' +
        'el aviso vale igual aquí, que es donde más tienta hacerlo.',
    );
  }

  return lines.join('\n');
}
