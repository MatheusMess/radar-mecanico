import { json, erro, rota, lerCorpo, csrfOk, comSessao } from '../lib/http.js';
import { one, run } from '../lib/db.js';
import { normalizarUploads, validarUploads, assinaturaConfere, detalheRecusas } from '../lib/upload.js';

// O padrao do runtime e 1 MB, e a foto e limitada a 2 MB.
export const config = { api: { bodyParser: { sizeLimit: '5mb' } } };

/**
 * Foto da fachada da oficina. Aparece no card da rede e na pagina publica.
 *
 *   POST operation=upload (padrao) -> troca a foto
 *   POST operation=remove          -> apaga a foto
 *
 * Trocar a foto incrementa workshops.photo_rev. O frontend usa esse numero na
 * URL da imagem: sem ele o navegador continuaria mostrando a foto anterior do
 * cache depois de um upload novo.
 */
export default rota(async (req) => {
  if (!csrfOk(req)) return erro('Requisição inválida.', 419);
  const sessao = await comSessao(req);
  if (sessao.res) return sessao.res;
  if (sessao.u.role !== 'workshop') return erro('Apenas Oficinas podem enviar a foto.', 403);

  const w = await one('SELECT id FROM workshops WHERE user_id = ?', [sessao.u.id]);
  if (!w) return erro('Oficina não encontrada.', 404);

  const d = await lerCorpo(req);
  const operacao = String(d.operation ?? 'upload');

  if (operacao === 'remove') {
    await run(
      'UPDATE workshops SET photo = NULL, photo_mime = NULL, photo_rev = photo_rev + 1 WHERE id = ?',
      [w.id]
    );
    const depois = await one('SELECT photo_rev FROM workshops WHERE id = ?', [w.id]);
    return json({ ok: true, has_photo: false, photo_rev: Number(depois.photo_rev) });
  }

  if (operacao !== 'upload') return erro('Operação inválida.', 422);

  const uploads = normalizarUploads(req.body);
  if (!uploads.length) return erro('Selecione uma imagem.', 422);

  const { salvaveis, recusados } = validarUploads(uploads);
  const validas = salvaveis.filter((u) => assinaturaConfere(u.bytes, u.mime));
  for (const u of salvaveis) {
    if (validas.includes(u)) continue;
    recusados.push({ name: u.nome, reason: 'o conteúdo não é uma imagem válida' });
  }
  if (!validas.length) {
    const porque = detalheRecusas(recusados);
    return erro(
      `Nenhuma imagem foi salva.${porque ? ' ' + porque : ' O arquivo não corresponde a uma imagem válida.'}`,
      422
    );
  }

  // A fachada e uma imagem so: quando o office manda varias, vale a primeira.
  const boa = validas[0];
  const extra = validas.length > 1 ? ` (${validas.length - 1} arquivo(s) ignorado(s): a fachada e uma foto só)` : '';

  await run(
    'UPDATE workshops SET photo = ?, photo_mime = ?, photo_rev = photo_rev + 1 WHERE id = ?',
    [boa.bytes, boa.mime, w.id]
  );
  const depois = await one('SELECT photo_rev FROM workshops WHERE id = ?', [w.id]);

  return json({
    ok: true,
    has_photo: true,
    photo_rev: Number(depois.photo_rev),
    bytes: boa.bytes.length,
    mime: boa.mime,
    rejected: recusados,
    aviso: extra || undefined,
  });
});