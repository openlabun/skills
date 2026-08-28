import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * De dónde sale la versión: del `package.json`, no de una constante.
 *
 * Estaba escrita a mano en `index.mjs` además de en el `package.json`, que es
 * la forma segura de que dentro de tres versiones el servidor siga
 * anunciándose como 0.1.0. Un solo sitio, y el que ya existía.
 */
const here = dirname(fileURLToPath(import.meta.url));

/** Raíz del paquete del MCP: `src/` está siempre un nivel por dentro. */
export const packageRoot = resolve(here, '..');

/** Raíz del plugin, cuando el MCP viaja dentro de uno. */
export const pluginRoot = resolve(packageRoot, '..');

function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export function mcpVersion() {
  return readJson(join(packageRoot, 'package.json'))?.version ?? 'desconocida';
}

/**
 * La del plugin que lo contiene.
 *
 * Devuelve `{ found, version }` y no un simple valor porque son dos
 * situaciones distintas: el MCP clonado por su cuenta, sin plugin alrededor, y
 * un plugin cuyo manifiesto no declara versión. Confundirlas hacía que el
 * diagnóstico dijera «corre suelto» estando dentro de un plugin.
 */
export function pluginVersion() {
  const manifest = readJson(join(pluginRoot, '.claude-plugin', 'plugin.json'));
  if (!manifest) return { found: false, version: null };
  return { found: true, version: manifest.version ?? null };
}
