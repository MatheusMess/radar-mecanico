// node:zlib expoe deflateSync como export nomeado; o objeto 'zlib' e o
// default export do modulo.
import { deflateSync } from 'node:zlib';

/**
 * Desenho das imagens de demonstracao, sem GD e sem dependencias.
 *
 * Gera PNGs RGB (filtro None) com fundo em gradiente e silhuetas simples de
 * veiculo e de fachada de oficina. Sao placeholders: a ideia e o sistema ter
 * fotos para exibir, nao servir de fotografia.
 */

export class Tela {
  constructor(w, h) {
    this.w = w;
    this.h = h;
    this.px = Buffer.alloc(w * h * 3);
  }

  ponto(x, y, [r, g, b]) {
    if (x < 0 || y < 0 || x >= this.w || y >= this.h) return;
    const o = (y * this.w + x) * 3;
    this.px[o] = r & 255;
    this.px[o + 1] = g & 255;
    this.px[o + 2] = b & 255;
  }

  gradiente(c1, c2, ang = 0.6) {
    const dx = Math.cos(ang);
    const dy = Math.sin(ang);
    const div = Math.max(0.001, Math.abs(dx) + Math.abs(dy));
    for (let y = 0; y < this.h; y++) {
      for (let x = 0; x < this.w; x++) {
        let t = ((x / Math.max(1, this.w - 1)) * dx + (y / Math.max(1, this.h - 1)) * dy) / div;
        t = Math.max(0, Math.min(1, t));
        this.ponto(x, y, [
          Math.round(c1[0] + (c2[0] - c1[0]) * t),
          Math.round(c1[1] + (c2[1] - c1[1]) * t),
          Math.round(c1[2] + (c2[2] - c1[2]) * t),
        ]);
      }
    }
  }

  elipse(cx, cy, rx, ry, cor, borda = 0) {
    for (let y = Math.floor(cy - ry - borda); y <= Math.ceil(cy + ry + borda); y++) {
      for (let x = Math.floor(cx - rx - borda); x <= Math.ceil(cx + rx + borda); x++) {
        const d = ((x - cx) ** 2) / ((rx + borda) ** 2) + ((y - cy) ** 2) / ((ry + borda) ** 2);
        if (d > 1) continue;
        this.ponto(x, y, cor);
      }
    }
  }

  retangulo(x0, y0, x1, y1, cor, raio = 0) {
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
      for (let x = Math.floor(x0); x <= Math.ceil(x1); x++) {
        if (raio > 0) {
          const cx = Math.min(Math.max(x, x0 + raio), x1 - raio);
          const cy = Math.min(Math.max(y, y0 + raio), y1 - raio);
          if ((x - cx) ** 2 + (y - cy) ** 2 > raio * raio) continue;
        }
        this.ponto(x, y, cor);
      }
    }
  }

  trapezio(baseEsq, baseDir, yTopo, yBase, topoEsq, topoDir, cor) {
    const altura = yBase - yTopo;
    if (altura <= 0) return;
    for (let y = Math.floor(yTopo); y <= Math.ceil(yBase); y++) {
      const t = (y - yTopo) / altura;
      const l = baseEsq + (topoEsq - baseEsq) * t;
      const r = baseDir + (topoDir - baseDir) * t;
      for (let x = Math.ceil(l); x <= Math.floor(r); x++) this.ponto(x, y, cor);
    }
  }

  paraPng() {
    const raw = Buffer.alloc(this.h * (this.w * 3 + 1));
    for (let y = 0; y < this.h; y++) {
      raw[y * (this.w * 3 + 1)] = 0;
      this.px.copy(raw, y * (this.w * 3 + 1) + 1, y * this.w * 3, (y + 1) * this.w * 3);
    }
    const crcTable = [];
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c >>> 0;
    }
    const crc32 = (buf) => {
      let c = 0xffffffff;
      for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
      return (c ^ 0xffffffff) >>> 0;
    };
    const chunk = (tipo, corpo) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(corpo.length);
      const t = Buffer.from(tipo, 'ascii');
      const c = Buffer.alloc(4);
      c.writeUInt32BE(crc32(Buffer.concat([t, corpo])));
      return Buffer.concat([len, t, corpo, c]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(this.w, 0);
    ihdr.writeUInt32BE(this.h, 4);
    ihdr[8] = 8;  // bit depth
    ihdr[9] = 2;  // color type RGB
    return Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk('IHDR', ihdr),
      chunk('IDAT', deflateSync(raw, { level: 9 })),
      chunk('IEND', Buffer.alloc(0)),
    ]);
  }
}

export function desenharCarro(t, corCarro, corJanela) {
  const L = t.w * 0.66;
  const x0 = (t.w - L) / 2;
  const x1 = x0 + L;
  const H = t.h * 0.30;
  const chao = t.h * 0.76;
  const raio = H * 0.26;
  const topoCarro = chao - H;
  const topoCabine = topoCarro - H * 0.46;
  const base = topoCarro + H * 0.02;

  t.elipse((x0 + x1) / 2, chao + raio * 0.55, L * 0.52, raio * 0.42, [26, 28, 33]);
  t.trapezio(x0 + L * 0.24, x1 - L * 0.30, topoCabine, base, x0 + L * 0.40, x1 - L * 0.26, corCarro);
  t.trapezio(x0 + L * 0.30, x1 - L * 0.34, topoCabine + H * 0.07, base - H * 0.03,
    x0 + L * 0.43, x1 - L * 0.29, corJanela);
  t.retangulo(x0 + L * 0.50, topoCabine + H * 0.04, x0 + L * 0.535, base, corCarro);
  t.retangulo(x0, base, x1, chao - raio * 0.30, corCarro, Math.round(H * 0.14));
  for (const cx of [x0 + L * 0.25, x1 - L * 0.25]) {
    t.elipse(cx, chao - raio * 0.28, raio, raio, [20, 22, 26]);
    t.elipse(cx, chao - raio * 0.28, raio * 0.46, raio * 0.46, [148, 154, 164]);
  }
  t.elipse(x1 - L * 0.05, base + H * 0.16, H * 0.09, H * 0.06, [252, 238, 176]);
  t.elipse(x0 + L * 0.05, base + H * 0.16, H * 0.08, H * 0.06, [198, 58, 52]);
}

export function desenharOficina(t, corParede, corToldo) {
  const w = t.w;
  const h = t.h;
  t.retangulo(0, h * 0.62, w, h, [58, 60, 66]);
  t.retangulo(w * 0.06, h * 0.20, w * 0.94, h * 0.72, corParede, 6);
  t.retangulo(w * 0.02, h * 0.12, w * 0.98, h * 0.24, corToldo, 4);
  for (let i = 0; i < 7; i++) {
    const x = w * 0.02 + i * ((w * 0.96) / 7);
    t.retangulo(x, h * 0.12, x + w * 0.068, h * 0.24, [235, 238, 242]);
  }
  t.retangulo(w * 0.14, h * 0.34, w * 0.44, h * 0.56, [150, 195, 225], 3);
  t.retangulo(w * 0.54, h * 0.30, w * 0.86, h * 0.72, [46, 49, 56], 3);
  for (let i = 1; i < 6; i++) {
    const y = h * 0.30 + i * ((h * 0.42) / 6);
    t.retangulo(w * 0.54, y, w * 0.86, y - 2, [72, 76, 84]);
  }
}