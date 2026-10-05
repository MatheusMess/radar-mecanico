/**
 * Radar Mecânico — interface.
 *
 * Diferenças em relação à versão em PHP:
 *   - o backend virou /api (funções serverless), não mais api.php?action=
 *   - a sessão é um cookie httpOnly; não há mais token CSRF para guardar
 *   - as imagens são servidas por /api/image?id=N&tipo=..., guardadas como BLOB
 *
 * Carregado como script clássico (não módulo): os templates usam handlers
 * inline como onclick="go('requests')", que só funcionam se as funções
 * estiverem no escopo global.
 */

let me = null;
let view = 'home';
let filtroEstrelas = 0;

const app = document.querySelector('#app');

const e = (s) => String(s ?? '').replace(/[&<>'"]/g, (c) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;',
}[c]));

const form = (f) => Object.fromEntries(new FormData(f));

// ---------------------------------------------------------------------------
// API
// ---------------------------------------------------------------------------

/** GET/POST JSON em /api/<recurso>. */
async function api(recurso, metodo = 'GET', dados) {
  const init = {
    method: metodo,
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'X-Requested-With': 'radar' },
  };
  if (dados !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(dados);
  }
  let r;
  let j;
  try {
    r = await fetch(`/api/${recurso}`, init);
    j = await r.json();
  } catch {
    throw Error('Não foi possível falar com o servidor. Verifique sua conexão.');
  }
  if (!r.ok) throw Error(j?.error || 'Não foi possível concluir a operação.');
  return j;
}

/** POST multipart (upload de imagens). */
async function apiUpload(recurso, formData) {
  const r = await fetch(`/api/${recurso}`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'X-Requested-With': 'radar' },
    body: formData,
  });
  let j;
  try { j = await r.json(); } catch { throw Error('Resposta inválida do servidor.'); }
  if (!r.ok) throw Error(j?.error || 'Falha no envio.');
  return j;
}

const imgVeiculo = (id) => `/api/image?tipo=vehicle&id=${id}`;
const imgPedido = (id) => `/api/image?tipo=request&id=${id}`;
// A revisao da foto entra na URL: se a foto mudasse sem isso, o navegador
// serviria a versao anterior do cache por 24 h depois do upload.
const imgOficina = (id, rev) => `/api/image?tipo=workshop&id=${id}${rev ? `&v=${rev}` : ''}`;

// ---------------------------------------------------------------------------
// Tema
// ---------------------------------------------------------------------------
const TEMA_KEY = 'radar-tema';

function temaAtual() {
  return document.documentElement.classList.contains('light') ? 'light' : 'dark';
}

function setTheme(t) {
  document.documentElement.classList.toggle('light', t === 'light');
  try { localStorage.setItem(TEMA_KEY, t); } catch (err) { /* modo restrito */ }
  // Aplica a url da imagem carregada agora.
  for (const link of document.querySelectorAll('link[rel="icon"][media]')) link.remove();
  const icon = document.createElement('link');
  icon.rel = 'icon';
  icon.type = 'image/png';
  icon.href = t === 'light' ? 'assets/radar-mark-dark.png' : 'assets/radar-mark.png';
  document.head.appendChild(icon);
  document.querySelectorAll('[data-tema-label]').forEach((x) => {
    x.textContent = t === 'light' ? 'Escuro' : 'Claro';
  });
  document.querySelectorAll('.theme-switch').forEach((x) => x.classList.toggle('on', t === 'light'));
}

const toggleTheme = () => setTheme(temaAtual() === 'light' ? 'dark' : 'light');
const brandHtml = () => '<img class="brand-logo" src="assets/radar-mark.png" alt="">';

function themeButton() {
  return `<button class="theme-switch" type="button" onclick="toggleTheme()" title="Alternar tema">`
    + `<span class="toggle-dot"></span>`
    + `<span data-tema-label>${temaAtual() === 'light' ? 'Escuro' : 'Claro'}</span></button>`;
}

// ---------------------------------------------------------------------------
// Máscaras e validações de entrada
// ---------------------------------------------------------------------------
const ANO_MIN = 1886;
const anoMax = () => new Date().getFullYear() + 1;

function maskPlate(el) {
  const raw = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 7);
  el.value = raw.length <= 3 ? raw : `${raw.slice(0, 3)}-${raw.slice(3)}`;
}

// O banco guarda a placa sem separador; para exibir, reinsere o hífen.
const fmtPlate = (v) => {
  const p = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return p.length > 3 ? `${p.slice(0, 3)}-${p.slice(3)}` : p;
};

function maskCpfCnpj(el) {
  const d = el.value.replace(/\D/g, '').slice(0, 14);
  el.value = d.length > 11
    ? d.replace(/^(\d{2})(\d{5})(\d{3})(\d{1,4})$/, '$1.$2.$3/$4')
    : d.replace(/^(\d{3})(\d{3})(\d{3})(\d{0,2})$/, '$1.$2.$3-$4');
}

/** Máscara de CEP: 00000-000. */
function maskCep(el) {
  const d = el.value.replace(/\D/g, '').slice(0, 8);
  el.value = d.length > 5 ? d.replace(/^(\d{5})(\d{1,3})$/, '$1-$2') : d;
}
const fmtCep = (v) => {
  const d = String(v ?? '').replace(/\D/g, '');
  return d.length === 8 ? d.replace(/^(\d{5})(\d{3})$/, '$1-$2') : d;
};

/** Chassi: 17 caracteres, sem I, O e Q. */
function maskChassi(el) {
  el.value = el.value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 17);
}

const fmtDoc = (v) => {  const d = String(v ?? '').replace(/\D/g, '');
  if (d.length === 11) return d.replace(/^(\d{3})(\d{3})(\d{3})(\d{2})$/, '$1.$2.$3-$4');
  if (d.length === 14) return d.replace(/^(\d{2})(\d{5})(\d{3})(\d{4})$/, '$1.$2.$3/$4');
  return String(v ?? '');
};

const anoValido = (y) => /^\d{4}$/.test(String(y)) && +y >= ANO_MIN && +y <= anoMax();

/** Validação de placa no navegador, espelhando valid_plate() do servidor. */
const placaValida = (v) => {
  const p = String(v ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^[A-Z]{3}(?:[0-9]{4}|[0-9][A-Z][0-9]{2})$/.test(p);
};

function toast(texto, erro) {
  document.querySelector('.toast')?.remove();
  const t = document.createElement('div');
  t.className = `toast${erro ? ' danger' : ''}`;
  t.textContent = texto;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3400);
}

// ---------------------------------------------------------------------------
// Autenticação
// ---------------------------------------------------------------------------
function loginPage() {
  app.innerHTML = `<main class="auth-page"><section class="auth-brand"><div class="brand">${brandHtml()} Radar Mecânico</div><div><div class="hero-kicker">Acesso seguro</div><h1>Diagnóstico certo.<br><span>Sem perder tempo.</span></h1><p>Solicite e responda orçamentos em uma rede confiável de oficinas.</p></div></section><section class="auth-panel"><div class="eyebrow">Entrar</div><h2>Acesse sua conta</h2><form id="login"><label class="form-label">E-mail</label><input class="input" name="email" type="email" required><label class="form-label">Senha</label><input class="input" name="password" type="password" minlength="8" required><button class="btn primary full">Entrar →</button></form><p>Não possui conta? <button class="link-btn" onclick="registerPage()">Criar conta</button></p><div id="msg"></div></section></main>`;
  document.querySelector('#login').onsubmit = async (x) => {
    x.preventDefault();
    try {
      const r = await api('login', 'POST', form(x.target));
      me = r.user;
      view = inicialView();
      render();
    } catch (q) { msg(q.message); }
  };
}

function msg(x) {
  document.querySelector('#msg').innerHTML = `<div class="demo-box">${e(x)}</div>`;
}

function registerPage() {
  app.innerHTML = `<main class="auth-page"><section class="auth-brand"><div class="brand">${brandHtml()} Radar Mecânico</div><div><div class="hero-kicker">Novo cadastro</div><h1>Faça parte da<br><span>rede Radar.</span></h1><p>Dados completos ajudam a manter Clientes e Oficinas protegidos.</p></div></section><section class="auth-panel"><div class="eyebrow">Cadastro</div><h2>Crie sua conta</h2><div class="role-switch"><button id="clientRole" type="button" class="active">Sou Cliente</button><button id="workshopRole" type="button">Sou Oficina</button></div><form id="signup"><input name="role" value="client" type="hidden"><label class="form-label">Nome completo</label><input class="input" name="name" required><label class="form-label">E-mail</label><input class="input" name="email" type="email" required><label class="form-label">Telefone</label><input class="input" name="phone" required><div id="fields"><label class="form-label">CPF</label><input class="input" name="cpf" required placeholder="000.000.000-00" oninput="maskCpfCnpj(this)"></div><label class="form-label">Senha (mín. 8 caracteres)</label><input class="input" name="password" type="password" minlength="8" required><button class="btn primary full">Criar conta →</button></form><p><button type="button" class="link-btn" onclick="loginPage()">← Voltar</button></p><div id="msg"></div></section></main>`;
  document.querySelector('#clientRole').addEventListener('click', () => setRegisterRole('client'));
  document.querySelector('#workshopRole').addEventListener('click', () => setRegisterRole('workshop'));
  document.querySelector('#signup').onsubmit = async (x) => {
    x.preventDefault();
    try {
      const r = await api('register', 'POST', form(x.target));
      me = r.user;
      view = inicialView();
      render();
    } catch (q) { msg(q.message); }
  };
}

