/**
 * MCP sobre stdio, sin dependencias.
 *
 * El transporte es JSON-RPC 2.0, un mensaje por línea, sobre stdin/stdout. Son
 * unas pocas decenas de líneas, y a cambio el plugin funciona recién clonado
 * del marketplace: con el SDK habría que arrastrar 24 MB de `node_modules` o
 * publicar en npm antes de que nadie pueda probarlo. El SDK sigue estando,
 * como dependencia de desarrollo, para que el smoke hable como un cliente de
 * verdad y no como el mismo código que se quiere comprobar.
 */

/** La versión que se responde si el cliente no pide una. */
const DEFAULT_PROTOCOL = '2025-06-18';

export function serve({ name, version, tools, callTool }) {
  const send = (message) => {
    process.stdout.write(JSON.stringify(message) + '\n');
  };

  const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
  const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

  async function handle(message) {
    const { id, method, params } = message;

    // Las notificaciones no llevan id y no se responden. `initialized` es la
    // que manda todo cliente tras el apretón de manos.
    const isNotification = id === undefined || id === null;

    if (method === 'initialize') {
      return reply(id, {
        protocolVersion: params?.protocolVersion ?? DEFAULT_PROTOCOL,
        capabilities: { tools: {} },
        serverInfo: { name, version },
      });
    }

    if (method === 'tools/list') return reply(id, { tools });

    if (method === 'tools/call') {
      try {
        const result = await callTool(params?.name, params?.arguments ?? {});
        return reply(id, result);
      } catch (err) {
        // Un fallo de la herramienta se devuelve como resultado con isError y
        // no como error de JSON-RPC: así el modelo lo lee y puede corregir, en
        // vez de que el cliente lo trate como avería del transporte.
        return reply(id, {
          content: [{ type: 'text', text: `Error: ${err.message}` }],
          isError: true,
        });
      }
    }

    if (method === 'ping') return reply(id, {});

    if (isNotification) return;

    fail(id, -32601, `Método no soportado: ${method}`);
  }

  // Las llamadas en vuelo cuando stdin cierra: salir en ese momento mataría la
  // respuesta a medio camino. Un cliente real mantiene stdin abierto y no se
  // nota, pero un `echo ... | roble-mcp` sí lo destapa.
  const pending = new Set();
  let stdinClosed = false;

  const track = (promise) => {
    pending.add(promise);
    promise.finally(() => {
      pending.delete(promise);
      if (stdinClosed && pending.size === 0) process.exit(0);
    });
  };

  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (chunk) => {
    buffer += chunk;

    let newline;
    while ((newline = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;

      let message;
      try {
        message = JSON.parse(line);
      } catch {
        fail(null, -32700, 'JSON inválido');
        continue;
      }
      track(handle(message));
    }
  });

  process.stdin.on('end', () => {
    stdinClosed = true;
    if (pending.size === 0) process.exit(0);
  });
}
