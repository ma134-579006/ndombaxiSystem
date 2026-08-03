/**
 * Atualização obrigatória — o motor partilhado.
 *
 * A MESMA decisão nas quatro aplicações (Gestor, Caixa, Android e o processo
 * principal do Electron). Se cada uma decidisse à sua maneira, mais cedo ou mais
 * tarde uma delas trancaria alguém que as outras deixavam trabalhar.
 */
export {
  compareVersions,
  decideUpdate,
  isSafeDownloadPage,
  isUsableVersion,
  parseRelease,
  type DecideOptions,
  type OfficialRelease,
  type UpdateDecision,
  type UpdateState,
} from './decide';

export {
  readyToBlock,
  type BlockReadiness,
  type PendingWork,
} from './gate';
