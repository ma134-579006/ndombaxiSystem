"""
Gera o ÍCONE DE APLICAÇÃO do LPS Vendas (quadrado), fonte única dos ícones do
instalador/app Windows e da app Android.

PORQUÊ: o logótipo (`public/logo.png`) é LARGO (carrinho + "LPS" + "Vendas").
Encolhido para os 16–48 px de um ícone, ficava um borrão claro com muita margem
— o lojista via "um instalador sem ícone". Um ícone de app tem de ser quadrado,
cheio e legível em pequeno: monograma "LPS" branco sobre o azul da marca.

Saídas (em apps/web/public/):
  • app-icon.png            1024 px — quadrado arredondado + "LPS" + "VENDAS"
  • app-icon-small.png      1024 px — o mesmo sem "VENDAS" (para 16–32 px)
  • app-icon-foreground.png 1024 px — só as letras, fundo transparente, dentro
                            da zona segura (Android adaptativo, fundo azul à parte)

Uso:  python3 apps/web/scripts/gen-app-icon.py   (precisa de Pillow)
Os PNG gerados vão para o repositório — o CI só os redimensiona.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter, ImageFont

PUBLIC = Path(__file__).resolve().parent.parent / "public"
S = 1024

# Azul da marca (o do logótipo é #0926FB): gradiente de cima para baixo.
TOPO = (52, 92, 255)
BASE = (6, 22, 170)
FONTES = [
    "/usr/share/fonts/truetype/liberation/LiberationSans-BoldItalic.ttf",
    "/usr/share/fonts/truetype/dejavu/DejaVuSans-BoldOblique.ttf",
]


def fonte(px):
    for f in FONTES:
        if Path(f).exists():
            return ImageFont.truetype(f, px)
    raise SystemExit("Fonte bold-italic não encontrada (instale fonts-liberation).")


def fundo():
    """Quadrado arredondado com gradiente e um brilho suave no topo."""
    grad = Image.new("RGB", (S, S))
    px = grad.load()
    for y in range(S):
        t = y / (S - 1)
        c = tuple(round(TOPO[i] * (1 - t) + BASE[i] * t) for i in range(3))
        for x in range(S):
            px[x, y] = c
    mascara = Image.new("L", (S, S), 0)
    ImageDraw.Draw(mascara).rounded_rectangle((0, 0, S - 1, S - 1), radius=int(S * 0.22), fill=255)
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    img.paste(grad, (0, 0), mascara)
    # brilho: elipse branca muito transparente no terço de cima
    brilho = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    ImageDraw.Draw(brilho).ellipse((-S * 0.3, -S * 0.75, S * 1.3, S * 0.42), fill=(255, 255, 255, 30))
    brilho = brilho.filter(ImageFilter.GaussianBlur(S * 0.03))
    brilho.putalpha(Image.composite(brilho.getchannel("A"), Image.new("L", (S, S), 0), mascara))
    return Image.alpha_composite(img, brilho)


def letras(com_vendas, escala=1.0):
    """'LPS' (e 'VENDAS') brancos com sombra, centrados, num canvas transparente."""
    camada = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(camada)
    f_lps = fonte(int((430 if com_vendas else 520) * escala))
    caixa = d.textbbox((0, 0), "LPS", font=f_lps)
    w, h = caixa[2] - caixa[0], caixa[3] - caixa[1]
    f_v = fonte(int(150 * escala))
    cv = d.textbbox((0, 0), "VENDAS", font=f_v)
    wv, hv = cv[2] - cv[0], cv[3] - cv[1]
    gap = int(40 * escala)
    total = h + (gap + hv if com_vendas else 0)
    y0 = (S - total) // 2
    d.text(((S - w) // 2 - caixa[0], y0 - caixa[1]), "LPS", font=f_lps, fill="white")
    if com_vendas:
        d.text(((S - wv) // 2 - cv[0], y0 + h + gap - cv[1]), "VENDAS", font=f_v, fill=(225, 233, 255, 255))
    sombra = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    sombra.putalpha(camada.getchannel("A").point(lambda a: a * 0.45))
    sombra = sombra.filter(ImageFilter.GaussianBlur(S * 0.012))
    base = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    base.alpha_composite(sombra, (int(S * 0.008), int(S * 0.018)))
    return Image.alpha_composite(base, camada)


def main():
    bg = fundo()
    Image.alpha_composite(bg, letras(True)).save(PUBLIC / "app-icon.png", optimize=True)
    Image.alpha_composite(bg, letras(False)).save(PUBLIC / "app-icon-small.png", optimize=True)
    # Android adaptativo: o sistema recorta 108dp → visível ~72dp (66%). Letras a ~62%.
    letras(True, escala=0.62).save(PUBLIC / "app-icon-foreground.png", optimize=True)
    print("Ícones gerados em", PUBLIC)


if __name__ == "__main__":
    main()
