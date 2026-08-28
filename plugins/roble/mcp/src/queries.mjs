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
 * Cómo se llama desde la app, para poder decírselo a quien la escribe.
 *
 * Se ejecuta **por nombre** y no por id: el id cambia si la consulta se
 * recrea, el nombre lo elige el dueño y se mantiene.
 */
export function callHint(name) {
  return [
    'Desde la app:',
    '',
    `  // JavaScript / TypeScript (roble-client)`,
    `  const usuarios = await db.executeQueryByName('${name}', []);`,
    '',
    `  // Flutter (roble)`,
    `  final usuarios = await db.executeQueryByName('${name}', []);`,
    '',
    'Los parámetros van como $1, $2… en el SQL y como array en la llamada.',
    'Nunca concatenes valores dentro del SQL: para eso están.',
  ].join('\n');
}
