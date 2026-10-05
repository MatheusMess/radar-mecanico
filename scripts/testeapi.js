/**
 * Teste de ponta a ponta da API.
 *
 * Sobe os handlers em Node com um req/res falso e um SQLite temporario, sem
 * subir a Vercel. Cobre o caminho que o usuario percorre de verdade: cadastro,
 * login, garagem, fotos, pedido, orcamento, status, avaliacao, administracao
 * e as fronteiras de permissao entre clientes.
 *
 * uso: npm test
 */
import { rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

const raiz = fileURLToPath(new URL('..', import.meta.url));
const arq = join(tmpdir(), `radarteste-${process.pid}.sqlite`);
for (const sufixo of ['', '-wal', '-shm']) rmSync(arq + sufixo, { force: true });
process.env.TURSO_DATABASE_URL = `file:${arq}`;
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'segredo-de-teste-0123456789abcdef';

const { Tela } = await import(pathToFileURL(join(raiz, 'scripts', 'desenho.js')).href);

let passou = 0;
const falhas = [];

function ok(nome, condicao, detalhe = '') {
  if (condicao) {
    passou++;
    console.log(`  OK    ${nome}`);
  } else {
    falhas.push(nome);
    console.log(`  FALHA ${nome}${detalhe ? ' -> ' + detalhe : ''}`);
  }
}

function igual(nome, obtido, esperado) {
  ok(nome, obtido === esperado, `obtido ${JSON.stringify(obtido)}, esperado ${JSON.stringify(esperado)}`);
}

/** req/res falsos no formato que a Vercel entrega. */
function chamar(handler, { method = 'GET', query = {}, body, cookie, csrf = true, origin, headers: extra = {} } = {}) {
  return new Promise((resolve) => {
    const headers = { host: 'radar.test', ...extra };
    if (csrf) headers['x-requested-with'] = 'radar';
    if (cookie) headers.cookie = cookie;
    if (origin) headers.origin = origin;

    const req = { method, query, body, headers };
    const res = {
      statusCode: 0,
      _headers: {},
      setHeader(k, v) { this._headers[k.toLowerCase()] = v; },
      end(payload) {
        const texto = Buffer.isBuffer(payload) ? payload.toString('utf8') : String(payload ?? '');
        let json = null;
        try { json = JSON.parse(texto); } catch { json = null; }
        resolve({
          status: this.statusCode,
          headers: this._headers,
          body: json,
          raw: payload,
          texto,
        });
      },
    };
    handler(req, res);
  });
}

const cookies = {};
function sessaoDe(chave) { return cookies[chave]; }

function guardarCookie(chave, r) {
  const c = r.headers['set-cookie'];
  if (c) cookies[chave] = c.split(';')[0];
}

/** PNG valido; `semente` muda os pixels para dar imagens distintas (importa no ETag). */
const img = (nome = 'foto.png', semente = 0) => {
  const t = new Tela(24, 24);
  if (semente) t.retangulo(0, 0, 24, 24, [semente % 256, (semente * 7) % 256, (semente * 13) % 256]);
  return { data: t.paraPng(), filename: nome, mimetype: 'image/png' };
};
const multipart = (veiculoId, arquivos) => ({
  vehicle_id: veiculoId,
  'images[]': arquivos,
});

// ---------------------------------------------------------------- handlers
const H = {};
for (const nome of [
  'register', 'login', 'logout', 'session', 'profile', 'password',
  'vehicles', 'vehicle-upload', 'vehicle-images', 'vehicle-delete',
  'requests', 'request-status', 'request-upload', 'request-images', 'quote',
  'workshops', 'workshop', 'workshop-photo', 'reviews', 'admin-users', 'image', 'especialidades',
]) {
  H[nome] = (await import(pathToFileURL(join(raiz, 'api', `${nome}.js`)).href)).default;
}

// ------------------------------------------------------------------ testes
console.log('\n1. Cadastro e login');
{
  const r = await chamar(H.register, {
    method: 'POST',
    body: {
      role: 'client', name: 'Ana Cliente', email: 'ana@test.local', password: 'Senha12345',
      phone: '(11) 98888-1111', cpf: '11144477735',
    },
  });
  igual('cadastro de cliente', r.status, 200);
  igual('perfil do cadastro', r.body?.user?.role, 'client');
  ok('cookie de sessao no cadastro', !!r.headers['set-cookie'], JSON.stringify(r.headers));
  guardarCookie('ana', r);

  const dup = await chamar(H.register, {
    method: 'POST',
    body: {
      role: 'client', name: 'Outra', email: 'ANA@test.local', password: 'Senha12345',
      phone: '(11) 9', cpf: '11144477735',
    },
  });
  igual('e-mail duplicado recusado', dup.status, 422);

  const semCpf = await chamar(H.register, {
    method: 'POST',
    body: { role: 'client', name: 'Sem CPF', email: 's@e.local', password: 'Senha12345', phone: '1' },
  });
  igual('CPF invalido recusado', semCpf.status, 422);

  const curta = await chamar(H.register, {
    method: 'POST',
    body: { role: 'client', name: 'Curta', email: 'c@e.local', password: '123', phone: '1', cpf: '11144477735' },
  });
  igual('senha curta recusada', curta.status, 422);

  const of = await chamar(H.register, {
    method: 'POST',
    body: {
      role: 'workshop', name: 'Obrigado Oficina', email: 'oficina@test.local', password: 'Senha12345',
      phone: '(11) 97777-2222', legal_name: 'Oficina LTDA', cnpj: '11222333000181',
      address: 'Rua A, 100', city: 'Sao Paulo', services: 'Freios', description: ' specialists',
    },
  });
  igual('cadastro de oficina', of.status, 200);
  guardarCookie('oficina', of);

  const b = await chamar(H.register, {
    method: 'POST',
    body: {
      role: 'client', name: 'Bruno Vizinho', email: 'bruno@test.local', password: 'Senha12345',
      phone: '(11) 96666-3333', cpf: '22233344455',
    },
  });
  igual('segundo cliente cadastrado', b.status, 200);
  guardarCookie('bruno', b);

  const login = await chamar(H.login, { method: 'POST', body: { email: 'ana@test.local', password: 'Senha12345' } });
  igual('login correto', login.status, 200);
  igual('nome no login', login.body?.user?.name, 'Ana Cliente');

  const errado = await chamar(H.login, { method: 'POST', body: { email: 'ana@test.local', password: 'errada' } });
  igual('senha errada recusada', errado.status, 422);

  const semCookie = await chamar(H.session, {});
  igual('sem cookie, sem sessao', semCookie.body?.user ?? null, null);

  const sessao = await chamar(H.session, { cookie: sessaoDe('ana') });
  igual('sessao恢复了 pelo cookie', sessao.body?.user?.email, 'ana@test.local');
}

console.log('\n2. Protecao CSRF');
{
  const semHeader = await chamar(H.login, {
    method: 'POST', csrf: false, body: { email: 'ana@test.local', password: 'Senha12345' },
  });
  igual('POST sem X-Requested-With bloqueado', semHeader.status, 419);

  const outraOrigem = await chamar(H.login, {
    method: 'POST', body: { email: 'ana@test.local', password: 'Senha12345' },
    origin: 'https://site-malicioso.example',
  });
  igual('POST de outra origem bloqueado', outraOrigem.status, 419);

  const mesmaOrigem = await chamar(H.login, {
    method: 'POST', body: { email: 'ana@test.local', password: 'Senha12345' }, origin: 'https://radar.test',
  });
  igual('POST da mesma origem aceito', mesmaOrigem.status, 200);
}

console.log('\n3. Garagem');
let veiculoId = 0;
{
  const invalido = await chamar(H.vehicles, {
    method: 'POST', cookie: sessaoDe('ana'),
    body: { brand: 'Honda', model: 'Civic', color: 'Prata', plate: 'XX', year: '2020', fuel: 'Flex', mileage: '1000' },
  });
  igual('placa invalida recusada', invalido.status, 422);

  const anoRuim = await chamar(H.vehicles, {
    method: 'POST', cookie: sessaoDe('ana'),
    body: { brand: 'Honda', model: 'Civic', color: 'Prata', plate: 'ABC1D23', year: '1800', fuel: 'Flex', mileage: '1000' },
  });
  igual('ano fora da faixa recusado', anoRuim.status, 422);

  const criado = await chamar(H.vehicles, {
    method: 'POST', cookie: sessaoDe('ana'),
    body: {
      brand: 'Honda', model: 'Civic Si', color: 'Prata', plate: 'abc1d23',
      year: '2020', fuel: 'Flex', mileage: '45000', notes: 'unico dono',
    },
  });
  igual('veiculo criado', criado.status, 200);
  veiculoId = criado.body?.vehicle_id ?? 0;
  ok('id do veiculo devolvido', veiculoId > 0);

  const lista = await chamar(H.vehicles, { cookie: sessaoDe('ana') });
  igual('um veiculo na garagem', lista.body?.vehicles?.length, 1);
  igual('make_model montado', lista.body?.vehicles?.[0]?.make_model, 'Honda Civic Si');
  igual('placa normalizada', lista.body?.vehicles?.[0]?.plate, 'ABC1D23');

  const oficina = await chamar(H.vehicles, {
    method: 'POST', cookie: sessaoDe('oficina'),
    body: { brand: 'X', model: 'Y', color: 'Z', plate: 'ABC1D24', year: '2020', fuel: 'Flex', mileage: '1' },
  });
  igual('oficina nao cadastra veiculo', oficina.status, 403);

  const edit = await chamar(H.vehicles, {
    method: 'POST', cookie: sessaoDe('ana'),
    body: {
      id: veiculoId, brand: 'Honda', model: 'Civic Si', color: 'Preto',
      plate: 'ABC1D23', year: '2021', fuel: 'Flex', mileage: '46000',
    },
  });
  igual('veiculo editado', edit.status, 200);

  const furado = await chamar(H.vehicles, {
    method: 'POST', cookie: sessaoDe('bruno'),
    body: {
      id: veiculoId, brand: 'X', model: 'Y', color: 'Z', plate: 'ABC1D23',
      year: '2021', fuel: 'Flex', mileage: '1',
    },
  });
  igual('nao edita veiculo alheio', furado.status, 404);
}

console.log('\n4. Fotos do veiculo');
let fotoVeiculoId = 0;
{
  const vazio = await chamar(H['vehicle-upload'], {
    method: 'POST', cookie: sessaoDe('ana'), body: multipart(veiculoId, []),
  });
  igual('upload sem imagem recusado', vazio.status, 422);

  const falso = await chamar(H['vehicle-upload'], {
    method: 'POST', cookie: sessaoDe('ana'),
    body: multipart(veiculoId, [{ data: Buffer.from('<svg onload=alert(1)>'), filename: 'x.svg', mimetype: 'image/svg+xml' }]),
  });
  igual('mime nao permitido recusado', falso.status, 422);

  const disfarce = await chamar(H['vehicle-upload'], {
    method: 'POST', cookie: sessaoDe('ana'),
    body: multipart(veiculoId, [{ data: Buffer.from('isto nao e png'), filename: 'x.png', mimetype: 'image/png' }]),
  });
  igual('conteudo falso com mime de png recusado', disfarce.status, 422);

  const okUpload = await chamar(H['vehicle-upload'], {
    method: 'POST', cookie: sessaoDe('ana'), body: multipart(veiculoId, [img('a.png'), img('b.png')]),
  });
  igual('upload de duas fotos', okUpload.status, 200);
  igual('duas fotos gravadas', okUpload.body?.count, 2);

  const campoUnico = await chamar(H['vehicle-upload'], {
    method: 'POST', cookie: sessaoDe('ana'), body: { vehicle_id: veiculoId, 'images[]': img('c.png') },
  });
  igual('campo unico tambem funciona', campoUnico.body?.count, 1);

  const lista = await chamar(H['vehicle-images'], { cookie: sessaoDe('ana'), query: { vehicle_id: veiculoId } });
  igual('tres fotos listadas', lista.body?.images?.length, 3);
  fotoVeiculoId = lista.body?.images?.[0]?.id ?? 0;

  const imagem = await chamar(H.image, {
    cookie: sessaoDe('ana'), query: { tipo: 'vehicle', id: fotoVeiculoId },
  });
  igual('dono le a propria foto', imagem.status, 200);
  igual('content-type da foto', imagem.headers['content-type'], 'image/png');
  ok('bytes da foto conferem', Buffer.isBuffer(imagem.raw) && imagem.raw.length > 20, `len=${imagem.raw?.length}`);

  const alheia = await chamar(H.image, {
    cookie: sessaoDe('bruno'), query: { tipo: 'vehicle', id: fotoVeiculoId },
  });
  ok('outro cliente nao le a foto', alheia.status === 404 || alheia.status === 403, `status=${alheia.status}`);

  const listaAlheia = await chamar(H['vehicle-images'], {
    cookie: sessaoDe('bruno'), query: { vehicle_id: veiculoId },
  });
  igual('outro cliente nao lista as fotos', listaAlheia.status, 404);

  const uploadAlheio = await chamar(H['vehicle-upload'], {
    method: 'POST', cookie: sessaoDe('bruno'), body: multipart(veiculoId, [img('x.png')]),
  });
  igual('nao envia foto em veiculo alheio', uploadAlheio.status, 404);
}

console.log('\n5. Pedido e fotos do problema');
let pedidoId = 0;
let fotoPedidoId = 0;
let oficinaId = 0;
{
  const semSessao = await chamar(H.workshops, {});
  igual('rede de oficinas exige sessao', semSessao.status, 401);

  const lista = await chamar(H.workshops, { cookie: sessaoDe('ana') });
  igual('rede de oficinas lista', lista.body?.workshops?.length, 1);
  igual('has_photo falso antes da foto', lista.body?.workshops?.[0]?.has_photo, false);
  oficinaId = lista.body?.workshops?.[0]?.id ?? 0;

  const semOficina = await chamar(H.requests, {
    method: 'POST', cookie: sessaoDe('ana'),
    body: { workshop_id: oficinaId, service_type: 'Freios', description: '' },
  });
  igual('pedido sem descricao recusado', semOficina.status, 422);

  const veiculoAlheio = await chamar(H.requests, {
    method: 'POST', cookie: sessaoDe('bruno'),
    body: { workshop_id: oficinaId, service_type: 'Freios', description: 'chiando' },
  });
  igual('criei pedido', veiculoAlheio.status, 200);
  pedidoId = veiculoAlheio.body?.request_id ?? 0;
  ok('id do pedido devolvido', pedidoId > 0);
  const cria = await chamar(H.requests, {
    method: 'POST', cookie: sessaoDe('ana'),
    body: { workshop_id: oficinaId, vehicle_id: veiculoId, service_type: 'Freios', description: 'chiado na frente' },
  });
  igual('pedido do cliente aceito', cria.status, 200);
  const meuPedido = cria.body?.request_id ?? 0;

  const veiculoDeOutro = await chamar(H.requests, {
    method: 'POST', cookie: sessaoDe('bruno'),
    body: {
      workshop_id: oficinaId, vehicle_id: veiculoId,
      service_type: 'Freios', description: 'usando veiculo alheio',
    },
  });
  igual('nao usa veiculo alheio no pedido', veiculoDeOutro.status, 404);

  const oficinaCria = await chamar(H.requests, {
    method: 'POST', cookie: sessaoDe('oficina'),
    body: { workshop_id: oficinaId, service_type: 'Freios', description: 'x' },
  });
  igual('oficina nao cria pedido', oficinaCria.status, 403);

  const up = await chamar(H['request-upload'], {
    method: 'POST', cookie: sessaoDe('ana'),
    body: { request_id: meuPedido, 'images[]': [img('problema.png')] },
  });
  igual('foto do problema anexada', up.status, 200);

  const asOficina = await chamar(H['request-images'], {
    cookie: sessaoDe('oficina'), query: { request_id: meuPedido },
  });
  igual('oficina ve as fotos do pedido', asOficina.body?.images?.length, 1);
  fotoPedidoId = asOficina.body?.images?.[0]?.id ?? 0;

  const brunoVe = await chamar(H['request-images'], {
    cookie: sessaoDe('bruno'), query: { request_id: meuPedido },
  });
  igual('terceiro nao ve as fotos do pedido', brunoVe.status, 403);

  const brunoImg = await chamar(H.image, {
    cookie: sessaoDe('bruno'), query: { tipo: 'request', id: fotoPedidoId },
  });
  igual('terceiro nao le a foto do pedido', brunoImg.status, 403);

  const donoImg = await chamar(H.image, {
    cookie: sessaoDe('ana'), query: { tipo: 'request', id: fotoPedidoId },
  });
  igual('cliente le a foto do proprio pedido', donoImg.status, 200);

  // Era o bug de IDOR: id da imagem usado como id do pedido.
  const viaPedido = await chamar(H.image, {
    cookie: sessaoDe('bruno'), query: { tipo: 'request', id: meuPedido },
  });
  ok('id de pedido nao vaza foto alheia', viaPedido.status === 403 || viaPedido.status === 404,
    `status=${viaPedido.status}`);

  const oficinaLista = await chamar(H.requests, { cookie: sessaoDe('oficina') });
  ok('oficina ve os pedidos recebidos', (oficinaLista.body?.requests?.length ?? 0) >= 2,
    `n=${oficinaLista.body?.requests?.length}`);
  const clienteLista = await chamar(H.requests, { cookie: sessaoDe('ana') });
  igual('cliente ve so o proprio pedido', clienteLista.body?.requests?.length, 1);
  igual('nome da oficina no pedido', clienteLista.body?.requests?.[0]?.workshop_name, 'Oficina LTDA');
  igual('contagem de fotos no pedido', clienteLista.body?.requests?.[0]?.image_count, 1);
}

console.log('\n6. Orçamento e status');
{
  const antesDeOrcar = await chamar(H.quote, {
    method: 'POST', cookie: sessaoDe('oficina'),
    body: { request_id: pedidoId, message: 'Orcamento', amount_min: 900, amount_max: 1200 },
  });
  igual('orcamento aceito', antesDeOrcar.status, 200);

  const invertido = await chamar(H.quote, {
    method: 'POST', cookie: sessaoDe('oficina'),
    body: { request_id: pedidoId, message: ' inverted', amount_min: 1200, amount_max: 900 },
  });
  igual('minimo maior que maximo recusado', invertido.status, 422);

  const semMensagem = await chamar(H.quote, {
    method: 'POST', cookie: sessaoDe('oficina'),
    body: { request_id: pedidoId, message: '', amount_min: 1, amount_max: 2 },
  });
  igual('orcamento sem mensagem recusado', semMensagem.status, 422);

  const brunoOrca = await chamar(H.quote, {
    method: 'POST', cookie: sessaoDe('bruno'),
    body: { request_id: pedidoId, message: 'x', amount_min: 1, amount_max: 2 },
  });
  igual('cliente nao orca', brunoOrca.status, 403);

  const oficinaVe = await chamar(H.requests, { cookie: sessaoDe('oficina') });
  const orcado = oficinaVe.body?.requests?.find((r) => r.id === pedidoId);
  igual('pedido passou para respondido', orcado?.status, 'responded');
  igual('valor minimo salvo', orcado?.amount_min, 900);
  igual('mensagem do orcamento salva', orcado?.quote_message, 'Orcamento');

  // Reorcar nao pode regredir um servico ja aceito.
  await chamar(H['request-status'], {
    method: 'POST', cookie: sessaoDe('oficina'), body: { request_id: pedidoId, status: 'in_progress' },
  });
  const reorcamento = await chamar(H.quote, {
    method: 'POST', cookie: sessaoDe('oficina'),
    body: { request_id: pedidoId, message: 'Ajuste', amount_min: 1000, amount_max: 1300 },
  });
  igual('reorcamento aceito', reorcamento.status, 200);
  igual('status nao regride para respondido', reorcamento.body?.status, 'in_progress');

  const statusRuim = await chamar(H['request-status'], {
    method: 'POST', cookie: sessaoDe('oficina'), body: { request_id: pedidoId, status: 'inventado' },
  });
  igual('status desconhecido recusado', statusRuim.status, 422);

  // Ana nao participa do pedido de Bruno: nem como cliente nem como oficina.
  const terceiraMexe = await chamar(H['request-status'], {
    method: 'POST', cookie: sessaoDe('ana'), body: { request_id: pedidoId, status: 'completed' },
  });
  igual('terceiro nao mexe no status', terceiraMexe.status, 403);

  // Concluir sem orcamento, partindo de "aberto", tem de ser recusado.
  const novo = await chamar(H.requests, {
    method: 'POST', cookie: sessaoDe('bruno'),
    body: { workshop_id: oficinaId, service_type: 'Borracharia', description: 'pneu' },
  });
  const aberto = novo.body?.request_id ?? 0;
  const concludesDireto = await chamar(H['request-status'], {
    method: 'POST', cookie: sessaoDe('oficina'), body: { request_id: aberto, status: 'completed' },
  });
  igual('oficina nao conclude pedido sem orcamento', concludesDireto.status, 422);
  const recusa = await chamar(H['request-status'], {
    method: 'POST', cookie: sessaoDe('oficina'), body: { request_id: aberto, status: 'cancelled' },
  });
  igual('oficina recusa pedido aberto', recusa.status, 200);

  const conclui = await chamar(H['request-status'], {
    method: 'POST', cookie: sessaoDe('oficina'), body: { request_id: pedidoId, status: 'completed' },
  });
  igual('oficina conclui servico em andamento', conclui.status, 200);

  const depoisDeConcluido = await chamar(H['request-status'], {
    method: 'POST', cookie: sessaoDe('oficina'), body: { request_id: pedidoId, status: 'in_progress' },
  });
  igual('pedido concluido e terminal', depoisDeConcluido.status, 422);

  const orcaConcluido = await chamar(H.quote, {
    method: 'POST', cookie: sessaoDe('oficina'),
    body: { request_id: pedidoId, message: 'de novo', amount_min: 1, amount_max: 2 },
  });
  igual('nao orca pedido ja concluido', orcaConcluido.status, 422);
}

console.log('\n7. Avaliação');
{
  // pedidoId e do Bruno; Ana nao pode avaliar pedido de outra conta.
  const alheio = await chamar(H.reviews, {
    method: 'POST', cookie: sessaoDe('ana'),
    body: { request_id: pedidoId, rating: 5, comment: 'rapido' },
  });
  igual('nao avalia pedido de outro cliente', alheio.status, 404);

  const oficinaAvalia = await chamar(H.reviews, {
    method: 'POST', cookie: sessaoDe('oficina'), body: { request_id: pedidoId, rating: 5, comment: 'eu' },
  });
  igual('oficina nao avalia', oficinaAvalia.status, 403);

  const notaRuim = await chamar(H.reviews, {
    method: 'POST', cookie: sessaoDe('bruno'), body: { request_id: pedidoId, rating: 9, comment: 'x' },
  });
  igual('nota fora de 1 a 5 recusada', notaRuim.status, 422);

  const avaliou = await chamar(H.reviews, {
    method: 'POST', cookie: sessaoDe('bruno'),
    body: { request_id: pedidoId, rating: 5, comment: 'Muito bom, rapido.' },
  });
  igual('avaliacao registrada', avaliou.status, 200);

  const repetida = await chamar(H.reviews, {
    method: 'POST', cookie: sessaoDe('bruno'), body: { request_id: pedidoId, rating: 4, comment: 'de novo' },
  });
  igual('segunda avaliacao no mesmo pedido recusada', repetida.status, 422);

  const lista = await chamar(H.reviews, { cookie: sessaoDe('bruno'), query: { workshop_id: oficinaId } });
  igual('uma avaliacao na lista', lista.body?.review_count, 1);
  igual('media das avaliacoes', lista.body?.review_avg, 5);
  igual('nome do cliente na avaliacao', lista.body?.reviews?.[0]?.client_name, 'Bruno Vizinho');

  const oficinaVe = await chamar(H.workshop, { cookie: sessaoDe('oficina'), query: { id: oficinaId } });
  igual('nota da oficina atualizada', oficinaVe.body?.workshop?.rating, 5);
  igual('total de avaliacoes na oficina', oficinaVe.body?.workshop?.review_count, 1);
  igual('distribuicao de notas', oficinaVe.body?.workshop?.distribution?.[5], 1);
  igual('avaliacao visivel na ficha', oficinaVe.body?.workshop?.reviews?.[0]?.client_name, 'Bruno Vizinho');
}

console.log('\n8. Foto da oficina');
{
  const antes = await chamar(H.image, { query: { tipo: 'workshop', id: oficinaId } });
  igual('sem foto, endpoint responde 404', antes.status, 404);

  const foto = await chamar(H['workshop-photo'], {
    method: 'POST', cookie: sessaoDe('oficina'), body: { 'images[]': img('fachada.png') },
  });
  igual('foto da oficina salva', foto.status, 200);

  const publica = await chamar(H.image, { query: { tipo: 'workshop', id: oficinaId } });
  igual('foto da oficina e publica', publica.status, 200);
  igual('content-type da fachada', publica.headers['content-type'], 'image/png');

  const lista = await chamar(H.workshops, { cookie: sessaoDe('ana') });
  igual('has_photo verdadeiro na listagem', lista.body?.workshops?.[0]?.has_photo, true);

  const clienteTentando = await chamar(H['workshop-photo'], {
    method: 'POST', cookie: sessaoDe('ana'), body: { 'images[]': img('x.png') },
  });
  igual('cliente nao muda foto de oficina', clienteTentando.status, 403);

  const busca = await chamar(H.workshops, { cookie: sessaoDe('ana'), query: { min_stars: '4' } });
  igual('filtro por estrelas inclui nota 5', busca.body?.workshops?.length, 1);
  const exigente = await chamar(H.workshops, { cookie: sessaoDe('ana'), query: { min_stars: '5' } });
  igual('filtro por estrelas nao exclui a nota 5', exigente.body?.workshops?.length, 1);
  // A media e 5,0; um piso de 4,5 nao pode excluir ninguem.
  const quase = await chamar(H.workshops, { cookie: sessaoDe('ana'), query: { min_stars: '4.5' } });
  igual('filtro abaixo da media nao exclui', quase.body?.workshops?.length, 1);
  // Acima de 5 o valor e limitado a 5, nao vira "nenhum resultado" nem erro.
  const acima = await chamar(H.workshops, { cookie: sessaoDe('ana'), query: { min_stars: '99' } });
  igual('filtro acima de 5 e limitado', acima.body?.workshops?.length, 1);
  const invalido = await chamar(H.workshops, { cookie: sessaoDe('ana'), query: { min_stars: 'abc' } });
  igual('filtro invalido nao quebra a listagem', invalido.body?.workshops?.length, 1);
}

console.log('\n9. Perfil e senha');
{
  const semCpf = await chamar(H.profile, {
    method: 'POST', cookie: sessaoDe('ana'), body: { name: 'Ana Atualizada', phone: '(11) 90000-0000' },
  });
  igual('perfil de cliente exige CPF', semCpf.status, 422);

  const cpfAlheio = await chamar(H.profile, {
    method: 'POST', cookie: sessaoDe('ana'),
    body: { name: 'Ana Atualizada', phone: '(11) 90000-0000', cpf: '22233344455' },
  });
  igual('CPF de outra conta recusado', cpfAlheio.status, 422);

  const atualizado = await chamar(H.profile, {
    method: 'POST', cookie: sessaoDe('ana'),
    body: { name: 'Ana Atualizada', phone: '(11) 90000-0000', cpf: '111.444.777-35' },
  });
  igual('perfil atualizado', atualizado.status, 200);

  const visto = await chamar(H.profile, { cookie: sessaoDe('ana') });
  igual('nome novo no perfil', visto.body?.user?.name, 'Ana Atualizada');
  igual('contador de veiculos no perfil', visto.body?.stats?.vehicles, 1);

  const oficinaPerfil = await chamar(H.profile, { cookie: sessaoDe('oficina') });
  igual('perfil da oficina traz a ficha', oficinaPerfil.body?.workshop?.legal_name, 'Oficina LTDA');
  ok('perfil da oficina traz avaliacoes', Array.isArray(oficinaPerfil.body?.reviews));

  const fraca = await chamar(H.password, {
    method: 'POST', cookie: sessaoDe('ana'), body: { current_password: 'Senha12345', new_password: '123' },
  });
  igual('senha nova curta recusada', fraca.status, 422);

  const trocou = await chamar(H.password, {
    method: 'POST', cookie: sessaoDe('ana'), body: { current_password: 'Senha12345', new_password: 'NovaSenha987' },
  });
  igual('senha trocada', trocou.status, 200);

  const antiga = await chamar(H.login, { method: 'POST', body: { email: 'ana@test.local', password: 'Senha12345' } });
  igual('senha antiga deixou de valer', antiga.status, 422);
  const nova = await chamar(H.login, { method: 'POST', body: { email: 'ana@test.local', password: 'NovaSenha987' } });
  igual('senha nova entra', nova.status, 200);
}

console.log('\n10. Administração');
{
  const comum = await chamar(H['admin-users'], { cookie: sessaoDe('ana') });
  igual('cliente nao entra na administracao', comum.status, 403);

  const { garantirAdmin } = await import(pathToFileURL(join(raiz, 'lib', 'db.js')).href);
  await garantirAdmin();
  const loginAdmin = await chamar(H.login, {
    method: 'POST', body: { email: 'admin@radarmecanico.local', password: 'RadarAdm@2026' },
  });
  igual('admin entra', loginAdmin.status, 200);
  guardarCookie('admin', loginAdmin);

  const lista = await chamar(H['admin-users'], { cookie: sessaoDe('admin') });
  ok('administracao lista contas', (lista.body?.users?.length ?? 0) >= 4, `n=${lista.body?.users?.length}`);
  ok('senha fora da listagem', !('password_hash' in (lista.body?.users?.[0] ?? {})));

  const criado = await chamar(H['admin-users'], {
    method: 'POST', cookie: sessaoDe('admin'),
    body: { operation: 'create_admin', name: 'Segundo Admin', email: 'admin2@test.local', password: 'Senha12345', phone: '1' },
  });
  igual('admin criado', criado.status, 200);

  const autoBloqueio = await chamar(H['admin-users'], {
    method: 'POST', cookie: sessaoDe('admin'),
    body: { operation: 'toggle_block', user_id: loginAdmin.body?.user?.id },
  });
  igual('admin nao bloqueia a si mesmo', autoBloqueio.status, 422);

  const brunoId = (await chamar(H['admin-users'], { cookie: sessaoDe('admin') }))
    .body?.users?.find((u) => u.email === 'bruno@test.local')?.id;
  const bloqueou = await chamar(H['admin-users'], {
    method: 'POST', cookie: sessaoDe('admin'), body: { operation: 'toggle_block', user_id: brunoId },
  });
  igual('bloqueio aplicado', bloqueou.status, 200);

  const loginBloqueado = await chamar(H.login, {
    method: 'POST', body: { email: 'bruno@test.local', password: 'Senha12345' },
  });
  igual('conta bloqueada nao entra', loginBloqueado.status, 403);

  const sessaoBloqueada = await chamar(H.session, { cookie: sessaoDe('bruno') });
  igual('sessao de conta bloqueada e recusada', sessaoBloqueada.status, 403);

  const desBloqueou = await chamar(H['admin-users'], {
    method: 'POST', cookie: sessaoDe('admin'), body: { operation: 'toggle_block', user_id: brunoId },
  });
  igual('desbloqueio aplicado', desBloqueou.status, 200);
}

console.log('\n11. Exclusão de veículo e logout');
{
  const oficinaApaga = await chamar(H['vehicle-delete'], {
    method: 'POST', cookie: sessaoDe('oficina'), body: { vehicle_id: veiculoId },
  });
  igual('oficina nao apaga veiculo', oficinaApaga.status, 403);

  const antes = await chamar(H.vehicles, { cookie: sessaoDe('ana') });
  igual('veiculo ainda na garagem', antes.body?.vehicles?.length, 1);

  const apagou = await chamar(H['vehicle-delete'], {
    method: 'POST', cookie: sessaoDe('ana'), body: { vehicle_id: veiculoId },
  });
  igual('veiculo apagado', apagou.status, 200);

  const depois = await chamar(H.vehicles, { cookie: sessaoDe('ana') });
  igual('garagem vazia', depois.body?.vehicles?.length, 0);

  const imagensOrfas = await chamar(H['vehicle-images'], {
    cookie: sessaoDe('ana'), query: { vehicle_id: veiculoId },
  });
  igual('fotos do veiculo apagadas junto', imagensOrfas.status, 404);

  const saiu = await chamar(H.logout, { method: 'POST', cookie: sessaoDe('ana') });
  igual('logout responde 200', saiu.status, 200);
}

console.log('\n12. Enderecos do cliente');
let enderecoId = 0;
{
  const semCidade = await chamar(H.profile, {
    method: 'POST', cookie: sessaoDe('ana'),
    body: { operation: 'endereco', rua: 'Rua A', numero: '10' },
  });
  igual('endereco sem cidade recusado', semCidade.status, 422);

  const cepRuim = await chamar(H.profile, {
    method: 'POST', cookie: sessaoDe('ana'),
    body: { operation: 'endereco', cep: '123', cidade: 'SP', rua: 'Rua A', numero: '10' },
  });
  igual('CEP invalido recusado', cepRuim.status, 422);

  const numeroTexto = await chamar(H.profile, {
    method: 'POST', cookie: sessaoDe('ana'),
    body: { operation: 'endereco', cidade: 'SP', rua: 'Rua A', numero: '10A' },
  });
  igual('numero nao inteiro recusado', numeroTexto.status, 422);

  const primeiro = await chamar(H.profile, {
    method: 'POST', cookie: sessaoDe('ana'),
    body: {
      operation: 'endereco', cep: '05435-030', cidade: 'Sao Paulo', rua: 'Rua Augusta',
      numero: '1500', bairro: 'Jardim Paulista', complemento: 'Apto 92',
    },
  });
  igual('endereco cadastrado', primeiro.status, 200);
  igual('um endereco na lista', primeiro.body?.enderecos?.length, 1);
  igual('cep so com digitos', primeiro.body?.enderecos?.[0]?.cep, '05435030');
  igual('numero virou inteiro', primeiro.body?.enderecos?.[0]?.numero, 1500);
  enderecoId = primeiro.body?.enderecos?.[0]?.id ?? 0;
  ok('id do endereco devolvido', enderecoId > 0);

  // Repetir o mesmo endereço não pode duplicar a linha.
  await chamar(H.profile, {
    method: 'POST', cookie: sessaoDe('ana'),
    body: { operation: 'endereco', cep: '05435-030', cidade: 'Sao Paulo', rua: 'Rua Augusta', numero: '1500', bairro: 'Jardim Paulista', complemento: 'Apto 92' },
  });
  const repetido = await chamar(H.profile, { cookie: sessaoDe('ana') });
  igual('endereco repetido nao duplica', repetido.body?.enderecos?.length, 1);

  const segundo = await chamar(H.profile, {
    method: 'POST', cookie: sessaoDe('ana'),
    body: { operation: 'endereco', cidade: 'Campinas', rua: 'Rua Barao de Jaguara', numero: '880', bairro: 'Centro' },
  });
  igual('segundo endereco aceito (N:N)', segundo.body?.enderecos?.length, 2);

  // O mesmo endereço de outro cliente reaproveita a linha, sem duplicar.
  const bruno = await chamar(H.profile, {
    method: 'POST', cookie: sessaoDe('bruno'),
    body: { operation: 'endereco', cidade: 'Campinas', rua: 'Rua Barao de Jaguara', numero: '880', bairro: 'Centro' },
  });
  igual('outro cliente pode ter o mesmo endereco', bruno.status, 200);
  igual('o segundo cliente ve so o dele', bruno.body?.enderecos?.length, 1);

  const oficinaTenta = await chamar(H.profile, {
    method: 'POST', cookie: sessaoDe('oficina'),
    body: { operation: 'endereco', cidade: 'SP', rua: 'Rua B', numero: '2' },
  });
  igual('oficina nao usa o endereco de cliente', oficinaTenta.status, 403);

  const outroRemove = await chamar(H.profile, {
    method: 'POST', cookie: sessaoDe('bruno'), body: { operation: 'endereco', id: enderecoId },
  });
  igual('nao remove endereco de outro', outroRemove.status, 404);

  const removeu = await chamar(H.profile, {
    method: 'POST', cookie: sessaoDe('ana'), body: { operation: 'endereco', id: enderecoId },
  });
  igual('endereco removido', removeu.status, 200);
  igual('so restou um endereco', removeu.body?.enderecos?.length, 1);
}

console.log('\n13. Especialidades');
{
  const lista = await chamar(H.especialidades, { cookie: sessaoDe('ana') });
  igual('catalogo vazio no comeco', lista.body?.especialidades?.length, 0);

  const clienteCria = await chamar(H.especialidades, {
    method: 'POST', cookie: sessaoDe('ana'), body: { operation: 'create', nome: 'Freios' },
  });
  igual('cliente nao cria especialidade', clienteCria.status, 403);

  const email = 'esp-e2e@radar.local';
  const r = await chamar(H.register, {
    method: 'POST',
    body: {
      role: 'workshop', name: 'Oficina Especialidades', email, password: 'Senha12345',
      phone: '(11) 95555-0000', legal_name: 'Esp LTDA', cnpj: '99888777000166',
      address: 'Rua C, 3', city: 'Campinas',
    },
  });
  igual('cadastro da oficina de especialidades', r.status, 200);
  const cookie = r.headers['set-cookie']?.split(';')[0];

  const ids = [];
  for (const nome of ['Freios e Suspensao', 'Eletrica Automotiva', 'Borracharia']) {
    const c = await chamar(H.especialidades, {
      method: 'POST', cookie: sessaoDe('admin'), body: { operation: 'create', nome, descricao: `Teste ${nome}` },
    });
    igual(`especialidade "${nome}" criada`, c.status, 200);
    ids.push(c.body?.id ?? 0);
  }

  const duplicada = await chamar(H.especialidades, {
    method: 'POST', cookie: sessaoDe('admin'), body: { operation: 'create', nome: 'Borracharia' },
  });
  igual('especialidade com nome repetido recusada', duplicada.status, 422);

  const catalogo = await chamar(H.especialidades, { cookie: sessaoDe('ana') });
  igual('catalogo lista as tres', catalogo.body?.especialidades?.length, 3);

  const oficinaDefine = await chamar(H.profile, {
    method: 'POST', cookie, body: { operation: 'especialidades', especialidades: [ids[0], ids[2], ids[0]] },
  });
  igual('oficina define suas especialidades', oficinaDefine.status, 200);
  igual('duplicado no veto foi ignorado', oficinaDefine.body?.total, 2);

  const perfil = await chamar(H.profile, { cookie });
  igual('perfil traz as marcadas', perfil.body?.especialidades?.length, 2);
  igual('perfil traz o catalogo inteiro', perfil.body?.todas_especialidades?.length, 3);

  const clienteMexe = await chamar(H.profile, {
    method: 'POST', cookie: sessaoDe('ana'), body: { operation: 'especialidades', especialidades: [ids[0]] },
  });
  igual('cliente nao define especialidades', clienteMexe.status, 403);

  const rede = await chamar(H.workshops, { cookie: sessaoDe('ana') });
  const espDaOficina = rede.body?.workshops?.find((w) => w.legal_name === 'Esp LTDA');
  igual('listagem traz os nomes da especialidade', espDaOficina?.especialidades?.length, 2);
  ok('listagem traz o nome, nao so o id',
    espDaOficina?.especialidades?.every((e) => typeof e === 'string'), JSON.stringify(espDaOficina?.especialidades));

  const ficha = await chamar(H.workshop, { cookie: sessaoDe('ana'), query: { id: espDaOficina.id } });
  igual('ficha traz as especialidades', ficha.body?.workshop?.especialidades?.length, 2);
  // Vem ordenada pelo nome, nao pela ordem de insercao.
  const idsNaFicha = (ficha.body?.workshop?.especialidades ?? []).map((e) => e.id).sort((a, b) => a - b);
  igual('ficha traz os ids certainos', JSON.stringify(idsNaFicha), JSON.stringify([ids[0], ids[2]].sort((a, b) => a - b)));

  const esvazia = await chamar(H.profile, {
    method: 'POST', cookie, body: { operation: 'especialidades', especialidades: [] },
  });
  igual('oficina pode limpar as especialidades', esvazia.body?.total, 0);
}

console.log('\n14. Chassi e garagem');
{
  const semChassi = await chamar(H.vehicles, {
    method: 'POST', cookie: sessaoDe('bruno'),
    body: {
      brand: 'VW', model: 'Gol', color: 'Branco', plate: 'GHI-1A23', year: '2015',
      fuel: 'Flex', mileage: '50000', chassi: '9BWZZZ3771K00',
    },
  });
  igual('chassi curto recusado', semChassi.status, 422);

  const comI = await chamar(H.vehicles, {
    method: 'POST', cookie: sessaoDe('bruno'),
    body: {
      brand: 'VW', model: 'Gol', color: 'Branco', plate: 'GHI-1A23', year: '2015',
      fuel: 'Flex', mileage: '50000', chassi: '9BWIZZ3771K00ABCD',
    },
  });
  igual('chassi com letra I recusado', comI.status, 422);

  const comChassi = await chamar(H.vehicles, {
    method: 'POST', cookie: sessaoDe('bruno'),
    body: {
      brand: 'VW', model: 'Gol G5', color: 'Branco', plate: 'GHI-1A23', year: '2015',
      fuel: 'Flex', mileage: '50000', chassi: '9bwzzz3771k00abcd', notes: 'revisao quarterly',
    },
  });
  igual('veiculo com chassi aceito', comChassi.status, 200);
  const idGol = comChassi.body?.vehicle_id ?? 0;

  const lista = await chamar(H.vehicles, { cookie: sessaoDe('bruno') });
  const gol = lista.body?.vehicles?.find((v) => v.id === idGol);
  igual('chassi gravado em maiusculo', gol?.chassi, '9BWZZZ3771K00ABCD');

  const repetido = await chamar(H.vehicles, {
    method: 'POST', cookie: sessaoDe('bruno'),
    body: {
      brand: 'Outro', model: 'Modelo', color: 'Azul', plate: 'JKL-2B34', year: '2016',
      fuel: 'Flex', mileage: '1', chassi: '9BWZZZ3771K00ABCD',
    },
  });
  igual('chassi repetido no mesmo dono recusado', repetido.status, 422);

  const oficinaGaragem = await chamar(H.profile, {
    method: 'POST', cookie: sessaoDe('oficina'),
    body: {
      name: 'Obrigado Oficina', phone: '(11) 97777-2222', legal_name: 'Oficina LTDA',
      cnpj: '11222333000181', address: 'Rua A, 100', city: 'Sao Paulo', garagem: 1,
    },
  });
  igual('perfil da oficina aceitou garagem', oficinaGaragem.status, 200);
  const comGaragem = await chamar(H.profile, { cookie: sessaoDe('oficina') });
  igual('garagem gravada', comGaragem.body?.workshop?.garagem, true);
  const rede = await chamar(H.workshops, { cookie: sessaoDe('ana') });
  igual('garagem aparece na listagem', rede.body?.workshops?.find((w) => w.id === oficinaId)?.garagem, true);
}

console.log('\n15. Foto da oficina');
{
  const oficinaPhoto = (await chamar(H.workshop, { cookie: sessaoDe('oficina'), query: { id: oficinaId } })).body?.workshop;
  igual('oficina começa com foto do seed', oficinaPhoto?.has_photo, true);
  ok('revisao da foto existe', typeof oficinaPhoto?.photo_rev === 'number', JSON.stringify(oficinaPhoto?.photo_rev));

  const semArquivo = await chamar(H['workshop-photo'], {
    method: 'POST', cookie: sessaoDe('oficina'), body: { operation: 'upload' },
  });
  igual('upload sem arquivo recusado', semArquivo.status, 422);

  const tipoErrado = await chamar(H['workshop-photo'], {
    method: 'POST', cookie: sessaoDe('oficina'),
    body: { 'images[]': { data: Buffer.from('<svg/>'), filename: 'x.svg', mimetype: 'image/svg+xml' } },
  });
  igual('tipo nao suportado recusado', tipoErrado.status, 422);

  const conteudoFalso = await chamar(H['workshop-photo'], {
    method: 'POST', cookie: sessaoDe('oficina'),
    body: { 'images[]': { data: Buffer.from('isto nao e png'), filename: 'x.png', mimetype: 'image/png' } },
  });
  igual('conteudo falso com mime de png recusado', conteudoFalso.status, 422);

  const cliente = await chamar(H['workshop-photo'], {
    method: 'POST', cookie: sessaoDe('ana'),
    body: { 'images[]': img('x.png') },
  });
  igual('cliente nao publica foto de oficina', cliente.status, 403);

  const primeira = await chamar(H['workshop-photo'], {
    method: 'POST', cookie: sessaoDe('oficina'), body: { 'images[]': img('fachada-a.png', 40) },
  });
  igual('foto trocada', primeira.status, 200);
  igual('resposta traz a revisao nova', typeof primeira.body?.photo_rev, 'number');
  ok('revisao mudou depois do upload', Number(primeira.body?.photo_rev) > Number(oficinaPhoto.photo_rev),
    `${oficinaPhoto.photo_rev} -> ${primeira.body?.photo_rev}`);
  igual('resposta traz o tamanho em bytes', typeof primeira.body?.bytes, 'number');

  const listagem = await chamar(H.workshops, { cookie: sessaoDe('ana') });
  const naLista = listagem.body?.workshops?.find((w) => w.id === oficinaId);
  igual('listagem mantem has_photo', naLista?.has_photo, true);
  igual('listagem traz a revisao', naLista?.photo_rev, primeira.body?.photo_rev);

  const bytes1 = await chamar(H.image, { query: { tipo: 'workshop', id: oficinaId } });
  igual('foto publica sem sessao', bytes1.status, 200);
  const etag1 = bytes1.headers?.etag;
  ok('foto publica tem ETag', !!etag1, JSON.stringify(bytes1.headers));

  // A revisao e o ETag existem para o navegador nao servir a foto antiga.
  const revalidado = await chamar(H.image, {
    query: { tipo: 'workshop', id: oficinaId }, headers: { 'if-none-match': etag1 },
  });
  igual('ETag igual devolve 304 sem bytes', revalidado.status, 304);

  const segunda = await chamar(H['workshop-photo'], {
    method: 'POST', cookie: sessaoDe('oficina'), body: { 'images[]': img('fachada-b.png', 90) },
  });
  ok('segundo upload muda a revisao', Number(segunda.body?.photo_rev) > Number(primeira.body?.photo_rev),
    `${primeira.body?.photo_rev} -> ${segunda.body?.photo_rev}`);

  const bytes2 = await chamar(H.image, { query: { tipo: 'workshop', id: oficinaId } });
  ok('foto trocada tem ETag diferente', bytes2.headers?.etag !== etag1,
    `${etag1} vs ${bytes2.headers?.etag}`);
  const revalidado2 = await chamar(H.image, {
    query: { tipo: 'workshop', id: oficinaId }, headers: { 'if-none-match': etag1 },
  });
  igual('ETag velho devolve a foto nova', revalidado2.status, 200);

  const varias = await chamar(H['workshop-photo'], {
    method: 'POST', cookie: sessaoDe('oficina'),
    body: { 'images[]': [img('um.png', 11), img('dois.png', 22)] },
  });
  igual('varias fotos aceitam a primeira', varias.status, 200);
  ok('avisa que a fachada e uma so', /arquivo\(s\) ignorado/.test(varias.body?.aviso || ''),
    JSON.stringify(varias.body?.aviso));

  const removido = await chamar(H['workshop-photo'], {
    method: 'POST', cookie: sessaoDe('oficina'), body: { operation: 'remove' },
  });
  igual('foto removida', removido.status, 200);
  igual('resposta diz que nao ha mais foto', removido.body?.has_photo, false);
  ok('remover tambem muda a revisao', Number(removido.body?.photo_rev) > Number(varias.body?.photo_rev),
    `${varias.body?.photo_rev} -> ${removido.body?.photo_rev}`);

  const depoisDeRemover = await chamar(H.image, { query: { tipo: 'workshop', id: oficinaId } });
  igual('endpoint de imagem responde 404 sem foto', depoisDeRemover.status, 404);

  const listagemFinal = await chamar(H.workshops, { cookie: sessaoDe('ana') });
  igual('card sem foto nao pede imagem', listagemFinal.body?.workshops?.find((w) => w.id === oficinaId)?.has_photo, false);

  const operationRuim = await chamar(H['workshop-photo'], {
    method: 'POST', cookie: sessaoDe('oficina'), body: { operation: 'inventada' },
  });
  igual('operacao invalida recusada', operationRuim.status, 422);

  // Devolve a foto para os testes seguintes.
  await chamar(H['workshop-photo'], {
    method: 'POST', cookie: sessaoDe('oficina'), body: { 'images[]': img('restaurada.png', 77) },
  });
}

// ------------------------------------------------------------------ resumo
for (const sufixo of ['', '-wal', '-shm']) {
  try { rmSync(arq + sufixo, { force: true }); } catch { /* arquivoBusy: irrelevante */ }
}

console.log(`\n${'-'.repeat(60)}`);
if (falhas.length) {
  console.log(`${passou} passaram, ${falhas.length} FALHARAM:`);
  for (const f of falhas) console.log(`  - ${f}`);
  process.exitCode = 1;
} else {
  console.log(`Tudo certo: ${passou} verificacoes passaram.`);
}
