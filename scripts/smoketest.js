/**
 * Teste de fumaça contra uma API de verdade (dev local ou produção).
 *
 * uso:
 *   npm run test:prod                  produção (https://radar-mecanico.vercel.app)
 *   node scripts/smoketest.js http://127.0.0.1:8787
 *
 * Percorre o caminho que o usuário faz, com as contas do seed: sessão, login,
 * rede de oficinas, garagem, foto do veículo (upload multipart + BYTEA),
 * fachada da oficina (upload, leitura e restauração byte a byte) e a central
 * de administração.
 *
 * O veículo criado é excluído no fim e a foto da oficina volta a ser a
 * original. O único resíduo é o contador photo_rev, que só serve para quebrar
 * cache de imagem.
 */
const BASE = process.argv[2] || process.env.BASE || 'http://127.0.0.1:8787';
let cookie = '';
const falhas = [];
let ok = 0;

const anota = (nome, cond, detalhe = '') => {
  if (cond) {
    ok++;
    console.log(`  OK    ${nome}`);
  } else {
    falhas.push(nome);
    console.log(`  FALHA ${nome}${detalhe ? ' -> ' + detalhe : ''}`);
  }
};

/** Chama a API guardando o cookie de sessão, como o navegador faria. */
async function call(method, caminho, { json, form, headers = {} } = {}) {
  const h = { 'X-Requested-With': 'radar', ...headers };
  if (cookie) h.Cookie = cookie;
  let corpo;
  if (json !== undefined) {
    h['Content-Type'] = 'application/json';
    corpo = JSON.stringify(json);
  } else if (form) {
    corpo = form;
  }
  const r = await fetch(BASE + caminho, { method, headers: h, body: corpo, redirect: 'manual' });
  for (const c of r.headers.getSetCookie?.() ?? []) {
    const par = c.split(';')[0];
    if (par.startsWith('sessao=')) cookie = par.endsWith('=') ? '' : par;
  }
  const tipo = r.headers.get('content-type') || '';
  if (tipo.includes('application/json')) {
    const dados = await r.json().catch(() => null);
    return { status: r.status, dados, headers: r.headers };
  }
  return { status: r.status, bytes: Buffer.from(await r.arrayBuffer()), headers: r.headers };
}

/** PNG 1x1 válido: serve para conferir o caminho binário de ponta a ponta. */
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

console.log(`\n== ${BASE} ==`);

// ------------------------------------------------------------------ sessão
let r = await call('GET', '/api/session');
anota('sessão vazia sem cookie', r.dados?.user === null, JSON.stringify(r.dados));

// -------------------------------------------------------- cliente: início
r = await call('POST', '/api/login', { json: { email: 'demo-cliente-marina@radar.local', password: 'Demo@2026' } });
anota('login do cliente', r.status === 200 && r.dados?.user?.role === 'client', `${r.status} ${JSON.stringify(r.dados)}`);

r = await call('GET', '/api/workshops');
const oficinas = r.dados?.workshops ?? [];
anota('lista de oficinas', r.status === 200 && oficinas.length >= 6, `${r.status} n=${oficinas.length}`);
anota('oficinas trazem especialidades', oficinas.every((o) => Array.isArray(o.especialidades)));
anota('oficinas trazem nota média', oficinas.every((o) => typeof o.rating === 'number'));

r = await call('GET', '/api/vehicles');
const veiculos = r.dados?.vehicles ?? [];
anota('garagem do cliente', r.status === 200 && veiculos.length >= 2, `n=${veiculos.length}`);

r = await call('GET', '/api/requests');
anota('pedidos do cliente', r.status === 200 && Array.isArray(r.dados?.requests), JSON.stringify(r.dados).slice(0, 120));

r = await call('GET', '/api/profile');
anota('perfil do cliente', r.status === 200 && r.dados?.user?.email === 'demo-cliente-marina@radar.local', `${r.status}`);
anota('perfil traz endereços', Array.isArray(r.dados?.enderecos), JSON.stringify(r.dados?.enderecos));

// -------------------------------------- ciclo de veículo com foto (reversível)
const placa = 'ABC' + Math.floor(Math.random() * 9 + 1) + 'D' + String(Math.floor(Math.random() * 90 + 10));
r = await call('POST', '/api/vehicles', {
  json: { brand: 'Teste', model: 'Smoke', color: 'Azul', plate: placa, year: 2021, fuel: 'Flex', mileage: 12345 },
});
const carroId = r.dados?.vehicle_id;
anota('cria veículo', r.status === 200 && carroId > 0, `${r.status} ${JSON.stringify(r.dados)}`);

