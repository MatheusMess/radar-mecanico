import {
  json, erro, rota, lerCorpo, limpar, digitos, csrfOk, comSessao,
} from '../lib/http.js';
import {
  all, one, run, cepValido, enderecosDoCliente, gravaEnderecoDoCliente,
  removeEnderecoDoCliente, especialidadesDaOficina, defineEspecialidades,
  listaEspecialidades,
} from '../lib/db.js';

/**
 * Perfil do usuario logado.
 *   GET  -> dados + contadores + enderecos (cliente) ou ficha + avaliacoes (oficina)
 *   POST operation=... -> atualiza dados, enderecos ou especialidades
 */
export default rota(async (req) => {
  const sessao = await comSessao(req);
  if (sessao.res) return sessao.res;
  const u = sessao.u;

  if ((req.method || 'GET').toUpperCase() === 'GET') return mostrar(req, u);
  if (!csrfOk(req)) return erro('Requisição inválida.', 419);
  return salvar(req, u);
});

async function mostrar(req, u) {
  const out = { user: u, stats: {} };

  if (u.role === 'client') {
    const v = await one('SELECT count(*) n FROM vehicles WHERE client_id = ?', [u.id]);
    const r = await one('SELECT count(*) n FROM requests WHERE client_id = ?', [u.id]);
    out.stats = { vehicles: Number(v.n), requests: Number(r.n) };
    // Enderecos sao N:N (endereco_cliente): um cliente pode ter varios.
    out.enderecos = (await enderecosDoCliente(u.id)).map(serializarEndereco);
  } else if (u.role === 'workshop') {
    const w = await one('SELECT * FROM workshops WHERE user_id = ?', [u.id]);
    if (!w) return erro('Oficina não encontrada.', 404);
    out.workshop = serializarOficina(w);
    const r = await one(
      'SELECT count(*) n FROM requests rq JOIN workshops ww ON ww.id = rq.workshop_id WHERE ww.user_id = ?',
      [u.id]
    );
    out.stats = { requests: Number(r.n) };

    const s = await one('SELECT count(*) n, avg(rating) avg FROM reviews WHERE workshop_id = ?', [w.id]);
    out.review_count = Number(s.n);
    out.review_avg = s.avg === null ? null : Number(Number(s.avg).toFixed(2));

    const dist = [1, 2, 3, 4, 5].map(() => 0);
    const linhas = await all('SELECT rating, count(*) total FROM reviews WHERE workshop_id = ? GROUP BY rating', [w.id]);
    for (const l of linhas) dist[Number(l.rating) - 1] = Number(l.total);
    out.rating_distribution = { 1: dist[0], 2: dist[1], 3: dist[2], 4: dist[3], 5: dist[4] };

    out.reviews = await all(
      `SELECT r.rating, c.name client_name, r.comment, r.created_at
         FROM reviews r JOIN users c ON c.id = r.client_id
        WHERE r.workshop_id = ?
        ORDER BY r.id DESC LIMIT 50`,
      [w.id]
    );

    out.especialidades = await especialidadesDaOficina(w.id);
    // A foto atual e a revisao: a tela mostra o que esta no ar e usa a revisao
    // na URL para nao puxar a versao antiga do cache.
    out.foto = await one(
      'SELECT (photo IS NOT NULL) has_photo, photo_rev FROM workshops WHERE id = ?',
      [w.id]
    );
    out.foto = { has_photo: Number(out.foto.has_photo) === 1, photo_rev: Number(out.foto.photo_rev ?? 0) };
    // A lista completa vem junto para o formulario ja vir marcado.
    out.todas_especialidades = (await listaEspecialidades()).map((e) => ({
      id: Number(e.id), nome: e.nome, descricao: e.descricao,
    }));
  }
  return json(out);
}

function serializarEndereco(e) {
  return {
    id: Number(e.id),
    cep: e.cep ?? '',
    cidade: e.cidade,
    rua: e.rua,
    numero: e.numero === null || e.numero === undefined ? null : Number(e.numero),
    bairro: e.bairro ?? '',
    complemento: e.complemento ?? '',
  };
}

