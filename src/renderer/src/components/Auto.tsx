// Tucano Auto: the whole app as one conversation with the Tuca. The person writes in one field,
// in their DM with him, and he is the only one who answers: what needs a specialist he hands to the
// team with `pedir` and delivers when it comes back (src/core/tuca.ts autoOrchestratorSection). What
// he asked of whom, what the team knows about the person and the routines wait in a drawer
// ("Bastidores") that only opens when asked. Approvals and questions come in the conversation, as
// the same cards as everywhere else. "Modo completo" goes back to the app as it always is.
import { L } from '../../../shared/lang'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { hasOpenSteps, questionsOf } from '../../../shared/questions'
import {
  decideMemory,
  ensureTuca,
  forgetMemory,
  getState,
  inboxCount,
  isMine,
  isTeam,
  navigate,
  openPanel,
  workingOn,
  runRoutine,
  sendMessage,
  stopRun,
  timelineOf,
  toast,
  updateSettings,
  useLiveText,
  useStore,
  type Approval,
  type Delegation,
  type Message,
  type State
} from '../store'
import { ApprovalCard, QuestionCard, ReplyText, StopNote, useDictation, VoiceButton } from './Conversation'
import { ArtifactCard } from './Panel'
import { Proposals } from './Tuca'
import { AnswersSummary, NextStepsCard } from './Decisions'
import { describeRoutine } from './Routines'
import { Icon, TucaMark, time, useJustEnded } from './ui'

// The Tuca, and this person's DM with him: the conversation behind the mode.
const tucaOf = (s: State) => s.agents.find((a) => a.kind === 'tuca' && !a.archived)
export const autoConversation = (s: State) => {
  const tuca = tucaOf(s)
  return tuca ? s.conversations.find((c) => c.kind === 'dm' && c.name === tuca.id) : undefined
}

// The Tuca and his DM, made if missing (never fresh: that would delete what was said there).
let making: Promise<unknown> | null = null
function ensureAutoConversation(): void {
  if (making || autoConversation(getState())) return
  making = ensureTuca()
    .catch(() => toast(L('Não consegui abrir a conversa com o Tuca.', "I couldn't open the conversation with the Tuca.")))
    .finally(() => (making = null))
}

// What the Tuca handed to the team from this conversation, newest last (the store keeps the open ones
// and those that ended in the last day).
const handedFrom = (s: State, conversationId: string | undefined): Delegation[] => {
  const tuca = tucaOf(s)
  return conversationId && tuca ? s.delegations.filter((d) => d.from === tuca.id && d.originConversationId === conversationId) : NO_DELEGATIONS
}
const NO_DELEGATIONS: Delegation[] = []
// Pending approvals the person sees here: this conversation's, and those the team's work stopped on.
const approvalsHere = (s: State, conversationId: string | undefined): Approval[] => {
  if (!conversationId) return NO_APPROVALS
  const held = new Set(handedFrom(s, conversationId).flatMap((d) => (d.approval ? [d.approval] : [])))
  const list = s.approvals.filter((a) => a.state === 'pending' && (a.conversationId === conversationId || held.has(a.id)))
  return list.length ? list : NO_APPROVALS
}
const NO_APPROVALS: Approval[] = []

// Leaves the mode, to the app as it always is (on a message, when there's one to look at).
export function leaveAuto(conversationId?: string, message?: string): void {
  const panel = getState().panel
  updateSettings({ auto: false })
  if (conversationId) navigate({ kind: 'conversation', id: conversationId, ...(message ? { message } : {}) })
  if (panel) openPanel(panel) // a file asked to be opened here opens beside the conversation there
}

// A reply of the Tuca's that handed work on (its requests are on it). Whatever he wrote with it shows
// above the team's line.
const handingOn = (m: Message): boolean => m.author.kind === 'agent' && !!m.run?.delegations?.length && m.run.status !== 'working'

type Tab = 'trail' | 'memory' | 'routines'

