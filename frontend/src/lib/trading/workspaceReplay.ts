import {
  ReplayGroup,
  type ReplayGroupMember,
  type ReplayGroupState,
  type ReplayScope,
  type ReplayState,
} from 'chartly-charts'

export interface PreparedReplayMember {
  member: ReplayGroupMember
  isCurrent(): boolean
}

export interface WorkspaceReplayTerminal {
  beginWorkspaceReplayPick(
    onPick: (time: number) => void,
    onCancel: () => void,
    onPreview?: (time: number) => void
  ): boolean
  setWorkspaceReplayPreview(time: number | null): void
  cancelReplayPick(): void
  prepareReplayMember(args: {
    id: string
    sessionId: number
    signal: AbortSignal
  }): Promise<PreparedReplayMember>
  setReplayParticipation(
    sessionId: number,
    active: boolean,
    state?: ReplayState,
    availableAt?: number
  ): void
  restoreReplayMember(sessionId: number): void
  setWorkspaceReplayLocked(locked: boolean): void
  setReplayInvalidationHandler(handler: (() => void) | null): void
}

export interface WorkspaceReplaySnapshot {
  phase: 'idle' | 'picking' | 'loading' | 'active'
  scope: ReplayScope
  ownerId: string | null
  state: ReplayGroupState | null
}

interface Registration {
  id: string
  terminal: WorkspaceReplayTerminal
}

interface Session {
  id: number
  ownerId: string
  members: readonly Registration[]
  abort: AbortController
  started: Set<Registration>
  prepared: Map<string, PreparedReplayMember>
  held: Set<string>
  group: ReplayGroup | null
  transitioning: boolean
  previewTime: number | null
}

/** Host lifecycle around the engine's single clock and availability timeline. */
export class WorkspaceReplayCoordinator {
  private members: readonly Registration[] = []
  private session: Session | null = null
  private phase: WorkspaceReplaySnapshot['phase'] = 'idle'
  private scope: ReplayScope = 'focused'
  private groupState: ReplayGroupState | null = null
  private revision = 0
  private closing = false
  private destroyed = false
  /** Paper ledgers advance on server acknowledgement, never a browser timer. */
  private externalClock = false
  /** Told when the hovered start bar moves, apart from the snapshot. */
  private readonly pickListeners = new Set<() => void>()
  private readonly callbacks: {
    onChange: (snapshot: WorkspaceReplaySnapshot) => void
    onError: (error: unknown) => void
  }

  constructor(callbacks: {
    onChange: (snapshot: WorkspaceReplaySnapshot) => void
    onError: (error: unknown) => void
  }) {
    this.callbacks = callbacks
  }

  setMembers(members: readonly Registration[]): void {
    if (this.destroyed) return
    const ids = new Set<string>(),
      terminals = new Set<WorkspaceReplayTerminal>()
    for (const member of members) {
      if (!member.id.trim() || ids.has(member.id) || terminals.has(member.terminal)) {
        throw new Error('Replay charts must have unique identities')
      }
      ids.add(member.id)
      terminals.add(member.terminal)
    }
    if (
      members.length === this.members.length &&
      members.every((member) =>
        this.members.some(
          (previous) => previous.id === member.id && previous.terminal === member.terminal
        )
      )
    )
      return
    this.stop()
    let failure: unknown
    const attempt = (action: () => void) => {
      try {
        action()
      } catch (error) {
        failure ??= error
      }
    }
    for (const member of this.members)
      attempt(() => member.terminal.setReplayInvalidationHandler(null))
    this.members = members.map((member) => ({ ...member }))
    for (const member of this.members) {
      attempt(() =>
        member.terminal.setReplayInvalidationHandler(() => {
          if (
            this.members.includes(member) &&
            this.session &&
            (this.phase === 'loading' || this.scope === 'all' || this.session.ownerId === member.id)
          )
            this.stop()
        })
      )
    }
    if (failure !== undefined) this.callbacks.onError(failure)
  }

  state(): WorkspaceReplaySnapshot {
    return {
      phase: this.phase,
      scope: this.scope,
      ownerId: this.session?.ownerId ?? null,
      state: this.groupState,
    }
  }

