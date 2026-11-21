// Servidor do site Toldos e Estofados Boa Vista
// Sem dependências: só precisa do Node.js instalado. Rodar com: node server.js

const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PORT = process.env.PORT || 3000;
const PUB = path.join(__dirname, 'public');
const DATA = path.join(__dirname, 'data');
const UP = path.join(PUB, 'uploads');
const DB_FILE = path.join(DATA, 'db.json');

// Login do administrador (pode trocar por variável de ambiente na hospedagem)
const ADMIN_USER = process.env.ADMIN_USER || 'toldos_boavista*';
const ADMIN_PASS = process.env.ADMIN_PASS || '241079';

fs.mkdirSync(UP, { recursive: true });
fs.mkdirSync(DATA, { recursive: true });

const SECOES = ['toldos', 'servicos', 'tecidos'];

const INICIAL = {
  users: [],
  mensagens: [],
  content: {
    toldos: [
      { id: 't1', titulo: 'Toldo retrátil de mola automática', descricao: 'Abre e fecha com facilidade, sem precisar de manivela. Ótimo para varandas, garagens e áreas de lazer.', foto: '' },
      { id: 't2', titulo: 'Toldo para janelas e portas', descricao: 'Protege do sol e da chuva e ajuda a manter o ambiente mais fresco.', foto: '' },
      { id: 't3', titulo: 'Cobertura para garagem', descricao: 'Proteção para o carro e para a área externa da casa.', foto: '' }
    ],
    servicos: [
      { id: 's1', titulo: 'Reforma de sofás', descricao: 'Troca de tecido, espuma e reparos na estrutura.', foto: '' },
      { id: 's2', titulo: 'Reforma de poltronas e cadeiras', descricao: 'Deixamos como nova, com o tecido que você escolher.', foto: '' },
      { id: 's3', titulo: 'Instalação de toldos', descricao: 'Instalação em Alterosa e em toda a região.', foto: '' }
    ],
    tecidos: [
      { id: 'c1', titulo: 'Suede', descricao: 'Macio e com boa aparência, muito usado em sofás e poltronas.', foto: '' },
      { id: 'c2', titulo: 'Veludo', descricao: 'Toque aconchegante e acabamento elegante.', foto: '' },
      { id: 'c3', titulo: 'Courino', descricao: 'Fácil de limpar e bem resistente.', foto: '' },
      { id: 'c4', titulo: 'Lona para toldos', descricao: 'Resistente ao sol e à chuva, em várias cores.', foto: '' }
    ]
  }
};

function carregar() {
  try { return JSON.parse(fs.readFileSync(DB_FILE, 'utf8')); }
  catch { fs.writeFileSync(DB_FILE, JSON.stringify(INICIAL, null, 2)); return JSON.parse(JSON.stringify(INICIAL)); }
}
let db = carregar();
function salvar() {
  const tmp = DB_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(db, null, 2));
  fs.renameSync(tmp, DB_FILE);
}

// ---------- senhas e sessões ----------
function hashSenha(senha, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(senha, salt, 64).toString('hex');
  return { salt, hash };
}
function confere(senha, salt, hash) {
  const h = crypto.scryptSync(senha, salt, 64);
  const b = Buffer.from(hash, 'hex');
  return b.length === h.length && crypto.timingSafeEqual(h, b);
}
function igual(a, b) {
  const ha = crypto.createHash('sha256').update(String(a)).digest();
  const hb = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(ha, hb);
}

const sessoes = new Map(); // token -> { role, nome, email, exp }
const DOZE_HORAS = 12 * 60 * 60 * 1000;
function novaSessao(dados) {
  const token = crypto.randomBytes(32).toString('hex');
  sessoes.set(token, { ...dados, exp: Date.now() + DOZE_HORAS });
  return token;
}
function sessaoDe(req) {
  const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
  if (!m) return null;
  const s = sessoes.get(m[1]);
  if (!s) return null;
  if (s.exp < Date.now()) { sessoes.delete(m[1]); return null; }
  return s;
}