export function AutoMode(): ReactNode {
  const conv = useStore(autoConversation)
  const teamSize = useStore((s) => s.agents.filter(isTeam).length)
  const handed = useStore((s) => handedFrom(s, conv?.id))
  const name = useStore((s) => s.me.name)
  const paused = useStore((s) => !!s.settings.paused)
  const theme = useStore((s) => s.settings.theme)
  const timeline = useStore((s) => (conv ? timelineOf(s, conv.id) : NONE))
  const approvals = useStore((s) => approvalsHere(s, conv?.id).length)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('trail')
  const [focus, setFocus] = useState<string | undefined>()
  const [opening, setOpening] = useState(() => typeof matchMedia === 'function' && !matchMedia('(prefers-reduced-motion: reduce)').matches)

  useEffect(() => ensureAutoConversation(), [conv])
  // A file or a thread asked to open (its card was clicked): that side panel is the full app's.
  const panel = useStore((s) => s.panel)
  useEffect(() => {
    if (panel && conv) leaveAuto(conv.id)
  }, [panel, conv])
  // What waits on me elsewhere: approvals and questions from other conversations.
  const elsewhere = useStore((s) => Math.max(0, inboxCount(s) - approvalsHere(s, conv?.id).length))
  useEffect(() => {
    if (!opening) return
    const t = setTimeout(() => setOpening(false), 2300)
    return () => clearTimeout(t)
  }, [opening])

  // What the person sees: what they asked and what the Tuca said. While the team works, he's working.
  const shown = timeline
  const working = timeline.some((m) => m.run?.status === 'working') || handed.some((d) => d.state === 'open')
  const done = useJustEnded(working, 1600)

  const say = paused
    ? L('Tudo parado. Retome nos bastidores quando quiser.', 'Everything is stopped. Resume it in the backstage when you like.')
    : approvals
      ? L('Preciso do seu sim para seguir.', 'I need your yes to go on.')
      : working
        ? L('Cuidando disso…', 'On it…')
        : teamSize === 0 && !shown.length
          ? L(`Oi, ${name}! Sua equipe ainda está vazia: me conte o que você quer resolver e eu monto quem cuida disso.`, `Hi, ${name}! Your team is still empty: tell me what you want to get done and I'll set up who takes care of it.`)
          : shown.length
            ? L('Pronto. O que mais?', 'Done. What else?')
            : L(`Oi, ${name}! O que você quer resolver?`, `Hi, ${name}! What do you want to get done?`)
  const status = paused ? L('pausado', 'paused') : working ? L('pensando', 'thinking') : L('pronto', 'ready')

  const showWho = (id: string): void => {
    setFocus(id)
    setTab('trail')
    setOpen(true)
  }

  return (
    <div className={`auto ${open ? 'is-open' : ''}`}>
      {opening && (
        <div className="auto-opening" aria-hidden="true" onClick={() => setOpening(false)}>
          <div className="auto-opening__half auto-opening__half--left">
            <TucaMark size={132} />
          </div>
          <div className="auto-opening__half auto-opening__half--right">
            <TucaMark size={132} />
          </div>
        </div>
      )}
      <div className="auto-main">
        <section className="auto-stage" aria-live="polite">
          <div className={`auto-figure ${working ? 'is-thinking' : ''} ${done ? 'is-done' : ''}`} aria-hidden="true">
            <TucaMark size={200} busy={working} happy={done} />
          </div>
          <div className="auto-balloon">
            <div>{say}</div>
            <div className="auto-balloon__status">{status}</div>
            {elsewhere > 0 && (
              <button className="auto-link" type="button" onClick={() => navigate({ kind: 'approvals' })}>
                {L(`${elsewhere} ${elsewhere === 1 ? 'coisa espera' : 'coisas esperam'} você fora daqui`, `${elsewhere} ${elsewhere === 1 ? 'thing waits' : 'things wait'} for you elsewhere`)}
              </button>
            )}
          </div>
        </section>

        <header className="auto-head">
          <div className="auto-brand">
            <TucaMark size={22} />
            <span>Tucano Auto</span>
            <small>{L('Você pede; a equipe encontra o caminho.', 'You ask; the team finds the way.')}</small>
          </div>
          <div className="auto-tools">
            <button
              className="auto-ghost auto-ghost--round"
              type="button"
              title={theme === 'system' ? L('Tema: automático', 'Theme: automatic') : theme === 'dark' ? L('Tema: escuro', 'Theme: dark') : L('Tema: claro', 'Theme: light')}
              aria-label={L('Trocar o tema', 'Change the theme')}
              onClick={() => updateSettings({ theme: theme === 'system' ? 'light' : theme === 'light' ? 'dark' : 'system' })}
            >
              <Icon name={theme === 'dark' ? 'moon' : 'sun'} size={15} />
            </button>
            <button className="auto-ghost" type="button" aria-pressed={open} aria-controls="auto-backstage" onClick={() => setOpen(!open)}>
              {L('Bastidores', 'Backstage')}
            </button>
            <button className="auto-ghost" type="button" onClick={() => leaveAuto(conv?.id)} title={L('Volta ao Tucano com todas as telas', 'Back to Tucano with every screen')}>
              {L('Modo completo', 'Full mode')}
            </button>
          </div>
        </header>

        <AutoChat messages={shown} onWho={showWho} />

        <AutoComposer conversationId={conv?.id} disabled={!conv} />
      </div>

      <aside className="auto-backstage" id="auto-backstage" aria-label={L('Bastidores', 'Backstage')} aria-hidden={!open}>
        <div className="auto-backstage__head">
          <h3>{L('Bastidores', 'Backstage')}</h3>
          <button type="button" aria-label={L('Fechar os bastidores', 'Close the backstage')} onClick={() => setOpen(false)}>
            <Icon name="x" size={14} />
          </button>
        </div>
        <p className="auto-backstage__sub">{L('Invisível por padrão. Aparece só quando você escava.', 'Hidden by default. It shows only when you dig.')}</p>
        <div className="auto-tabs" role="tablist">
          {(
            [
              ['trail', L('Quem fez', 'Who did it')],
              ['memory', L('O que sei de você', 'What I know about you')],
              ['routines', L('Rotinas', 'Routines')]
            ] as const
          ).map(([key, label]) => (
            <button key={key} className="auto-tab" role="tab" type="button" aria-selected={tab === key} onClick={() => setTab(key)}>
              {label}
            </button>
          ))}
        </div>
        {tab === 'trail' && <Trail timeline={timeline} handed={handed} focus={focus} conversationId={conv?.id} />}
        {tab === 'memory' && <WhatIKnow />}
        {tab === 'routines' && <AutoRoutines />}
      </aside>
    </div>
  )
}

