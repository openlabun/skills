#!/usr/bin/env node
import { serve } from './rpc.mjs';
import { RobleAdminClient } from './client.mjs';
import { applyPlan, planSchema, readSchema } from './schema.mjs';
import { indexSnapshot, readSnapshot, snapshotPath, writeSnapshot } from './snapshot.mjs';
import { callHint, createQuery, listQueries } from './queries.mjs';
import { ENV_FILE, isGitIgnored, loadConfig } from './env.mjs';

const DESIRED_SCHEMA = {
  type: 'object',
  properties: {
    tables: {
      type: 'array',
      description: 'El esquema que la app necesita.',
      items: {
        type: 'object',
        properties: {
          table: { type: 'string' },
          columns: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                name: { type: 'string' },
                type: {
                  type: 'string',
                  description:
                    'Tipo de Postgres. Roble acepta: text, int, bigint, smallint, ' +
                    'numeric, real, double precision, date, timestamp, ' +
                    'timestamp with time zone, time, json, jsonb, boolean, uuid, ' +
                    'serial, varchar(n).',
                },
                nullable: {
                  type: 'boolean',
                  description: 'Por omisión true. No declares "_id": Roble la añade sola.',
                },
                primary: {
                  type: 'boolean',
                  description:
                    'Clave primaria. Por omisión false, y entonces Roble usa "_id". ' +
                    'Si marcas alguna, "_id" se sigue creando pero como UNIQUE NOT NULL ' +
                    'en vez de clave. Solo se puede declarar al crear la tabla.',
                },
              },
              required: ['name', 'type'],
            },
          },
        },
        required: ['table', 'columns'],
      },
    },
  },
  required: ['tables'],
};

const TOOLS = [
  {
    name: 'roble_schema_read',
    description:
      'Lee el esquema del proyecto: tablas, columnas, tipos y filas estimadas. ' +
      'Empieza siempre por aquí, antes de proponer cambios. ' +
      'Dos cosas al leerlo: "user_system" aparece pero es de la plataforma y no ' +
      'se puede modificar, y esta API no hace joins — para cualquier lectura ' +
      'que cruce tablas o agregue, usa roble_query_create en vez de resolverlo ' +
      'en la app.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'roble_queries_list',
    description:
      'Lista las consultas guardadas del proyecto, con su SQL y si están activas. ' +
      'Míralas antes de escribir lógica de lectura en la app: puede que la ' +
      'consulta que hace falta ya exista, y también antes de crear una nueva.',
    inputSchema: { type: 'object', properties: {} },
  },
  {
    name: 'roble_query_create',
    description:
      'Crea una consulta guardada, y es la opción por defecto para cualquier ' +
      'lectura que no sea "dame las filas de una tabla". ' +
      'PREFIÉRELA cuando la app necesite: cruzar dos o más tablas, agregar ' +
      '(COUNT, SUM, AVG, GROUP BY), ordenar o filtrar por algo que no sea ' +
      'igualdad simple, o paginar un resultado calculado. ' +
      'La API de lectura de Roble no hace joins, así que la alternativa es ' +
      'traerse cada tabla entera y cruzarlas en Dart o JavaScript: N+1 viajes, ' +
      'más código en la app y más datos por la red. Una consulta guardada lo ' +
      'resuelve en un viaje y dentro de Postgres. ' +
      'ADMITE PARÁMETROS: escribe $1, $2… en el SQL y la app los pasa como ' +
      'array, así que una sola consulta sirve para todos los casos que solo ' +
      'cambien en un valor. No crees una por cada id. ' +
      'Es además la forma correcta de exponer una lista de usuarios: ' +
      '"user_system" no se abre a las apps porque daría a cualquier usuario los ' +
      'datos de todos, y una consulta publica solo lo que sus filtros dejen pasar. ' +
      'El servidor exige que sea de solo lectura, al guardarla y en cada ' +
      'ejecución. Requiere token de escritura.',
    inputSchema: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description:
            'Con este nombre la llama la app. Elígelo estable: se ejecuta por ' +
            'nombre, no por id.',
        },
        description: { type: 'string', description: 'Para qué es, en una línea.' },
        query: {
          type: 'string',
          description:
            'SELECT con las columnas que se quieran publicar. Nombra las ' +
            'columnas en vez de usar SELECT *: publicar de más es el error ' +
            'caro aquí. Los parámetros van como $1, $2… y se pasan como array ' +
            'al ejecutar; no concatenes valores dentro del SQL.',
        },
      },
      required: ['name', 'query'],
    },
  },
  {
    name: 'roble_schema_plan',
    description:
      'Compara el esquema del proyecto con el que la app necesita y devuelve los ' +
      'pasos, separando los que se pueden aplicar solos de los que perderían datos. ' +
      'No modifica nada.',
    inputSchema: DESIRED_SCHEMA,
  },
  {
    name: 'roble_schema_apply',
    description:
      'Aplica los pasos aditivos del plan: crear tablas y añadir columnas opcionales. ' +
      'Nunca borra ni cambia tipos: eso lo informa para que lo decida una persona. ' +
      'Requiere un token con alcance de lectura y escritura.',
    inputSchema: DESIRED_SCHEMA,
  },
];