function setRegisterRole(r) {
  document.querySelectorAll('.role-switch button').forEach((x) => x.classList.toggle('active',
    (r === 'client' && x.id === 'clientRole') || (r === 'workshop' && x.id === 'workshopRole')));
  document.querySelector('[name=role]').value = r;
  document.querySelector('#fields').innerHTML = r === 'client'
    ? '<label class="form-label">CPF</label><input class="input" name="cpf" required placeholder="000.000.000-00" oninput="maskCpfCnpj(this)">'
    : `<label class="form-label">Razão social</label><input class="input" name="legal_name" required>
       <label class="form-label">CNPJ</label><input class="input" name="cnpj" required placeholder="00.000.000/0000-00" oninput="maskCpfCnpj(this)">
       <label class="form-label">Endereço</label><input class="input" name="address" required>
       <label class="form-label">Cidade</label><input class="input" name="city" required>
       <label class="form-label">Serviços</label><input class="input" name="services" placeholder="Revisão, freios, elétrica">`;
}

async function logout() {
  try { await api('logout', 'POST'); } catch { /* cookie morre no servidor de qualquer jeito */ }
  me = null;
  view = 'home';
  loginPage();
}

// ---------------------------------------------------------------------------
// Estrutura e rotas
// ---------------------------------------------------------------------------
const VIEWS_CLIENT = ['home', 'workshops', 'requests', 'vehicles', 'profile'];
const VIEWS_OFFICE = ['requests', 'profile'];
const VIEWS_ADMIN = ['admin', 'profile'];

const allowedViews = () => (me?.role === 'admin' ? VIEWS_ADMIN : me?.role === 'workshop' ? VIEWS_OFFICE : VIEWS_CLIENT);
const inicialView = () => (me?.role === 'admin' ? 'admin' : me?.role === 'workshop' ? 'requests' : 'home');

function shell(content) {
  const office = me.role === 'workshop';
  const admin = me.role === 'admin';
  const nav = admin
    ? [['admin', '▦', 'Central de controle']]
    : office
      ? [['requests', '▣', 'Pedidos recebidos']]
      : [['home', '⌂', 'Página Inicial'], ['workshops', '⌕', 'Buscar Oficinas'], ['requests', '▣', 'Meus Pedidos'], ['vehicles', '▰', 'Meus Veículos']];
  const perfilLabel = admin ? 'Minha conta' : office ? 'Dados da Oficina' : 'Meus dados';
  return `<div class="shell"><header class="topbar"><div class="brand">${brandHtml()} Radar Mecânico</div><div class="top-actions">${themeButton()}<span class="top-user">${e(me.name)}</span><button class="btn ghost" onclick="logout()">Sair</button></div></header><aside class="side"><div class="side-label">NAVEGAÇÃO</div>${nav.map((n) => `<button class="nav-item ${view === n[0] ? 'active' : ''}" onclick="go('${n[0]}')"><span class="nav-icon">${n[1]}</span>${n[2]}</button>`).join('')}<button class="nav-item ${view === 'profile' ? 'active' : ''}" onclick="go('profile')"><span class="nav-icon">◎</span>${perfilLabel}</button><div class="side-footer">RADAR MECÂNICO<br>${admin ? 'ADMINISTRAÇÃO' : office ? 'OFICINA' : 'CLIENTE'}</div></aside><main class="main">${content}</main></div>`;
}

function go(v) {
  if (!allowedViews().includes(v)) v = inicialView();
  view = v;
  if (location.hash.slice(1) !== v) history.pushState({ view: v }, '', `#${v}`);
  render();
}

function syncHash() {
  const alvo = location.hash.slice(1);
  if (alvo && allowedViews().includes(alvo) && alvo !== view) {
    view = alvo;
    render();
  }
}
window.addEventListener('popstate', syncHash);

async function render() {
  try {
    const c = view === 'admin' ? await adminPanel()
      : view === 'profile' ? await profile()
        : view === 'home' ? await home()
          : view === 'vehicles' ? await vehicles()
            : view === 'requests' ? await requests()
              : await workshops();
    app.innerHTML = shell(c);
  } catch (x) {
    if (/Sessão expirada/.test(x.message)) {
      me = null;
      loginPage();
      return;
    }
    app.innerHTML = shell(`<div class="empty">${e(x.message)}</div>`);
  }
}

// ---------------------------------------------------------------------------
// Avaliações e estrelas (RF12/RF13)
// ---------------------------------------------------------------------------
const STATUS_LABEL = {
  open: 'Solicitado', responded: 'Orçamento enviado', in_progress: 'Em andamento',
  completed: 'Concluído', cancelled: 'Cancelado',
};
const STATUS_FLOW = ['open', 'responded', 'in_progress', 'completed'];

function stars(valor, total) {
  const n = Number(valor) || 0;
  let html = '<span class="stars" aria-hidden="true">';
  for (let i = 1; i <= 5; i++) html += i <= Math.round(n) ? '★' : '☆';
  html += '</span>';
  if (total === undefined) return html;
  return `${html}<b>${n ? n.toFixed(1).replace('.0', '') : '—'}</b><small>${total} ${total === 1 ? 'avaliação' : 'avaliações'}</small>`;
}

function commentBlock(list, limite) {
  if (!list?.length) return '<div class="empty">Ainda não há avaliações nesta oficina.</div>';
  const shown = list.slice(0, limite ?? list.length);
  return `<div class="review-list">${shown.map((r) => `<article class="review">
      <div class="review-head"><b>${e(r.client_name)}</b>${stars(r.rating)}<small>${e(r.created_at)}</small></div>
      ${r.comment ? `<p>${e(r.comment)}</p>` : '<p class="muted">Sem comentário.</p>'}
    </article>`).join('')}</div>${list.length > shown.length ? `<p class="hint">Mostrando ${shown.length} de ${list.length} avaliações.</p>` : ''}`;
}

function starPicker(name, inicial) {
  const atual = inicial || 5;
  return '<div class="star-picker" data-picker>'
    + [1, 2, 3, 4, 5].map((i) => `<label class="star-opt" title="${i} estrela${i > 1 ? 's' : ''}">
      <input type="radio" name="${name}" value="${i}" ${i === atual ? 'checked' : ''} required>
      <span>${i <= atual ? '★' : '☆'}</span></label>`).join('')
    + '</div><small class="hint">Selecione de 1 a 5 estrelas.</small>';
}

function bindStarPicker() {
  document.querySelectorAll('[data-picker]').forEach((box) => {
    const spans = [...box.querySelectorAll('.star-opt span')];
    const paint = (v) => spans.forEach((s, i) => { s.textContent = i < v ? '★' : '☆'; });
    box.querySelectorAll('input').forEach((r) => {
      r.addEventListener('change', () => paint(+r.value));
      r.addEventListener('mouseenter', () => paint(+r.value));
    });
    box.addEventListener('mouseleave', () => paint(+(box.querySelector('input:checked')?.value || 0)));
  });
}

function reviewModal(requestId) {
  modal('Avaliar o serviço', `<form id="reviewForm">
    <p class="subhead">Como foi o atendimento desta oficina?</p>
    <label class="form-label">Sua nota *</label>
    ${starPicker('rating', 5)}
    <label class="form-label">Comentário (opcional)</label>
    <textarea class="input" name="comment" rows="4" maxlength="600" placeholder="Conte o que a oficina fez bem ou o que pode melhorar."></textarea>
    <button class="btn primary full">Enviar avaliação</button></form>`);
  bindStarPicker();
  document.querySelector('#reviewForm').onsubmit = async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    try {
      await api('reviews', 'POST', {
        request_id: requestId, rating: +f.rating.value, comment: f.comment.value,
      });
      closeModal();
      view = 'requests';
      render();
      toast('Avaliação enviada. Obrigado!');
    } catch (x) { toast(x.message, true); }
  };
}

