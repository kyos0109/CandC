export type Participant = { id: string; name: string; symbol: string; role?: string; model?: string; effort?: string };
export const human: Participant = { id: 'user', name: '你', symbol: '你' };
export function participantsFromAgents(agents: Record<string, { model: string; effort: string; name?: string; symbol?: string; role?: string }>): Participant[] {
  const known: Record<string, { name: string; symbol: string }> = { codex: { name: 'Codex', symbol: 'C' }, claude: { name: 'Claude', symbol: 'A' } };
  return [human, ...Object.entries(agents).map(([id, agent]) => ({ id, name: agent.name ?? known[id]?.name ?? id,
    symbol: agent.symbol ?? known[id]?.symbol ?? id.slice(0, 1).toUpperCase(), model: agent.model, effort: agent.effort,
    ...(agent.role ? { role: agent.role } : {}) }))];
}
export function Avatar({ participant }: { participant: Participant }) {
  return <span className={`message-avatar ${participant.id}`} aria-hidden="true">{participant.symbol}</span>;
}
export function ParticipantList({ participants }: { participants: Participant[] }) {
  return <ul className="participant-list">{participants.map(p => <li key={p.id}><Avatar participant={p}/><div><strong>{p.name}</strong>{p.role && <small>{p.role}</small>}{p.model && <small>{p.model} · {p.effort}</small>}</div></li>)}</ul>;
}
// A host process notice is presentation only; it does not orchestrate providers.
export function ProcessNotice({ children }: { children: React.ReactNode }) { return <div className="process-notice" role="status">{children}</div>; }
