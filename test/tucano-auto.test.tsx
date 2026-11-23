// Tucano Auto: the app as one conversation with the toucan, the team behind it (components/Auto.tsx).
// The person sees what they asked and what came back; who the router called, and why, waits in the
// backstage. The mode is each person's own, and always has its way back to the full app.
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent, Approval, Conversation, Delegation, Message, Settings } from '../src/shared/types'
import type { State } from '../src/renderer/src/store'

let fake: State
vi.mock('../src/renderer/src/store', async (original) => {
  const real = await original<typeof import('../src/renderer/src/store')>()
  return { ...real, useStore: <T,>(select: (s: State) => T): T => select(fake), useLiveText: (m: Message) => m.text }
})
const { getState } = await import('../src/renderer/src/store')
const { AutoMode } = await import('../src/renderer/src/components/Auto')
const { settingsPatchError } = await import('../src/core/settings-patch')
const { People } = await import('../src/core/people')
const { PERSONAL_SETTINGS } = await import('../src/core/policy-people')

const bia = { id: 'bia', name: 'Bia', handle: 'bia', role: 'Pesquisa', color: 'sky' } as Agent
const tuca = { id: 'tuca', name: 'Tuca', handle: 'tuca', role: 'Te ajuda com o Tucano', color: 'amber', kind: 'tuca' } as Agent
const dm: Conversation = { id: 'c1', kind: 'dm', name: 'tuca', members: ['tuca'] }
const biaDm: Conversation = { id: 'c2', kind: 'dm', name: 'bia', members: ['bia'] }
const ask: Message = { id: 'm1', conversationId: 'c1', author: { kind: 'person', id: 'me' }, text: 'Um cardápio para receber amigos', at: 1 }
// The Tuca hands it to Bia (a reply with no text of its own), and delivers when it comes back.
const handing: Message = { id: 'm2', conversationId: 'c1', author: { kind: 'agent', id: 'tuca' }, text: '', at: 2, run: { status: 'done', steps: [], endedAt: 2, delegations: [{ id: 'd1', to: 'bia', conversationId: 'c2', rootId: 'r1' }] } }
const reply: Message = { id: 'm3', conversationId: 'c1', author: { kind: 'agent', id: 'tuca' }, text: 'Que tal uma moqueca?', at: 3, run: { status: 'done', steps: [], endedAt: 4, artifactIds: ['f1'] } }
const biaAnswer: Message = { id: 'm4', conversationId: 'c2', author: { kind: 'agent', id: 'bia' }, text: 'Moqueca, farofa e pudim.', at: 3, threadId: 'r1', run: { status: 'done', steps: [], endedAt: 3 } }
const asked: Delegation = { id: 'd1', from: 'tuca', to: 'bia', conversationId: 'c2', rootId: 'r1', originConversationId: 'c1', originMessageId: 'm2', requestedBy: 'me', text: 'monte um cardápio para receber amigos', state: 'done', result: 'm4', createdAt: 2 }

const drawn = (): string => renderToStaticMarkup(<AutoMode />)
const chat = (html: string): string => html.slice(html.indexOf('class="auto-chat"'), html.indexOf('class="auto-composer"'))
const backstage = (html: string): string => html.slice(html.indexOf('class="auto-backstage"'))

beforeEach(() => {
  fake = { ...getState(), ready: true, me: { name: 'Zen', initials: 'Z' }, settings: { ...getState().settings, auto: true }, agents: [tuca, bia], conversations: [dm, biaDm], messages: { c1: [ask, handing, reply], c2: [biaAnswer] }, delegations: [asked], artifacts: [{ id: 'f1', name: 'cardapio.pdf', messageId: 'm4', conversationId: 'c2', size: 10, mime: 'application/pdf', at: 3 } as never] }
})