async function workshopDetail(id) {
  const r = await api(`workshop?id=${id}`);
  const w = r.workshop;
  const d = w.distribution;
  const bars = [5, 4, 3, 2, 1].map((n) => `<div class="dist-row"><span>${n}★</span>
      <span class="dist-bar"><i style="width:${w.review_count ? Math.round((d[n] * 100) / w.review_count) : 0}%"></i></span>
      <small>${d[n]}</small></div>`).join('');
  modal(w.legal_name, `
    ${w.has_photo ? `<div class="shop-photo detail-photo" style="background-image:url('${imgOficina(w.id, w.photo_rev)}')"></div>` : ''}
    <div class="shop-detail-head">
      <div><small>AVALIAÇÃO MÉDIA</small><div class="big-stars">${stars(w.rating, w.review_count)}</div></div>
      <div class="dist">${bars}</div>
    </div>
    <hr class="rule">
    <p>${e(w.description || 'Esta oficina ainda não escreveu uma descrição.')}</p>
    <div class="contact-row"><i>◎</i> ${e(w.city)}${w.address ? ` · ${e(w.address)}` : ''}</div>
    <div class="contact-row"><i>☎</i> ${e(w.phone)}</div>
    ${w.opening_hours ? `<div class="contact-row"><i>◷</i> ${e(w.opening_hours)}</div>` : ''}
    ${w.garagem ? '<p class="hint"><b>Garagem própria:</b> o veículo do cliente fica guardado no local.</p>' : ''}
    ${w.especialidades?.length ? `<h3 class="panel-title">Especialidades</h3><div class="tag-row">${w.especialidades.map((x) => `<span class="tag">${e(x.nome)}</span>`).join('')}</div>` : ''}
    ${w.services ? `<p class="hint"><b>Serviços:</b> ${e(w.services)}</p>` : ''}
    ${w.request_count ? `<p class="hint">${w.request_count} pedido(s) já realizados pela rede.</p>` : ''}
    <hr class="rule">
    <h3 class="panel-title">Avaliações dos clientes</h3>
    ${commentBlock(w.reviews, 10)}`);
}

function card(w) {
  // Só pede a foto quando existe: sem isso, oficina recém-cadastrada geraria
  // um 404 em /api/image e o card ficaria com fundo vazio.
  const foto = w.has_photo
    ? `<div class="shop-photo" style="background-image:url('${imgOficina(w.id, w.photo_rev)}')"><span class="badge">Parceira verificada</span></div>`
    : '<div class="shop-photo"><span class="badge">Parceira verificada</span></div>';
  const etiquetas = (w.especialidades || []).slice(0, 3).map((x) => `<span class="tag">${e(typeof x === 'string' ? x : x.nome)}</span>`).join('');
  const garagem = w.garagem ? '<span class="tag tag-ok">Garagem própria</span>' : '';
  return `<article class="shop-card">${foto}<div class="shop-info"><h3>${e(w.legal_name)}</h3><div class="shop-meta"><span>${e(w.city)}</span><span class="rating-line">${stars(w.rating, w.review_count)}</span></div>${etiquetas || garagem ? `<div class="tag-row">${etiquetas}${garagem}</div>` : ''}</div><div class="shop-footer"><span>${e(w.services || 'Serviços gerais')}</span><span class="card-actions"><button class="link-btn" onclick="workshopDetail(${w.id})">VER AVALIAÇÕES</button><button class="link-btn" onclick="requestModal(${w.id})">ORÇAMENTO →</button></span></div></article>`;
}

// ---------------------------------------------------------------------------
// Páginas
// ---------------------------------------------------------------------------
function filtroEstrelasHtml() {
  return `<div class="star-filter"><span>Avaliação mínima</span>${
    [0, 1, 2, 3, 4, 5].map((n) => `<button class="pill ${filtroEstrelas === n ? 'on' : ''}" onclick="setFiltro(${n})">${n === 0 ? 'Todas' : `${n}★`}</button>`).join('')}</div>`;
}
function setFiltro(n) { filtroEstrelas = n; render(); }

async function home() {
  const [r, meus] = await Promise.all([
    api(`workshops${filtroEstrelas ? `?min_stars=${filtroEstrelas}` : ''}`),
    me.role === 'client' ? api('requests') : Promise.resolve({ requests: [] }),
  ]);
  const pendentes = (meus.requests || []).filter((x) => x.status === 'completed' && !x.review_id);
  const aviso = pendentes.length
    ? `<div class="review-callout"><div><b>${pendentes.length} serviço${pendentes.length > 1 ? 's' : ''} concluído${pendentes.length > 1 ? 's' : ''} aguardando sua avaliação</b><small>Conte como foi o atendimento para a oficina ${e(pendentes[0].workshop_name)} e outros clientes.</small></div><button class="btn primary" onclick="reviewModal(${pendentes[0].id})">★ AVALIAR AGORA</button></div>`
    : '';
  return `<div class="dashboard-top"><div><div class="eyebrow">Painel do Cliente</div><h1 class="page-title">Olá, ${e(String(me.name).split(' ')[0])}.</h1><p class="subhead">Encontre especialistas e acompanhe seus orçamentos.</p></div><button class="btn primary" onclick="requestModal()">+ Solicitar orçamento</button></div>${aviso}${filtroEstrelasHtml()}<div class="section-head"><h2 class="section-title">Oficinas em destaque</h2></div><div class="grid">${r.workshops.map(card).join('') || '<div class="empty">Nenhuma oficina cadastrada.</div>'}</div>`;
}

async function workshops() {
  const r = await api(`workshops${filtroEstrelas ? `?min_stars=${filtroEstrelas}` : ''}`);
  return `<div class="eyebrow">Rede de parceiros</div><h1 class="page-title">Buscar oficinas</h1><p class="subhead">Solicite um orçamento diretamente à oficina escolhida.</p>${filtroEstrelasHtml()}<div class="grid">${r.workshops.map(card).join('') || '<div class="empty">Nenhuma oficina disponível.</div>'}</div>`;
}

async function requests() {
  const r = await api('requests');
  const office = me.role === 'workshop';
  const lista = r.requests.map((o) => {
    const podeAvaliar = !office && o.status === 'completed' && !o.review_id;
    const encerrado = o.status === 'completed' || o.status === 'cancelled';
    // Para um pedido em aberto a oficina só pode recusar (cancelar). Concluir
// direto de "aberto" permitiria o cliente avaliar um serviço nunca orçado.
const acoesOficina = office && !encerrado
  ? `<button class="btn ghost" onclick="mudarStatus(${o.id},'${o.status === 'open' ? 'cancelled' : o.status === 'responded' ? 'in_progress' : 'completed'}')">${o.status === 'open' ? 'RECUSAR' : o.status === 'responded' ? 'ACEITAR' : 'CONCLUIR'}</button>`
  : '';
    const cancelar = !office && (o.status === 'open' || o.status === 'responded')
      ? `<button class="btn ghost" onclick="mudarStatus(${o.id},'cancelled')">CANCELAR</button>` : '';
    const responder = office && !encerrado
      ? `<button class="btn primary" onclick="quoteModal(${o.id})">RESPONDER</button>` : '';
    return `<article class="request"><div><strong>${e(o.service_type)}</strong><small>#${o.id} · ${e(o.created_at)}${o.image_count ? ` · ${o.image_count} foto(s)` : ''}</small></div><div><small>${office ? 'CLIENTE' : 'OFICINA'}</small><strong>${e(office ? o.client_name : o.workshop_name)}</strong></div><div><small>VEÍCULO</small><strong>${e(o.make_model || 'Não informado')}</strong></div><div><span class="status ${e(o.status)}">${e(STATUS_LABEL[o.status] || o.status)}</span></div><div class="request-acts">${acoesOficina}${cancelar}<button class="btn ghost" onclick="detail(${o.id})">DETALHES</button>${responder}${podeAvaliar ? `<button class="btn primary" onclick="reviewModal(${o.id})">★ AVALIAR</button>` : ''}${o.review_id ? '<span class="reviewed">Avaliado</span>' : ''}</div></article>`;
  }).join('');
  return `<div class="dashboard-top"><div><div class="eyebrow">${office ? 'Central de atendimento' : 'Acompanhamento'}</div><h1 class="page-title">${office ? 'Pedidos recebidos' : 'Meus pedidos'}</h1><p class="subhead">${office ? 'Aceite o orçamento, acompanhe o serviço e conclua para receber a avaliação.' : 'Acompanhe o status do serviço e avalie a oficina quando for concluído.'}</p></div>${office ? '' : '<button class="btn primary" onclick="requestModal()">+ Novo pedido</button>'}</div><div class="request-list">${lista || '<div class="empty">Nenhum pedido por enquanto.</div>'}</div>`;
}

async function mudarStatus(id, novo) {
  if (novo === 'cancelled' && !confirm('Deseja realmente cancelar este pedido?')) return;
  try {
    const r = await api('request-status', 'POST', { request_id: id, status: novo });
    render();
    toast(r.label + (novo === 'completed' ? ' — o cliente já pode avaliar.' : '.'));
  } catch (x) { toast(x.message, true); }
}