/**
 * Se avisa una vez por proceso: repetirlo en cada herramienta sería ruido, y
 * callarlo del todo dejaría un token vivo camino del repositorio.
 */
let avisadoDelGitignore = false;

function avisoDeSeguridad(cfg) {
  if (avisadoDelGitignore || !cfg.envFile) return null;
  avisadoDelGitignore = true;
  if (isGitIgnored(cfg.envFile)) return null;

  return (
    `Aviso: ${cfg.envFile} no está en .gitignore y lleva tu token dentro. ` +
    `Añade "${ENV_FILE}" al .gitignore antes de commitear.`
  );
}

function describePlan(plan) {
  // Los avisos se dan aunque no haya nada que hacer: un tipo que no cruza es
  // exactamente el caso en que el esquema «ya coincide» y aun así está mal.
  const avisos = plan.warnings?.length
    ? 'Avisos, no bloquean nada:\n' + plan.warnings.map((w) => `  ~ ${w.message}`).join('\n')
    : '';

  if (plan.steps.length === 0) {
    const ok = 'El esquema ya coincide con lo que la app necesita.';
    return avisos ? `${ok}\n\n${avisos}` : ok;
  }

  const line = (s) => {
    if (s.action === 'create_table') {
      const cols = s.columns
        .map((c) => `${c.name} ${c.type}${c.primary ? ' PK' : ''}`)
        .join(', ');
      const clave = s.columns.some((c) => c.primary) ? '' : ', clave: _id';
      return `CREAR TABLA ${s.table} (${cols})${clave}`;
    }
    if (s.action === 'add_column') {
      return `AÑADIR ${s.table}.${s.column.name} ${s.column.type}${s.column.nullable ? '' : ' NOT NULL'}`;
    }
    if (s.action === 'change_column_type') {
      return `CAMBIAR TIPO ${s.table}.${s.column}: ${s.from} → ${s.to}`;
    }
    if (s.action === 'skip_table') return `OMITIDA ${s.table}`;
    if (s.action === 'change_primary_key') return `CAMBIAR CLAVE ${s.table}.${s.column}`;
    return `QUITAR COLUMNA ${s.table}.${s.column}`;
  };

  const parts = [];
  if (avisos) parts.push(avisos);
  if (plan.safe.length) {
    parts.push(
      'Se aplican solos:\n' + plan.safe.map((s) => `  + ${line(s)}\n    ${s.reason}`).join('\n'),
    );
  }
  if (plan.unsafe.length) {
    parts.push(
      'Requieren decisión humana, no se aplican:\n' +
        plan.unsafe.map((s) => `  ! ${line(s)}\n    ${s.reason}`).join('\n'),
    );
  }
  return parts.join('\n\n');
}