  start(ownerId: string): void {
    if (this.destroyed || this.closing || this.session) return
    const owner = this.members.find((member) => member.id === ownerId)
    if (!owner) {
      this.callbacks.onError(new Error('Choose an available chart before starting replay'))
      return
    }
    const session: Session = {
      id: ++this.revision,
      ownerId,
      members: [...this.members],
      abort: new AbortController(),
      started: new Set(),
      prepared: new Map(),
      held: new Set(),
      group: null,
      transitioning: false,
      previewTime: null,
    }
    this.session = session
    this.phase = 'picking'
    try {
      for (const member of session.members) {
        if (this.session !== session) return
        member.terminal.setWorkspaceReplayLocked(true)
      }
      this.publish()
      if (this.session !== session) return
      const picking = owner.terminal.beginWorkspaceReplayPick(
        (time) => {
          if (this.session === session && this.phase === 'picking') void this.prepare(session, time)
        },
        () => {
          if (this.session === session) this.stop()
        },
        (time) => {
          if (this.session !== session || this.phase !== 'picking') return
          try {
            if (!Number.isFinite(time)) throw new Error('Choose a candle with a valid replay time')
            session.previewTime = time
            this.preview(session)
            this.notifyPick()
          } catch (error) {
            this.finish(session, error)
          }
        }
      )
      if (!picking && this.session === session) this.stop()
    } catch (error) {
      this.finish(session, error)
    }
  }

  /** Resume only the chart availability clock; no simulation account is created. */
  async resume(ownerId: string, availableAt: number): Promise<void> {
    if (!Number.isFinite(availableAt)) throw new Error('The saved chart cursor is invalid.')
    this.start(ownerId)
    const session = this.session
    if (session?.ownerId === ownerId && this.phase === 'picking')
      await this.prepare(session, availableAt)
  }

  /** Apply a committed paper checkpoint to every pane without advancing its account locally. */
  async acknowledge(ownerId: string, availableAt: number): Promise<boolean> {
    if (!Number.isFinite(availableAt)) throw new Error('The acknowledged paper clock is invalid.')
    if (this.phase === 'loading') return false
    this.externalClock = true
    const existing = this.session
    if (existing?.group && existing.group.state().scope !== 'all') {
      await this.expandScope(existing)
      if (
        this.session !== existing ||
        this.phase !== 'active' ||
        existing.group?.state().scope !== 'all'
      )
        return false
    }
    this.scope = 'all'
    if (!this.session?.group) await this.resume(ownerId, availableAt)
    const session = this.session
    if (!session?.group || this.phase !== 'active') return false
    this.assertCurrent(session)
    session.group.pause()
    session.group.setScope('all', session.ownerId)
    session.group.seekTime(availableAt)
    this.changed(session, session.group.state())
    return this.session === session
  }

  private async prepare(session: Session, time: number): Promise<void> {
    try {
      if (!Number.isFinite(time)) throw new Error('Choose a candle with a valid replay time')
      this.preview(session, true)
      if (this.session !== session) return
      this.notifyPick()
      this.phase = 'loading'
      this.publish()
      if (this.session !== session) return
      const participants = session.members.filter(
        (member) => this.scope === 'all' || member.id === session.ownerId
      )
      await Promise.all(
        participants.map(async (member) => {
          if (this.session !== session) return
          session.started.add(member)
          session.held.add(member.id)
          const prepared = await member.terminal.prepareReplayMember({
            id: member.id,
            sessionId: session.id,
            signal: session.abort.signal,
          })
          if (this.session !== session) {
            // The terminal's session token prevents a late old result unpausing a new owner.
            member.terminal.restoreReplayMember(session.id)
            return
          }
          if (prepared.member.id !== member.id || !prepared.isCurrent()) {
            throw new Error('Chart history changed. Start a new replay from the current charts.')
          }
          session.prepared.set(member.id, prepared)
        })
      )
      if (this.session !== session) return
      this.assertCurrent(session)
      session.transitioning = true
      for (const member of session.members) {
        if (this.session !== session) return
        if (this.scope === 'all' || member.id === session.ownerId) {
          member.terminal.setReplayParticipation(session.id, true)
        }
      }
      if (this.session !== session) return
      const group = new ReplayGroup(
        participants.map((member) => session.prepared.get(member.id)!.member),
        {
          scope: this.scope,
          focusedId: session.ownerId,
          startTime: time,
          onChange: (state) => this.changed(session, state),
        }
      )
      if (this.session !== session) {
        group.destroy()
        return
      }
      session.group = group
      session.transitioning = false
      this.phase = 'active'
      this.changed(session, group.state())
    } catch (error) {
      if (this.session === session) this.finish(session, error)
    }
  }

