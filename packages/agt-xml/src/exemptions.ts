/**
 * Códigos de isenção de IVA do SAF-T (AO) — TaxExemptionCode/TaxExemptionReason.
 * Fonte: lista SAF-T AO publicada (assoft-portugal/SAF-T-AO, Tax Exemption Codes).
 * A Facturação Electrónica rejeita (E18) linhas isentas sem um destes códigos.
 */
export interface TaxExemption { code: string; reason: string; hint: string }

export const TAX_EXEMPTIONS: readonly TaxExemption[] = [
  { code: 'M00', reason: 'IVA – Regime Simplificado', hint: 'Contribuinte no regime simplificado' },
  { code: 'M02', reason: 'Transmissão de bens e serviços não sujeita', hint: 'Operação não sujeita a IVA' },
  { code: 'M04', reason: 'IVA – Regime de Exclusão', hint: 'Contribuinte no regime de exclusão' },
  { code: 'M10', reason: 'Isento nos termos da alínea a) do nº1 do artigo 12.º do CIVA', hint: 'Bens alimentares (anexo I do CIVA)' },
  { code: 'M11', reason: 'Isento nos termos da alínea b) do nº1 do artigo 12.º do CIVA', hint: 'Medicamentos (fins terapêuticos e profiláticos)' },
  { code: 'M12', reason: 'Isento nos termos da alínea c) do nº1 do artigo 12.º do CIVA', hint: 'Cadeiras de rodas e equipamento para pessoas com deficiência' },
  { code: 'M13', reason: 'Isento nos termos da alínea d) do nº1 do artigo 12.º do CIVA', hint: 'Livros (incluindo digitais)' },
  { code: 'M14', reason: 'Isento nos termos da alínea e) do nº1 do artigo 12.º do CIVA', hint: 'Arrendamento para habitação' },
  { code: 'M15', reason: 'Isento nos termos da alínea f) do nº1 do artigo 12.º do CIVA', hint: 'Operações sujeitas a SISA' },
  { code: 'M16', reason: 'Isento nos termos da alínea g) do nº1 do artigo 12.º do CIVA', hint: 'Jogos de fortuna ou azar' },
  { code: 'M17', reason: 'Isento nos termos da alínea h) do nº1 do artigo 12.º do CIVA', hint: 'Transporte colectivo de passageiros' },
  { code: 'M18', reason: 'Isento nos termos da alínea i) do nº1 artigo 12.º do CIVA', hint: 'Intermediação financeira' },
  { code: 'M19', reason: 'Isento nos termos da alínea j) do nº1 do artigo 12.º do CIVA', hint: 'Seguros de saúde e do ramo vida' },
  { code: 'M20', reason: 'Isento nos termos da alínea k) do nº1 do artigo 12.º do CIVA', hint: 'Produtos petrolíferos (anexo II)' },
  { code: 'M21', reason: 'Isento nos termos da alínea l) do nº1 do artigo 12.º do CIVA', hint: 'Ensino' },
  { code: 'M22', reason: 'Isento nos termos da alínea m) do artigo 12.º do CIVA', hint: 'Serviços médicos e sanitários (hospitais, clínicas)' },
  { code: 'M23', reason: 'Isento nos termos da alínea n) do artigo 12.º do CIVA', hint: 'Transporte de doentes (ambulâncias)' },
  { code: 'M24', reason: 'Isento nos termos da alínea o) do artigo 12.º do CIVA', hint: 'Equipamentos médicos para estabelecimentos de saúde' },
  { code: 'M30', reason: 'Isento nos termos da alínea a) do artigo 15.º do CIVA', hint: 'Exportação de bens' },
  { code: 'M31', reason: 'Isento nos termos da alínea b) do artigo 15.º do CIVA', hint: 'Abastecimento de embarcações (alto mar)' },
  { code: 'M32', reason: 'Isento nos termos da alínea c) do artigo 15.º do CIVA', hint: 'Abastecimento de aeronaves (internacional)' },
  { code: 'M33', reason: 'Isento nos termos da alínea d) do artigo 15.º do CIVA', hint: 'Abastecimento de embarcações de salvamento/pesca' },
  { code: 'M34', reason: 'Isento nos termos da alínea e) do artigo 15.º do CIVA', hint: 'Embarcações e aeronaves (transmissão, reparação, aluguer)' },
  { code: 'M35', reason: 'Isento nos termos da alínea f) do artigo 15.º do CIVA', hint: 'Relações diplomáticas e consulares' },
  { code: 'M36', reason: 'Isento nos termos da alínea g) do artigo 15.º do CIVA', hint: 'Organismos internacionais' },
  { code: 'M37', reason: 'Isento nos termos da alínea h) do artigo 15.º do CIVA', hint: 'Tratados e acordos internacionais' },
  { code: 'M38', reason: 'Isento nos termos da alínea i) do artigo 15.º do CIVA', hint: 'Transporte internacional de pessoas' },
  { code: 'M80', reason: 'Isento nos termos da alinea a) do nº1 do artigo 14.º', hint: 'Importação de bens isentos' },
  { code: 'M81', reason: 'Isento nos termos da alinea b) do nº1 do artigo 14.º', hint: 'Importação de ouro/moeda pelo BNA' },
  { code: 'M82', reason: 'Isento nos termos da alinea c) do nº1 do artigo 14.º', hint: 'Importação para calamidades naturais' },
  { code: 'M83', reason: 'Isento nos termos da alinea d) do nº1 do artigo 14.º', hint: 'Importação para operações petrolíferas' },
  { code: 'M84', reason: 'Isento nos termos da alínea e) do nº1 do artigo 14.º', hint: 'Importação de moeda estrangeira (bancos)' },
  { code: 'M85', reason: 'Isento nos termos da alinea a) do nº2 do artigo 14.º', hint: 'Importação no âmbito de tratados internacionais' },
  { code: 'M86', reason: 'Isento nos termos da alinea b) do nº2 do artigo 14.º', hint: 'Importação em relações diplomáticas' },
  { code: 'M90', reason: 'Isento nos termos da alinea a) do nº1 do artigo 16.º', hint: 'Regimes aduaneiros (importação sob controlo)' },
  { code: 'M91', reason: 'Isento nos termos da alinea b) do nº1 do artigo 16.º', hint: 'Bens para zonas/depósitos francos' },
  { code: 'M92', reason: 'Isento nos termos da alinea c) do nº1 do artigo 16.º', hint: 'Bens em regimes aduaneiros suspensivos' },
  { code: 'M93', reason: 'Isento nos termos da alinea d) do nº1 do artigo 16.º', hint: 'Trânsito, draubaque ou importação temporária' },
  { code: 'M94', reason: 'Isento nos termos da alinea e) do nº1 do artigo 16.º', hint: 'Reimportação de bens exportados' },
];

const BY_CODE = new Map(TAX_EXEMPTIONS.map((e) => [e.code, e]));

export function findTaxExemption(code: string | null | undefined): TaxExemption | undefined {
  return code ? BY_CODE.get(code.trim().toUpperCase()) : undefined;
}
