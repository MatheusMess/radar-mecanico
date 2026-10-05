import {
  json, erro, rota, lerCorpo, limpar, csrfOk, comSessao,
} from '../lib/http.js';
import { all, one, run, syncWorkshopRating } from '../lib/db.js';

/**
 * Avaliacoes das oficinas (RF12 / RF13).
 *   GET  ?workshop_id=N -> lista + media
 *   POST -> o Cliente avalia um pedido SEU que a oficina ja CONCLUIU
 *
 * Cada pedido aceita no maximo uma avaliacao (request_id e UNIQUE).
 */
export default rota(async (req) => {
  const sessao = await comSessao(req);
  if (sessao.res) return sessao.res;
  const u = sessao.u;

  if ((req.method || 'GET').toUpperCase() === 'GET') {
    const wid = Number(req.query?.workshop_id ?? 0);
    const reviews = await all(
      `SELECT r.id, r.rating, c.name client_name, r.comment, r.created_at
         FROM reviews r JOIN users c ON c.id = r.client_id
        WHERE r.workshop_id = ? ORDER BY r.id DESC`,
      [wid]
    );
    const s = await one('SELECT count(*) n, avg(rating) avg FROM reviews WHERE workshop_id = ?', [wid]);
    // Mesmos nomes de /api/workshop, para o front nao ter dois contratos.
    return json({
      reviews: reviews.map((r) => ({
        id: Number(r.id), rating: Number(r.rating), client_name: r.client_name,
        comment: r.comment ?? '', created_at: r.created_at,
      })),
      review_count: Number(s.n),
      review_avg: s.avg === null ? null : Number(Number(s.avg).toFixed(2)),
    });
  }

  if (!csrfOk(req)) return erro('Requisição inválida.', 419);
  if (u.role !== 'client') return erro('Apenas Clientes podem avaliar.', 403);

  const d = await lerCorpo(req);
  const requestId = Number(d.request_id ?? 0);
  const nota = Number(d.rating ?? 0);
  const comentario = limpar(d.comment);

  if (!Number.isInteger(nota) || nota < 1 || nota > 5) {
    return erro('Escolha uma nota de 1 a 5 estrelas.', 422);
  }

  const r = await one(
    `SELECT r.id, r.status, r.client_id, w.id workshop_id
       FROM requests r JOIN workshops w ON w.id = r.workshop_id
      WHERE r.id = ? AND r.client_id = ?`,
    [requestId, u.id]
  );
  if (!r) return erro('Pedido não encontrado.', 404);
  if (String(r.status) !== 'completed') {
    return erro('Você só pode avaliar depois que o serviço for concluído pela oficina.', 422);
  }
  const jaTem = await one('SELECT id FROM reviews WHERE request_id = ?', [requestId]);
  if (jaTem) return erro('Este pedido já foi avaliado.', 422);

  await run('INSERT INTO reviews(workshop_id,client_id,request_id,rating,comment) VALUES(?,?,?,?,?)',
    [r.workshop_id, u.id, requestId, nota, comentario]);
  await syncWorkshopRating(r.workshop_id);

  return json({ ok: true });
});