// ---------------------------------------------------------------------------
// Perfil (RF03/RF04)
// ---------------------------------------------------------------------------
async function profile() {
  const r = await api('profile');
  const w = r.workshop || {};
  const office = me.role === 'workshop';
  const admin = me.role === 'admin';
  const s = r.stats || {};
  const kpis = office ? [['Pedidos recebidos', s.requests ?? 0]]
    : admin ? [] : [['Veículos', s.vehicles ?? 0], ['Pedidos', s.requests ?? 0]];

  const dados = admin
    ? `<div class="two-col"><div><label class="form-label">Nome</label><input class="input" name="name" value="${e(r.user.name)}" required></div><div><label class="form-label">Telefone</label><input class="input" name="phone" value="${e(r.user.phone)}" required></div></div><div class="two-col"><div><label class="form-label">E-mail de acesso</label><input class="input" value="${e(r.user.email)}" disabled></div><div><label class="form-label">Nível de acesso</label><input class="input" value="Administrador" disabled></div></div><p class="hint">O e-mail de acesso não pode ser alterado por esta tela.</p>`
    : office
      ? `<div class="two-col"><div><label class="form-label">Nome do responsável</label><input class="input" name="name" value="${e(r.user.name)}" required></div><div><label class="form-label">Telefone</label><input class="input" name="phone" value="${e(r.user.phone)}" required></div></div><div class="two-col"><div><label class="form-label">Razão social</label><input class="input" name="legal_name" value="${e(w.legal_name)}" required></div><div><label class="form-label">CNPJ</label><input class="input" name="cnpj" value="${e(fmtDoc(w.cnpj))}" required oninput="maskCpfCnpj(this)"></div></div><label class="form-label">Endereço</label><input class="input" name="address" value="${e(w.address)}" required><div class="two-col"><div><label class="form-label">Cidade</label><input class="input" name="city" value="${e(w.city)}" required></div><div><label class="form-label">Horário de funcionamento</label><input class="input" name="opening_hours" value="${e(w.opening_hours)}" placeholder="Seg–Sex, 08:00–18:00"></div></div><label class="form-label">Serviços atendidos</label><input class="input" name="services" value="${e(w.services)}" placeholder="Revisão, freios, elétrica"><label class="form-label">Descrição pública</label><textarea class="input" name="description" rows="4" placeholder="Conte o que a oficina faz de melhor.">${e(w.description)}</textarea>`
      : `<div class="two-col"><div><label class="form-label">Nome completo</label><input class="input" name="name" value="${e(r.user.name)}" required></div><div><label class="form-label">Telefone</label><input class="input" name="phone" value="${e(r.user.phone)}" required></div></div><div class="two-col"><div><label class="form-label">CPF</label><input class="input" name="cpf" value="${e(fmtDoc(r.user.cpf))}" required oninput="maskCpfCnpj(this)"></div><div><label class="form-label">E-mail</label><input class="input" value="${e(r.user.email)}" disabled></div></div><p class="hint">As fotos dos seus veículos ficam visíveis para as oficinas que recebem seus pedidos.</p>`;

  return `<div class="eyebrow">Dados da conta</div><h1 class="page-title">${office ? 'Dados da Oficina' : admin ? 'Minha conta' : 'Meus dados'}</h1><p class="subhead">${office ? 'Estas informações aparecem para os clientes que procuram sua oficina.' : 'Atualize os dados usados no atendimento e nas solicitações de orçamento.'}</p>${office ? avaliacaoPublica(r) : ''}${kpis.length ? `<section class="office-kpi garage-kpi">${kpis.map((k) => `<div class="metric"><small>${k[0]}</small><b>${k[1]}</b><span>no sistema</span></div>`).join('')}</section>` : ''}<section class="profile-panel"><form id="profileForm"><h2 class="panel-title">${office ? 'Dados da oficina' : 'Dados pessoais'}</h2>${dados}${office ? garagemCheck(w) : ''}<button class="btn primary full">Salvar alterações</button></form>${office ? especialidadesForm(r) : ''}${office ? '' : enderecosForm(r.enderecos || [])}<hr class="rule"><form id="passwordForm"><h2 class="panel-title">Alterar senha</h2><label class="form-label">Senha atual</label><input class="input" name="current_password" type="password" autocomplete="current-password" required><div class="two-col"><div><label class="form-label">Nova senha</label><input class="input" name="new_password" type="password" minlength="8" autocomplete="new-password" required></div><div><label class="form-label">Repetir nova senha</label><input class="input" name="new_password2" type="password" minlength="8" autocomplete="new-password" required></div></div><button class="btn ghost full">Atualizar senha</button></form>${office ? fotoOficinaForm(r) : ''}</section>${office ? `<section class="profile-panel"><h2 class="panel-title">Avaliações recebidas</h2>${commentBlock(r.reviews, 20)}</section>` : ''}`;
}

/** Oficina com garagem própria: muda o jeito de falar do serviço. */
function garagemCheck(w) {
  return `<label class="check-row"><input type="checkbox" name="garagem" ${w.garagem ? 'checked' : ''}> <span>Possuo garagem própria para o veículo do cliente</span></label>`;
}

/** RF05: N:N entre oficina e especialidade (esp_ofc). */
function especialidadesForm(r) {
  const marcadas = new Set((r.especialidades || []).map((x) => Number(x.id)));
  const catalogo = r.todas_especialidades || [];
  if (!catalogo.length) {
    return `<hr class="rule"><h2 class="panel-title">Especialidades</h2><p class="hint">Nenhuma especialidade cadastrada ainda. O administrador do sistema cadastra o catálogo.</p>`;
  }
  return `<hr class="rule"><form id="especialidadesForm"><h2 class="panel-title">Especialidades atendidas</h2>
    <p class="hint">Marque tudo o que a oficina faz. Aparece no card e na página da oficina.</p>
    ${catalogo.map((esp) => `<label class="check-row"><input type="checkbox" name="especialidade" value="${esp.id}" ${marcadas.has(Number(esp.id)) ? 'checked' : ''}> <span>${e(esp.nome)}</span></label>`).join('')}
    <button class="btn ghost full">Salvar especialidades</button></form>`;
}

/** RF04: endereco normalizado, N:N com o cliente (endereco_cliente). */
function enderecosForm(lista) {
  const linhas = lista.length
    ? lista.map((x) => `<li><b>${e(x.rua)}${x.numero ? ', ' + e(String(x.numero)) : ''}</b>
        <small>${e(x.bairro || '')}${x.cidade ? ' · ' + e(x.cidade) : ''}${x.cep ? ' · CEP ' + e(fmtCep(x.cep)) : ''}${x.complemento ? ' · ' + e(x.complemento) : ''}</small>
        <button class="link-btn" onclick="removerEndereco(${x.id})">remover</button></li>`).join('')
    : '<li class="empty">Nenhum endereço cadastrado.</li>';
  return `<hr class="rule"><h2 class="panel-title">Endereços</h2><ul class="endereco-lista">${linhas}</ul>
    <form id="enderecoForm"><div class="two-col"><div><label class="form-label">CEP</label><input class="input" name="cep" inputmode="numeric" placeholder="00000-000" maxlength="9" oninput="maskCep(this)"></div><div><label class="form-label">Cidade *</label><input class="input" name="cidade" required></div></div>
    <div class="two-col"><div><label class="form-label">Rua *</label><input class="input" name="rua" required></div><div><label class="form-label">Número</label><input class="input" name="numero" inputmode="numeric"></div></div>
    <div class="two-col"><div><label class="form-label">Bairro</label><input class="input" name="bairro"></div><div><label class="form-label">Complemento</label><input class="input" name="complemento" placeholder="Apto, sala..."></div></div>
    <button class="btn ghost full">Adicionar endereço</button></form>`;
}

async function removerEndereco(id) {
  try {
    await api('profile', 'POST', { operation: 'endereco', id });
    toast('Endereço removido.');
    render();
  } catch (x) { toast(x.message, true); }
}

// RF13: média de avaliações pública no perfil da oficina.
function avaliacaoPublica(r) {
  const n = r.review_count || 0;
  const avg = n ? Number(r.review_avg) : 0;
  const d = r.rating_distribution || {};
  return `<section class="office-kpi review-kpi">
    <div class="metric"><small>Avaliação média</small><b>${n ? avg.toFixed(1).replace('.0', '') : '—'}</b><span>${stars(avg)}</span></div>
    <div class="metric"><small>Avaliações</small><b>${n}</b><span>${n === 1 ? 'cliente' : 'clientes'}</span></div>
  </section>${n ? `<div class="dist-inline">${[5, 4, 3, 2, 1].map((k) => `<span class="dist-chip">${k}★ <b>${d[k] || 0}</b></span>`).join('')}</div>` : '<p class="hint">Assim que os clientes concluírem e avaliarem um serviço, a média aparece aqui e nos cards da rede.</p>'}`;
}

function fotoOficinaForm(r) {
  const foto = r.foto || { has_photo: false, photo_rev: 0 };
  const atual = foto.has_photo
    ? `<div class="foto-atual">
         <div class="foto-atual-thumb" style="background-image:url('${imgOficina(r.workshop.id, foto.photo_rev)}')"></div>
         <div class="foto-atual-info">
           <b>Foto publicada</b>
           <small>Esta é a imagem que os clientes veem no card da oficina.</small>
           <button type="button" class="btn danger" id="removerFotoBtn">Remover foto</button>
         </div>
       </div>`
    : `<p class="hint">Sua oficina ainda não tem foto. Sem foto, o card aparece sem imagem e fica menos chamativo na busca.</p>`;

  return `<hr class="rule"><form id="shopPhotoForm"><h2 class="panel-title">Foto da oficina</h2>${atual}
    <div class="dropzone" id="fotoDrop">
      <input id="fotoInput" name="image" type="file" accept="image/jpeg,image/png,image/webp" hidden>
      <b>ARRASTE A FOTO AQUI</b>
      <span>ou clique para escolher · JPG, PNG ou WEBP · até 20 MB</span>
      <small>A imagem é redimensionada para no máximo 1600 px antes de subir, e depois mostra aqui o que vai ser publicado.</small>
    </div>
    <div class="foto-preview" id="fotoPreview" hidden></div>
    <button class="btn primary full" id="fotoEnviar" disabled>Publicar foto</button>
  </form>`;
}

