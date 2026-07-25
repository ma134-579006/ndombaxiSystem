/**
 * Menu da aplicação. Curto por decisão: um lojista não devia ter de aprender um
 * menu para vender. O que está aqui é o mínimo que se espera de uma aplicação
 * Windows a sério — trocar de módulo, fazer uma cópia de segurança, saber a
 * versão instalada.
 */
import { app, BrowserWindow, Menu, dialog, shell } from 'electron';
import path from 'node:path';
import { backupTo } from './database';
import { checkForUpdates, openDownloadPage } from './updater';
import type { ModuleId } from './settings';

export function buildMenu(opts: {
  onOpenModule: (id: ModuleId) => void;
  getWindow: () => BrowserWindow | null;
}): void {
  const menu = Menu.buildFromTemplate([
    {
      label: 'Ndombaxi',
      submenu: [
        { label: 'Painel de Gestão', accelerator: 'Ctrl+1', click: () => opts.onOpenModule('gestao') },
        { label: 'Caixa (POS)', accelerator: 'Ctrl+2', click: () => opts.onOpenModule('caixa') },
        { type: 'separator' },
        {
          label: 'Cópia de segurança agora…',
          click: async () => {
            const win = opts.getWindow();
            const dir = path.join(app.getPath('documents'), 'Ndombaxi', 'Backups');
            const stamp = new Date().toISOString().replace(/[:.]/g, '-');
            const dest = path.join(dir, `ndombaxi-${stamp}.db`);
            try {
              await backupTo(dest);
              const r = await dialog.showMessageBox(win ?? undefined!, {
                type: 'info',
                title: 'Cópia de segurança concluída',
                message: 'Os dados deste posto foram copiados.',
                detail: dest,
                buttons: ['Abrir pasta', 'Fechar'],
                defaultId: 0,
              });
              if (r.response === 0) shell.showItemInFolder(dest);
            } catch (e) {
              dialog.showErrorBox('Cópia de segurança falhou', (e as Error).message);
            }
          },
        },
        { type: 'separator' },
        { role: 'quit', label: 'Sair' },
      ],
    },
    {
      label: 'Editar',
      submenu: [
        { role: 'undo', label: 'Anular' },
        { role: 'redo', label: 'Refazer' },
        { type: 'separator' },
        { role: 'cut', label: 'Cortar' },
        { role: 'copy', label: 'Copiar' },
        { role: 'paste', label: 'Colar' },
        { role: 'selectAll', label: 'Selecionar tudo' },
      ],
    },
    {
      label: 'Ver',
      submenu: [
        { role: 'reload', label: 'Recarregar' },
        { role: 'resetZoom', label: 'Tamanho normal' },
        { role: 'zoomIn', label: 'Aumentar' },
        { role: 'zoomOut', label: 'Diminuir' },
        { type: 'separator' },
        { role: 'togglefullscreen', label: 'Ecrã inteiro' },
      ],
    },
    {
      label: 'Ajuda',
      submenu: [
        {
          label: 'Procurar atualizações…',
          click: async () => {
            const verdict = await checkForUpdates();
            const win = opts.getWindow();
            if (!verdict.available || !verdict.info) {
              await dialog.showMessageBox(win ?? undefined!, {
                type: 'info',
                title: 'Ndombaxi System',
                message: 'Está a usar a versão mais recente.',
                detail: `Versão instalada: ${verdict.current}`,
              });
              return;
            }
            const r = await dialog.showMessageBox(win ?? undefined!, {
              type: 'info',
              title: 'Nova versão disponível',
              message: `Ndombaxi System ${verdict.info.version}`,
              detail: [
                ...(verdict.info.notes ?? []).map((n) => `• ${n}`),
                ...(verdict.info.fixes ?? []).map((f) => `• Correção: ${f}`),
              ].join('\n') || 'Melhorias de desempenho e correções.',
              buttons: ['Atualizar', 'Depois'],
              defaultId: 0,
              cancelId: 1,
            });
            if (r.response === 0) await openDownloadPage(verdict.info);
          },
        },
        {
          label: 'Sobre o Ndombaxi System',
          click: () => {
            const win = opts.getWindow();
            void dialog.showMessageBox(win ?? undefined!, {
              type: 'info',
              title: 'Ndombaxi System',
              message: `Ndombaxi System ${app.getVersion()}`,
              detail: [
                'ERP Offline-First para Angola.',
                '',
                `Dados deste posto: ${app.getPath('userData')}`,
                `Electron ${process.versions.electron} · Chromium ${process.versions.chrome}`,
              ].join('\n'),
            });
          },
        },
      ],
    },
  ]);
  Menu.setApplicationMenu(menu);
}
