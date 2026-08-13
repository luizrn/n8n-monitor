import { betterAuth } from 'better-auth'
import { admin, organization } from 'better-auth/plugins'
import { db } from './db.js'

const secret = process.env.BETTER_AUTH_SECRET
  || process.env.AUTH_SECRET
  || (process.env.NODE_ENV === 'production' ? '' : 'n8n-monitor-dev-secret-min-32-chars')

if (process.env.NODE_ENV === 'production' && secret.length < 32) {
  throw new Error('BETTER_AUTH_SECRET deve ter pelo menos 32 caracteres em produção')
}

const origens = [
  process.env.BETTER_AUTH_URL,
  'http://127.0.0.1:8787',
  'http://localhost:8787',
].filter((x): x is string => Boolean(x))

export const auth = betterAuth({
  secret,
  baseURL: process.env.BETTER_AUTH_URL || undefined,
  database: db,
  trustedOrigins: origens,
  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    disableSignUp: true,
    minPasswordLength: 6,
  },
  user: {
    additionalFields: {
      mustChangePassword: {
        type: 'boolean',
        required: false,
        defaultValue: false,
        input: false,
      },
    },
  },
  session: {
    expiresIn: 60 * 60 * 24 * 14,
    updateAge: 60 * 60 * 24,
  },
  advanced: {
    database: {
      generateId: 'uuid',
    },
  },
  databaseHooks: {
    session: {
      create: {
        before: async (session) => {
          try {
            const membro = db.prepare(
              'SELECT organizationId FROM member WHERE userId = ? ORDER BY createdAt ASC LIMIT 1'
            ).get(session.userId) as { organizationId: string } | undefined
            if (!membro?.organizationId) return { data: session }
            return { data: { ...session, activeOrganizationId: membro.organizationId } }
          } catch {
            return { data: session }
          }
        },
      },
    },
  },
  plugins: [
    admin({
      defaultRole: 'user',
      adminRoles: ['admin'],
    }),
    organization({
      allowUserToCreateOrganization: true,
      organizationLimit: 50,
      membershipLimit: 200,
    }),
  ],
})

export type SessaoAuth = typeof auth.$Infer.Session

export async function migrarAuth() {
  const { getMigrations } = await import('better-auth/db/migration')
  const { runMigrations } = await getMigrations(auth.options)
  await runMigrations()
}
