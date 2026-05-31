import { AssistantService } from './assistant.service';

// Testa apenas a lógica pura de extração de blocos — sem dependências reais.
const svc = new AssistantService({} as never, {} as never);

describe('AssistantService.extractBlocks', () => {
  it('extrai um gráfico de um bloco ```chart', () => {
    const text = [
      'Aqui estão as vendas 📊',
      '```chart',
      JSON.stringify({ type: 'bar', title: 'Vendas', labels: ['Jan', 'Fev'], series: [{ name: 'AOA', data: [10, 20] }] }),
      '```',
    ].join('\n');
    const { charts, imagePrompts } = svc.extractBlocks(text);
    expect(charts).toHaveLength(1);
    expect(charts[0].type).toBe('bar');
    expect(charts[0].series?.[0].data).toEqual([10, 20]);
    expect(imagePrompts).toHaveLength(0);
  });

  it('extrai pedidos de imagem de blocos ```image', () => {
    const text = '```image\n{"prompt":"logótipo moderno azul"}\n```';
    const { imagePrompts } = svc.extractBlocks(text);
    expect(imagePrompts).toEqual(['logótipo moderno azul']);
  });

  it('ignora blocos malformados sem rebentar', () => {
    const text = '```chart\n{ inválido json }\n```';
    const { charts } = svc.extractBlocks(text);
    expect(charts).toHaveLength(0);
  });

  it('lida com texto sem blocos', () => {
    const { charts, imagePrompts } = svc.extractBlocks('Olá, tudo bem? 🙂');
    expect(charts).toHaveLength(0);
    expect(imagePrompts).toHaveLength(0);
  });
});
