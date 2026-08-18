/* Backup consistente do SQLite.

   `tar` do diretório de dados com o processo rodando não serve: em modo WAL o
   arquivo principal, o `-wal` e o `-shm` são copiados em instantes diferentes e o
   resultado pode sair rasgado — o que só se descobre na hora de restaurar.

   `VACUUM INTO` grava um banco novo, íntegro e já compactado, sem parar o painel.

   Vive em src/ (e nao em scripts/) porque precisa existir compilado na imagem de
   producao, que nao carrega tsx. A resolucao do diretorio de dados espelha db.ts de
   proposito: importar db.ts abriria a conexao e rodaria as migracoes, o que um backup
   somente leitura nao deve fazer.

   Uso: npm run backup -- [destino.sqlite]
        node dist/backup.js /data/copia.sqlite   (dentro do container) */
import { DatabaseSync } from 'node:sqlite'
import { existsSync, mkdirSync, statSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const dirDados = process.env.N8N_MONITOR_DATA_DIR
  ? resolve(process.env.N8N_MONITOR_DATA_DIR)
  : join(process.env.LOCALAPPDATA || process.env.HOME || RAIZ, 'n8n-monitor')

const origem = join(dirDados, 'n8n-monitor.sqlite')
if (!existsSync(origem)) {
  console.error(`banco não encontrado em ${origem}`)
  console.error('defina N8N_MONITOR_DATA_DIR se os dados estiverem em outro lugar')
  process.exit(1)
}

const carimbo = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
const pedido = process.argv[2] || join(dirDados, `n8n-monitor-backup-${carimbo}.sqlite`)
const destino = isAbsolute(pedido) ? pedido : resolve(process.cwd(), pedido)

if (existsSync(destino)) {
  console.error(`destino já existe: ${destino}`)
  process.exit(1)
}
mkdirSync(dirname(destino), { recursive: true })

// Abre somente leitura: o backup nunca deve poder alterar o banco em uso.
const db = new DatabaseSync(origem, { readOnly: true })
try {
  // O caminho vai como literal SQL; escapa aspas simples do jeito do SQLite.
  db.exec(`VACUUM INTO '${destino.replace(/'/g, "''")}'`)
} finally {
  db.close()
}

const bytes = statSync(destino).size
console.log(`backup gravado: ${destino}`)
console.log(`${(bytes / 1048576).toFixed(2)} MB`)
console.log('contém segredos: armazene criptografado e com acesso restrito')
