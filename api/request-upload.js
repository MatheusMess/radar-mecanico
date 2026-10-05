import { json, erro, rota, csrfOk, comSessao } from '../lib/http.js';
import { one, batch } from '../lib/db.js';
import {
  normalizarUploads, validarUploads, assinaturaConfere, detalheRecusas,
} from '../lib/upload.js';

// O padrao do runtime e 1 MB, e o upload precisa passar por 3 MB.
export const config = { api: { bodyParser: { sizeLimit: '5mb' } } };

/**
 * Anexa fotos do problema a um pedido. O cliente dono do pedido anexa; as
 * imagens ficam visiveis para ele e para a oficina que o recebeu.
 */
export default rota(async (req) => {
  if (!csrfOk(req)) return erro('Requisição inválida.', 419);
  const sessao = await comSessao(req);
  if (sessao.res) return sessao.res;
  if (sessao.u.role !== 'client') return erro('Apenas o Cliente pode enviar fotos do problema.', 403);

  const requestId = Number(req.body?.request_id ?? req.query?.request_id ?? 0);
  const dono = await one('SELECT id FROM requests WHERE id = ? AND client_id = ?', [requestId, sessao.u.id]);
  if (!dono) return erro('Pedido não encontrado.', 404);

  const uploads = normalizarUploads(req.body);
  if (!uploads.length) return erro('Selecione ao menos uma imagem.', 422);

  const { salvaveis, recusados } = validarUploads(uploads);
  const validas = salvaveis.filter((u) => assinaturaConfere(u.bytes, u.mime));
  for (const u of salvaveis) {
    if (validas.includes(u)) continue;
    recusados.push({ name: u.nome, reason: 'o conteúdo não é uma imagem válida' });
  }
  if (!validas.length) {
    return erro(`Nenhuma imagem foi salva.${detalheRecusas(recusados) ? ' ' + detalheRecusas(recusados) : ''}`, 422);
  }
  await batch(validas.map((u) => ({
    sql: 'INSERT INTO request_images(request_id,mime,data) VALUES(?,?,?)',
    args: [requestId, u.mime, u.bytes],
  })));
  return json({ ok: true, count: validas.length, rejected: recusados });
});