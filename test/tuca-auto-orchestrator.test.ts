// Tucano Auto with the Tuca as the one who talks to the person (src/core/tuca.ts autoOrchestratorSection):
// in his DM he hands the work to the team, and when it comes back he delivers it in the same
// conversation, not in a thread, where he reads it on the next request. Out of the mode, as always.
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { beforeEach, describe, expect, it } from 'vitest'
import type { CoreEvent } from '../src/shared/rpc'
import type { Agent, EngineId, Message, Settings } from '../src/shared/types'
import { Db } from '../src/core/db'
import { fakeEngine } from '../src/core/engines/fake'
import type { Engine, Turn } from '../src/core/engines/types'
import { Gateway } from '../src/core/gateway'
import { Runner } from '../src/core/runs'
import { exportTeam, importTeam } from '../src/core/team'
import { People } from '../src/core/people'

const ready = { installed: true, loggedIn: true }
const agent = (id: string, extra: Partial<Agent> = {}): Agent => ({ id, name: id[0]!.toUpperCase() + id.slice(1), handle: id, role: '', color: 'sky', instructions: '', modelId: 'sonnet', effort: 'low', limit: 1_000_000, used: 0, grants: {}, memory: 'auto', computer: false, archived: false, ...extra })

function counted(engine: Engine): Engine & { turns: Turn[] } {
  const turns: Turn[] = []
  return { id: engine.id, turns, run: (t) => (turns.push(t), engine.run(t)) }
}

let db: Db
let events: CoreEvent[]
let settings: Settings
let gateway: Gateway
let claude: ReturnType<typeof counted>
let codex: ReturnType<typeof counted>

function runner(): Runner {
  // "quebre de vez": Clara's reply fails on something that doesn't pass by itself (no waiting to try again).
  const fake = fakeEngine('claude', { delayMs: 1 })
  claude = counted({ id: 'claude', run: (t) => t.system.includes('Você é Tuca') && /responda o Fulano/.test(t.prompt) && !/Voltou do que/.test(t.prompt) ? (async function* () { const { callTool } = await import('../src/core/engines/fake'); await callTool(t.mcpUrl!, 'pedir', { para: 'clara', pedido: 'responda o Fulano' }); yield { type: 'done' as const, text: '', usage: { inputTokens: 1, cacheReadTokens: 0, outputTokens: 1 } } })() : (t.system.includes('Você é Clara') && /quebre de vez/.test(t.prompt) ? (async function* () { yield { type: 'error' as const, message: 'quebrou' } })() : fake.run(t)) })
  codex = counted(fakeEngine('codex', { delayMs: 1 }))
  const engines: Record<EngineId, Engine> = { claude, codex, opencode: fakeEngine('opencode'), pi: fakeEngine('pi'), antigravity: fakeEngine('antigravity'), cursor: fakeEngine('cursor'), grok: fakeEngine('grok'), cline: fakeEngine('cline'), hermes: fakeEngine('hermes'), endpoint: fakeEngine('endpoint') }
  return new Runner({ db, engines, settings: async () => settings, emit: (e) => events.push(e), workDir: mkdtempSync(join(tmpdir(), 'ad-work-')), gateway })
}

// What I wrote in a conversation, and the thread under it where whoever I asked closes the subject.
const mine = (conversationId: string): Message[] => db.messages().filter((m) => m.conversationId === conversationId && m.author.kind === 'person')
const under = (root: Message): Message[] => db.messages().filter((m) => m.threadId === root.id)
// The DM of an agent with me, where what it's asked lands when it isn't in the conversation that asked.
const dmOf = (id: string): string => db.conversations().find((c) => c.kind === 'dm' && c.name === id)?.id ?? 'none'
const by = (id: string, conversationId?: string): Message[] => db.messages().filter((m) => m.author.kind === 'agent' && m.author.id === id && (!conversationId || m.conversationId === conversationId))
const until = async (ok: () => boolean, ms = 5000): Promise<void> => {
  for (const end = Date.now() + ms; !ok(); ) {
    if (Date.now() > end) throw new Error('never happened')
    await new Promise((r) => setTimeout(r, 10))
  }
}