/** Entrada pelo clique no input. */
async function escolherFoto(input) {
  await prepararPreview(input.files?.[0]);
}

/** Valida, redimensiona e mostra a prévia. Vale tanto clique quanto arrastar. */
async function prepararPreview(file) {
  const preview = document.querySelector('#fotoPreview');
  const enviar = document.querySelector('#fotoEnviar');
  const drop = document.querySelector('#fotoDrop');
  if (!preview || !enviar || !drop) return;

  if (!file) {
    preview.hidden = true;
    preview.innerHTML = '';
    enviar.disabled = true;
    window.__fotoPronta = null;
    return;
  }

  preview.hidden = false;
  preview.innerHTML = '<span class="spinner"></span> Lendo a imagem…';
  enviar.disabled = true;
  drop.classList.remove('erro');

  try {
    const feito = await prepararFotoFachada(file);
    // Guarda o blob pronto; o upload usa este e nao o arquivo original.
    window.__fotoPronta = feito;
    preview.innerHTML = `<img src="${feito.url}" alt="Prévia da fachada">
      <div class="foto-preview-info"><b>${e(feito.nome)}</b>
        <small>${feito.largura}×${feito.altura} px · ${Math.max(1, Math.round(feito.size / 1024))} KB${feito.reduziu ? ' (redimensionada)' : ''}</small>
        <button type="button" class="link-btn" id="trocarFotoBtn">Escolher outra</button></div>`;
    enviar.disabled = false;
  } catch (x) {
    window.__fotoPronta = null;
    preview.innerHTML = `<p class="erro-inline">${e(x.message)}</p>`;
    drop.classList.add('erro');
  }
}

const TIPOS_FOTO = ['image/jpeg', 'image/png', 'image/webp'];
const BRUTO_MAX = 20 * 1024 * 1024;
const ENVIO_MAX = 2 * 1024 * 1024;

/**
 * Valida, redimensiona e recomprime a foto da fachada.
 *
 * Sem o redimensionamento, uma foto de celular de 4000 px ia crua para o banco
 * (2 MB de BLOB) e o card baixava tudo isso para mostrar 300 px. Aqui a imagem
 * vai para no maximo 1600 px e a qualidade e reduzida ate caber em 2 MB, que e
 * o limite do endpoint.
 */
async function prepararFotoFachada(file) {
  if (!TIPOS_FOTO.includes(file.type)) {
    throw new Error('Use uma imagem JPG, PNG ou WEBP.');
  }
  if (!file.size) throw new Error('O arquivo está vazio.');
  if (file.size > BRUTO_MAX) {
    throw new Error(`A imagem tem ${(file.size / 1048576).toFixed(1)} MB. O limite antes do redimensionamento é 20 MB.`);
  }

  const url = URL.createObjectURL(file);
  let img;
  try {
    img = await carregarImagem(url);
  } finally {
    // Depois que a imagem entrou em memoria o objectURL pode ir.
    setTimeout(() => URL.revokeObjectURL(url), 0);
  }

  const largura = img.naturalWidth || img.width;
  const altura = img.naturalHeight || img.height;
  if (largura < 320 || altura < 200) {
    throw new Error(`A imagem tem ${largura}×${altura} px. Use uma foto de pelo menos 320×200 px.`);
  }

  // Escala para caber em 1600 px sem esticar.
  const LADO = 1600;
  const fator = Math.min(1, LADO / Math.max(largura, altura));
  const alvoL = Math.max(1, Math.round(largura * fator));
  const alvoA = Math.max(1, Math.round(altura * fator));
  const reduziu = fator < 1;

  // Se a qualidade sozinho nao resolver, cada passada tambem reduz o lado.
  for (const passo of [{ q: 0.86, esc: 1 }, { q: 0.74, esc: 1 }, { q: 0.6, esc: 0.8 }, { q: 0.5, esc: 0.65 }]) {
    const l = Math.max(1, Math.round(alvoL * passo.esc));
    const a = Math.max(1, Math.round(alvoA * passo.esc));
    const canvas = document.createElement('canvas');
    canvas.width = l;
    canvas.height = a;
    const ctx = canvas.getContext('2d');
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(img, 0, 0, l, a);
    const blob = await canvasParaBlob(canvas, passo.q);
    if (blob.size <= ENVIO_MAX) {
      return {
        blob,
        // size em bytes, para a tela mostrar quanto vai subir.
        size: blob.size,
        largura: l,
        altura: a,
        nome: file.name,
        reduziu: reduziu || passo.esc < 1,
        url: canvas.toDataURL('image/jpeg', 0.7),
      };
    }
  }

  throw new Error('Não consegui reduzir a imagem para 2 MB. Tente uma foto menor ou em JPG.');
}

function carregarImagem(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Não consegui ler essa imagem. O arquivo pode estar corrompido.'));
    img.src = src;
  });
}

function canvasParaBlob(canvas, qualidade) {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (b) => (b ? resolve(b) : reject(new Error('Falha ao processar a imagem.'))),
      'image/jpeg',
      qualidade
    );
  });
}

/** Envia a foto preparada e devolve o que a tela precisa redesenhar. */
async function enviarFotoOficina(form) {
  const enviar = document.querySelector('#fotoEnviar');
  const preview = document.querySelector('#fotoPreview');
  const pronta = window.__fotoPronta;
  if (!pronta) return toast('Escolha uma imagem primeiro.', true);

  const original = enviar.innerHTML;
  enviar.disabled = true;
  enviar.innerHTML = '<span class="spinner"></span> Publicando…';
  preview.querySelector('button')?.setAttribute('disabled', 'disabled');

  try {
    const fd = new FormData();
    fd.append('operation', 'upload');
    fd.append('image', pronta.blob, pronta.nome || 'fachada.jpg');
    const j = await apiUpload('workshop-photo', fd);
    window.__fotoPronta = null;
    render();
    const extra = j.aviso ? ` ${j.aviso}` : '';
    toast(`Foto publicada (${Math.max(1, Math.round(j.bytes / 1024))} KB).${extra}`);
  } catch (x) {
    enviar.disabled = false;
    enviar.innerHTML = original;
    preview.querySelector('button')?.removeAttribute('disabled');
    toast(x.message, true);
  }
}

async function removerFotoOficina() {
  if (!confirm('Remover a foto da oficina? Ela voltará a aparecer sem imagem no card.')) return;
  const btn = document.querySelector('#removerFotoBtn');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner"></span> Removendo…';
  }
  try {
    await api('workshop-photo', 'POST', { operation: 'remove' });
    window.__fotoPronta = null;
    render();
    toast('Foto removida.');
  } catch (x) {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Remover foto';
    }
    toast(x.message, true);
  }
}

// ---------------------------------------------------------------------------
// Garagem
// ---------------------------------------------------------------------------
const FUELS = ['Gasolina', 'Etanol', 'Flex', 'Diesel', 'Elétrico', 'Híbrido'];

function veiculoCard(v) {
  const ano = v.year ? e(v.year) : '—';
  const km = v.mileage !== null && v.mileage !== undefined && v.mileage !== '' ? `${Number(v.mileage).toLocaleString('pt-BR')} km` : null;
  return `<div class="vehicle-card">${v.image_count ? `<img class="vehicle-thumb" src="${imgVeiculo(v.image_id ?? 0)}" alt="Foto de ${e(v.make_model)}">` : '<div class="logo-box thumb-box">▰</div>'}<div class="vehicle-main"><b>${e(v.brand || v.make_model)} ${e(v.model || '')}</b><span class="plate-tag">${e(fmtPlate(v.plate))}</span><small>${ano} · ${e(v.color || 'cor não informada')} · ${e(v.fuel || 'combustível não informado')}${km ? ` · ${km}` : ''}</small><small class="muted">${v.image_count} foto(s)</small></div><div class="vehicle-actions"><button class="btn ghost" onclick="vehicleModal(${v.id})">Editar</button><button class="btn ghost" onclick="vehiclePhotos(${v.id})">Fotos</button><button class="btn ghost danger" onclick="deleteVehicle(${v.id})">Excluir</button></div></div>`;
}

async function vehicles() {
  const r = await api('vehicles');
  // Busca o id da primeira foto de cada veiculo para a miniatura do card.
  const cards = await Promise.all(r.vehicles.map(async (v) => {
    if (!v.image_count) return veiculoCard(v);
    const imgs = await api(`vehicle-images?vehicle_id=${v.id}`);
    return veiculoCard({ ...v, image_id: imgs.images?.[0]?.id });
  }));
  return `<div class="dashboard-top"><div><div class="eyebrow">Garagem</div><h1 class="page-title">Meus veículos</h1><p class="subhead">Dados completos e fotos ajudam a oficina a fechar o orçamento certo.</p></div><button class="btn primary" onclick="vehicleModal()">+ Adicionar veículo</button></div><div class="vehicle-list">${cards.join('') || '<div class="empty">Nenhum veículo cadastrado. Clique em “Adicionar veículo” para começar.</div>'}</div>`;
}

