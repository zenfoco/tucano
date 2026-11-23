// Tucano Auto: the app as one conversation with the toucan, the team behind it (components/Auto.tsx).
// The person sees what they asked and what came back; who the router called, and why, waits in the
// backstage. The mode is each person's own, and always has its way back to the full app.
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Agent, Conversation, Message, Settings } from '../src/shared/types'
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

  it('offers to resume when everything is stopped', () => {
    fake = { ...fake, settings: { ...fake.settings, paused: true } }
    const html = drawn()
    expect(html).toContain('Tudo parado')
  })
})

describe('the switch', () => {
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
