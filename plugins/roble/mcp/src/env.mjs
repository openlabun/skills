import { readFileSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';

/**
 * Configuración por directorio, en `.roble.mcp.env`.
 *
 * Atarla a `~/.zshrc` obliga a reexportar cada vez que se cambia de proyecto y
 * hace fácil apuntar sin querer el token de un proyecto contra otro. Un archivo
 * junto al código viaja con él y se migra copiándolo.
 *
 * Se busca desde el directorio de trabajo hacia arriba y se usa el primero que
 * aparece, de modo que funciona igual lanzando el editor en la raíz del
 * proyecto o en una subcarpeta.
 */

export const ENV_FILE = '.roble.mcp.env';

/** Hasta dónde subir. Suficiente para cualquier monorepo, y acotado. */
const MAX_LEVELS = 12;

export function findEnvFile(startDir = process.cwd()) {
  let dir = resolve(startDir);
  for (let i = 0; i < MAX_LEVELS; i++) {
    const candidate = join(dir, ENV_FILE);
    if (existsSync(candidate)) return { file: candidate, dir };

    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

/**
 * Parser mínimo: `CLAVE=valor`, una por línea.
 *
 * Acepta el prefijo `export` y comillas alrededor del valor porque la gente
 * pega estas líneas desde su shell, y rechazarlas por eso sería gratuito.
 * No interpola ni ejecuta nada: es un archivo de configuración, no un script.
 */
export function parseEnv(text) {
  const out = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq === -1) continue;

    const key = line.slice(0, eq).replace(/^export\s+/, '').trim();
    if (!key) continue;

    let value = line.slice(eq + 1).trim();
    const quoted = value.length >= 2 && (value[0] === '"' || value[0] === "'");
    if (quoted && value[value.length - 1] === value[0]) {
      value = value.slice(1, -1);
    } else {
      // Sin comillas, un `#` empieza un comentario al final de la línea.
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }

    out[key] = value;
  }
  return out;
}

/**
 * `true` si el archivo está fuera del alcance de git: ignorado, o en un
 * directorio que no es un repositorio.
 *
 * Es una comprobación de seguridad, no de corrección: si git no está o falla,
 * se prefiere callar antes que avisar en falso.
 */
export function isGitIgnored(file) {
  try {
    execFileSync('git', ['check-ignore', '-q', file], {
      cwd: dirname(file),
      stdio: 'ignore',
    });
    return true;
  } catch (err) {
    // 1 = hay repositorio y el archivo NO está ignorado. Cualquier otro código
    // (128 sin repo, ENOENT sin git) no permite concluir nada.
    return err.status === 1 ? false : true;
  }
}

/**
 * La configuración efectiva y de dónde salió.
 *
 * El archivo gana sobre el entorno a propósito: es lo que hace que trabajar en
 * dos proyectos a la vez funcione. Un `export` global que quedó de otra sesión
 * no debe secuestrar el proyecto que se tiene delante.
 */
export function loadConfig(startDir = process.cwd()) {
  const found = findEnvFile(startDir);
  let fromFile = {};

  if (found) {
    try {
      fromFile = parseEnv(readFileSync(found.file, 'utf8'));
    } catch (err) {
      throw new Error(`No se pudo leer ${found.file}: ${err.message}`);
    }
  }

  const pick = (key) => fromFile[key] ?? process.env[key];

  return {
    baseUrl: pick('ROBLE_BASE_URL'),
    contractId: pick('ROBLE_CONTRACT_ID'),
    token: pick('ROBLE_TOKEN'),
    schemaFile: pick('ROBLE_SCHEMA_FILE'),
    envFile: found?.file ?? null,
    // Donde vive el .env es la raíz del proyecto, así que el snapshot va ahí y
    // no en la subcarpeta desde la que se lanzara el editor.
    projectDir: found?.dir ?? resolve(startDir),
  };
}

/**
 * Qué tiene que hacer el usuario para darle escritura al MCP.
 *
 * Se compone aquí porque hace falta saber de dónde salió la configuración: no
 * es lo mismo decir «pon el token en tu .env» que nombrar el archivo exacto, y
 * menos cuando el que manda puede estar dos carpetas más arriba.
 */
export function writeTokenInstructions(cfg) {
  const destino = cfg?.envFile
    ? `Reemplaza \`ROBLE_TOKEN\` en ${cfg.envFile}`
    : `Crea un ${ENV_FILE} en la raíz del proyecto con \`ROBLE_TOKEN=…\`` +
      ' (y añádelo al .gitignore)';

  return [
    'Para esto hace falta un token con alcance de **lectura y escritura**, y el',
    'que está configurado es de solo lectura. No lo puedo cambiar yo: los tokens',
    'se emiten desde la consola.',
    '',
    '1. Abre la consola de Roble → tu proyecto → Configuración → Tokens de acceso.',
    '2. «Nuevo token», alcance **Lectura y escritura**. Se muestra una sola vez.',
    `3. ${destino}.`,
    '4. Reinicia el editor para que el servidor MCP recoja el valor nuevo.',
    '',
    'El de solo lectura puedes conservarlo: sirve para leer el esquema y planear,',
    'que es la mayor parte del trabajo. Y cuando termines de aplicar cambios,',
    'volver a uno de lectura deja el proyecto a salvo de un error del agente.',
  ].join('\n');
}