// orion (on Codex) ← clara, bento; bento ← nico. Orion is in no channel: I talk to it in its DM.
beforeEach(async () => {
  db = new Db(join(mkdtempSync(join(tmpdir(), 'ad-db-')), 'test.db'))
  events = []
  settings = { workspaceName: 'Edu', context: '', engines: { claude: ready, codex: ready, opencode: ready, pi: ready, antigravity: ready, cursor: ready, grok: ready, cline: ready, hermes: ready, endpoint: ready }, routerModel: 'haiku', memoryModel: 'haiku', memory: 'auto', chainDepth: 3 } as unknown as Settings
  db.saveAgent(agent('orion', { modelId: 'gpt-5.6-luna' }))
  db.saveAgent(agent('clara', { reportsTo: 'orion' }))
  db.saveAgent(agent('bento', { reportsTo: 'orion' }))
  db.saveAgent(agent('nico', { reportsTo: 'bento' }))
  db.saveAgent(agent('solo'))
  db.saveAgent(agent('tuca', { kind: 'tuca', name: 'Tuca', instructions: 'Você é Tuca, quem ajuda com o Tucano.' }))
  db.createConversation({ id: 'tdm', kind: 'dm', name: 'tuca', members: ['tuca'] })
  db.createConversation({ id: 'dm', kind: 'dm', name: 'orion', members: ['orion'] })
  db.createConversation({ id: 'clientes', kind: 'channel', name: 'clientes', topic: 'Suporte e e-mails', members: ['clara'] })
  db.createConversation({ id: 'vendas', kind: 'channel', name: 'vendas', members: ['clara'] })
  db.createConversation({ id: 'eng', kind: 'channel', name: 'engenharia', members: ['bento', 'nico'] })
  gateway = new Gateway()
  await gateway.start()
  return () => gateway.stop()
})


const tucaTurns = (): { system: string; prompt: string }[] => claude.turns.filter((t) => t.system.includes('Você é Tuca'))

describe('the Tuca in Tucano Auto', () => {
  it('is told he is the only one who talks to the person, hands the work on and delivers it in the conversation itself', async () => {
    db.setSettings({ auto: true })
    const r = runner()
    await r.send('tdm', 'responda o Fulano')
    await r.idle()
    const [first, back] = tucaTurns()
    expect(first!.system + first!.prompt).toContain('Tucano Auto: você é o único que fala com Edu')
    // Clara did it in her DM, and it came back to him with the wording that delivers the work itself.
    const d = db.delegationsFrom('tuca', 'tdm', undefined)[0]!
    expect(d).toMatchObject({ to: 'clara', state: 'done', told: true, originConversationId: 'tdm' })
    expect(d.originThreadId).toBeUndefined()
    expect(back!.prompt).toContain('Entregue a Edu o trabalho pronto e completo, na sua voz')
    expect(back!.prompt).not.toContain('Não copie as respostas inteiras')
    // Everything of his stays in the conversation, out of threads.
    const his = db.messages().filter((m) => m.conversationId === 'tdm' && m.author.kind === 'agent')
    expect(his.length).toBe(2)
    expect(his.every((m) => !m.threadId)).toBe(true)
  })

  it('stays the Tuca he always was with the mode off', async () => {
    const r = runner()
    await r.send('tdm', 'responda o Fulano')
    await r.idle()
    const [first, back] = tucaTurns()
    expect(first!.system + first!.prompt).not.toContain('Tucano Auto')
    expect(back!.prompt).toContain('Não copie as respostas inteiras')
    const his = db.messages().filter((m) => m.conversationId === 'tdm' && m.author.kind === 'agent')
    expect(his.every((m) => !!m.threadId)).toBe(true)
  })
})
