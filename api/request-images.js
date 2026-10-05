import { json, erro, rota, comSessao } from '../lib/http.js';
import { all, one } from '../lib/db.js';

/**
 * Fotos do problema de um pedido. Responde 403 para quem nao e o cliente dono
 * nem a oficina que recebeu: o pedido tem dados pessoais e fotos do veiculo.
 */
export default rota(async (req) => {
  const sessao = await comSessao(req);
  if (sessao.res) return sessao.res;
  const u = sessao.u;

  const requestId = Number(req.query?.request_id ?? 0);
  const r = await one(
    `SELECT r.id, r.client_id, w.user_id workshop_user
       FROM requests r JOIN workshops w ON w.id = r.workshop_id WHERE r.id = ?`,
    [requestId]
  );
  if (!r) return erro('Pedido não encontrado.', 404);
  if (Number(r.client_id) !== Number(u.id) && Number(r.workshop_user) !== Number(u.id)) {
    return erro('Acesso restrito a este pedido.', 403);
  }

  const imgs = await all('SELECT id FROM request_images WHERE request_id = ? ORDER BY id', [requestId]);
  return json({ images: imgs.map((i) => ({ id: Number(i.id) })) });
});