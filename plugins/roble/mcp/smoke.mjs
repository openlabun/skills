#!/usr/bin/env node
/**
 * Verifica el servidor MCP contra un Roble de verdad, hablando por stdio como
 * lo haría el editor.
 *
 * Crea una tabla desechable y la borra al terminar, incluso si algo falla en
 * medio, para no dejar rastro en el proyecto.
 *
 *   ROBLE_BASE_URL=... ROBLE_CONTRACT_ID=... ROBLE_TOKEN=... node smoke.mjs
 */
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const TABLA = `zz_smoke_${Date.now().toString(36)}`;

const env = {
  ROBLE_BASE_URL: process.env.ROBLE_BASE_URL,
  ROBLE_CONTRACT_ID: process.env.ROBLE_CONTRACT_ID,
  ROBLE_TOKEN: process.env.ROBLE_TOKEN,
};

for (const [k, v] of Object.entries(env)) {
  if (!v) {
    console.error(`Falta ${k}. Uso:\n  ROBLE_BASE_URL=... ROBLE_CONTRACT_ID=... ROBLE_TOKEN=... node smoke.mjs`);
    process.exit(2);
  }
}

let fallos = 0;
const ok = (msg) => console.log(`  ok  ${msg}`);
const fail = (msg, extra) => {
  fallos++;
  console.error(`  FALLO  ${msg}${extra ? `\n         ${extra}` : ''}`);
};

const texto = (res) => res.content.map((c) => c.text).join('\n');

const client = new Client({ name: 'roble-mcp-smoke', version: '0.1.0' }, { capabilities: {} });
const transport = new StdioClientTransport({
  command: process.execPath,
  args: [join(here, 'src', 'index.mjs')],
  env: { ...process.env, ...env },
});

await client.connect(transport);

async function limpiar() {
  // Por la API de administración directamente: el MCP no borra tablas a
  // propósito, que es justo lo que se está comprobando.
  try {
    await fetch(`${env.ROBLE_BASE_URL}/database/${env.ROBLE_CONTRACT_ID}/delete-table/${TABLA}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${env.ROBLE_TOKEN}` },
    });
  } catch {
    console.error(`  aviso  no se pudo borrar ${TABLA}; bórrala a mano`);
  }
}

try {
  console.log('\n1. El servidor anuncia sus herramientas');
  const { tools } = await client.listTools();
  const nombres = tools.map((t) => t.name).sort();
  if (nombres.join() === 'roble_schema_apply,roble_schema_plan,roble_schema_read') {
    ok(`3 herramientas: ${nombres.join(', ')}`);
  } else {
    fail('herramientas inesperadas', nombres.join(', '));
  }

  console.log('\n2. Lee el esquema del proyecto real');
  const leido = await client.callTool({ name: 'roble_schema_read', arguments: {} });
  if (leido.isError) {
    fail('no pudo leer', texto(leido));
    throw new Error('sin esquema no tiene sentido seguir');
  }
  const esquema = JSON.parse(texto(leido));
  ok(`${esquema.length} tablas, p.ej. ${esquema.slice(0, 3).map((t) => t.table).join(', ') || '(ninguna)'}`);
  if (esquema.length && !esquema[0].columns.some((c) => c.name === '_id')) {
    fail('la primera tabla no trae _id, que Roble siempre añade');
  } else if (esquema.length) {
    ok('las columnas llegan con _id incluido');
  }

  console.log('\n3. Planea sin tocar nada');
  const deseado = {
    tables: [
      {
        table: TABLA,
        columns: [
          { name: 'titulo', type: 'text' },
          { name: 'prioridad', type: 'int' },
        ],
      },
    ],
  };
  const plan = await client.callTool({ name: 'roble_schema_plan', arguments: deseado });
  if (/CREAR TABLA/.test(texto(plan))) ok('propone crear la tabla que falta');
  else fail('no propuso crear la tabla', texto(plan));

  const trasPlan = JSON.parse(
    texto(await client.callTool({ name: 'roble_schema_read', arguments: {} })),
  );
  if (trasPlan.length === esquema.length) ok('planear no creó nada');
  else fail('planear modificó el proyecto');

  console.log('\n4. Aplica lo aditivo');
  const aplicado = await client.callTool({ name: 'roble_schema_apply', arguments: deseado });
  if (aplicado.isError) fail('apply devolvió error', texto(aplicado));
  else ok(texto(aplicado).split('\n')[0]);

  const conTabla = JSON.parse(
    texto(await client.callTool({ name: 'roble_schema_read', arguments: {} })),
  );
  const creada = conTabla.find((t) => t.table === TABLA);
  if (!creada) fail(`la tabla ${TABLA} no aparece tras aplicar`);
  else {
    ok(`${TABLA} existe con columnas: ${creada.columns.map((c) => c.name).join(', ')}`);
    const tipos = new Map(creada.columns.map((c) => [c.name, c.type]));
    if (tipos.get('prioridad') === 'int') ok('int se guardó como int, no como otra cosa');
    else fail(`prioridad quedó como ${tipos.get('prioridad')}`);
  }

  console.log('\n5. Volver a aplicar lo mismo no propone nada');
  const repetido = await client.callTool({ name: 'roble_schema_plan', arguments: deseado });
  if (/ya coincide/.test(texto(repetido))) ok('el plan queda vacío: es idempotente');
  else fail('propuso cambios sobre un esquema que ya coincide', texto(repetido));

  console.log('\n6. Lo destructivo se informa y NO se aplica');
  const recortado = {
    tables: [{ table: TABLA, columns: [{ name: 'titulo', type: 'text' }] }],
  };
  const planCorte = await client.callTool({ name: 'roble_schema_plan', arguments: recortado });
  if (/QUITAR COLUMNA .*prioridad/.test(texto(planCorte))) ok('detecta la columna que sobra');
  else fail('no detectó la columna sobrante', texto(planCorte));

  await client.callTool({ name: 'roble_schema_apply', arguments: recortado });
  const trasCorte = JSON.parse(
    texto(await client.callTool({ name: 'roble_schema_read', arguments: {} })),
  );
  const sigue = trasCorte
    .find((t) => t.table === TABLA)
    ?.columns.some((c) => c.name === 'prioridad');
  if (sigue) ok('apply NO borró la columna: sigue ahí');
  else fail('apply borró una columna, que es justo lo que no debe hacer');

  console.log('\n7. Un cambio de tipo tampoco se aplica solo');
  const cambio = {
    tables: [{ table: TABLA, columns: [{ name: 'titulo', type: 'int' }] }],
  };
  const planTipo = await client.callTool({ name: 'roble_schema_plan', arguments: cambio });
  if (/CAMBIAR TIPO/.test(texto(planTipo))) ok('detecta el cambio de tipo');
  else fail('no detectó el cambio de tipo', texto(planTipo));

  await client.callTool({ name: 'roble_schema_apply', arguments: cambio });
  const trasTipo = JSON.parse(
    texto(await client.callTool({ name: 'roble_schema_read', arguments: {} })),
  );
  const tipoTitulo = trasTipo
    .find((t) => t.table === TABLA)
    ?.columns.find((c) => c.name === 'titulo')?.type;
  if (tipoTitulo === 'text') ok('titulo sigue siendo text');
  else fail(`titulo cambió a ${tipoTitulo}`);
} finally {
  console.log('\nLimpiando...');
  await limpiar();
  await client.close();
}

console.log(fallos === 0 ? '\nTodo bien.\n' : `\n${fallos} fallo(s).\n`);
process.exit(fallos === 0 ? 0 : 1);
