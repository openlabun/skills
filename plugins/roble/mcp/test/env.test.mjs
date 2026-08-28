import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseEnv, findEnvFile, loadConfig, ENV_FILE } from '../src/env.mjs';

const dir = () => mkdtemp(join(tmpdir(), 'roble-env-'));

test('parsea lo básico', () => {
  const r = parseEnv('ROBLE_BASE_URL=https://x.co\nROBLE_TOKEN=roble_pat_abc\n');
  assert.equal(r.ROBLE_BASE_URL, 'https://x.co');
  assert.equal(r.ROBLE_TOKEN, 'roble_pat_abc');
});

test('tolera export y comillas, que es como se pega desde el shell', () => {
  const r = parseEnv(`export ROBLE_TOKEN="roble_pat_abc"\nexport ROBLE_CONTRACT_ID='proy_1'\n`);
  assert.equal(r.ROBLE_TOKEN, 'roble_pat_abc');
  assert.equal(r.ROBLE_CONTRACT_ID, 'proy_1');
});

test('ignora comentarios y líneas vacías', () => {
  const r = parseEnv('# un comentario\n\nROBLE_TOKEN=abc # al final\nsin_igual\n');
  assert.equal(r.ROBLE_TOKEN, 'abc');
  assert.equal(Object.keys(r).length, 1);
});

test('un # dentro de comillas no es comentario', () => {
  assert.equal(parseEnv('ROBLE_TOKEN="ab#cd"').ROBLE_TOKEN, 'ab#cd');
});

test('no interpola nada: es configuración, no un script', () => {
  const r = parseEnv('ROBLE_TOKEN=$OTRA_COSA\nX=`whoami`\n');
  assert.equal(r.ROBLE_TOKEN, '$OTRA_COSA');
  assert.equal(r.X, '`whoami`');
});

test('lo encuentra subiendo desde una subcarpeta', async () => {
  const raiz = await dir();
  await writeFile(join(raiz, ENV_FILE), 'ROBLE_TOKEN=desde_la_raiz\n');
  const sub = join(raiz, 'src', 'features');
  await mkdir(sub, { recursive: true });

  const encontrado = findEnvFile(sub);
  assert.equal(encontrado.dir, raiz);
  assert.equal(loadConfig(sub).token, 'desde_la_raiz');
});

test('sin archivo cae al entorno', async () => {
  const vacio = await dir();
  process.env.ROBLE_TOKEN = 'del_entorno';
  try {
    const cfg = loadConfig(vacio);
    assert.equal(cfg.token, 'del_entorno');
    assert.equal(cfg.envFile, null);
  } finally {
    delete process.env.ROBLE_TOKEN;
  }
});

test('el archivo gana sobre el entorno: es lo que permite dos proyectos a la vez', async () => {
  const raiz = await dir();
  await writeFile(join(raiz, ENV_FILE), 'ROBLE_TOKEN=del_proyecto\n');
  process.env.ROBLE_TOKEN = 'global_viejo';
  try {
    assert.equal(loadConfig(raiz).token, 'del_proyecto');
  } finally {
    delete process.env.ROBLE_TOKEN;
  }
});

test('rellena del entorno lo que el archivo no define', async () => {
  const raiz = await dir();
  await writeFile(join(raiz, ENV_FILE), 'ROBLE_TOKEN=del_proyecto\n');
  process.env.ROBLE_BASE_URL = 'https://del-entorno.co';
  try {
    const cfg = loadConfig(raiz);
    assert.equal(cfg.token, 'del_proyecto');
    assert.equal(cfg.baseUrl, 'https://del-entorno.co');
  } finally {
    delete process.env.ROBLE_BASE_URL;
  }
});

test('la raíz del proyecto es donde vive el archivo', async () => {
  const raiz = await dir();
  await writeFile(join(raiz, ENV_FILE), 'ROBLE_TOKEN=x\n');
  const sub = join(raiz, 'a', 'b');
  await mkdir(sub, { recursive: true });

  assert.equal(loadConfig(sub).projectDir, raiz);
});