async function callTool(name, args) {
  // Se lee por llamada, y no al arrancar, para que un token mal puesto salga
  // como un error legible en la herramienta y no como un proceso que muere
  // antes de que el editor llegue a hablar con él. Además recoge un cambio en
  // el archivo sin reiniciar el editor.
  const cfg = loadConfig();
  const client = new RobleAdminClient(cfg);
  const aviso = avisoDeSeguridad(cfg);
  const conAviso = (texto) => (aviso ? `${texto}\n\n${aviso}` : texto);
  const rutaSnapshot = snapshotPath(cfg);

  if (name === 'roble_queries_list') {
    const queries = await listQueries(client);
    if (queries.length === 0) {
      return {
        content: [
          {
            type: 'text',
            text:
              'Este proyecto no tiene consultas guardadas.\n\n' +
              'Si una app necesita la lista de usuarios, este es el camino: ' +
              '"user_system" no se expone a las apps, y una consulta guardada ' +
              'publica solo lo que sus filtros dejen pasar. Créala con ' +
              'roble_query_create.',
          },
        ],
      };
    }
    return { content: [{ type: 'text', text: JSON.stringify(queries, null, 2) }] };
  }

  if (name === 'roble_query_create') {
    if (!args?.name?.trim() || !args?.query?.trim()) {
      throw new Error('Hacen falta "name" y "query".');
    }
    await createQuery(client, args);
    return {
      content: [
        {
          type: 'text',
          text: `Consulta "${args.name}" guardada.\n\n${callHint(args.name.trim(), args.query)}`,
        },
      ],
    };
  }

  if (name === 'roble_schema_read') {
    const schema = await readSchema(client);
    return { content: [{ type: 'text', text: conAviso(JSON.stringify(schema, null, 2)) }] };
  }

  if (name === 'roble_schema_plan' || name === 'roble_schema_apply') {
    const actual = await readSchema(client);
    const snapshot = await readSnapshot(rutaSnapshot);
    const plan = planSchema(actual, args?.tables ?? [], indexSnapshot(snapshot));

    if (name === 'roble_schema_plan') {
      const memoria = snapshot
        ? `Comparado contra ${rutaSnapshot}, del ${snapshot.updatedAt}.`
        : `Sin ${rutaSnapshot}: primera vez, así que el plan no tiene memoria de ` +
          'lo aplicado antes. Se crea al primer apply.';
      return { content: [{ type: 'text', text: conAviso(`${describePlan(plan)}\n\n${memoria}`) }] };
    }

    const result = await applyPlan(client, plan);
    const parts = [];

    if (result.applied.length) {
      parts.push(
        `Aplicados ${result.applied.length}:\n` +
          result.applied.map((s) => `  + ${s.action} ${s.table}`).join('\n'),
      );
    } else if (plan.safe.length === 0) {
      // Distinto de "todo lo aditivo falló", que es lo que pasa con un token de
      // solo lectura y merece un mensaje que no diga lo contrario.
      parts.push('No había nada aditivo que aplicar.');
    }

    if (result.failed.length) {
      parts.push(
        'Fallaron:\n' +
          result.failed.map((f) => `  x ${f.step.action} ${f.step.table}: ${f.error}`).join('\n'),
      );
    }
    if (result.skipped.length) {
      parts.push(
        'Sin aplicar, requieren decisión humana:\n' +
          result.skipped.map((s) => `  ! ${s.reason}`).join('\n'),
      );
    }

    // El snapshot se escribe desde el esquema releído del servidor, no desde lo
    // que se pidió: si un paso falló a medias, la memoria refleja lo que hay de
    // verdad y no lo que se pretendía.
    try {
      const despues = await readSchema(client);
      // `previous` es lo que hace que una baja se recuerde: sin él, el archivo
      // volvería a espejar el servidor y la memoria duraría un solo plan.
      await writeSnapshot(despues, {
        contractId: client.contractId,
        previous: snapshot,
        path: rutaSnapshot,
      });
      parts.push(`Snapshot actualizado: ${rutaSnapshot}`);
    } catch (err) {
      parts.push(
        `Aviso: los cambios se aplicaron pero no se pudo escribir el snapshot ` +
          `(${err.message}). El próximo plan no tendrá memoria de esto.`,
      );
    }

    return { content: [{ type: 'text', text: conAviso(parts.join('\n\n')) }] };
  }

  throw new Error(`Herramienta desconocida: ${name}`);
}

serve({ name: 'roble-mcp', version: '0.1.0', tools: TOOLS, callTool });