function vehicleModal(id) {
  const maxYear = anoMax();
  const editar = !!id;
  modal(editar ? 'Editar veículo' : 'Adicionar veículo', `<form id="vehicle">${editar ? `<input type="hidden" name="id" value="${id}">` : ''}<div class="two-col"><div><label class="form-label">Marca *</label><input class="input" name="brand" id="vBrand" required maxlength="40" placeholder="Ex.: Honda"></div><div><label class="form-label">Modelo *</label><input class="input" name="model" id="vModel" required maxlength="60" placeholder="Ex.: Civic"></div></div><div class="two-col"><div><label class="form-label">Ano *</label><input class="input" name="year" id="vYear" type="number" inputmode="numeric" min="${ANO_MIN}" max="${maxYear}" placeholder="${maxYear}" required></div><div><label class="form-label">Placa *</label><input class="input" name="plate" id="vPlate" required maxlength="8" placeholder="ABC-1D23" oninput="maskPlate(this)" onblur="maskPlate(this)"></div></div><div class="two-col"><div><label class="form-label">Cor *</label><input class="input" name="color" required maxlength="30" placeholder="Ex.: Prata"></div><div><label class="form-label">Combustível *</label><select class="input" name="fuel" required><option value="">Selecione</option>${FUELS.map((f) => `<option>${f}</option>`).join('')}</select></div></div><label class="form-label">Quilometragem *</label><input class="input" name="mileage" type="number" inputmode="numeric" min="0" step="1" placeholder="Ex.: 45000" required><div class="two-col"><div><label class="form-label">Chassi</label><input class="input" name="chassi" maxlength="17" placeholder="17 caracteres" oninput="maskChassi(this)"></div><div><label class="form-label">Observações</label><input class="input" name="notes" placeholder="Barulhos, luzes acesas…"></div></div><label class="form-label">Fotos do veículo *</label><label class="upload-zone"><b>+ ADICIONAR FOTOS</b><span>JPG, PNG ou WEBP, até 2 MB cada. Selecione ao menos uma foto.</span><input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple ${editar ? '' : 'required'}></label><div id="filePreview" class="file-preview"></div><p class="hint">Placa no padrão brasileiro: <b>ABC-1D23</b> (Mercosul) ou <b>ABC-1234</b> (antiga).</p><button class="btn primary full">${editar ? 'Salvar alterações' : 'Cadastrar veículo'}</button></form>`);
  if (editar) fillVehicle(id);
  const f = document.querySelector('#vehicle');
  f.querySelector('[name=images]').addEventListener('change', (ev) => previewFiles(ev.target.files));
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const anoTxt = f.year.value.trim();
    if (!anoValido(anoTxt)) return toast(`Informe um ano válido entre ${ANO_MIN} e ${maxYear}.`, true);
    if (!placaValida(f.plate.value)) return toast('Placa inválida. Use ABC-1D23 ou ABC-1234.', true);
    const files = [...f.images.files];
    if (!editar && !files.length) return toast('Adicione ao menos uma foto do veículo.', true);
    try {
      const saved = await api('vehicles', 'POST', form(f));
      let aviso = '';
      if (files.length) {
        const up = new FormData();
        up.append('vehicle_id', saved.vehicle_id);
        files.forEach((x) => up.append('images[]', x));
        const j = await apiUpload('vehicle-upload', up);
        aviso = (j.rejected || []).map((x) => `${x.name}: ${x.reason}`).join('; ');
      }
      closeModal();
      render();
      toast(aviso ? `Veículo salvo, mas algumas fotos não foram aceitas — ${aviso}` : editar ? 'Veículo atualizado.' : 'Veículo cadastrado com sucesso.', !!aviso);
    } catch (x) { toast(x.message, true); }
  };
}

async function fillVehicle(id) {
  const r = await api('vehicles');
  const v = r.vehicles.find((x) => +x.id === +id);
  if (!v) return;
  const f = document.querySelector('#vehicle');
  f.brand.value = v.brand || '';
  f.model.value = v.model || '';
  f.year.value = v.year || '';
  f.plate.value = fmtPlate(v.plate);
  f.color.value = v.color || '';
  f.fuel.value = v.fuel || '';
  f.mileage.value = v.mileage ?? '';
  f.notes.value = v.notes || '';
  if (f.chassi) f.chassi.value = v.chassi || '';
}

function previewFiles(files) {
  const box = document.querySelector('#filePreview');
  if (!box) return;
  box.innerHTML = [...files].map((f) => `<span class="file-chip">${e(f.name)} · ${(f.size / 1024 / 1024).toFixed(2)} MB</span>`).join('');
}

async function vehiclePhotos(id) {
  const [r, det] = await Promise.all([api(`vehicle-images?vehicle_id=${id}`), api('vehicles')]);
  const v = det.vehicles.find((x) => +x.id === +id);
  const lista = r.images || [];
  modal('Fotos do veículo', `<p class="subhead">${e(v?.make_model ?? '')} · ${e(fmtPlate(v?.plate ?? ''))}</p>
    <div class="vehicle-image-preview">${lista.map((i) => `<img src="${imgVeiculo(i.id)}" alt="Foto do veículo" onclick="ampliarFoto('${imgVeiculo(i.id)}')">`).join('') || '<div class="empty">Nenhuma foto enviada.</div>'}</div>
    <hr class="rule"><form id="morePhotos"><label class="form-label">Adicionar mais fotos</label><label class="upload-zone"><b>+ ADICIONAR FOTOS</b><span>JPG, PNG ou WEBP, até 2 MB cada.</span><input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple required></label><div id="filePreview" class="file-preview"></div><button class="btn primary full">Enviar fotos</button></form>`);
  const f = document.querySelector('#morePhotos');
  f.images.addEventListener('change', (ev) => previewFiles(ev.target.files));
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const up = new FormData();
    up.append('vehicle_id', id);
    [...f.images.files].forEach((x) => up.append('images[]', x));
    try {
      const j = await apiUpload('vehicle-upload', up);
      closeModal();
      render();
      const bad = j.rejected || [];
      toast(bad.length ? bad.map((x) => `${x.name}: ${x.reason}`).join('; ') : 'Fotos enviadas.', !!bad.length);
    } catch (x) { toast(x.message, true); }
  };
}

async function deleteVehicle(id) {
  if (!confirm('Excluir este veículo e todas as suas fotos? Esta ação não pode ser desfeita.')) return;
  try {
    await api('vehicle-delete', 'POST', { vehicle_id: id });
    render();
    toast('Veículo excluído.');
  } catch (x) { toast(x.message, true); }
}

// ---------------------------------------------------------------------------
// Orçamentos
// ---------------------------------------------------------------------------
/**
 * Pilha de modais.
 *
 * Abrir a foto ampliada sobre o modal de listagem criava um segundo elemento
 * com id="modal", e o closeModal() pegava o primeiro da lista, ou seja, o de
 * baixo: o fundo sumia e a foto continuava aberta. A pilha garante que o
 * "fechar" sempre atinja a camada de cima, e que voltar uma camada recoloque
 * a de baixo como estava.
 */
const pilhaModal = [];

function modal(titulo, conteudo, opcoes = {}) {
  descartarModaisOrfaos();
  const el = document.createElement('div');
  el.className = 'modal-back';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-modal', 'true');
  el.innerHTML = `<div class="modal ${opcoes.largo ? 'modal-largo' : ''}">
      <div class="modal-head"><h2>${e(titulo)}</h2>
        <button class="close" type="button" aria-label="Fechar">&times;</button></div>
      <div class="modal-body">${conteudo}</div>
    </div>`;
  el.querySelector('.close').addEventListener('click', fecharModal);
  // Clique no fundo fecha apenas esta camada, como o botão ×.
  el.addEventListener('mousedown', (ev) => {
    if (ev.target === el) fecharModal();
  });
  document.body.appendChild(el);

  const antes = document.activeElement;
  pilhaModal.push({ el, focoAntes: antes && antes !== document.body ? antes : null });
  marcarCamadas();
  focarPrimeiro(el);
  return el;
}

/**
 * Rede de seguranca contra modal orfao: um .modal-back fora da pilha nao tem
 * como ser fechado por closeModal() e some apenas com um novo render.
 *
 * A causa foi o `render()` de dentro de um callback: ele trocava o conteudo de
 * #app e disparava uma acao que abria outro modal, enquanto o topo da pilha era
 * removido no meio. Aqui qualquer sobra e eliminada junto com a proxima
 * abertura, entao o pior caso e um modal fechar sozinho, nunca ficar preso.
 */
function descartarModaisOrfaos() {
  if (!pilhaModal.length) {
    for (const orfao of document.querySelectorAll('.modal-back')) orfao.remove();
  }
}

