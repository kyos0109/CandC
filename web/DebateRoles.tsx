import type { DiscussionInput } from '../src/domain';

type Side = 'support' | 'oppose' | 'custom';
const positions = {
  support: 'Support the proposition stated in the debate topic. Present the strongest evidence-based case for it, address objections, and acknowledge material limitations. Do not invent evidence or agreement.',
  oppose: 'Oppose the proposition stated in the debate topic. Present the strongest evidence-based objections and alternatives, address supporting arguments, and acknowledge material limitations. Do not invent evidence or agreement.',
};
const separator = '\n\nAdditional persona or requirements:\n';
export const defaultDebateRoles = { codex: positions.support, claude: positions.oppose };

function describe(role: string): { side: Side; persona: string } {
  for (const side of ['support', 'oppose'] as const) {
    if (role === positions[side] || role.startsWith(positions[side] + separator)) {
      return { side, persona: role.slice(positions[side].length + separator.length) };
    }
  }
  return { side: 'custom', persona: role };
}
export const debateSide = (role: string) => ({ support: '支持方', oppose: '反對方', custom: '自訂立場' })[describe(role).side];
const build = (side: Side, persona: string) => side === 'custom' ? persona : positions[side] + (persona.trim() ? separator + persona : '');

export function DebateRoles({ roles, onChange, disabled = false }: { roles: DiscussionInput['roles']; onChange: (roles: DiscussionInput['roles']) => void; disabled?: boolean }) {
  return <div className="debate-roles"><p className="muted">依討論題目分配支持與反對立場。人設、語氣或額外要求可留白；已有自訂立場也可以保留。</p><div className="grid-two">{(['codex', 'claude'] as const).map(agent => {
    const role = describe(roles[agent]);
    const peer = agent === 'codex' ? 'claude' : 'codex';
    return <fieldset key={agent}><legend>{agent === 'codex' ? 'Codex' : 'Claude'}</legend>
      <label>立場<select aria-label={`${agent === 'codex' ? 'Codex' : 'Claude'} 立場方向`} disabled={disabled} value={role.side} onChange={event => {
        const side = event.target.value as Side;
        onChange({ ...roles, [agent]: build(side, role.persona), ...(side === 'custom' ? {} : { [peer]: build(side === 'support' ? 'oppose' : 'support', describe(roles[peer]).persona) }) });
      }}><option value="support">支持方</option><option value="oppose">反對方</option><option value="custom">自訂立場</option></select></label>
      <label>{role.side === 'custom' ? '自訂立場' : '人設或補充要求（選填）'}<textarea aria-label={`${agent === 'codex' ? 'Codex' : 'Claude'} 立場`} rows={2} maxLength={role.side === 'custom' ? 4000 : 3000} disabled={disabled} value={role.persona} onChange={event => onChange({ ...roles, [agent]: build(role.side, event.target.value) })} placeholder={role.side === 'custom' ? '描述這位 AI 應採取的立場。' : '例如：務實的工程主管、尖銳但講證據；也可以留白。'}/></label>
    </fieldset>;
  })}</div></div>;
}
