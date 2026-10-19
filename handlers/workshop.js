import { json, erro, rota, comSessao } from '../lib/http.js';
import { one, all, especialidadesDaOficina } from '../lib/db.js';

/**
 * Pagina publica de uma oficina, com a media e a distribuicao por nota
 * (RF13). O cliente ve isso ao comparar oficinas.
 */
export default rota(async (req) => {
  const sessao = await comSessao(req);
  if (sessao.res) return sessao.res;

  const id = Number(req.query?.id ?? 0);
  const w = await one(
    `SELECT w.id, w.user_id, w.legal_name, w.city, w.address, w.description, w.services,
            w.opening_hours, (w.photo IS NOT NULL) has_photo, w.photo_rev, u.phone,
            (SELECT count(*) FROM reviews r WHERE r.workshop_id = w.id) review_count,
            (SELECT avg(r.rating) FROM reviews r WHERE r.workshop_id = w.id) review_avg,
            (SELECT count(*) FROM requests rq WHERE rq.workshop_id = w.id) request_count
       FROM workshops w JOIN users u ON u.id = w.user_id
      WHERE w.id = ?`,
    [id]
  );
  if (!w) return erro('Oficina não encontrada.', 404);

  const reviews = await all(
    `SELECT r.id, r.rating, c.name client_name, r.comment, r.created_at
       FROM reviews r JOIN users c ON c.id = r.client_id
      WHERE r.workshop_id = ? ORDER BY r.id DESC`,
    [id]
  );

  const dist = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
  for (const r of reviews) dist[Number(r.rating)] = (dist[Number(r.rating)] || 0) + 1;

  const especialidades = await especialidadesDaOficina(id);

  return json({
    workshop: {
      id: Number(w.id),
      legal_name: w.legal_name,
      city: w.city,
      address: w.address,
      description: w.description ?? '',
      services: w.services ?? '',
      opening_hours: w.opening_hours ?? '',
      phone: w.phone,
      garagem: Number(w.garagem ?? 0) === 1,
      has_photo: Number(w.has_photo ?? 0) === 1,
      photo_rev: Number(w.photo_rev ?? 0),
      review_count: Number(w.review_count ?? 0),
      review_avg: w.review_avg === null ? null : Number(w.review_avg),
      rating: Number(w.review_count ?? 0) > 0 ? Number(Number(w.review_avg).toFixed(2)) : 0,
      request_count: Number(w.request_count ?? 0),
      distribution: dist,
      especialidades: especialidades.map((e) => ({ id: Number(e.id), nome: e.nome, descricao: e.descricao })),
      reviews: reviews.map((r) => ({
        id: Number(r.id),
        rating: Number(r.rating),
        client_name: r.client_name,
        comment: r.comment ?? '',
        created_at: r.created_at,
      })),
    },
  });
});