const NONE: Message[] = []

function AutoChat({ messages, onWho }: { messages: Message[]; onWho: (id: string) => void }): ReactNode {
  const box = useRef<HTMLElement>(null)
  // Follows the end as things come (words still arriving too), unless the person scrolled up to read.
  const pinned = useRef(true)
  useEffect(() => {
    const el = box.current
    if (!el) return
    const follow = (): void => {
      if (pinned.current) el.scrollTop = el.scrollHeight
    }
    follow()
    const watch = new MutationObserver(follow)
    watch.observe(el, { childList: true, subtree: true, characterData: true })
    return () => watch.disconnect()
  }, [])
  return (
    <section
      className="auto-chat"
      ref={box}
      aria-live="polite"
      onScroll={(e) => {
        const el = e.currentTarget
        pinned.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80
      }}
    >
      {messages.length === 0 && <p className="auto-empty">{L('Escreva o que você precisa, do seu jeito. Ninguém aqui precisa de comando.', 'Write what you need, your own way. Nothing here needs a command.')}</p>}
      {messages.map((m) => <Said key={m.id} message={m} onWho={onWho} />)}
    </section>
  )
}

function Said({ message, onWho }: { message: Message; onWho: (id: string) => void }): ReactNode {
  const mine = useStore((s) => isMine(s, message.author))
  if (message.author.kind === 'system')
    return message.stop ? (
      <StopNote message={message} />
    ) : (
      <div className="auto-system">
        <ReplyText text={message.text} />
      </div>
    )
  if (mine)
    return (
      <div className="auto-msg auto-msg--me">
        <ReplyText text={message.text} />
      </div>
    )
  if (handingOn(message))
    return (
      <>
        {message.text.trim() && <Theirs message={message} onWho={onWho} />}
        <TeamWork message={message} onWho={onWho} />
      </>
    )
  return <Theirs message={message} onWho={onWho} />
}

