# -*- coding: utf-8 -*-
"""
TREINO do bot (machine learning de raiz, sem bibliotecas):

  corpus → TF-IDF → regressão logística multinomial (softmax) treinada por
  gradiente descendente com regularização L2 → avaliação → exporta:

    apps/api/src/support/bot-model.json      (vocabulário, idf, pesos)
    apps/api/src/support/bot-knowledge.json  (respostas + imagens SVG)

Correr:  python ml/bot/train.py
"""
from __future__ import annotations

import json
import math
import os
import random
import sys

sys.path.insert(0, os.path.dirname(__file__))
from corpus import INTENTS  # noqa: E402
from images import GUIDES  # noqa: E402
from nlp import TfidfVectorizer, softmax, tokenize  # noqa: E402

random.seed(42)

ROOT = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT_DIR = os.path.join(ROOT, "apps", "api", "src", "support")

EPOCHS = 350
LR = 0.5
L2 = 1e-4


def main() -> None:
    # ── dados ──
    X_docs: list[str] = []
    y: list[int] = []
    classes = [it["id"] for it in INTENTS]
    for ci, it in enumerate(INTENTS):
        for ex in it["examples"]:
            X_docs.append(ex)
            y.append(ci)

    vec = TfidfVectorizer()
    vec.fit(X_docs)
    X = [vec.transform(d) for d in X_docs]
    n, d, k = len(X), len(vec.vocab), len(classes)
    print(f"corpus: {n} exemplos · {k} intenções · vocabulário {d} termos")

    # ── pesos (k × d) + bias (k) ──
    W = [[0.0] * d for _ in range(k)]
    b = [0.0] * k

    idx = list(range(n))
    for epoch in range(EPOCHS):
        random.shuffle(idx)
        loss = 0.0
        for i in idx:
            xi, yi = X[i], y[i]
            zs = [b[c] + sum(W[c][j] * v for j, v in xi.items()) for c in range(k)]
            ps = softmax(zs)
            loss -= math.log(max(ps[yi], 1e-12))
            for c in range(k):
                g = ps[c] - (1.0 if c == yi else 0.0)
                b[c] -= LR * g
                wc = W[c]
                for j, v in xi.items():
                    wc[j] -= LR * (g * v + L2 * wc[j])
        if (epoch + 1) % 70 == 0:
            print(f"  época {epoch + 1:>3} · loss média {loss / n:.4f}")

    # ── avaliação (treino + sondas de generalização) ──
    correct = 0
    for i in range(n):
        zs = [b[c] + sum(W[c][j] * v for j, v in X[i].items()) for c in range(k)]
        if max(range(k), key=lambda c: zs[c]) == y[i]:
            correct += 1
    print(f"precisão no corpus: {correct}/{n} = {correct / n:.1%}")

    probes = [
        ("quero registar a minha loja no sistema", "criar_conta"),
        ("o meu operador esqueceu o pin da caixa", "login_caixa"),
        ("chegou mercadoria nova do fornecedor", "entrada_stock"),
        ("quanto fica por mes o plano", "precos_planos"),
        ("preciso de falar com uma pessoa de verdade", "falar_humano"),
        ("como calculo o salario com inss", "folha_salarial"),
        ("da para tirar um mapa de iva", "saft_agt"),
    ]
    ok = 0
    for q, expect in probes:
        xq = vec.transform(q)
        zs = [b[c] + sum(W[c][j] * v for j, v in xq.items()) for c in range(k)]
        ps = softmax(zs)
        top = max(range(k), key=lambda c: ps[c])
        hit = classes[top] == expect
        ok += hit
        print(f"  sonda {'✓' if hit else '✗'} «{q}» → {classes[top]} ({ps[top]:.0%})")
    print(f"sondas de generalização: {ok}/{len(probes)}")

    # ── export ── (pesos esparsos: só |w| relevantes, p/ ficheiro pequeno)
    weights: list[dict[str, float]] = []
    for c in range(k):
        wc = {str(j): round(w, 5) for j, w in enumerate(W[c]) if abs(w) > 1e-3}
        weights.append(wc)
    model = {
        "version": 1,
        "classes": classes,
        "vocab": vec.vocab,
        "idf": [round(v, 5) for v in vec.idf],
        "bias": [round(v, 5) for v in b],
        "weights": weights,
        "stopwordsNote": "tokenizacao replicada em neural-bot.ts",
    }
    knowledge = {
        it["id"]: {
            "answer": it["answer"],
            "escalate": bool(it.get("escalate")),
            "image": GUIDES.get(it.get("image", "")) if it.get("image") else None,
        }
        for it in INTENTS
    }
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(os.path.join(OUT_DIR, "bot-model.json"), "w", encoding="utf-8") as f:
        json.dump(model, f, ensure_ascii=False, separators=(",", ":"))
    with open(os.path.join(OUT_DIR, "bot-knowledge.json"), "w", encoding="utf-8") as f:
        json.dump(knowledge, f, ensure_ascii=False, separators=(",", ":"))
    print(f"exportado → {OUT_DIR}\\bot-model.json + bot-knowledge.json")

    # sanity: tokenização de exemplo (tem de bater certo com o runtime TS)
    print("tokens('como criar conta'):", tokenize("como criar conta"))


if __name__ == "__main__":
    main()
