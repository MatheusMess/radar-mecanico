import { erro, rota, comSessao } from '../lib/http.js';
import { one } from '../lib/db.js';
import { createHash } from 'node:crypto';

/**
 * Serve uma imagem do banco.
 *
 * Como as fotos sao BLOB, o <img> do navegador aponta para ca. O acesso
 * replica as regras da listagem: veiculo so para o dono; foto de pedido so
 * para o cliente e a oficina envolvidos. A fachada da oficina e publica.
 *
 * Todas as respostas levam ETag e revalidam: se a foto foi trocada, o
 * navegador pede, recebe a versao nova na hora, e nao a antiga do cache.
 */
export default rota(async (req) => {
  const tipo = String(req.query?.tipo ?? 'vehicle');
  const id = Number(req.query?.id ?? 0);

  if (tipo === 'workshop') {
    const w = await one('SELECT photo, photo_mime FROM workshops WHERE id = ?', [id]);
    if (!w?.photo) return erro('Esta oficina ainda não tem foto.', 404);
    // Publica, mas so revalidando: trocar a foto tem que aparecer na hora.
    return responderBytes(w.photo, w.photo_mime || 'image/png', 'public, max-age=0, must-revalidate', req);
  }

  const sessao = await comSessao(req);
  if (sessao.res) return sessao.res;
  const u = sessao.u;

  if (tipo === 'request') {
    // A autorizacao precisa vir da imagem real, nao de um id de pedido qualquer:
    // requests e request_images tem autoincrement proprios.
    const row = await one(
      `SELECT ri.mime, ri.data, r.client_id, w.user_id workshop_user
         FROM request_images ri
         JOIN requests r ON r.id = ri.request_id
         JOIN workshops w ON w.id = r.workshop_id
        WHERE ri.id = ?`,
      [id]
    );
    if (!row) return erro('Imagem não encontrada.', 404);
    if (Number(row.client_id) !== Number(u.id) && Number(row.workshop_user) !== Number(u.id)) {
      return erro('Acesso restrito a este pedido.', 403);
    }
    return responderBytes(row.data, row.mime, undefined, req);
  }

  const v = await one(
    `SELECT vi.mime, vi.data FROM vehicle_images vi
       JOIN vehicles vv ON vv.id = vi.vehicle_id
      WHERE vi.id = ? AND vv.client_id = ?`,
    [id, u.id]
  );
  if (!v) return erro('Veículo não encontrado.', 404);
  return responderBytes(v.data, v.mime, undefined, req);
});

/**
 * Etag = hash do conteudo. Mudou um byte, mudou a ETag, e o navegador baixa a
 * foto nova. Sem mudanca, responde 304 e nao trafega nada.
 */
function responderBytes(data, mime, cache = 'private, max-age=86400', req) {
  const bytes = data instanceof Uint8Array ? data : new Uint8Array(data ?? []);
  const etag = `"${createHash('sha1').update(bytes).digest('base64url')}"`;

  const headers = {
    'Content-Type': mime,
    'Cache-Control': cache,
    ETag: etag,
    'Last-Modified': new Date().toUTCString(),
    // Foto de fachada e conteudo de usuario: em CDN compartilhada precisa
    // variar a URL para nao vazar de um usuario para outro.
    Vary: 'Cookie',
  };

  const atual = req?.headers?.['if-none-match'];
  if (atual && atual.split(',').some((t) => t.trim() === etag)) {
    return { statusCode: 304, headers, body: '' };
  }

  return {
    statusCode: 200,
    headers: { ...headers, 'Content-Length': String(bytes.length) },
    body: Buffer.from(bytes),
  };
}