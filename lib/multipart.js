/**
 * Parser de multipart/form-data.
 *
 * O corpo do upload chega como Buffer cru: a Vercel nao interpreta
 * multipart/form-data por conta propria, e o servidor local tambem entrega os
 * bytes. Aqui ele vira o mesmo objeto que os handlers esperam:
 *   { "images[]": { data: Buffer, filename, mimetype }, request_id: '12' }
 *
 * A leitura usa latin1 (uma string de bytes) para nao corromper o binario: cada
 * caractere e exatamente um byte, entao Buffer.from(x, 'binary') devolve o
 * arquivo original. Campos repetidos viram array, que e o caso de images[].
 */

/** Extrai o boundary do Content-Type. */
function boundaryDe(contentType) {
  const m = /boundary=(?:"([^"]+)"|([^;]+))/i.exec(contentType || '');
  return m ? `--${m[1] || m[2]}` : null;
}

/**
 * @param {Buffer|Uint8Array} bruto corpo da requisicao
 * @param {string} contentType header Content-Type
 * @returns {Record<string, unknown>|null} campos e arquivos, ou null se nao for multipart
 */
export function corpoMultipart(bruto, contentType) {
  const boundary = boundaryDe(contentType);
  if (!boundary) return null;

  const buf = Buffer.isBuffer(bruto) ? bruto : Buffer.from(bruto ?? []);
  const corpo = buf.toString('binary');
  const saida = {};

  for (const pedaco of corpo.split(boundary)) {
    if (!pedaco || pedaco === '--' || pedaco === '--\r\n') continue;

    const corte = pedaco.indexOf('\r\n\r\n');
    if (corte === -1) continue;

    const cabecalhos = pedaco.slice(0, corte);
    const dados = pedaco.slice(corte + 4).replace(/\r\n$/, '');
    const nome = /name="([^"]*)"/i.exec(cabecalhos)?.[1];
    if (!nome) continue;

    const filename = /filename="([^"]*)"/i.exec(cabecalhos)?.[1];
    const tipo = /content-type:\s*([^\r\n]+)/i.exec(cabecalhos)?.[1]?.trim();

    const valor = filename !== undefined
      ? {
          data: Buffer.from(dados, 'binary'),
          filename,
          mimetype: tipo || 'application/octet-stream',
        }
      : dados;

    if (nome in saida) {
      saida[nome] = [].concat(saida[nome], valor);
    } else {
      saida[nome] = valor;
    }
  }

  return saida;
}

/** True quando o Content-Type da requisicao e multipart. */
export function ehMultipart(contentType) {
  return /multipart\/form-data/i.test(String(contentType || ''));
}