/** Liga a camada ao seu elemento, para nunca sair de sincronia com o DOM. */
function sincronizarPilha() {
  for (const el of document.querySelectorAll('.modal-back')) {
    if (pilhaModal.some((c) => c.el === el)) continue;
    // Nao ha entrada correspondente: e um orfao de uma camada ja removida.
    el.remove();
  }
}

/**
 * Quantos .modal-back estao na tela. Precisa bater com a pilha: quando nao bate,
 * ha uma camada que ninguem consegue fechar.
 */
function modaisNaTela() {
  return document.querySelectorAll('.modal-back').length;
}

/** Aplica o papel de fundo em tudo menos a camada de cima. */
function marcarCamadas() {
  pilhaModal.forEach((c, i) => c.el.classList.toggle('abaixo', i < pilhaModal.length - 1));
}

function focarPrimeiro(el) {
  const alvo = el.querySelector('[autofocus], input:not([type=hidden]), select, textarea, button');
  alvo?.focus({ preventScroll: true });
}

/**
 * Fecha a camada de cima e devolve o foco a quem abriu. É isso que faz o zoom
 * da foto fechar a foto, e não a tela que estava atrás dela.
 */
function fecharModal() {
  const topo = pilhaModal.pop();
  if (!topo) return sincronizarPilha();
  topo.el.remove();
  marcarCamadas();
  sincronizarPilha();
  const agora = pilhaModal[pilhaModal.length - 1];
  if (agora) {
    focarPrimeiro(agora.el);
  } else {
    topo.focoAntes?.focus?.({ preventScroll: true });
  }
}

/** Escape: sobe uma camada. Com uma camada só, é o mesmo que fechar. */
function voltarModal() {
  if (pilhaModal.length <= 1) return fecharModal();
  const topo = pilhaModal.pop();
  topo?.el.remove();
  marcarCamadas();
  sincronizarPilha();
  focarPrimeiro(pilhaModal[pilhaModal.length - 1]?.el);
}

document.addEventListener('keydown', (ev) => {
  if (ev.key === 'Escape') {
    if (!pilhaModal.length) return;
    // Escape so fecha modal; em um campo de texto, o browser cancela a edicao.
    ev.preventDefault();
    voltarModal();
    return;
  }
  // Tab circular dentro da camada de cima.
  if (ev.key !== 'Tab' || !pilhaModal.length) return;
  const el = pilhaModal[pilhaModal.length - 1];
  const focaveis = [...el.querySelectorAll('a[href], button:not([disabled]), input:not([type=hidden]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])')]
    .filter((n) => n.offsetParent !== null);
  if (!focaveis.length) return;
  const primeiro = focaveis[0];
  const ultimo = focaveis[focaveis.length - 1];
  if (ev.shiftKey && document.activeElement === primeiro) {
    ev.preventDefault();
    ultimo.focus();
  } else if (!ev.shiftKey && document.activeElement === ultimo) {
    ev.preventDefault();
    primeiro.focus();
  }
});

/**
 * Nome antigo, ainda em varias linhas. Fechar sempre age na camada de cima:
 * por isso um closeModal() chamado de dentro de um callback de um modal
 * qualquer nao fecha mais um modal de baixo por acidente.
 */
function closeModal() {
  return fecharModal();
}

function modalAberto() {
  return pilhaModal.length > 0;
}

/** Quantas camadas estao abertas; 1 = so um modal, 2 = zoom sobre um modal. */
function profundidadeModal() {
  return pilhaModal.length;
}

/**
 * Zoom da foto. Reaproveita a camada de baixo: os dois ficam com o mesmo
 * tamanho e a mesma cor de fundo, então o de baixo some atrás do zoom em vez
 * de parecer uma segunda janela por cima.
 */
function ampliarFoto(src) {
  const el = modal('Foto ampliada', `
    <div class="lightbox"><img src="${e(src)}" alt="Foto ampliada" tabindex="0"></div>`, { largo: true });
  el.classList.add('modal-foto');
  // Clicar na propria imagem volta para a lista, como todo mundo espera.
  el.querySelector('.lightbox img')?.addEventListener('click', fecharModal);
  return el;
}

async function requestModal(id) {
  const [w, v] = await Promise.all([api('workshops'), api('vehicles')]);
  if (!w.workshops.length) return toast('Nenhuma oficina cadastrada ainda.', true);
  modal('Solicitar orçamento', `<form id="request"><label class="form-label">Oficina</label><select class="input" name="workshop_id">${w.workshops.map((x) => `<option value="${x.id}" ${x.id === id ? 'selected' : ''}>${e(x.legal_name)} — ${e(x.city)}</option>`).join('')}</select><label class="form-label">Veículo</label><select class="input" name="vehicle_id"><option value="">Não informar agora</option>${v.vehicles.map((x) => `<option value="${x.id}">${e(x.make_model)} · ${e(fmtPlate(x.plate))}</option>`).join('')}</select><label class="form-label">Serviço</label><select class="input" name="service_type"><option>Revisão / manutenção</option><option>Problema mecânico</option><option>Freios e suspensão</option><option>Diagnóstico eletrônico</option></select><label class="form-label">Descreva o problema</label><textarea class="input" name="description" rows="4" required></textarea>
    <label class="form-label">Fotos do problema</label>
    <label class="upload-zone"><b>+ ANEXAR FOTOS</b><span>Mostre o estrago para a oficina avaliar melhor. JPG, PNG ou WEBP, até 2 MB cada.</span><input name="images" type="file" accept="image/jpeg,image/png,image/webp" multiple></label>
    <div id="filePreview" class="file-preview"></div>
    <div class="upload-guide"><div class="upload-tip"><b>Visão geral</b>Área afetada.</div><div class="upload-tip"><b>Detalhe</b>Peça ou vazamento.</div><div class="upload-tip"><b>Painel</b>Luzes acesas.</div></div>
    <button class="btn primary full">Enviar solicitação →</button></form>`);
  const f = document.querySelector('#request');
  f.images.addEventListener('change', (ev) => previewFiles(ev.target.files));
  f.onsubmit = async (ev) => {
    ev.preventDefault();
    const files = [...f.images.files];
    try {
      const r = await api('requests', 'POST', form(f));
      let aviso = '';
      if (files.length && r.request_id) {
        const up = new FormData();
        up.append('request_id', r.request_id);
        files.forEach((x) => up.append('images[]', x));
        const j = await apiUpload('request-upload', up);
        aviso = (j.rejected || []).map((x) => `${x.name}: ${x.reason}`).join('; ');
      }
      closeModal();
      view = 'requests';
      render();
      toast(aviso ? `Pedido enviado. Fotos: ${aviso}` : 'Solicitação enviada à oficina.', !!aviso);
    } catch (q) { toast(q.message, true); }
  };
}

async function quoteModal(id) {
  let det = null;
  try { det = await api(`request-images?request_id=${id}`); } catch { det = { images: [] }; }
  const fotos = (det.images || []).map((i) => `<img src="${imgPedido(i.id)}" alt="Foto do problema" onclick="ampliarFoto('${imgPedido(i.id)}')">`).join('');
  modal('Responder orçamento', `
    ${fotos ? `<h3 class="panel-title">Fotos enviadas pelo cliente</h3><div class="vehicle-image-preview">${fotos}</div><hr class="rule">` : '<p class="hint">O cliente não anexou fotos neste pedido.</p>'}
    <form id="quote"><label class="form-label">Mensagem ao Cliente</label><textarea class="input" name="message" rows="4" required>Recomendamos uma inspeção presencial para confirmar o diagnóstico.</textarea><div class="two-col"><div><label class="form-label">Valor inicial</label><input class="input" name="amount_min" type="number" step=".01" min="0" required></div><div><label class="form-label">Valor máximo</label><input class="input" name="amount_max" type="number" step=".01" min="0" required></div></div><button class="btn primary full">Enviar orçamento →</button></form>`);
  document.querySelector('#quote').onsubmit = async (x) => {
    x.preventDefault();
    const d = form(x.target);
    d.request_id = id;
    try {
      await api('quote', 'POST', d);
      closeModal();
      render();
      toast('Orçamento enviado ao Cliente.');
    } catch (q) { toast(q.message, true); }
  };
}