  setScope(scope: ReplayScope): void {
    if (this.externalClock && scope !== 'all') return
    if (this.destroyed || this.closing || this.phase === 'loading') return
    if (scope !== 'focused' && scope !== 'all') {
      this.callbacks.onError(new Error('Choose focused or all charts for replay'))
      return
    }
    if (scope === this.scope) return
    const session = this.session
    if (!session?.group) {
      this.scope = scope
      try {
        if (session && this.phase === 'picking') this.preview(session)
        this.publish()
      } catch (error) {
        if (session) this.finish(session, error)
        else this.callbacks.onError(error)
      }
      return
    }
    if (scope === 'all') {
      void this.expandScope(session)
      return
    }
    try {
      this.assertCurrent(session)
    } catch (error) {
      this.finish(session, error)
      return
    }
    try {
      session.transitioning = true
      session.group.setScope(scope, session.ownerId)
      session.transitioning = false
      this.changed(session, session.group.state())
    } catch (error) {
      session.transitioning = false
      if (session.group.state().destroyed) {
        this.finish(session, error)
        return
      }
      this.callbacks.onError(error)
    }
  }

  /** Prepare followers only when they join, keeping the focused snapshot on failure. */
  private async expandScope(session: Session): Promise<void> {
    const previous = session.group!
    const state = previous.state()
    const entering = session.members.filter((member) => member.id !== session.ownerId)
    try {
      this.assertCurrent(session)
      session.transitioning = true
      this.phase = 'loading'
      previous.pause()
      if (this.session !== session) return
      this.groupState = previous.state()
      this.publish()
      const preparations = await Promise.allSettled(
        entering.map(async (member) => {
          if (this.session !== session) return
          session.started.add(member)
          const prepared = await member.terminal.prepareReplayMember({
            id: member.id,
            sessionId: session.id,
            signal: session.abort.signal,
          })
          if (this.session !== session || !session.transitioning) {
            member.terminal.restoreReplayMember(session.id)
            return
          }
          if (prepared.member.id !== member.id || !prepared.isCurrent())
            throw new Error('Chart history changed. Start a new replay from the current charts.')
          session.prepared.set(member.id, prepared)
        })
      )
      if (this.session !== session) return
      const rejected = preparations.find((result) => result.status === 'rejected')
      if (rejected?.status === 'rejected') throw rejected.reason
      this.assertCurrent(session, true)
      previous.destroy()
      session.group = null
      for (const member of session.members) {
        if (this.session !== session) return
        session.held.add(member.id)
        member.terminal.setReplayParticipation(session.id, true)
      }
      if (this.session !== session) return
      const group = new ReplayGroup(
        session.members.map((member) => session.prepared.get(member.id)!.member),
        {
          scope: 'all',
          focusedId: session.ownerId,
          startTime: state.time ?? undefined,
          speed: state.speed,
          onChange: (next) => this.changed(session, next),
        }
      )
      if (this.session !== session) {
        group.destroy()
        return
      }
      session.group = group
      session.transitioning = false
      this.phase = 'active'
      this.changed(session, group.state())
      if (this.session === session && state.playing && !this.externalClock)
        group.play({ speed: state.speed })
    } catch (error) {
      if (this.session !== session) return
      session.transitioning = false
      let restoreFailed = false
      for (const member of entering) {
        if (this.session !== session) return
        try {
          member.terminal.restoreReplayMember(session.id)
          session.held.delete(member.id)
          session.prepared.delete(member.id)
        } catch {
          restoreFailed = true
        }
      }
      if (this.session !== session) return
      try {
        this.assertCurrent(session)
      } catch {
        restoreFailed = true
      }
      if (!restoreFailed && (!session.group || session.group.state().destroyed)) {
        try {
          this.assertCurrent(session)
          session.transitioning = true
          session.group = new ReplayGroup([session.prepared.get(session.ownerId)!.member], {
            scope: 'focused',
            focusedId: session.ownerId,
            startTime: state.time ?? undefined,
            speed: state.speed,
            onChange: (next) => this.changed(session, next),
          })
          if (this.session !== session) {
            session.group.destroy()
            return
          }
          session.transitioning = false
        } catch {
          restoreFailed = true
        }
      }
      if (restoreFailed) {
        this.finish(session, error)
        return
      }
      this.phase = 'active'
      this.changed(session, session.group!.state())
      this.callbacks.onError(error)
    }
  }

