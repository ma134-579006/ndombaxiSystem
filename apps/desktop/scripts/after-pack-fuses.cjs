/**
 * Fuses do Electron aplicadas DEPOIS de empacotar (hook `afterPack`).
 *
 * O electron-builder 25 não conhece a opção `electronFuses` (só existe a partir
 * do 26): com ela no YAML o instalador Windows deixava de se gerar. Aplicamos as
 * MESMAS fuses com o pacote oficial `@electron/fuses`, diretamente no executável.
 * Decisão de segurança mantida (ver electron-builder.yml):
 *   • NODE_OPTIONS e --inspect desligados (injeção de código por processos locais);
 *   • runAsNode ligado — o servidor local arranca a API com ELECTRON_RUN_AS_NODE=1.
 */
const path = require('node:path');
const { flipFuses, FuseVersion, FuseV1Options } = require('@electron/fuses');

exports.default = async function afterPack(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  const exe = electronPlatformName === 'darwin'
    ? path.join(appOutDir, `${packager.appInfo.productFilename}.app`)
    : path.join(appOutDir, electronPlatformName === 'win32'
      ? `${packager.appInfo.productFilename}.exe`
      : packager.executableName);
  await flipFuses(exe, {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: electronPlatformName === 'darwin',
    [FuseV1Options.RunAsNode]: true,
    [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
    [FuseV1Options.EnableNodeCliInspectArguments]: false,
  });
  console.log(`  • fuses aplicadas: ${path.basename(exe)} (NODE_OPTIONS/--inspect desligados)`);
};