// limite de tentativas de login por IP
const tentativas = new Map();
function bloqueado(ip) {
  const t = tentativas.get(ip);
  return t && t.n >= 10 && Date.now() - t.ini < 15 * 60 * 1000;
}
function falhou(ip) {
  const t = tentativas.get(ip);
  if (!t || Date.now() - t.ini > 15 * 60 * 1000) tentativas.set(ip, { n: 1, ini: Date.now() });
  else t.n++;
}

// ---------- utilidades http ----------
function json(res, status, obj) {
  const body = JSON.stringify(obj);
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(body);
}
function lerCorpo(req, limite = 8 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let tam = 0; const partes = [];
    req.on('data', c => {
      tam += c.length;
      if (tam > limite) { reject(new Error('grande')); req.destroy(); return; }
      partes.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(partes).toString('utf8') || '{}')); }
      catch { reject(new Error('json')); }
    });
    req.on('error', reject);
  });
}
const txt = (v, max) => String(v == null ? '' : v).trim().slice(0, max);

function salvarFoto(dataUrl) {
  const m = /^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || '');
  if (!m) return null;
  const buf = Buffer.from(m[2], 'base64');
  if (buf.length > 6 * 1024 * 1024) return null;
  const ext = m[1] === 'jpeg' ? 'jpg' : m[1];
  const nome = crypto.randomBytes(12).toString('hex') + '.' + ext;
  fs.writeFileSync(path.join(UP, nome), buf);
  return 'uploads/' + nome;
}
function apagarFoto(foto) {
  if (!foto || !foto.startsWith('uploads/')) return;
  fs.unlink(path.join(UP, path.basename(foto)), () => {});
}

