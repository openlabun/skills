/**
 * Cliente HTTP contra `db-service` con un token de acceso de proyecto.
 *
 * No usa `roble-client`: aquel habla la API de la aplicación —usuarios finales,
 * `insert`, `read`— y esto habla la de administración del proyecto, que es otra
 * y va autenticada con un `roble_pat_…` en vez de un token de sesión.
 */

export class RobleAdminError extends Error {
  constructor(status, message, body, { needsWriteToken = false } = {}) {
    super(message);
    this.name = 'RobleAdminError';
    this.status = status;
    this.body = body;
    /** El fallo se arregla con un token de escritura, no reintentando. */
    this.needsWriteToken = needsWriteToken;
  }
}

/**
 * Si el servidor rechazó por alcance de solo lectura.
 *
 * `ProjectPermissionGuard` lo dice con ese texto y solo para ese caso; un 403
 * por rol insuficiente —un VIEWER intentando escribir— trae otro mensaje y no
 * se arregla cambiando de token, así que no conviene confundirlos.
 */
function isReadOnlyRefusal(status, body) {
  if (status !== 403) return false;
  return /solo lectura/i.test(String(body?.message ?? body?.error ?? ''));
}

/** Traduce los fallos que un estudiante va a ver de verdad. */
function explain(status, body) {
  const fromServer = body?.message ?? body?.error;

  if (status === 401) {
    return (
      'El token no vale: puede estar vencido, revocado o mal copiado. ' +
      'Genera otro en la consola de Roble, en Configuración → Tokens de acceso.'
    );
  }
  if (isReadOnlyRefusal(status, body)) {
    // El texto completo lo compone quien conoce la ruta del .env; aquí solo se
    // marca el caso.
    return 'El token configurado es de solo lectura.';
  }
  if (status === 403) {
    return (
      `${fromServer ?? 'Sin permisos'}. Esto no se arregla con otro token: ` +
      'depende del rol que tengas en el proyecto.'
    );
  }
  if (status === 404) return fromServer ?? 'No existe';
  return fromServer ?? `El servidor respondió ${status}`;
}

export class RobleAdminClient {
  /**
   * @param {{baseUrl: string, contractId: string, token: string, timeoutMs?: number}} config
   */
  constructor(config) {
    if (!config.baseUrl?.startsWith('http')) {
      throw new Error(
        `ROBLE_BASE_URL inválida: "${config.baseUrl}". Debe empezar por http:// o https://`,
      );
    }
    if (!config.contractId?.trim()) {
      throw new Error(
        'ROBLE_CONTRACT_ID no puede estar vacío. Es el identificador del ' +
          'proyecto en la consola, algo como "miproyecto_ab12cd34ef"',
      );
    }
    if (!config.token?.startsWith('roble_pat_')) {
      throw new Error(
        'ROBLE_TOKEN debe ser un token de acceso de proyecto (empieza por ' +
          '"roble_pat_"). Se genera en la consola, en Configuración → Tokens de acceso.',
      );
    }

    this.baseUrl = config.baseUrl.replace(/\/+$/, '');
    this.contractId = config.contractId.trim();
    this.token = config.token.trim();
    this.timeoutMs = config.timeoutMs ?? 30_000;
  }

  async request(method, path, body) {
    const url = `${this.baseUrl}/database/${this.contractId}${path}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let res;
    try {
      res = await fetch(url, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new RobleAdminError(0, `El servidor no respondió en ${this.timeoutMs} ms`);
      }
      throw new RobleAdminError(0, `No se pudo conectar con ${this.baseUrl}: ${err.message}`);
    } finally {
      clearTimeout(timer);
    }

    const text = await res.text();
    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!res.ok) {
      throw new RobleAdminError(res.status, explain(res.status, parsed), parsed, {
        needsWriteToken: isReadOnlyRefusal(res.status, parsed),
      });
    }
    return parsed;
  }

  get(path) {
    return this.request('GET', path);
  }
  post(path, body) {
    return this.request('POST', path, body);
  }
}