// Where the Tuca handed work to the team: one quiet line while it's done and the approvals it stopped on.
// What it found, and the files it made, come on his own delivery (Theirs), when it comes back.
function TeamWork({ message, onWho }: { message: Message; onWho: (id: string) => void }): ReactNode {
  const ids = message.run?.delegations?.map((d) => d.id) ?? []
  const asked = useStore((s) => s.delegations.filter((d) => ids.includes(d.id)))
  const approvals = useStore((s) => {
    const held = new Set(asked.flatMap((d) => (d.approval ? [d.approval] : [])))
    const list = s.approvals.filter((a) => a.state === 'pending' && held.has(a.id))
    return list.length ? list : NO_APPROVALS
  })
  const open = asked.some((d) => d.state === 'open')
  return (
    <div className="auto-row">
      <div className="auto-team">
        <span className={`auto-team__dot ${open ? 'is-working' : ''}`} aria-hidden="true" />
        {open ? L('A equipe está cuidando disso. Já te entrego.', "The team is on it. I'll deliver it shortly.") : L('A equipe terminou.', 'The team is done.')}
        <button className="auto-who" type="button" onClick={() => onWho(message.id)}>
          {L('quem está fazendo?', "who's doing it?")}
        </button>
      </div>
      {approvals.map((a) => (
        <div key={a.id} className="auto-approve">
          <ApprovalCard approval={a} />
        </div>
      ))}
    </div>
  )
}

function Theirs({ message, onWho }: { message: Message; onWho: (id: string) => void }): ReactNode {
  const text = useLiveText(message, message.run?.status === 'working' ? 120 : 0)
  const approval = useStore((s) => (message.run?.approvalId ? s.approvals.find((a) => a.id === message.run!.approvalId) : undefined))
  const team = useStore((s) => s.people.length > 1)
  const run = message.run
  const working = run?.status === 'working'
  return (
    <div className="auto-row">
      <div className={`auto-msg auto-msg--them ${working ? 'is-writing' : ''}`}>
        <span className="auto-msg__face" aria-hidden="true">
          <TucaMark size={28} busy={working} />
        </span>
        <div className="auto-msg__body">
          {text ? <ReplyText text={text} /> : working ? <span className="auto-dots" aria-label={L('escrevendo', 'writing')} /> : null}
          {run?.error && <p className="auto-msg__error">{run.error}</p>}
          {run?.status === 'stopped' && <p className="auto-msg__error">{L('Interrompido por você.', 'Stopped by you.')}</p>}
          {!!run?.artifactIds?.length && (
            <div className="artifacts auto-files">
              {run.artifactIds.map((id) => (
                <ArtifactCard key={id} id={id} />
              ))}
            </div>
          )}
          {run && questionsOf(run).length > 0 &&
            (hasOpenSteps(run) ? (
              <NextStepsCard message={message} />
            ) : team && run.askedTo ? (
              <QuestionCard id={message.id} askedTo={run.askedTo} question={run.question ?? ''} {...(run.questions?.length ? { decisions: run.questions } : {})} answers={run.answers} answeredInText={run.answeredInText} cancelled={run.cancelled} answered={run.status !== 'waiting_input'} answeredBy={run.answeredBy} />
            ) : (
              <AnswersSummary message={message} />
            ))}
          {!working && (
            <button className="auto-who" type="button" onClick={() => onWho(message.id)}>
              {L('quem fez isso?', 'who did this?')}
            </button>
          )}
        </div>
      </div>
      {(run?.agentDraft || !!run?.proposals?.length || !!run?.proposal) && (
        <div className="auto-approve">
          <Proposals message={message} />
        </div>
      )}
      {approval?.state === 'pending' && (
        <div className="auto-approve">
          <ApprovalCard approval={approval} />
        </div>
      )}
    </div>
  )
}