// ---------- API ----------
async function api(req, res, url) {
  const ip = req.socket.remoteAddress;
  const rota = url.pathname;
  const sess = sessaoDe(req);

  try {
    if (req.method === 'GET' && rota === '/api/content') return json(res, 200, db.content);

    if (req.method === 'GET' && rota === '/api/me') {
      return json(res, 200, sess ? { role: sess.role, nome: sess.nome, email: sess.email || '' } : { role: null });
    }

    if (req.method === 'POST' && rota === '/api/register') {
      const b = await lerCorpo(req, 50 * 1024);
      const nome = txt(b.nome, 80), email = txt(b.email, 120).toLowerCase(), senha = String(b.senha || '');
      if (nome.length < 2) return json(res, 400, { erro: 'Digite seu nome.' });
      if (!/^\S+@\S+\.\S+$/.test(email)) return json(res, 400, { erro: 'E-mail inválido.' });
      if (senha.length < 6) return json(res, 400, { erro: 'A senha precisa ter pelo menos 6 caracteres.' });
      if (db.users.some(u => u.email === email)) return json(res, 400, { erro: 'Esse e-mail já está cadastrado.' });
      const { salt, hash } = hashSenha(senha);
      db.users.push({ id: crypto.randomUUID(), nome, email, salt, hash, criado: new Date().toISOString() });
      salvar();
      const token = novaSessao({ role: 'user', nome, email });
      return json(res, 200, { token, role: 'user', nome });
    }

    if (req.method === 'POST' && rota === '/api/login') {
      if (bloqueado(ip)) return json(res, 429, { erro: 'Muitas tentativas. Espere alguns minutos.' });
      const b = await lerCorpo(req, 50 * 1024);
      const usuario = txt(b.usuario, 120), senha = String(b.senha || '');
      // administrador
      if (igual(usuario, ADMIN_USER) && igual(senha, ADMIN_PASS)) {
        const token = novaSessao({ role: 'admin', nome: 'Administrador' });
        return json(res, 200, { token, role: 'admin', nome: 'Administrador' });
      }
      // usuário normal (entra com e-mail)
      const u = db.users.find(x => x.email === usuario.toLowerCase());
      if (u && confere(senha, u.salt, u.hash)) {
        const token = novaSessao({ role: 'user', nome: u.nome, email: u.email });
        return json(res, 200, { token, role: 'user', nome: u.nome });
      }
      falhou(ip);
      return json(res, 401, { erro: 'Usuário ou senha incorretos.' });
    }

    if (req.method === 'POST' && rota === '/api/logout') {
      const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
      if (m) sessoes.delete(m[1]);
      return json(res, 200, { ok: true });
    }

    if (req.method === 'POST' && rota === '/api/contato') {
      const b = await lerCorpo(req, 50 * 1024);
      const nome = txt(b.nome, 80), telefone = txt(b.telefone, 30), mensagem = txt(b.mensagem, 1500);
      if (nome.length < 2 || mensagem.length < 3) return json(res, 400, { erro: 'Preencha nome e mensagem.' });
      db.mensagens.unshift({ id: crypto.randomUUID(), nome, telefone, mensagem, data: new Date().toISOString() });
      db.mensagens = db.mensagens.slice(0, 500);
      salvar();
      return json(res, 200, { ok: true });
    }

    // ----- só administrador daqui pra baixo -----
    const mCont = /^\/api\/content\/([a-z]+)(?:\/([\w-]+))?$/.exec(rota);
    if (mCont && (req.method === 'POST' || req.method === 'DELETE')) {
      if (!sess || sess.role !== 'admin') return json(res, 403, { erro: 'Só o administrador pode fazer isso.' });
      const sec = mCont[1];
      if (!SECOES.includes(sec)) return json(res, 404, { erro: 'Seção não existe.' });

      if (req.method === 'POST') {
        const b = await lerCorpo(req);
        const titulo = txt(b.titulo, 80), descricao = txt(b.descricao, 400);
        if (!titulo) return json(res, 400, { erro: 'Coloque um título.' });
        let foto = '';
        if (b.foto) {
          foto = salvarFoto(b.foto);
          if (!foto) return json(res, 400, { erro: 'Foto inválida. Use JPG, PNG ou WEBP.' });
        }
        const item = { id: crypto.randomBytes(6).toString('hex'), titulo, descricao, foto };
        db.content[sec].push(item);
        salvar();
        return json(res, 200, item);
      }

      if (req.method === 'DELETE' && mCont[2]) {
        const i = db.content[sec].findIndex(x => x.id === mCont[2]);
        if (i < 0) return json(res, 404, { erro: 'Item não encontrado.' });
        const [rem] = db.content[sec].splice(i, 1);
        apagarFoto(rem.foto);
        salvar();
        return json(res, 200, { ok: true });
      }
    }

    if (req.method === 'GET' && rota === '/api/mensagens') {
      if (!sess || sess.role !== 'admin') return json(res, 403, { erro: 'Só o administrador pode ver.' });
      return json(res, 200, db.mensagens);
    }
    const mMsg = /^\/api\/mensagens\/([\w-]+)$/.exec(rota);
    if (req.method === 'DELETE' && mMsg) {
      if (!sess || sess.role !== 'admin') return json(res, 403, { erro: 'Só o administrador pode fazer isso.' });
      db.mensagens = db.mensagens.filter(x => x.id !== mMsg[1]);
      salvar();
      return json(res, 200, { ok: true });
    }

    return json(res, 404, { erro: 'Não encontrado.' });
  } catch (e) {
    if (e.message === 'grande') return json(res, 413, { erro: 'Arquivo muito grande.' });
    if (e.message === 'json') return json(res, 400, { erro: 'Requisição inválida.' });
    console.error(e);
    return json(res, 500, { erro: 'Erro no servidor.' });
  }
}

// ---------- arquivos estáticos ----------
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp',
  '.svg': 'image/svg+xml', '.ico': 'image/x-icon'
};
function estatico(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p === '/') p = '/index.html';
  const arq = path.normalize(path.join(PUB, p));
  if (!arq.startsWith(PUB + path.sep)) { res.writeHead(403); return res.end('Proibido'); }
  fs.readFile(arq, (err, data) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('Página não encontrada'); }
    res.writeHead(200, {
      'Content-Type': MIME[path.extname(arq).toLowerCase()] || 'application/octet-stream',
      'X-Content-Type-Options': 'nosniff'
    });
    res.end(data);
  });
}

http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (url.pathname.startsWith('/api/')) return api(req, res, url);
  estatico(req, res, url);
}).listen(PORT, () => console.log('Site no ar: http://localhost:' + PORT));
