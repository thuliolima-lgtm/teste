// Site Toldos e Estofados Boa Vista

const SECOES = {
  toldos: 'Novo tipo de toldo',
  servicos: 'Novo serviço realizado',
  tecidos: 'Novo tecido / material'
};

let token = null;
try { token = localStorage.getItem('bv_token'); } catch (e) {}
let sessao = { role: null };

// ---------- ajuda ----------
async function api(url, opcoes = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const r = await fetch(url, { ...opcoes, headers });
  let dados = {};
  try { dados = await r.json(); } catch (e) {}
  if (!r.ok) throw new Error(dados.erro || 'Algo deu errado. Tente de novo.');
  return dados;
}

function el(tag, props = {}, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else e.setAttribute(k, v);
  }
  filhos.forEach(f => e.append(f));
  return e;
}

function aviso(id, texto, tipo) {
  const p = document.getElementById(id);
  p.textContent = texto;
  p.className = 'aviso' + (tipo ? ' ' + tipo : '');
}

// reduz a foto antes de enviar, pra não pesar no site
function reduzirFoto(arquivo, maxLado = 1400, qualidade = 0.82) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(arquivo);
    const img = new Image();
    img.onload = () => {
      let { width: w, height: h } = img;
      const escala = Math.min(1, maxLado / Math.max(w, h));
      w = Math.round(w * escala); h = Math.round(h * escala);
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      c.getContext('2d').drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', qualidade));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Não consegui abrir essa foto.')); };
    img.src = url;
  });
}

// ---------- conteúdo ----------
let conteudo = { toldos: [], servicos: [], tecidos: [] };

async function carregarConteudo() {
  try { conteudo = await api('/api/content'); } catch (e) { /* mantém vazio */ }
  Object.keys(SECOES).forEach(desenharSecao);
}

function desenharSecao(sec) {
  const grade = document.getElementById('grade-' + sec);
  grade.replaceChildren();
  if (!conteudo[sec].length) {
    grade.append(el('p', { class: 'sub' }, 'Em breve.'));
    return;
  }
  conteudo[sec].forEach(item => {
    const corpo = el('div', { class: 'corpo' }, el('h3', {}, item.titulo));
    if (item.descricao) corpo.append(el('p', {}, item.descricao));
    if (sessao.role === 'admin') {
      corpo.append(el('button', { class: 'btn peq perigo', type: 'button', onclick: () => apagarItem(sec, item.id) }, 'Apagar'));
    }
    const card = el('div', { class: 'card' });
    if (item.foto) {
      card.append(el('img', { src: item.foto, alt: item.titulo, loading: 'lazy', onclick: () => abrirFoto(item.foto) }));
    } else {
      card.append(el('div', { class: 'sem-foto' }));
    }
    card.append(corpo);
    grade.append(card);
  });
}

function abrirFoto(src) {
  const lb = el('div', { class: 'lightbox', onclick: () => lb.remove() }, el('img', { src, alt: '' }));
  document.body.append(lb);
}

async function apagarItem(sec, id) {
  if (!confirm('Apagar este item?')) return;
  try {
    await api('/api/content/' + sec + '/' + id, { method: 'DELETE' });
    conteudo[sec] = conteudo[sec].filter(x => x.id !== id);
    desenharSecao(sec);
  } catch (e) { alert(e.message); }
}

// formulários de upload (só aparecem para o administrador)
function montarFormsAdmin() {
  document.querySelectorAll('.admin-form').forEach(form => {
    const sec = form.dataset.sec;
    form.replaceChildren(
      el('p', { class: 'tit' }, SECOES[sec] + ' (só você, administrador, vê isso)'),
      el('label', {}, 'Título', el('input', { name: 'titulo', required: '', maxlength: '80' })),
      el('label', {}, 'Descrição (opcional)', el('input', { name: 'descricao', maxlength: '400' })),
      el('label', {}, 'Foto (opcional)', el('input', { name: 'foto', type: 'file', accept: 'image/*' })),
      el('button', { class: 'btn sec', type: 'submit' }, 'Adicionar'),
      el('p', { class: 'aviso', style: 'flex-basis:100%', role: 'status' })
    );
    form.onsubmit = async ev => {
      ev.preventDefault();
      const msg = form.querySelector('.aviso');
      const botao = form.querySelector('button');
      msg.className = 'aviso'; msg.textContent = 'Enviando...';
      botao.disabled = true;
      try {
        const arq = form.foto.files[0];
        const corpo = { titulo: form.titulo.value, descricao: form.descricao.value };
        if (arq) corpo.foto = await reduzirFoto(arq);
        const novo = await api('/api/content/' + sec, { method: 'POST', body: JSON.stringify(corpo) });
        conteudo[sec].push(novo);
        desenharSecao(sec);
        form.reset();
        msg.className = 'aviso ok'; msg.textContent = 'Adicionado!';
      } catch (e) {
        msg.className = 'aviso erro'; msg.textContent = e.message;
      }
      botao.disabled = false;
    };
  });
}