const formCarro = new FormData();
formCarro.append('vehicle_id', String(carroId));
formCarro.append('images[]', new Blob([png], { type: 'image/png' }), 'smoke.png');
r = await call('POST', '/api/vehicle-upload', { form: formCarro });
anota('upload de foto do veículo (multipart)', r.status === 200, `${r.status} ${JSON.stringify(r.dados)}`);

r = await call('GET', `/api/vehicle-images?vehicle_id=${carroId}`);
const fotosCarro = r.dados?.images ?? [];
anota('foto do veículo listada', fotosCarro.length === 1, JSON.stringify(r.dados));

r = await call('GET', `/api/image?tipo=vehicle&id=${fotosCarro[0]?.id}`);
anota('bytes da foto do veículo', r.status === 200 && r.bytes?.equals(png), `${r.status} bytes=${r.bytes?.length}`);

r = await call('POST', '/api/vehicle-delete', { json: { vehicle_id: carroId } });
anota('exclui veículo (limpa as fotos)', r.status === 200, `${r.status}`);

r = await call('GET', `/api/vehicle-images?vehicle_id=${carroId}`);
anota('fotos somem junto com o veículo', r.status === 404, `${r.status}`);

await call('POST', '/api/logout');

// ------------------------------------------------- oficina: foto da fachada
r = await call('POST', '/api/login', { json: { email: 'demo-oficina-silva@radar.local', password: 'Demo@2026' } });
anota('login da oficina', r.status === 200 && r.dados?.user?.role === 'workshop', `${r.status}`);

r = await call('GET', '/api/profile');
const oficina = r.dados?.workshop;
const fotoOficina = r.dados?.foto;
anota('perfil da oficina', r.status === 200 && oficina?.id > 0, `${r.status}`);
anota('oficina tem foto no seed', fotoOficina?.has_photo === true, JSON.stringify(fotoOficina));

const original = await call('GET', `/api/image?tipo=workshop&id=${oficina?.id}`);
anota('foto da oficina servida', original.status === 200 && original.bytes?.length > 100, `${original.status} bytes=${original.bytes?.length}`);
const mimeOriginal = original.headers.get('content-type') || 'image/png';
const revAntes = fotoOficina?.photo_rev;

const formOficina = new FormData();
formOficina.append('images[]', new Blob([png], { type: 'image/png' }), 'fachada.png');
r = await call('POST', '/api/workshop-photo', { form: formOficina });
anota('upload da foto da oficina (multipart)', r.status === 200 && r.dados?.photo_rev > revAntes, `${r.status} ${JSON.stringify(r.dados)}`);

r = await call('GET', `/api/image?tipo=workshop&id=${oficina?.id}&rev=${r.dados?.photo_rev}`);
anota('foto nova servida', r.status === 200 && r.bytes?.equals(png), `${r.status}`);

// Devolve a foto original, para o teste não alterar o visual do site.
const formVolta = new FormData();
formVolta.append('images[]', new Blob([original.bytes], { type: mimeOriginal.split(';')[0] }), 'original.png');
r = await call('POST', '/api/workshop-photo', { form: formVolta });
anota('foto original restaurada', r.status === 200, `${r.status}`);
const restaurada = await call('GET', `/api/image?tipo=workshop&id=${oficina?.id}`);
anota('bytes restaurados batem', restaurada.status === 200 && restaurada.bytes?.equals(original.bytes), `${restaurada.status}`);

await call('POST', '/api/logout');

// ---------------------------------------------------------- administração
r = await call('POST', '/api/login', { json: { email: 'admin@radarmecanico.local', password: 'RadarAdm@2026' } });
anota('login do admin', r.status === 200 && r.dados?.user?.role === 'admin', `${r.status}`);

r = await call('GET', '/api/admin-users');
anota('central de administração', r.status === 200 && (r.dados?.users?.length ?? 0) >= 13, `${r.status} n=${r.dados?.users?.length}`);

await call('POST', '/api/logout');
r = await call('GET', '/api/session');
anota('sessão encerrada no fim', r.dados?.user === null, JSON.stringify(r.dados));

console.log(`\n${ok} OK, ${falhas.length} falha(s)`);
if (falhas.length) {
  console.log('Falhas: ' + falhas.join('; '));
  process.exitCode = 1;
}
