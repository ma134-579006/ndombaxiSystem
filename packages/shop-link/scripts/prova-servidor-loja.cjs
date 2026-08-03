/**
 * Prova do SERVIDOR DA LOJA.
 *
 * É a peça que dá ao telemóvel o sistema completo sem internet — e a que, mal
 * feita, mandaria as vendas de uma empresa para uma máquina desconhecida, ou
 * deixaria um aparelho preso a um computador que já foi desligado.
 */
const path = require('node:path');
const {
  ESTADO_INICIAL, DESCANSO_MS, FALHAS_ATE_DESISTIR,
  anotarFalha, anotarSucesso, escolherBase, esquecerLoja, normalizarEndereco,
} = require(path.join(__dirname, '..', 'dist', 'index.js'));

const r = [];
const check = (nome, cond) => r.push([cond ? 'OK  ' : 'FALHA', nome]);
const NUVEM = 'https://ndombaxi-api-img.onrender.com';

// ── Que endereços se aceitam ──────────────────────────────────────────
const escrito = normalizarEndereco('192.168.1.50:3399');
check('endereço escrito à mão, sem http → aceite', escrito.ok === true);
check('  e fica uma base limpa', escrito.url === 'http://192.168.1.50:3399');

check('10.x.x.x (rede de loja) → aceite', normalizarEndereco('http://10.0.0.7:3399').ok === true);
check('172.20.x.x (rede de loja) → aceite', normalizarEndereco('http://172.20.5.9:3399').ok === true);
check('localhost → aceite', normalizarEndereco('http://127.0.0.1:3399').ok === true);

// O engano que isto impede: o aparelho a entregar as vendas da empresa a uma
// máquina que ninguém controla.
const publico = normalizarEndereco('http://185.23.44.10:3399');
check('endereço PÚBLICO por http → RECUSADO', publico.ok === false);
check('  e explica-se porquê', /rede local/i.test(publico.motivo));
check('172.32.x.x (fora da gama privada) → recusado',
  normalizarEndereco('http://172.32.0.1:3399').ok === false);
check('endereço com octeto inválido → recusado',
  normalizarEndereco('http://192.168.1.999:3399').ok === false);
check('esquema estranho → recusado', normalizarEndereco('ftp://192.168.1.50').ok === false);
check('vazio → recusado com instrução', /Escreva/.test(normalizarEndereco('').motivo));

// Um nome próprio com https é legítimo (quem tiver certificado).
check('nome próprio por https → aceite', normalizarEndereco('https://loja.minhaempresa.ao').ok === true);

// Caminhos e páginas não são bases de API.
const comCaminho = normalizarEndereco('http://192.168.1.50:3399/gestao/index.html?x=1');
check('endereço com caminho → fica só a base', comCaminho.url === 'http://192.168.1.50:3399');

// ── Quando se usa a loja e quando se volta à nuvem ────────────────────
check('sem servidor configurado → nuvem',
  escolherBase(ESTADO_INICIAL, NUVEM).usandoLoja === false);

let estado = { url: 'http://192.168.1.50:3399', failures: 0, restingUntil: null };
check('servidor configurado → usa a LOJA', escolherBase(estado, NUVEM).usandoLoja === true);
check('  e é mesmo o endereço da loja', escolherBase(estado, NUVEM).base === 'http://192.168.1.50:3399');

// Uma falha isolada (um pacote perdido no Wi-Fi) não desliga nada.
estado = anotarFalha(estado, 1_000);
check('1 falha → continua na loja', escolherBase(estado, NUVEM, 2_000).usandoLoja === true);

// O empregado saiu da loja: ao fim de algumas falhas seguidas, volta à nuvem
// sozinho. Ficar preso ao endereço morto seria um telemóvel que deixou de servir.
estado = anotarFalha(estado, 1_000);
estado = anotarFalha(estado, 1_000);
check(`${FALHAS_ATE_DESISTIR} falhas seguidas → volta à NUVEM`,
  escolherBase(estado, NUVEM, 2_000).usandoLoja === false);
check('  mas não esquece o servidor da loja', estado.url === 'http://192.168.1.50:3399');

// E volta a tentar mais tarde — o computador da loja pode ter sido religado.
check('passado o descanso → tenta a loja outra vez',
  escolherBase(estado, NUVEM, 1_000 + DESCANSO_MS + 1).usandoLoja === true);

// Respondeu: esquece o mau passado.
estado = anotarSucesso(estado);
check('respondeu → contagem de falhas a zero', estado.failures === 0);
check('  e volta a usar a loja já', escolherBase(estado, NUVEM, 2_000).usandoLoja === true);

// O responsável desligou a ligação à loja.
check('esquecer a loja → volta à nuvem', escolherBase(esquecerLoja(), NUVEM).usandoLoja === false);

for (const [e, n] of r) console.log(e, n);
const falhas = r.filter(([e]) => e !== 'OK  ').length;
console.log(`\n${r.length - falhas}/${r.length}`);
process.exit(falhas ? 1 : 0);