  play(speed?: number): void {
    this.control((group) => group.play(speed === undefined ? undefined : { speed }))
  }
  pause(): void {
    this.control((group) => group.pause())
  }
  step(): void {
    this.control((group) => group.step())
  }
  stepBack(): void {
    this.control((group) => group.stepBack())
  }
  seek(index: number): void {
    this.control((group) => group.seek(index))
  }

  private control(action: (group: ReplayGroup) => void): void {
    if (this.externalClock) return
    const session = this.session
    if (!session?.group || this.closing || this.phase === 'loading') return
    try {
      this.assertCurrent(session)
    } catch (error) {
      this.finish(session, error)
      return
    }
    try {
      action(session.group)
    } catch (error) {
      if (session.group.state().destroyed) this.finish(session, error)
      else this.callbacks.onError(error)
    }
  }

  private assertCurrent(session: Session, all = this.scope === 'all'): void {
    if (
      [...session.prepared].some(
        ([id, prepared]) => (all || id === session.ownerId) && !prepared.isCurrent()
      )
    ) {
      throw new Error('Chart history changed. Start a new replay from the current charts.')
    }
  }

  private preview(session: Session, clear = false): void {
    for (const member of session.members) {
      if (this.session !== session) return
      if (member.id !== session.ownerId) {
        member.terminal.setWorkspaceReplayPreview(
          clear || this.scope !== 'all' ? null : session.previewTime
        )
      }
    }
  }

  private changed(session: Session, state: ReplayGroupState): void {
    if (this.session !== session || session.transitioning) return
    if (state.destroyed) {
      this.finish(session)
      return
    }
    try {
      for (const member of session.members) {
        if (this.session !== session) return
        const frame = state.members.find((value) => value.id === member.id)
        if (!frame?.active && session.held.has(member.id)) {
          member.terminal.restoreReplayMember(session.id)
          session.held.delete(member.id)
        }
        if (this.session !== session) return
        member.terminal.setReplayParticipation(
          session.id,
          frame?.active ?? false,
          frame?.state,
          state.time ?? undefined
        )
      }
      if (this.session !== session) return
      this.scope = state.scope
      this.groupState = state
      this.publish()
    } catch (error) {
      this.finish(session, error)
    }
  }

  stop(): void {
    this.externalClock = false
    if (this.session && !this.closing) this.finish(this.session)
  }

  private finish(session: Session, failure?: unknown): void {
    if (this.session !== session || this.closing) return
    this.closing = true
    this.session = null
    const attempt = (action: () => void) => {
      try {
        action()
      } catch (error) {
        failure ??= error
      }
    }
    attempt(() => session.group?.destroy())
    attempt(() => session.abort.abort())
    for (const member of session.members) {
      if (member.id !== session.ownerId)
        attempt(() => member.terminal.setWorkspaceReplayPreview(null))
      attempt(() => member.terminal.cancelReplayPick())
      if (session.started.has(member))
        attempt(() => member.terminal.restoreReplayMember(session.id))
    }
    // Keep every workspace route locked until all restoration attempts finish.
    for (const member of session.members)
      attempt(() => member.terminal.setWorkspaceReplayLocked(false))
    this.groupState = null
    this.phase = 'idle'
    this.closing = false
    attempt(() => this.notifyPick())
    attempt(() => this.publish())
    if (failure !== undefined) this.callbacks.onError(failure)
  }

  destroy(): void {
    if (this.destroyed) return
    this.destroyed = true
    this.stop()
    this.pickListeners.clear()
    let failure: unknown
    for (const member of this.members) {
      try {
        member.terminal.setReplayInvalidationHandler(null)
      } catch (error) {
        failure ??= error
      }
    }
    this.members = []
    if (failure !== undefined) this.callbacks.onError(failure)
  }

  /**
   * Listen for the start bar moving under the pointer while one is chosen.
   *
   * Kept out of the snapshot on purpose: the snapshot reaches every pane, and
   * a crosshair sweep would re-render all of them for a label that only the
   * replay bar shows.
   */
  subscribePick(listener: () => void): () => void {
    this.pickListeners.add(listener)
    return () => {
      this.pickListeners.delete(listener)
    }
  }

  private notifyPick(): void {
    for (const listener of [...this.pickListeners]) listener()
  }

  private publish(): void {
    this.callbacks.onChange(this.state())
  }
}
