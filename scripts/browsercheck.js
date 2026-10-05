/**
 * Roda uma pagina no Edge headless e le o texto de um elemento quando ela
 * termina, usando o protocolo DevTools. Alternativa ao --dump-dom, que
 * captura o DOM antes das chamadas de rede terminarem.
 *
 * uso: node scripts/browsercheck.js <url> <seletor> <marcador> [segundos]
 */
const [, , url, seletor = '#r', marcador = 'FIM', limiteSeg = '60'] = process.argv;
const porta = Number(process.env.CDP_PORT || 9333);
const limite = Number(limiteSeg) * 1000;

const inicio = Date.now();
let ws = null;
let proximoId = 1;
const pendentes = new Map();

function enviar(method, params = {}) {
  return new Promise((resolve, reject) => {
    const id = proximoId++;
    pendentes.set(id, { resolve, reject });
    ws.send(JSON.stringify({ id, method, params }));
  });
}

/** Espera a pagina de /json existir. */
async function esperarAlvo() {
  while (Date.now() - inicio < limite) {
    try {
      const r = await fetch(`http://127.0.0.1:${porta}/json`);
      const lista = await r.json();
      const alvo = lista.find((t) => t.type === 'page' && t.webSocketDebuggerUrl);
      if (alvo) return alvo;
    } catch { /* navegador ainda subindo */ }
    await new Promise((r) => setTimeout(r, 300));
  }
  throw new Error('Edge nao expôs um alvo de pagina a tempo.');
}

const alvo = await esperarAlvo();
ws = new WebSocket(alvo.webSocketDebuggerUrl);

await new Promise((res, rej) => {
  ws.addEventListener('open', res, { once: true });
  ws.addEventListener('error', rej, { once: true });
});

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pendentes.has(m.id)) {
    const { resolve, reject } = pendentes.get(m.id);
    pendentes.delete(m.id);
    if (m.error) reject(new Error(m.error.message));
    else resolve(m.result);
  }
});

await enviar('Runtime.enable');
await enviar('Page.enable');
await enviar('Page.navigate', { url });

const expr = `document.querySelector(${JSON.stringify(seletor)})?.textContent || ''`;
let texto = '';
while (Date.now() - inicio < limite) {
  await new Promise((r) => setTimeout(r, 500));
  try {
    const r = await enviar('Runtime.evaluate', { expression: expr, returnByValue: true });
    texto = r?.result?.value || '';
  } catch { /* recarregou a pagina */ }
  if (texto.includes(marcador)) break;
}

if (!texto.trim()) {
  console.error('Nada lido do seletor. Verifique se a pagina carregou.');
  process.exitCode = 1;
} else {
  console.log(texto);
  if (!texto.includes(marcador)) {
    console.error(`\n[aviso] marcador "${marcador}" nao apareceu a tempo; resultado parcial.`);
    process.exitCode = 2;
  }
}
ws.close();
process.exit(process.exitCode ?? 0);