// ---------- conta ----------
function atualizarConta() {
  const logado = !!sessao.role;
  const admin = sessao.role === 'admin';
  document.getElementById('deslogado').hidden = logado;
  document.getElementById('logado').hidden = !logado;
  document.getElementById('painelAdmin').hidden = !admin;
  document.getElementById('linkConta').textContent = logado ? 'Minha conta' : 'Entrar / Cadastrar';
  document.querySelectorAll('.admin-form').forEach(f => { f.hidden = !admin; });
  if (logado) {
    document.getElementById('saudacao').textContent = admin
      ? 'Você está logado como administrador.'
      : 'Olá, ' + sessao.nome + '! Você está logado.';
  }
  // preenche o formulário de contato com o nome da pessoa
  const fc = document.getElementById('formContato');
  if (logado && !admin && !fc.nome.value) fc.nome.value = sessao.nome;
  Object.keys(SECOES).forEach(desenharSecao);
  if (admin) carregarMensagens();
}

function entrou(dados) {
  token = dados.token;
  try { localStorage.setItem('bv_token', token); } catch (e) {}
  sessao = { role: dados.role, nome: dados.nome };
  atualizarConta();
  location.hash = dados.role === 'admin' ? '#toldos' : '#conta';
}

async function verificarSessao() {
  if (!token) return atualizarConta();
  try { sessao = await api('/api/me'); } catch (e) { sessao = { role: null }; }
  if (!sessao.role) { token = null; try { localStorage.removeItem('bv_token'); } catch (e) {} }
  atualizarConta();
}

async function carregarMensagens() {
  const box = document.getElementById('listaMensagens');
  try {
    const msgs = await api('/api/mensagens');
    box.replaceChildren();
    if (!msgs.length) { box.append(el('p', {}, 'Nenhuma mensagem ainda.')); return; }
    msgs.forEach(m => {
      const data = new Date(m.data).toLocaleString('pt-BR');
      box.append(el('div', { class: 'msg' },
        el('small', {}, data + ' · ' + m.nome + (m.telefone ? ' · ' + m.telefone : '')),
        el('p', {}, m.mensagem),
        el('button', { class: 'btn peq perigo', type: 'button', onclick: async () => {
          try { await api('/api/mensagens/' + m.id, { method: 'DELETE' }); carregarMensagens(); } catch (e) { alert(e.message); }
        } }, 'Apagar')
      ));
    });
  } catch (e) { box.textContent = e.message; }
}

// ---------- eventos ----------
document.getElementById('btnMenu').addEventListener('click', () => document.getElementById('menu').classList.toggle('aberto'));
document.querySelectorAll('#menu a').forEach(a => a.addEventListener('click', () => document.getElementById('menu').classList.remove('aberto')));

document.querySelectorAll('.aba').forEach(b => b.addEventListener('click', () => {
  document.querySelectorAll('.aba').forEach(x => x.classList.toggle('ativa', x === b));
  document.getElementById('formLogin').hidden = b.dataset.aba !== 'entrar';
  document.getElementById('formCadastro').hidden = b.dataset.aba !== 'cadastrar';
}));

document.getElementById('formLogin').addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = ev.target;
  aviso('msgLogin', 'Entrando...');
  try {
    const d = await api('/api/login', { method: 'POST', body: JSON.stringify({ usuario: f.usuario.value, senha: f.senha.value }) });
    f.reset(); aviso('msgLogin', '');
    entrou(d);
  } catch (e) { aviso('msgLogin', e.message, 'erro'); }
});

document.getElementById('formCadastro').addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = ev.target;
  aviso('msgCadastro', 'Criando conta...');
  try {
    const d = await api('/api/register', { method: 'POST', body: JSON.stringify({ nome: f.nome.value, email: f.email.value, senha: f.senha.value }) });
    f.reset(); aviso('msgCadastro', '');
    entrou(d);
  } catch (e) { aviso('msgCadastro', e.message, 'erro'); }
});

document.getElementById('btnSair').addEventListener('click', async () => {
  try { await api('/api/logout', { method: 'POST' }); } catch (e) {}
  token = null; sessao = { role: null };
  try { localStorage.removeItem('bv_token'); } catch (e) {}
  atualizarConta();
});

document.getElementById('formContato').addEventListener('submit', async ev => {
  ev.preventDefault();
  const f = ev.target;
  aviso('msgContato', 'Enviando...');
  try {
    await api('/api/contato', { method: 'POST', body: JSON.stringify({ nome: f.nome.value, telefone: f.telefone.value, mensagem: f.mensagem.value }) });
    f.mensagem.value = '';
    aviso('msgContato', 'Mensagem enviada! Em breve a gente responde.', 'ok');
  } catch (e) { aviso('msgContato', e.message, 'erro'); }
});

// ---------- início ----------
montarFormsAdmin();
carregarConteudo();
verificarSessao();