function AutoComposer({ conversationId, disabled }: { conversationId: string | undefined; disabled: boolean }): ReactNode {
  const [text, setText] = useState('')
  const [note, setNote] = useState('')
  const field = useRef<HTMLInputElement>(null)
  const [dictation, controls] = useDictation((t) => setText((v) => (v ? `${v} ${t}` : t)), setNote, conversationId ?? 'tucano-auto')
  const send = (): void => {
    const t = text.trim()
    if (!t || !conversationId || disabled) return
    sendMessage(conversationId, t)
    setText('')
    field.current?.focus()
  }
  return (
    <div className="auto-composer">
      {/* Not a form: the microphone's button would be its default one, and Enter would press it. */}
      <div className="auto-field">
        <input
          ref={field}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Enter' || e.shiftKey || e.nativeEvent.isComposing) return
            e.preventDefault()
            send()
          }}
          autoComplete="off"
          autoFocus
          placeholder={L('Fale com o Tucano…', 'Talk to Tucano…')}
          aria-label={L('Mensagem para o Tucano', 'Message to Tucano')}
        />
        <VoiceButton controls={controls} state={dictation} />
        <button className="auto-send" type="button" disabled={disabled || !text.trim()} aria-label={L('Enviar', 'Send')} onClick={send}>
          <Icon name="send" size={16} />
        </button>
      </div>
      <div className="auto-hint">{note || L('Sem menu, sem escolher nada. Toque em “quem fez isso?” para ver por dentro.', 'No menu, nothing to pick. Tap “who did this?” to look inside.')}</div>
    </div>
  )
}

// Each request, newest first: who the router called and why, and how each reply went.
function Trail({ timeline, handed, focus, conversationId }: { timeline: Message[]; handed: Delegation[]; focus: string | undefined; conversationId: string | undefined }): ReactNode {
  const agents = useStore((s) => s.agents)
  const blocks = useMemo(() => {
    const out: { ask: Message; replies: Message[]; asked: Delegation[] }[] = []
    for (const m of timeline) {
      if (m.author.kind === 'person') out.push({ ask: m, replies: [], asked: [] })
      else if (m.author.kind === 'agent' && out.length) out.at(-1)!.replies.push(m)
    }
    for (const b of out) {
      const ids = new Set(b.replies.map((r) => r.id))
      b.asked = handed.filter((d) => ids.has(d.originMessageId))
    }
    return out.reverse()
  }, [timeline, handed])
  const lit = useRef<HTMLLIElement>(null)
  // Braces: scrollIntoView returns a promise in newer Chromium, and an effect may return only its cleanup.
  useEffect(() => {
    lit.current?.scrollIntoView({ block: 'nearest' })
  }, [focus])
  if (!blocks.length) return <p className="auto-quiet">{L('Nada ainda. Mande um pedido.', 'Nothing yet. Send a request.')}</p>
  const nameOf = (id: string): string => agents.find((a) => a.id === id)?.name ?? L('Agente', 'Agent')
  const roleOf = (id: string): string => agents.find((a) => a.id === id)?.role ?? ''
  return (
    <ul className="auto-trail">
      {blocks.map(({ ask, replies, asked }) => {
        const here = !!focus && replies.some((r) => r.id === focus)
        return (
          <li key={ask.id} className={`auto-trail__block ${here ? 'is-lit' : ''}`} ref={here ? lit : undefined}>
            <div className="auto-trail__ask">
              “{ask.text.length > 90 ? `${ask.text.slice(0, 90)}…` : ask.text}”<small>{time(ask.at)}</small>
            </div>
            {asked.length === 0 && replies.length > 0 && <div className="auto-trail__step">{L('O Tuca respondeu direto.', 'The Tuca answered himself.')}</div>}
            {asked.map((d) => (
              <div key={d.id} className="auto-trail__step">
                <b>{nameOf(d.to)}</b>
                {roleOf(d.to) ? ` · ${roleOf(d.to)}` : ''}
                <small>
                  “{d.text.length > 80 ? `${d.text.slice(0, 80)}…` : d.text}” · {handedWords(d)}
                </small>
                <button className="auto-link" type="button" onClick={() => leaveAuto(d.conversationId, d.rootId)}>
                  {L('Ver o trabalho no modo completo', 'See the work in the full mode')}
                </button>
              </div>
            ))}
          </li>
        )
      })}
    </ul>
  )
}

