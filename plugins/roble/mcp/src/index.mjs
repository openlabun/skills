#!/usr/bin/env node
import { serve } from './rpc.mjs';
import { RobleAdminClient } from './client.mjs';
import { applyPlan, planSchema, readSchema } from './schema.mjs';
import { indexSnapshot, readSnapshot, snapshotPath, writeSnapshot } from './snapshot.mjs';
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
      'Empieza siempre por aquí, antes de proponer cambios.',
    inputSchema: { type: 'object', properties: {} },
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
  if (plan.steps.length === 0) return 'El esquema ya coincide con lo que la app necesita.';

  const line = (s) => {
    if (s.action === 'create_table') {
      const cols = s.columns.map((c) => `${c.name} ${c.type}`).join(', ');
      return `CREAR TABLA ${s.table} (${cols})`;
    }
    if (s.action === 'add_column') {
      return `AÑADIR ${s.table}.${s.column.name} ${s.column.type}${s.column.nullable ? '' : ' NOT NULL'}`;
    }
    if (s.action === 'change_column_type') {
      return `CAMBIAR TIPO ${s.table}.${s.column}: ${s.from} → ${s.to}`;
    }
    if (s.action === 'skip_table') return `OMITIDA ${s.table}`;
    return `QUITAR COLUMNA ${s.table}.${s.column}`;
  };

  const parts = [];
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
