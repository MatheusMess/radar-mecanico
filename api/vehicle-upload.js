import { json, erro, rota, csrfOk, comSessao } from '../lib/http.js';
import { one, batch } from '../lib/db.js';
import {
  normalizarUploads, validarUploads, assinaturaConfere, detalheRecusas,
} from '../lib/upload.js';

// O padrao do runtime e 1 MB, e o upload precisa passar por 3 MB.
export const config = { api: { bodyParser: { sizeLimit: '5mb' } } };

/**
 * Anexa fotos a um veiculo do cliente logado.
 * As imagens vao para o banco como BLOB (nao ha disco gravavel no Vercel).
 * As fotos do cadastro sao obrigatorias, entao este endpoint e chamado logo
 * apos criar o veiculo.
 */
export default rota(async (req) => {
  if (!csrfOk(req)) return erro('Requisição inválida.', 419);
  const sessao = await comSessao(req);
  if (sessao.res) return sessao.res;
  if (sessao.u.role !== 'client') return erro('Apenas Clientes podem enviar imagens de veículos.', 403);

  const vehicleId = Number(req.body?.vehicle_id ?? req.query?.vehicle_id ?? 0);
  const existe = await one('SELECT id FROM vehicles WHERE id = ? AND client_id = ?', [vehicleId, sessao.u.id]);
  if (!existe) return erro('Veículo não encontrado.', 404);

  const uploads = normalizarUploads(req.body);
  if (!uploads.length) return erro('Selecione ao menos uma imagem.', 422);

  const { salvaveis, recusados } = validarUploads(uploads);
  // Confere os bytes, não só o MIME declarado: o arquivo é servido de volta
  // com esse Content-Type.
  const validas = salvaveis.filter((u) => assinaturaConfere(u.bytes, u.mime));
  for (const u of salvaveis) {
    if (validas.includes(u)) continue;
    recusados.push({ name: u.nome, reason: 'o conteúdo não é uma imagem válida' });
  }
  if (!validas.length) {
    return erro(`Nenhuma imagem foi salva.${detalheRecusas(recusados) ? ' ' + detalheRecusas(recusados) : ''}`, 422);
  }

  // Uma transação só: ou as fotos entram todas, ou nenhuma.
  await batch(validas.map((u) => ({
    sql: 'INSERT INTO vehicle_images(vehicle_id,mime,data) VALUES(?,?,?)',
    args: [vehicleId, u.mime, u.bytes],
  })));
  return json({ ok: true, count: validas.length, rejected: recusados });
});