const handedWords = (d: Delegation): string =>
  d.state === 'open'
    ? d.asking
      ? L('perguntou algo', 'asked something')
      : d.approval
        ? L('esperando uma aprovação', 'waiting for an approval')
        : L('trabalhando', 'working')
    : d.state === 'done'
      ? L('entregou', 'delivered')
      : d.state === 'failed'
        ? L('não conseguiu', "didn't manage")
        : L('cancelado', 'cancelled')


function WhatIKnow(): ReactNode {
  const memories = useStore((s) => s.memories)
  const agents = useStore((s) => s.agents)
  const pending = memories.filter((m) => m.state === 'pending')
  const active = memories.filter((m) => m.state === 'active').sort((a, b) => b.confirmedAt - a.confirmedAt)
  if (!pending.length && !active.length) return <p className="auto-quiet">{L('Ainda não sei nada de você.', "I don't know anything about you yet.")}</p>
  const by = (agentId?: string): string => (agentId ? (agents.find((a) => a.id === agentId)?.name ?? '') : '')
  return (
    <div>
      {pending.map((m) => (
        <div key={m.id} className="auto-note is-pending">
          {m.text}
          <small>{L('Quer que eu guarde isso?', 'Shall I keep this?')}</small>
          <div className="auto-note__acts">
            <button type="button" onClick={() => decideMemory(m.id, true)}>
              {L('Guardar', 'Keep')}
            </button>
            <button type="button" onClick={() => decideMemory(m.id, false)}>
              {L('Não guardar', "Don't keep")}
            </button>
          </div>
        </div>
      ))}
      {active.map((m) => (
        <div key={m.id} className="auto-note">
          {m.text}
          <small>{[by(m.agentId), time(m.confirmedAt)].filter(Boolean).join(' · ')}</small>
          <div className="auto-note__acts">
            <button type="button" onClick={() => forgetMemory(m.id)}>
              {L('Esquecer', 'Forget')}
            </button>
          </div>
        </div>
      ))}
    </div>
  )
}

function AutoRoutines(): ReactNode {
  const routines = useStore((s) => s.routines)
  const paused = useStore((s) => !!s.settings.paused)
  const agents = useStore((s) => s.agents)
  const agentName = (id: string): string => agents.find((a) => a.id === id)?.name ?? ''
  return (
    <div>
      {routines.length === 0 && <p className="auto-quiet">{L('Nenhuma rotina ainda. Peça uma: “todo dia às 8h, me mande…”.', 'No routines yet. Ask for one: “every day at 8, send me…”.')}</p>}
      {routines.map((r) => (
        <div key={r.id} className="auto-note">
          <b>{r.name}</b>
          <small>
            {describeRoutine(r)} · {agentName(r.agentId)}
            {r.enabled ? '' : ` · ${L('desligada', 'off')}`}
          </small>
          <div className="auto-note__acts">
            <button
              type="button"
              onClick={() => {
                runRoutine(r.id)
                toast(L(`Rodando “${r.name}”. A resposta fica na conversa da rotina.`, `Running “${r.name}”. The answer goes in the routine's conversation.`), { label: L('Ver', 'See'), run: () => navigate({ kind: 'conversation', id: r.conversationId }) })
              }}
            >
              {L('Rodar agora', 'Run now')}
            </button>
          </div>
        </div>
      ))}
      {paused ? (
        <button className="auto-resume" type="button" onClick={() => updateSettings({ paused: false })}>
          ▶ {L('Retomar', 'Resume')}
        </button>
      ) : (
        <button
          className="auto-stop"
          type="button"
          title={L('Para o que está rodando, e nenhum agente começa nem rotina roda até retomar', "Stops what's running, and no agent starts nor routine runs until you resume")}
          onClick={() => {
            updateSettings({ paused: true })
            for (const m of workingOn(getState()).values()) stopRun(m.id)
          }}
        >
          ■ {L('Pare tudo', 'Stop everything')}
        </button>
      )}
    </div>
  )
}
