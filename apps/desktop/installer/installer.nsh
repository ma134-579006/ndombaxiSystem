; Fecha o LPS Vendas antes de instalar/desinstalar — substitui a verificação padrão
; do electron-builder, que falhava com "Não é possível fechar o LPS Vendas":
;  • o nome do executável tem um espaço ("LPS Vendas.exe");
;  • a API local corre como um 2.º "LPS Vendas.exe" (ELECTRON_RUN_AS_NODE) e o
;    PostgreSQL portátil (postgres.exe) fica a correr se a app fechou mal —
;    processos órfãos que prendiam os ficheiros da instalação.
; Fecha-os à força (só os do LPS Vendas: o postgres apenas se vier da pasta da app).
!macro customCheckAppRunning
  DetailPrint "A fechar o LPS Vendas e o servidor local…"
  nsExec::Exec `"$SYSDIR\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -NonInteractive -ExecutionPolicy Bypass -Command "Get-Process -Name 'LPS Vendas' -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue; Get-Process -Name 'postgres','pg_ctl' -ErrorAction SilentlyContinue | Where-Object { $$_.Path -like '*\LPS Vendas\*' } | Stop-Process -Force -ErrorAction SilentlyContinue"`
  Pop $0
  ; Plano B sem PowerShell (instalações mínimas): taskkill com o nome entre aspas.
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /T /IM "LPS Vendas.exe"`
  Pop $0
  ; 2.ª passagem: o vigilante do servidor local pode ter relançado a API entretanto.
  Sleep 800
  nsExec::Exec `"$SYSDIR\taskkill.exe" /F /T /IM "LPS Vendas.exe"`
  Pop $0
  ; Dá tempo ao Windows para libertar os ficheiros antes de os substituir.
  Sleep 1500
!macroend
