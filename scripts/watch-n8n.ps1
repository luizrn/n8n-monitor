# Monitor de execucoes do n8n: emite uma linha por erro NOVO e por execucao
# travada. A chave e lida do registro do usuario e nunca e impressa.
$ErrorActionPreference = 'Continue'
$base = if ($env:N8N_BASE_URL) { $env:N8N_BASE_URL }
        else { [Environment]::GetEnvironmentVariable('N8N_BASE_URL','User') }
if (-not $base) { $base = 'http://localhost:5678' }
$key  = [Environment]::GetEnvironmentVariable('N8N_API_KEY', 'User')

if ([string]::IsNullOrEmpty($key)) { Write-Output 'FATAL: N8N_API_KEY ausente no registro'; exit 1 }

$headers = @{ 'X-N8N-API-KEY' = $key; 'accept' = 'application/json' }

function Chamar($caminho) {
  try   { return Invoke-RestMethod -Uri "$base$caminho" -Headers $headers -TimeoutSec 25 -ErrorAction Stop }
  catch { return $null }
}

# id -> nome, para a notificacao dizer o nome do fluxo e nao so o id
$nomes = @{}
function AtualizarNomes {
  $r = Chamar '/api/v1/workflows?limit=250'
  if ($null -eq $r) { return }
  foreach ($w in $r.data) { $nomes[$w.id] = $w.name }
}
AtualizarNomes
$nomesAtualizadoEm = Get-Date

function NomeDe($id) {
  if ($nomes.ContainsKey($id)) { return $nomes[$id] }
  AtualizarNomes
  if ($nomes.ContainsKey($id)) { return $nomes[$id] }
  return "(fluxo $id)"
}

$errosVistos    = @{}
$travadasVistas = @{}
$falhasSeguidas = 0
$LIMITE_TRAVADA_MIN = 30

while ($true) {

  # ---- erros novos ----
  $r = Chamar '/api/v1/executions?status=error&limit=30'
  if ($null -eq $r) {
    $falhasSeguidas++
    if ($falhasSeguidas -eq 3) { Write-Output 'ALERTA: 3 falhas seguidas ao consultar a API do n8n' }
  } else {
    if ($falhasSeguidas -ge 3) { Write-Output 'OK: API do n8n respondendo de novo' }
    $falhasSeguidas = 0
    foreach ($e in $r.data) {
      if ($errosVistos.ContainsKey($e.id)) { continue }
      $errosVistos[$e.id] = $true
      Write-Output ("ERRO {0} | {1} | {2} | {3}/workflow/{4}/executions/{0}" -f $e.id, (NomeDe $e.workflowId), $e.startedAt, $base, $e.workflowId)
    }
  }

  # ---- execucoes travadas ----
  $r2 = Chamar '/api/v1/executions?status=running&limit=30'
  if ($null -ne $r2) {
    $agora = (Get-Date).ToUniversalTime()
    foreach ($e in $r2.data) {
      if ($travadasVistas.ContainsKey($e.id)) { continue }
      if ([string]::IsNullOrEmpty($e.startedAt)) { continue }
      $min = ($agora - ([datetime]$e.startedAt).ToUniversalTime()).TotalMinutes
      if ($min -lt $LIMITE_TRAVADA_MIN) { continue }
      $travadasVistas[$e.id] = $true
      Write-Output ("TRAVADA {0} | {1} | rodando ha {2:N0} min | {3}/workflow/{4}/executions/{0}" -f $e.id, (NomeDe $e.workflowId), $min, $base, $e.workflowId)
    }
  }

  if (((Get-Date) - $nomesAtualizadoEm).TotalMinutes -gt 30) { AtualizarNomes; $nomesAtualizadoEm = Get-Date }

  Start-Sleep -Seconds 60
}
