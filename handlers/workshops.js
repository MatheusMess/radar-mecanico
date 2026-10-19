import { json, rota, comSessao } from '../lib/http.js';
import { all, mapaEspecialidades } from '../lib/db.js';

/**
 * Rede de oficinas para o Cliente.
 *   ?min_stars=N  filtra por avaliacao minima (RF08, parte de estrelas)
 *
 * A media vem das avaliacoes reais; offices sem avaliacao aparecem com 0 e
 * ficam no fim da ordenacao.
 */
export default rota(async (req) => {
  const sessao = await comSessao(req);
  if (sessao.res) return sessao.res;

  let minStars = Number(req.query?.min_stars ?? 0);
  if (!Number.isFinite(minStars) || minStars < 0) minStars = 0;
  if (minStars > 5) minStars = 5;

  const filtro = minStars > 0 ? 'AND (SELECT avg(r.rating) FROM reviews r WHERE r.workshop_id = w.id) >= ?' : '';
  const args = minStars > 0 ? [minStars] : [];

  const rows = await all(
    `SELECT w.id, w.legal_name, w.city, w.address, w.description, w.services, w.garagem,
            (w.photo IS NOT NULL) has_photo, w.photo_rev, u.phone,
            (SELECT count(*) FROM reviews r WHERE r.workshop_id = w.id) review_count,
            (SELECT avg(r.rating) FROM reviews r WHERE r.workshop_id = w.id) review_avg,
            CASE WHEN (SELECT count(*) FROM reviews r WHERE r.workshop_id = w.id) = 0 THEN 0
                 ELSE ROUND((SELECT avg(r.rating) FROM reviews r WHERE r.workshop_id = w.id), 2) END rating
       FROM workshops w JOIN users u ON u.id = w.user_id
      WHERE 1 = 1 ${filtro}
      ORDER BY rating DESC, review_count DESC, w.legal_name`,
    args
  );

  const mapa = await mapaEspecialidades(rows.map((w) => Number(w.id)));
  return json({ workshops: rows.map((w) => ({ ...serializar(w), especialidades: mapa.get(Number(w.id)) ?? [] })) });
});

function serializar(w) {
  return {
    id: Number(w.id),
    legal_name: w.legal_name,
    city: w.city,
    address: w.address,
    description: w.description ?? '',
    services: w.services ?? '',
    phone: w.phone,
    garagem: Number(w.garagem ?? 0) === 1,
    has_photo: Number(w.has_photo ?? 0) === 1,
    photo_rev: Number(w.photo_rev ?? 0),
    review_count: Number(w.review_count ?? 0),
    review_avg: w.review_avg === null ? null : Number(w.review_avg),
    rating: Number(w.rating ?? 0),
  };
}