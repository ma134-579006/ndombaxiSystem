/**
 * RUNTIME do bot de suporte — executa o modelo de machine learning treinado
 * em Python de raiz (ml/bot/train.py): TF-IDF + regressão softmax.
 *
 * A tokenização replica EXATAMENTE a do treino (ml/bot/nlp.py):
 * minúsculas → sem acentos → tokens → stopwords → unigramas + bigramas.
 *
 * O bot conhece todo o sistema (conhecimento embutido no treino) e gera
 * GUIAS VISUAIS (SVG) — mas NUNCA acede à base de dados.
 */
import model from './bot-model.json';
import knowledge from './bot-knowledge.json';

const STOPWORDS = new Set([
  'a', 'o', 'as', 'os', 'um', 'uma', 'uns', 'umas', 'de', 'do', 'da', 'dos', 'das',
  'em', 'no', 'na', 'nos', 'nas', 'por', 'para', 'pra', 'com', 'sem', 'sobre',
  'e', 'ou', 'mas', 'que', 'se', 'ja', 'tambem', 'muito', 'mais', 'menos',
  'eu', 'tu', 'ele', 'ela', 'nos', 'voces', 'eles', 'elas', 'voce', 'vc',
  'meu', 'minha', 'teu', 'tua', 'seu', 'sua', 'este', 'esta', 'isto', 'esse',
  'essa', 'isso', 'aquele', 'aquela', 'aquilo', 'ao', 'aos', 'à', 'às', 'é',
  'ser', 'estar', 'ter', 'haver', 'foi', 'sao', 'está', 'esta', 'como',
]);

interface BotModel {
  classes: string[];
  vocab: Record<string, number>;
  idf: number[];
  bias: number[];
  weights: Record<string, number>[];
}
interface BotKnowledgeEntry { answer: string; escalate: boolean; image: string | null }

const M = model as unknown as BotModel;
const K = knowledge as unknown as Record<string, BotKnowledgeEntry>;

function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '');
}

function tokenize(s: string): string[] {
  const norm = stripAccents(s.toLowerCase()).replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  const toks = norm.split(' ').filter((t) => t.length > 1 && !STOPWORDS.has(t));
  const bigrams: string[] = [];
  for (let i = 0; i + 1 < toks.length; i++) bigrams.push(`${toks[i]}_${toks[i + 1]}`);
  return [...toks, ...bigrams];
}

/** TF-IDF (tf = 1+log(c); norma L2) — igual ao treino. */
function vectorize(text: string): Map<number, number> {
  const counts = new Map<string, number>();
  for (const t of tokenize(text)) counts.set(t, (counts.get(t) ?? 0) + 1);
  const vec = new Map<number, number>();
  for (const [t, c] of counts) {
    const i = M.vocab[t];
    if (i !== undefined) vec.set(i, (1 + Math.log(c)) * M.idf[i]);
  }
  let norm = 0;
  for (const v of vec.values()) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm > 0) for (const [i, v] of vec) vec.set(i, v / norm);
  return vec;
}

export interface BotPrediction {
  intent: string;
  confidence: number;
  answer: string;
  /** SVG do guia visual (quando a intenção tem imagem). */
  imageSvg: string | null;
  /** Só verdadeiro quando o VISITANTE pediu explicitamente um humano. */
  escalate: boolean;
}

/** Classifica a pergunta e devolve a resposta do conhecimento treinado. */
export function predict(text: string): BotPrediction | null {
  const x = vectorize(text);
  if (x.size === 0) return null; // sem sinal nenhum (emoji, "????", etc.)
  const k = M.classes.length;
  const zs = new Array<number>(k);
  for (let c = 0; c < k; c++) {
    let z = M.bias[c];
    const wc = M.weights[c];
    for (const [i, v] of x) {
      const w = wc[String(i)];
      if (w !== undefined) z += w * v;
    }
    zs[c] = z;
  }
  const m = Math.max(...zs);
  const exps = zs.map((z) => Math.exp(z - m));
  const sum = exps.reduce((s, e) => s + e, 0);
  let best = 0;
  for (let c = 1; c < k; c++) if (exps[c] > exps[best]) best = c;
  const conf = exps[best] / sum;
  const intent = M.classes[best];
  const kn = K[intent];
  if (!kn) return null;
  return { intent, confidence: conf, answer: kn.answer, imageSvg: kn.image, escalate: kn.escalate };
}

/** Resposta de recurso quando a confiança é baixa (NÃO escala sozinho). */
export function fallbackAnswer(): string {
  return 'Hmm, não tenho a certeza de ter percebido. 🤔 Posso ajudar com:\n• criar conta e planos\n• vender no caixa (PIN, scanner, recibos)\n• stock, lotes e inventário\n• folha salarial (INSS/IRT, faltas)\n• relatórios, SAF-T e impressões\n• loja online e encomendas\nReformula a pergunta — ou, se preferires, escreve «quero falar com um humano» e chamo a equipa.';
}
