"""
Gera o ÍCONE DE APLICAÇÃO do LPS Vendas a partir do LOGÓTIPO OFICIAL
(`public/logo.png` — o mesmo do site, do favicon e da landing), fonte única dos
ícones do instalador/app Windows e da app Android.

O logótipo é LARGO (carrinho + "LPS" + "Vendas") e tem muita margem transparente
no ficheiro original. Encolhido tal e qual para 16–48 px ficava um borrão. Aqui:
  1. recorta-se à caixa real do desenho (sem a margem);
  2. escala-se para ocupar o máximo possível de um quadrado branco, que é o que
     um ícone de aplicação precisa.
É SEMPRE o mesmo logótipo — não se inventa outro desenho.

Saídas (em apps/web/public/):
  • app-icon.png            1024 px — logótipo num quadrado branco arredondado
  • app-icon-small.png      1024 px — igual, com menos margem (para 16–32 px)
  • app-icon-round.png      1024 px — logótipo num círculo branco (Android redondo)
  • app-icon-foreground.png 1024 px — só o logótipo, fundo transparente, dentro
                            da zona segura do ícone adaptativo (Android 8+;
                            o fundo branco vem de ic_launcher_background)

Uso:  python3 apps/web/scripts/gen-app-icon.py   (precisa de Pillow)
Os PNG gerados vão para o repositório — o CI só os redimensiona.
"""
from pathlib import Path

from PIL import Image, ImageDraw, ImageFilter

PUBLIC = Path(__file__).resolve().parent.parent / "public"
S = 1024
BORDA = (203, 213, 238, 255)  # contorno azul-claro: o ícone branco não "some" numa barra branca


def logotipo():
    """O logótipo oficial recortado à caixa real do desenho."""
    im = Image.open(PUBLIC / "logo.png").convert("RGBA")
    return im.crop(im.getchannel("A").getbbox())


def colocar(base, logo, largura_rel, dy=0):
    """Cola o logótipo centrado, com `largura_rel` da largura da tela, e uma sombra suave."""
    w = int(S * largura_rel)
    h = round(logo.height * w / logo.width)
    img = logo.resize((w, h), Image.LANCZOS)
    x, y = (S - w) // 2, (S - h) // 2 + dy
    sombra = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    mascara = Image.new("RGBA", img.size, (20, 40, 120, 0))
    mascara.putalpha(img.getchannel("A").point(lambda a: int(a * 0.22)))
    sombra.alpha_composite(mascara, (x, y + int(S * 0.012)))
    sombra = sombra.filter(ImageFilter.GaussianBlur(S * 0.008))
    base.alpha_composite(sombra)
    base.alpha_composite(img, (x, y))
    return base


def quadrado(raio_rel):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(S * raio_rel)
    d.rounded_rectangle((0, 0, S - 1, S - 1), radius=r, fill=BORDA)
    d.rounded_rectangle((10, 10, S - 11, S - 11), radius=max(r - 10, 0), fill=(255, 255, 255, 255))
    return img


def circulo():
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.ellipse((0, 0, S - 1, S - 1), fill=BORDA)
    d.ellipse((10, 10, S - 11, S - 11), fill=(255, 255, 255, 255))
    return img


def main():
    logo = logotipo()
    colocar(quadrado(0.22), logo, 0.88).save(PUBLIC / "app-icon.png", optimize=True)
    colocar(quadrado(0.16), logo, 0.94).save(PUBLIC / "app-icon-small.png", optimize=True)
    # Círculo: a largura do logótipo tem de caber na corda do círculo à altura das pontas.
    colocar(circulo(), logo, 0.76).save(PUBLIC / "app-icon-round.png", optimize=True)
    # Adaptativo: o sistema mostra ~66% centrais (círculo de 72 dp em 108 dp). O logótipo
    # é largo — a diagonal tem de caber nesse círculo: largura <= 0.577 da tela.
    colocar(Image.new("RGBA", (S, S), (0, 0, 0, 0)), logo, 0.56).save(PUBLIC / "app-icon-foreground.png", optimize=True)
    print("Ícones gerados em", PUBLIC)


if __name__ == "__main__":
    main()
