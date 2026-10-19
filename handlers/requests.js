import { json, erro, rota, lerCorpo, limpar, csrfOk, comSessao } from '../lib/http.js';
import { all, one, run } from '../lib/db.js';

/**
 * Pedidos de orcamento.
 *   GET  -> os pedidos do cliente (com workshop_name) ou da oficina (com client_name)
 *   POST -> o cliente cria um pedido
 */
export default rota(async (req) => {
  const sessao = await comSessao(req);
  if (sessao.res) return sessao.res;
  const u = sessao.u;

  const metodo = (req.method || 'GET').toUpperCase();
  if (metodo === 'GET') return listar(u);

  if (!csrfOk(req)) return erro('Requisição inválida.', 419);
  if (u.role !== 'client') return erro('Apenas Clientes podem criar pedidos.', 403);
  return criar(req, u);
});

const CAMPOS = `
  r.*,
  (SELECT rv.id FROM reviews rv WHERE rv.request_id = r.id) review_id,
  (SELECT count(*) FROM request_images ri WHERE ri.request_id = r.id) image_count`;

async function listar(u) {
  if (u.role === 'client') {
    const rows = await all(
      `SELECT ${CAMPOS}, w.legal_name workshop_name, v.make_model, v.plate,
              q.message quote_message, q.amount_min, q.amount_max
         FROM requests r
         JOIN workshops w ON w.id = r.workshop_id
         LEFT JOIN vehicles v ON v.id = r.vehicle_id
         LEFT JOIN quotes q ON q.request_id = r.id
        WHERE r.client_id = ? ORDER BY r.id DESC`,
      [u.id]
    );
    return json({ requests: rows.map(serializar) });
  }
  const rows = await all(
    `SELECT ${CAMPOS}, c.name client_name, v.make_model, v.plate,
            q.message quote_message, q.amount_min, q.amount_max
       FROM requests r
       JOIN workshops w ON w.id = r.workshop_id
       JOIN users c ON c.id = r.client_id
       LEFT JOIN vehicles v ON v.id = r.vehicle_id
       LEFT JOIN quotes q ON q.request_id = r.id
      WHERE w.user_id = ? ORDER BY r.id DESC`,
    [u.id]
  );
  return json({ requests: rows.map(serializar) });
}

async function criar(req, u) {
  const d = await lerCorpo(req);
  const oficinaId = Number(d.workshop_id ?? 0);
  const veiculoId = Number(d.vehicle_id ?? 0);
  const servico = limpar(d.service_type);
  const descricao = limpar(d.description);

  if (!oficinaId) return erro('Escolha a oficina.', 422);
  if (!servico) return erro('Escolha o tipo de serviço.', 422);
  if (!descricao) return erro('Descreva o problema.', 422);
  if (veiculoId > 0) {
    const v = await one('SELECT id FROM vehicles WHERE id = ? AND client_id = ?', [veiculoId, u.id]);
    if (!v) return erro('Veículo não encontrado.', 404);
  }

  const { lastInsertId } = await run(
    'INSERT INTO requests(client_id,workshop_id,vehicle_id,service_type,description) VALUES(?,?,?,?,?)',
    [u.id, oficinaId, veiculoId > 0 ? veiculoId : null, servico, descricao]
  );
  return json({ ok: true, request_id: Number(lastInsertId) });
}

function serializar(r) {
  return {
    id: Number(r.id),
    client_id: Number(r.client_id),
    workshop_id: Number(r.workshop_id),
    vehicle_id: r.vehicle_id === null ? null : Number(r.vehicle_id),
    service_type: r.service_type,
    description: r.description,
    status: r.status,
    created_at: r.created_at,
    workshop_name: r.workshop_name ?? null,
    client_name: r.client_name ?? null,
    make_model: r.make_model ?? null,
    plate: r.plate ?? null,
    quote_message: r.quote_message ?? null,
    amount_min: r.amount_min ?? null,
    amount_max: r.amount_max ?? null,
    review_id: r.review_id === null ? null : Number(r.review_id),
    image_count: Number(r.image_count ?? 0),
  };
}