async function salvar(req, u) {
  const d = await lerCorpo(req);
  const operacao = String(d.operation ?? 'dados');

  if (operacao === 'endereco') return salvarEndereco(d, u);
  if (operacao === 'especialidades') return salvarEspecialidades(d, u);

  const nome = limpar(d.name);
  const telefone = limpar(d.phone);
  if (!nome) return erro('Informe o nome completo.', 422);
  if (!telefone) return erro('Informe um telefone de contato.', 422);

  if (u.role === 'client') {
    const cpf = digitos(d.cpf);
    if (cpf.length !== 11) return erro('Informe um CPF válido com 11 dígitos.', 422);
    if (cpf !== String(u.cpf ?? '')) {
      const outro = await one('SELECT id FROM users WHERE cpf = ? AND id <> ?', [cpf, u.id]);
      if (outro) return erro('Este CPF já pertence a outra conta.', 422);
    }
    await run('UPDATE users SET name = ?, phone = ?, cpf = ? WHERE id = ?', [nome, telefone, cpf, u.id]);
    return json({ ok: true });
  }

  if (u.role === 'workshop') {
    const razao = limpar(d.legal_name);
    const cnpj = digitos(d.cnpj);
    const endereco = limpar(d.address);
    const cidade = limpar(d.city);
    if (!razao) return erro('Informe a razão social da oficina.', 422);
    if (!endereco) return erro('Informe o endereço da oficina.', 422);
    if (!cidade) return erro('Informe a cidade da oficina.', 422);
    if (cnpj.length !== 14) return erro('Informe um CNPJ válido com 14 dígitos.', 422);
    const w = await one('SELECT id FROM workshops WHERE user_id = ?', [u.id]);
    if (!w) return erro('Oficina não encontrada.', 404);
    const outro = await one('SELECT id FROM workshops WHERE cnpj = ? AND user_id <> ?', [cnpj, u.id]);
    if (outro) return erro('Este CNPJ já pertence a outra oficina.', 422);

    const horas = limpar(d.opening_hours);
    await run('UPDATE users SET name = ?, phone = ? WHERE id = ?', [nome, telefone, u.id]);
await run(
      `UPDATE workshops SET legal_name = ?, cnpj = ?, address = ?, city = ?, description = ?, services = ?, opening_hours = ?, garagem = ?
        WHERE user_id = ?`,
      [razao, cnpj, endereco, cidade, limpar(d.description), limpar(d.services),
        horas || 'Seg–Fri, 08:00–18:00', d.garagem ? 1 : 0, u.id]
    );
    return json({ ok: true });
  }

  // Administrador: pode corrigir nome e telefone, nao o acesso.
  await run('UPDATE users SET name = ?, phone = ? WHERE id = ?', [nome, telefone, u.id]);
  return json({ ok: true });
}

/** operation=endereco: inclui (id ausente) ou remove (id presente). */
async function salvarEndereco(d, u) {
  if (u.role !== 'client') {
    return erro('Somente Clientes mantêm endereços.', 403);
  }
  const id = Number(d.id ?? 0);
  if (id > 0) {
    const meu = await one('SELECT 1 x FROM endereco_cliente WHERE cliente_id = ? AND endereco_id = ?', [u.id, id]);
    if (!meu) return erro('Endereço não encontrado.', 404);
    await removeEnderecoDoCliente(u.id, id);
    return json({ ok: true, removed: id, enderecos: (await enderecosDoCliente(u.id)).map(serializarEndereco) });
  }

  const cep = String(d.cep ?? '');
  if (cep && !cepValido(cep)) return erro('CEP inválido. Use os 8 dígitos.', 422);
  try {
    const enderecoId = await gravaEnderecoDoCliente(u.id, d);
    return json({ ok: true, id: enderecoId, enderecos: (await enderecosDoCliente(u.id)).map(serializarEndereco) });
  } catch (e) {
    return erro(e.message || 'Não foi possível salvar o endereço.', 422);
  }
}

/** operation=especialidades: substitui o conjunto inteiro da oficina. */
async function salvarEspecialidades(d, u) {
  if (u.role !== 'workshop') return erro('Somente Oficinas têm especialidades.', 403);
  const w = await one('SELECT id FROM workshops WHERE user_id = ?', [u.id]);
  if (!w) return erro('Oficina não encontrada.', 404);

  const bruto = Array.isArray(d.especialidades) ? d.especialidades : [];
  const total = await defineEspecialidades(w.id, bruto);
  return json({ ok: true, total, especialidades: await especialidadesDaOficina(w.id) });
}

function serializarOficina(w) {
  return {
    id: Number(w.id),
    legal_name: w.legal_name,
    city: w.city,
    address: w.address,
    description: w.description ?? '',
    services: w.services ?? '',
    opening_hours: w.opening_hours ?? '',
    cnpj: w.cnpj ?? '',
    garagem: Number(w.garagem ?? 0) === 1,
  };
}