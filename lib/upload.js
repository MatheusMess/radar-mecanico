/**
 * Imagens ficam como BLOB no SQLite: no Vercel nao existe disco gravavel numa
 * funcao serverless, entao o arquivo precisa ir para o banco.
 *
 * Consequencia: o limite passa a ser o do proprio request (4.5 MB na Vercel),
 * entao aqui cada imagem e limitada a 2 MB e no maximo 6 por requisicao.
 */

const LIMITE_POR_IMAGEM = 2 * 1024 * 1024;
const MAX_IMAGENS = 6;
/**
 * Teto do corpo da requisicao no Vercel (~4.5 MB). Sem este teto, um envio com
 * varias imagens de 2 MB passaria pelas validacoes e a plataforma cortaria a
 * conexao, com um erro que o usuario nao entenderia.
 */
const LIMITE_TOTAL = 3 * 1024 * 1024;

const MIMES = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
};

/** Extensao e MIME aceitos; usado para validar e para servir com Content-Type. */
function mimeParaExt(mime) {
  return MIMES[String(mime || '').toLowerCase()] ?? null;
}

/**
 * Normaliza o que o runtime entrega em req.body para uma lista de
 * { bytes: Uint8Array, mime: string, nome: string }.
 *
 * O frontend envia o campo como "images[]", e o parser depende do runtime:
 *   - campo simples  -> { "images[]": { data, filename, mimetype } }
 *   - campo repetido -> { "images[]": [ {...}, {...} ] }  ou { images: [...] }
 *   - sem parser     -> { "images[]": "<conteudo cru>" }  (fallback abaixo)
 * Por isso a busca aceita as tres formas e tambem a chave sem colchetes.
 */
export function normalizarUploads(body) {
  if (!body || typeof body !== 'object') return [];
  const chaves = ['images[]', 'images', 'image[]', 'image'];

  for (const chave of chaves) {
    const valor = body[chave];
    if (valor === undefined || valor === null) continue;

    if (ehArquivo(valor)) return [paraArquivo(valor, chave)];
    if (Array.isArray(valor)) {
      const brutos = valor.filter((v) => ehArquivo(v));
      if (brutos.length) return brutos.map((v, i) => paraArquivo(v, `${chave}[${i}]`));
      continue;
    }
  }

  // Fallback: qualquer propriedade que pareca um arquivo enviado.
  return Object.entries(body)
    .filter(([, v]) => ehArquivo(v))
    .map(([nome, v]) => paraArquivo(v, nome));
}

function ehArquivo(v) {
  return !!v && typeof v === 'object' && !Array.isArray(v)
    && ('data' in v || 'bytes' in v || 'buffer' in v);
}

function paraArquivo(b, nomePadrao) {
  const bytes = b.data ?? b.bytes ?? b.buffer;
  return {
    bytes: bytes ? new Uint8Array(bytes) : new Uint8Array(0),
    mime: String(b.mimetype ?? b.mime ?? b.type ?? b.contentType ?? '').toLowerCase(),
    nome: String(b.filename ?? b.name ?? b.originalFilename ?? nomePadrao),
  };
}

/**
 * Valida a lista de uploads. Devolve { salvaveis, recusados }.
 * Descarta silenciosamente arquivos com MIME nao suportado ou tamanho invalido,
 * como fazia o vehicle-upload do PHP.
 */
export function validarUploads(uploads) {
  const salvaveis = [];
  const recusados = [];
  let total = 0;
  for (const u of uploads.slice(0, 20)) {
    if (!mimeParaExt(u.mime)) {
      recusados.push({ name: u.nome, reason: 'não é JPG, PNG ou WEBP' });
      continue;
    }
    if (!u.bytes.length) {
      recusados.push({ name: u.nome, reason: 'arquivo vazio' });
      continue;
    }
    if (u.bytes.length > LIMITE_POR_IMAGEM) {
      recusados.push({ name: u.nome, reason: 'acima de 2 MB' });
      continue;
    }
    if (salvaveis.length >= MAX_IMAGENS) {
      recusados.push({ name: u.nome, reason: `limite de ${MAX_IMAGENS} imagens por envio` });
      continue;
    }
    if (total + u.bytes.length > LIMITE_TOTAL) {
      recusados.push({ name: u.nome, reason: 'o envio inteiro passaria de 3 MB; envie menos imagens por vez' });
      continue;
    }
    total += u.bytes.length;
    salvaveis.push(u);
  }
  return { salvaveis, recusados };
}

/** Confere se os bytes realmente comecam com a assinatura do tipo declarado. */
export function assinaturaConfere(bytes, mime) {
  const b = bytes;
  if (b.length < 12) return false;
  const igual = (offset, arr) => arr.every((v, i) => b[offset + i] === v);
  switch (String(mime).toLowerCase()) {
    case 'image/png':
      return igual(0, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    case 'image/jpeg':
      return igual(0, [0xff, 0xd8, 0xff]);
    case 'image/webp':
      return String.fromCharCode(b[8], b[9], b[10], b[11]) === 'WEBP';
    default:
      return false;
  }
}

export function detalheRecusas(recusados) {
  return recusados.length
    ? recusados.map((r) => `${r.name} (${r.reason})`).join('; ')
    : '';
}