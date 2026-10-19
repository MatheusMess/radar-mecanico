import { json, erro, rota, comSessao } from '../lib/http.js';
import { all, one } from '../lib/db.js';

/** Lista os ids das fotos de um veiculo. Os bytes vem em /api/image. */
export default rota(async (req) => {
  const sessao = await comSessao(req);
  if (sessao.res) return sessao.res;
  const u = sessao.u;

  const vehicleId = Number(req.query?.vehicle_id ?? 0);
  const dono = await one('SELECT id FROM vehicles WHERE id = ? AND client_id = ?', [vehicleId, u.id]);
  if (!dono) return erro('Veículo não encontrado.', 404);

  const imgs = await all('SELECT id FROM vehicle_images WHERE vehicle_id = ? ORDER BY id', [vehicleId]);
  return json({ images: imgs.map((i) => ({ id: Number(i.id) })) });
});