describe('Tucano Auto', () => {
  it('shows what was asked and what the Tuca delivered, with the way back to the full app', () => {
    const html = drawn()
    expect(chat(html)).toContain('Um cardápio para receber amigos')
    expect(chat(html)).toContain('Que tal uma moqueca?')
    expect(chat(html)).toContain('quem fez isso?')
    // Who did the work stays behind the curtain: a quiet line where he handed it on, and the file it made.
    expect(chat(html)).toContain('A equipe terminou.')
    expect(chat(html)).toContain('cardapio.pdf')
    expect(chat(html)).not.toContain('Bia')
    expect(chat(html)).not.toContain('Moqueca, farofa e pudim.')
    expect(html).toContain('Modo completo')
  })

  it('shows the files on the Tuca\'s delivery, once, with no delegation or team messages to look them up in', () => {
    fake = { ...fake, delegations: [], messages: { c1: [ask, handing, reply] } }
    const html = chat(drawn())
    expect(html).toContain('cardapio.pdf')
    // One file card (its name shows twice inside it): the files live only on his delivery.
    expect(html.split('auto-files').length - 1).toBe(1)
  })

  it('keeps what the Tuca asked of whom in the backstage', () => {
    const html = backstage(drawn())
    expect(html).toContain('Bia</b> · Pesquisa')
    expect(html).toContain('monte um cardápio para receber amigos')
    expect(html).toContain('entregou')
    expect(html).toContain('Ver o trabalho no modo completo')
  })

  it('works while the team works: the balloon says so, and the line under his message too', () => {
    fake = { ...fake, delegations: [{ ...asked, state: 'open', result: undefined }] }
    const html = drawn()
    expect(html).toContain('Cuidando disso…')
    expect(chat(html)).toContain('A equipe está cuidando disso.')
  })

  it("brings an approval the team's work stopped on into his conversation", () => {
    const approval = { id: 'ap2', hash: 'h', agentId: 'bia', conversationId: 'c2', messageId: 'm4', connectorId: 'gmail', connectorName: 'Gmail', tool: 'send_email', args: { to: 'ana@exemplo.com' }, why: 'mandar o cardápio', highRisk: false, state: 'pending', createdAt: 1, expiresAt: Date.now() + 3_600_000 } as Approval
    fake = { ...fake, approvals: [approval], delegations: [{ ...asked, state: 'open', result: undefined, approval: 'ap2' }] }
    const html = drawn()
    expect(html).toContain('Preciso do seu sim para seguir.')
    expect(chat(html)).toContain('ana@exemplo.com')
  })

  it('with no team yet, the field stays open: the Tuca builds who takes care of it', () => {
    fake = { ...fake, agents: [tuca], conversations: [dm], messages: {}, delegations: [] }
    const html = drawn()
    expect(html).toContain('Sua equipe ainda está vazia')
    // The app's own message box, open with no team: what the person writes goes to the Tuca.
    expect(html).toContain('Mensagem pra Tuca')
  })

  it('keeps a stop with Continuar and what the app says in the conversation', () => {
    const failed: Message = { id: 'n2', conversationId: 'c1', author: { kind: 'system' }, text: 'Algo deu errado.', at: 6 }
    const stop: Message = { id: 'n3', conversationId: 'c1', author: { kind: 'system' }, text: 'Parei no limite desta tarefa.', at: 7, stop: { job: 'j1' } }
    fake = { ...fake, messages: { ...fake.messages, c1: [ask, handing, reply, failed, stop] } }
    const html = chat(drawn())
    expect(html).toContain('Algo deu errado.')
    expect(html).toContain('Parei no limite desta tarefa.')
    expect(html).toContain('Continuar')
  })

  it('asks for the yes in the conversation, as the usual approval card', () => {
    const approval = { id: 'ap1', hash: 'h', agentId: 'bia', conversationId: 'c1', messageId: 'm3', connectorId: 'gmail', connectorName: 'Gmail', tool: 'send_email', args: { to: 'ana@exemplo.com' }, why: 'mandar o cardápio', highRisk: false, state: 'pending', createdAt: 1, expiresAt: Date.now() + 3_600_000 } as Approval
    fake = { ...fake, approvals: [approval], messages: { ...fake.messages, c1: [ask, { ...reply, run: { status: 'waiting_approval', steps: [], approvalId: 'ap1' } } as Message] } }
    const html = drawn()
    expect(html).toContain('Preciso do seu sim para seguir.')
    expect(chat(html)).toContain('class="auto-approve"')
    expect(chat(html)).toContain('ana@exemplo.com')
  })

  it('shows a question the reply asked, to answer right there', () => {
    const question = { ...reply, run: { status: 'waiting_input', steps: [], question: 'Quantas pessoas vêm?' } } as Message
    fake = { ...fake, messages: { ...fake.messages, c1: [ask, question] } }
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
