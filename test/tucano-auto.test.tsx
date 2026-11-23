// Tucano Auto: the app as one conversation with the toucan, the team behind it (components/Auto.tsx).
// The person sees what they asked and what came back; who the router called, and why, waits in the
// backstage. The mode is each person's own, and always has its way back to the full app.
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent, Approval, Conversation, Message, Settings } from '../src/shared/types'
import type { State } from '../src/renderer/src/store'

let fake: State
vi.mock('../src/renderer/src/store', async (original) => {
  const real = await original<typeof import('../src/renderer/src/store')>()
  return { ...real, useStore: <T,>(select: (s: State) => T): T => select(fake), useLiveText: (m: Message) => m.text }
})
const { getState } = await import('../src/renderer/src/store')
const { AutoMode, AUTO_CHANNEL } = await import('../src/renderer/src/components/Auto')
const { settingsPatchError } = await import('../src/core/settings-patch')
const { People } = await import('../src/core/people')
const { PERSONAL_SETTINGS } = await import('../src/core/policy-people')

const bia = { id: 'bia', name: 'Bia', handle: 'bia', role: 'Pesquisa', color: 'sky' } as Agent
const channel: Conversation = { id: 'c1', kind: 'channel', name: AUTO_CHANNEL, members: ['bia'] }
const ask: Message = { id: 'm1', conversationId: 'c1', author: { kind: 'person', id: 'me' }, text: 'Um cardápio para receber amigos', at: 1 }
const note: Message = { id: 'm2', conversationId: 'c1', author: { kind: 'system' }, text: 'Chamei **Bia** · pedido de pesquisa', at: 2 }
const reply: Message = { id: 'm3', conversationId: 'c1', author: { kind: 'agent', id: 'bia' }, text: 'Que tal uma moqueca?', at: 3, run: { status: 'done', steps: [], endedAt: 4 } }

const drawn = (): string => renderToStaticMarkup(<AutoMode />)
const chat = (html: string): string => html.slice(html.indexOf('class="auto-chat"'), html.indexOf('class="auto-composer"'))
const backstage = (html: string): string => html.slice(html.indexOf('class="auto-backstage"'))

beforeEach(() => {
  fake = { ...getState(), ready: true, me: { name: 'Zen', initials: 'Z' }, settings: { ...getState().settings, auto: true }, agents: [bia], conversations: [channel], messages: { c1: [ask, note, reply] } }
})

describe('Tucano Auto', () => {
  it('shows what was asked and what came back, as the toucan, with the way back to the full app', () => {
    const html = drawn()
    expect(chat(html)).toContain('Um cardápio para receber amigos')
    expect(chat(html)).toContain('Que tal uma moqueca?')
    expect(chat(html)).toContain('quem fez isso?')
    // The agent's name stays behind the curtain; the router's note too.
    expect(chat(html)).not.toContain('Bia')
    expect(chat(html)).not.toContain('Chamei')
    expect(html).toContain('Modo completo')
  })

  it('keeps who the router called, and why, in the backstage', () => {
    const html = backstage(drawn())
    expect(html).toContain('Chamei <strong>Bia</strong> · pedido de pesquisa')
    expect(html).toContain('Bia</b> · Pesquisa')
    expect(html).toContain('Ver tudo no modo completo')
  })

  it('says when the team is empty, and keeps the field shut until there is someone to answer', () => {
    fake = { ...fake, agents: [], conversations: [], messages: {} }
    const html = drawn()
    expect(html).toContain('Sua equipe ainda está vazia')
    expect(html).toMatch(/class="auto-send" type="button" disabled=""/)
  })

  it("keeps the router's pick backstage, but says when it couldn't pick, and keeps a stop with Continuar", () => {
    const nobody: Message = { id: 'n1', conversationId: 'c1', author: { kind: 'system' }, text: 'Ninguém precisa responder · um agradecimento', at: 5 }
    const failed: Message = { id: 'n2', conversationId: 'c1', author: { kind: 'system' }, text: 'Não consegui escolher quem responde: sem login. Mencione um agente com **@nome**.', at: 6 }
    const stop: Message = { id: 'n3', conversationId: 'c1', author: { kind: 'system' }, text: 'Parei no limite desta tarefa.', at: 7, stop: { job: 'j1' } }
    fake = { ...fake, messages: { c1: [ask, note, reply, nobody, failed, stop] } }
    const html = chat(drawn())
    expect(html).not.toContain('Ninguém precisa responder')
    expect(html).toContain('Não consegui escolher quem responde')
    expect(html).toContain('Parei no limite desta tarefa.')
    expect(html).toContain('Continuar')
  })

  it('asks for the yes in the conversation, as the usual approval card', () => {
    const approval = { id: 'ap1', hash: 'h', agentId: 'bia', conversationId: 'c1', messageId: 'm3', connectorId: 'gmail', connectorName: 'Gmail', tool: 'send_email', args: { to: 'ana@exemplo.com' }, why: 'mandar o cardápio', highRisk: false, state: 'pending', createdAt: 1, expiresAt: Date.now() + 3_600_000 } as Approval
    fake = { ...fake, approvals: [approval], messages: { c1: [ask, note, { ...reply, run: { status: 'waiting_approval', steps: [], approvalId: 'ap1' } } as Message] } }
    const html = drawn()
    expect(html).toContain('Preciso do seu sim para seguir.')
    expect(chat(html)).toContain('class="auto-approve"')
    expect(chat(html)).toContain('ana@exemplo.com')
  })

  it('shows a question the reply asked, to answer right there', () => {
    const asked = { ...reply, run: { status: 'waiting_input', steps: [], question: 'Quantas pessoas vêm?' } } as Message
    fake = { ...fake, messages: { c1: [ask, note, asked] } }
    expect(chat(drawn())).toContain('Quantas pessoas vêm?')
  })

  it('offers to resume when everything is stopped', () => {
    fake = { ...fake, settings: { ...fake.settings, paused: true } }
    const html = drawn()
    expect(html).toContain('Tudo parado')
  })
})

describe('the switch', () => {
  it('gives way to the full app when something else is asked for, and stays for its own conversation', async () => {
    const store = await import('../src/renderer/src/store')
    const set = (auto: boolean): void => store.updateSettings({ auto })
    vi.spyOn(console, 'error').mockImplementation(() => {})
    set(true)
    store.navigate({ kind: 'settings' })
    expect(store.getState().settings.auto).toBe(false)
    set(true)
    store.navigate({ kind: 'tuca' })
    expect(store.getState().settings.auto).toBe(true)
  })

  it('is a setting the app accepts, as a boolean and nothing else', () => {
    expect(settingsPatchError({ auto: true })).toBeUndefined()
    expect(settingsPatchError({ auto: null })).toBeUndefined()
    expect(settingsPatchError({ auto: 'sim' })).toBeTruthy()
  })

  it("is each person's own: a member does not inherit the owner's choice", () => {
    expect(PERSONAL_SETTINGS).toContain('auto')
    const people = new People({ prefs: () => ({}) } as never)
    expect(people.settingsFor({ id: 'ana', role: 'owner' }, { auto: true } as Settings).auto).toBe(true)
    expect(people.settingsFor({ id: 'bia', role: 'member' }, { auto: true } as Settings).auto).toBeUndefined()
  })
})