async function detail(id) {
  const [r, pics] = await Promise.all([api('requests'), api(`request-images?request_id=${id}`)]);
  const o = r.requests.find((x) => +x.id === +id);
  if (!o) return toast('Pedido não encontrado.', true);
  const office = me.role === 'workshop';
  const etapas = STATUS_FLOW.map((s) => `<li class="${s === o.status ? 'on' : STATUS_FLOW.indexOf(o.status) > STATUS_FLOW.indexOf(s) ? 'done' : ''}"><span>${e(STATUS_LABEL[s])}</span></li>`).join('');
  const podeAvaliar = !office && o.status === 'completed' && !o.review_id;
  const fotos = (pics.images || []).map((i) => `<img src="${imgPedido(i.id)}" alt="Foto do problema" onclick="ampliarFoto('${imgPedido(i.id)}')">`).join('');
  modal(`Pedido #${id}`, `
    <span class="status ${e(o.status)}">${e(STATUS_LABEL[o.status] || o.status)}</span>
    <p><b>${e(o.service_type)}</b><br><span class="subhead">${e(o.description)}</span></p>
    <div class="detail-grid">
      <div><small>${office ? 'CLIENTE' : 'OFICINA'}</small><strong>${e(office ? o.client_name : o.workshop_name)}</strong></div>
      <div><small>VEÍCULO</small><strong>${e(o.make_model || 'Não informado')}</strong></div>
      <div><small>ABERTO EM</small><strong>${e(o.created_at)}</strong></div>
    </div>
    ${fotos ? `<h3 class="panel-title">Fotos do problema (${pics.images.length})</h3><div class="vehicle-image-preview">${fotos}</div>` : (office ? '<p class="hint">O cliente não anexou fotos neste pedido.</p>' : '')}
    <ul class="timeline">${etapas}</ul>
    ${o.quote_message ? `<div class="quote-box"><small>PROPOSTA DA OFICINA</small><p>${e(o.quote_message)}</p><b>R$ ${Number(o.amount_min).toFixed(2)} – R$ ${Number(o.amount_max).toFixed(2)}</b></div>` : '<div class="alert-strip"><b>AGUARDANDO RESPOSTA DA OFICINA</b></div>'}
    ${office && (o.status === 'open' || o.status === 'responded') ? `<button class="btn primary full" onclick="closeModal();quoteModal(${o.id})">RESPONDER COM ORÇAMENTO</button>` : ''}
    ${podeAvaliar ? `<hr class="rule"><p class="subhead">Serviço concluído. Avalie a oficina para ajudar outros clientes.</p><button class="btn primary full" onclick="closeModal();reviewModal(${o.id})">★ AVALIAR O SERVIÇO</button>` : ''}
    ${o.review_id ? '<div class="alert-strip"><b>AVALIAÇÃO ENVIADA</b><span>Obrigado pelo retorno.</span></div>' : ''}`);
}

// ---------------------------------------------------------------------------
// Administração
// ---------------------------------------------------------------------------
async function adminPanel() {
  const r = await api('admin-users');
  const users = r.users;
  const clients = users.filter((x) => x.role === 'client').length;
  const shops = users.filter((x) => x.role === 'workshop').length;
  return `<div class="dashboard-top"><div><div class="eyebrow">Acesso administrativo</div><h1 class="page-title">Central de controle</h1><p class="subhead">Gerencie contas, permissões e segurança do Radar Mecânico.</p></div><button class="btn primary" onclick="adminModal()">+ Criar administrador</button></div><section class="office-kpi"><div class="metric"><small>Total de contas</small><b>${users.length}</b><span>Todos os perfis</span></div><div class="metric"><small>Clientes</small><b>${clients}</b><span>Contas cadastradas</span></div><div class="metric"><small>Oficinas</small><b>${shops}</b><span>Parceiras cadastradas</span></div><div class="metric"><small>Bloqueadas</small><b>${users.filter((x) => +x.is_blocked).length}</b><span>Acesso suspenso</span></div></section><div class="section-head"><h2 class="section-title">Usuários do sistema</h2></div><div class="request-list">${users.map((u) => `<article class="request"><div><strong>${e(u.name)}</strong><small>${e(u.email)} · desde ${e(u.created_at)}</small></div><div><small>PERFIL</small><strong>${u.role === 'admin' ? 'Administrador' : u.role === 'workshop' ? 'Oficina' : 'Cliente'}</strong></div><div><small>TELEFONE</small><strong>${e(u.phone)}</strong></div><div><span class="status ${+u.is_blocked ? 'open' : 'responded'}">${+u.is_blocked ? 'Bloqueado' : 'Ativo'}</span></div><button class="btn ghost" ${+u.id === +me.id ? 'disabled' : ''} onclick="toggleUser(${u.id})">${+u.is_blocked ? 'DESBLOQUEAR' : 'BLOQUEAR'}</button></article>`).join('')}</div>`;
}

function adminModal() {
  modal('Criar administrador', `<form id="newAdmin"><label class="form-label">Nome</label><input class="input" name="name" required><label class="form-label">E-mail</label><input class="input" name="email" type="email" required><label class="form-label">Telefone</label><input class="input" name="phone"><label class="form-label">Senha temporária</label><input class="input" name="password" type="password" minlength="8" required><button class="btn primary full">Criar administrador</button></form>`);
  document.querySelector('#newAdmin').onsubmit = async (x) => {
    x.preventDefault();
    const d = form(x.target);
    d.operation = 'create_admin';
    try {
      await api('admin-users', 'POST', d);
      closeModal();
      render();
      toast('Administrador criado.');
    } catch (q) { toast(q.message, true); }
  };
}

async function toggleUser(id) {
  if (!confirm('Deseja alterar o acesso desta conta?')) return;
  try {
    await api('admin-users', 'POST', { operation: 'toggle_block', user_id: id });
    render();
  } catch (x) { toast(x.message, true); }
}

// ---------------------------------------------------------------------------
// Formulários globais
// ---------------------------------------------------------------------------
document.addEventListener('submit', async (ev) => {
  const f = ev.target;
  if (f.id === 'profileForm') {
    ev.preventDefault();
    const dados = form(f);
    // Checkbox não vem no FormData; o garage é o único booleano do formulário.
    if (f.garagem) dados.garagem = f.garagem.checked ? 1 : 0;
    try {
      await api('profile', 'POST', dados);
      const r = await api('session');
      me = r.user;
      render();
      toast('Dados atualizados com sucesso.');
    } catch (x) { toast(x.message, true); }
  } else if (f.id === 'passwordForm') {
    ev.preventDefault();
    const d = form(f);
    if (d.new_password !== d.new_password2) return toast('A confirmação da nova senha não confere.', true);
    try {
      await api('password', 'POST', { current_password: d.current_password, new_password: d.new_password });
      f.reset();
      toast('Senha alterada com sucesso.');
    } catch (x) { toast(x.message, true); }
  } else if (f.id === 'enderecoForm') {
    ev.preventDefault();
    const d = form(f);
    if (!d.cidade || !d.rua) return toast('Informe cidade e rua.', true);
    try {
      await api('profile', 'POST', { ...d, operation: 'endereco' });
      f.reset();
      render();
      toast('Endereço adicionado.');
    } catch (x) { toast(x.message, true); }
  } else if (f.id === 'especialidadesForm') {
    ev.preventDefault();
    const marcadas = [...f.querySelectorAll('[name=especialidade]:checked')].map((x) => Number(x.value));
    try {
      await api('profile', 'POST', { operation: 'especialidades', especialidades: marcadas });
      render();
      toast('Especialidades atualizadas.');
    } catch (x) { toast(x.message, true); }
  } else if (f.id === 'shopPhotoForm') {
    ev.preventDefault();
    await enviarFotoOficina(f);
  }
});

// ---------------------------------------------------------------------------
// Foto da oficina: escolha, arrastar e soltar
// ---------------------------------------------------------------------------
document.addEventListener('click', (ev) => {
  if (ev.target?.id === 'fotoDrop') {
    document.querySelector('#fotoInput')?.click();
    return;
  }
  if (ev.target?.id === 'trocarFotoBtn') {
    document.querySelector('#fotoInput')?.click();
    return;
  }
  if (ev.target?.id === 'removerFotoBtn') {
    ev.preventDefault();
    removerFotoOficina();
  }
});

document.addEventListener('change', (ev) => {
  if (ev.target?.id === 'fotoInput') escolherFoto(ev.target);
});

for (const tipo of ['dragenter', 'dragover']) {
  document.addEventListener(tipo, (ev) => {
    const drop = ev.target?.closest?.('#fotoDrop');
    if (!drop) return;
    ev.preventDefault();
    drop.classList.add('sobre');
  });
}
for (const tipo of ['dragleave', 'drop']) {
  document.addEventListener(tipo, (ev) => {
    const drop = ev.target?.closest?.('#fotoDrop');
    if (!drop) return;
    ev.preventDefault();
    drop.classList.remove('sobre');
    if (tipo !== 'drop') return;
    const file = ev.dataTransfer?.files?.[0];
    if (!file) return;
    const input = document.querySelector('#fotoInput');
    // DataTransfer nem sempre pode ser atribuida a input.files; o caminho
    // seguro e mexer no objeto e chamar o mesmo tratamento.
    escolherArquivoFoto(input, file);
  });
}

async function escolherArquivoFoto(input, file) {
  // Faz a escolha "parecer" vinda do input, para o mesmo fluxo do clique.
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
  } catch {
    // Navegador sem DataTransfer: segue com o arquivo direto.
  }
  await prepararPreview(file);
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------
(async () => {
  setTheme(temaAtual());
  try {
    const r = await api('session');
    me = r.user;
    if (!me) return loginPage();
    const hash = location.hash.slice(1);
    view = allowedViews().includes(hash) ? hash : inicialView();
    render();
  } catch {
    loginPage();
  }
})();