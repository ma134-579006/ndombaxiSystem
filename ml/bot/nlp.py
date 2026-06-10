# -*- coding: utf-8 -*-
"""
NLP de RAIZ (sem bibliotecas de ML) para o bot de suporte do Ndombaxi System.

Pipeline clássico e transparente:
  texto → normalização (minúsculas, sem acentos) → tokens → n-gramas (1+2)
        → vector TF-IDF → classificador (treinado em train.py)

Tudo em Python puro — o modelo exportado (JSON) é executado pela API Node.
"""
from __future__ import annotations

import math
import re
import unicodedata
from collections import Counter

# Palavras vazias do português (curta e prática — não agressiva).
STOPWORDS = {
    "a", "o", "as", "os", "um", "uma", "uns", "umas", "de", "do", "da", "dos", "das",
    "em", "no", "na", "nos", "nas", "por", "para", "pra", "com", "sem", "sobre",
    "e", "ou", "mas", "que", "se", "ja", "tambem", "muito", "mais", "menos",
    "eu", "tu", "ele", "ela", "nos", "voces", "eles", "elas", "voce", "vc",
    "meu", "minha", "teu", "tua", "seu", "sua", "este", "esta", "isto", "esse",
    "essa", "isso", "aquele", "aquela", "aquilo", "ao", "aos", "à", "às", "é",
    "ser", "estar", "ter", "haver", "foi", "sao", "está", "esta", "como",
}


def strip_accents(s: str) -> str:
    return "".join(c for c in unicodedata.normalize("NFD", s) if unicodedata.category(c) != "Mn")


def normalize(s: str) -> str:
    s = strip_accents(s.lower())
    s = re.sub(r"[^a-z0-9\s]", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def tokenize(s: str) -> list[str]:
    toks = [t for t in normalize(s).split() if len(t) > 1 and t not in STOPWORDS]
    # n-gramas: unigramas + bigramas (capturam "criar conta", "folha salarial"…)
    bigrams = [f"{a}_{b}" for a, b in zip(toks, toks[1:])]
    return toks + bigrams


class TfidfVectorizer:
    """TF-IDF implementado à mão (idf suavizado, norma L2)."""

    def __init__(self) -> None:
        self.vocab: dict[str, int] = {}
        self.idf: list[float] = []

    def fit(self, docs: list[str]) -> None:
        df: Counter[str] = Counter()
        tokenized = [set(tokenize(d)) for d in docs]
        for toks in tokenized:
            df.update(toks)
        # vocabulário: termos que aparecem em ≥1 documento (corpus é curado)
        self.vocab = {t: i for i, t in enumerate(sorted(df))}
        n = len(docs)
        self.idf = [0.0] * len(self.vocab)
        for t, i in self.vocab.items():
            self.idf[i] = math.log((1 + n) / (1 + df[t])) + 1.0

    def transform(self, doc: str) -> dict[int, float]:
        counts = Counter(tokenize(doc))
        if not counts:
            return {}
        vec: dict[int, float] = {}
        for t, c in counts.items():
            i = self.vocab.get(t)
            if i is not None:
                vec[i] = (1 + math.log(c)) * self.idf[i]
        norm = math.sqrt(sum(v * v for v in vec.values()))
        if norm > 0:
            for i in vec:
                vec[i] /= norm
        return vec


def softmax(zs: list[float]) -> list[float]:
    m = max(zs)
    exps = [math.exp(z - m) for z in zs]
    s = sum(exps)
    return [e / s for e in exps]
