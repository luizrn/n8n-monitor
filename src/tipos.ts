export type Idioma = 'pt-BR' | 'en'
export type Tema = 'escuro' | 'claro'
export type ModoDestino = 'webhook' | 'evolution' | 'discord'

export type Instancia = {
  id: string
  nome: string
  baseUrl: string
  apiKey: string
  ativo: boolean
}

export type Notificacoes = {
  toastSeg: number
  navegador: boolean
  som: boolean
  volume: number
}

export type UptimeKuma = {
  ativo: boolean
  baseUrl: string
  token: string
  slug: string
  monitores: Record<string, boolean>
  avisarCertDias: number
}

export type Destino = {
  id: string
  nome: string
  ativo: boolean
  modo: ModoDestino
  url: string
  metodo: string
  bearer: string
  headerNome: string
  headerValor: string
  evolutionUrl: string
  evolutionInstancia: string
  evolutionApiKey: string
  evolutionNumero: string
  discordUrl: string
  discordNome: string
}

export type Config = {
  instancias: Instancia[]
  ativo: boolean
  idioma: Idioma
  tema: Tema
  fuso: string
  horasCron: number
  toleranciaMin: number
  limiteTravadaMin: number
  limitesTravada: Record<string, number>
  notificacoes: Notificacoes
  uptimeKuma: UptimeKuma
  webhook: { destinos: Destino[] }
}

export type Reconhecimento = {
  estado: string
  magnitude: number
  instanciaId?: string | null
  origem?: string | null
  em: string
}

export type Alerta = {
  chave: string
  origem?: string
  nivel?: string
  tipo?: string
  titulo?: string
  resumo?: string
  detalhe?: string
  mensagem?: string | null
  magnitude?: number
  instanciaId?: string
  instancia?: string
  workflowId?: string
  executionId?: string
  link?: string | null
  copiarGrupo?: number
  fluxo?: string
  no?: string
}
