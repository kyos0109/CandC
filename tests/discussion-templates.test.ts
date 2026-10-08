import { afterEach, describe, expect, it } from 'vitest';
import { applyDiscussionTemplate, discussionTemplates, emptyTemplateOrigins, retainTemplateSeats } from '../web/discussion-templates.js';
import { setLocale } from '../web/i18n.js';
import { roomInputSchema, type RoomInput } from '../src/room-contract.js';

afterEach(() => setLocale('zh-TW'));
const draft = (count = 2) => ({
  goal: '', kind: 'discussion' as RoomInput['kind'], mode: 'manual' as RoomInput['mode'], topic: 'Keep this topic.', constraints: 'Keep these constraints.',
  seats: Array.from({ length: count }, (_, index) => ({ uid: index + 10, label: '', stance: '', provider: 'codex' as const, model: `model-${index}`, effort: 'high' as const, side: '' })),
  backend: 'live', flow: 'alternating', singleSentence: true, files: ['evidence.txt'], optionCount: 5,
  host: true, hostProvider: 'claude', hostSettings: { model: 'host-model', effort: 'low' }, hostJudge: true,
  research: true, roots: ['fixture-root'], limits: { maxRounds: 9, maxDurationMs: 60000, turnTimeoutMs: 5000, maxModeratorCalls: 8 },
});
const select = (id: string) => discussionTemplates().find(t => t.id === id)!;

describe('optional discussion templates', () => {
  it('provides the six agreed scenarios and execution defaults', () => {
    expect(discussionTemplates().map(t => [t.name, t.kind, t.mode])).toEqual([
      ['Decision Lab', 'discussion', 'conclusion'], ['Engineering Review', 'discussion', 'conclusion'],
      ['Research Council', 'discussion', 'conclusion'], ['Incident War Room', 'discussion', 'manual'],
      ['Code Review Board', 'discussion', 'conclusion'], ['Simulation Arena', 'discussion', 'manual'],
    ]);
    expect(new Set(discussionTemplates().map(t => t.id)).size).toBe(6);
  });

  for (const count of [2, 3, 4]) it.each(discussionTemplates().map(t => [t.id]))(`applies %s to exactly ${count} seats and satisfies the existing input schema`, id => {
    const template = select(id!), result = applyDiscussionTemplate(draft(count), template, emptyTemplateOrigins());
    expect(result.draft.goal).toBe(template.goal); expect(result.draft.kind).toBe('discussion'); expect(result.draft.mode).toBe(template.mode);
    expect(result.draft.seats).toHaveLength(count);
    expect(result.draft.seats.map(s => [s.label, s.stance])).toEqual(template.roles.slice(0, count).map(r => [r.label, r.stance]));
    expect(result.origins).toMatchObject({ goal: 'template', kind: 'template', mode: 'template' });
    for (const seat of result.draft.seats) expect(result.origins.seats[seat.uid]).toEqual({ label: 'template', stance: 'template' });
    expect(roomInputSchema.safeParse({ behaviorVersion: 3, topic: result.draft.topic, goal: result.draft.goal, kind: result.draft.kind, mode: result.draft.mode,
      participants: result.draft.seats.map(s => ({ id: `codex-${s.uid}`, provider: s.provider, role: 'speaker', label: s.label, instructions: s.stance, settings: { model: s.model, effort: s.effort } })),
      limits: result.draft.limits }).success).toBe(true);
  });

  it('switches between every pair and is idempotent when reapplied', () => {
    for (const first of discussionTemplates()) for (const second of discussionTemplates()) {
      const applied = applyDiscussionTemplate(draft(4), first, emptyTemplateOrigins());
      const switched = applyDiscussionTemplate(applied.draft, second, applied.origins);
      expect(switched.draft.goal).toBe(second.goal); expect(switched.draft.mode).toBe(second.mode);
      expect(switched.draft.seats.map(s => s.label)).toEqual(second.roles.map(r => r.label));
      expect(applyDiscussionTemplate(switched.draft, second, switched.origins)).toEqual(switched);
    }
  });

  it.each(['A manually written goal.', ''])('preserves a manually edited goal, including intentional clearing (%j)', goal => {
    const first = applyDiscussionTemplate(draft(), select('decision-lab'), emptyTemplateOrigins());
    first.draft.goal = goal; first.origins.goal = 'user';
    const next = applyDiscussionTemplate(first.draft, select('engineering-review'), first.origins);
    expect(next.draft.goal).toBe(goal); expect(next.origins.goal).toBe('user');
    expect(next.draft.seats[0]!.label).toBe('軟體／系統架構師');
  });

  it('protects edits made before the first template without inferring origin from value', () => {
    const form = draft(), origins = emptyTemplateOrigins();
    origins.goal = 'user'; origins.kind = 'user'; origins.mode = 'user';
    const next = applyDiscussionTemplate(form, select('decision-lab'), origins);
    expect(next.draft.goal).toBe(''); expect(next.draft.kind).toBe('discussion'); expect(next.draft.mode).toBe('manual');
    expect(next.origins.goal).toBe('user'); expect(next.origins.mode).toBe('user');
  });

  it.each(['manual', 'auto', 'conclusion'] as const)('preserves manually chosen debate and %s mode', mode => {
    const form = draft(), origins = emptyTemplateOrigins(); form.kind = 'debate'; form.mode = mode;
    form.seats[0]!.side = 'support'; form.seats[1]!.side = 'oppose'; origins.kind = 'user'; origins.mode = 'user';
    const next = applyDiscussionTemplate(form, select('simulation-arena'), origins);
    expect(next.draft.kind).toBe('debate'); expect(next.draft.mode).toBe(mode);
    expect(next.draft.seats.map(s => s.side)).toEqual(['support', 'oppose']);
  });

  it('preserves independently edited labels and instructions, including empty text', () => {
    const first = applyDiscussionTemplate(draft(3), select('decision-lab'), emptyTemplateOrigins());
    first.draft.seats[0]!.label = ''; first.origins.seats[10]!.label = 'user';
    first.draft.seats[1]!.stance = 'My own task.'; first.origins.seats[11]!.stance = 'user';
    first.draft.seats[2]!.stance = ''; first.origins.seats[12]!.stance = 'user';
    const next = applyDiscussionTemplate(first.draft, select('engineering-review'), first.origins);
    expect(next.draft.seats.map(s => s.label)).toEqual(['', 'SRE／維運', '安全審查員']);
    expect(next.draft.seats[0]!.stance).toBe(select('engineering-review').roles[0]!.stance);
    expect(next.draft.seats[1]!.stance).toBe('My own task.'); expect(next.draft.seats[2]!.stance).toBe('');
  });

  it('tracks edits by UID through removal, reordering, addition and explicit reapplication', () => {
    const first = applyDiscussionTemplate(draft(3), select('decision-lab'), emptyTemplateOrigins());
    first.draft.seats[1]!.label = 'Keep UID 11'; first.origins.seats[11]!.label = 'user';
    first.origins.seats[10]!.stance = 'user';
    const added = { ...draft().seats[0]!, uid: 99 };
    first.draft.seats = [first.draft.seats[2]!, first.draft.seats[1]!, added];
    const retained = retainTemplateSeats(first.origins, first.draft.seats);
    expect(retained.seats[10]).toBeUndefined(); expect(retained.seats[99]).toBeUndefined(); expect(added.label).toBe('');
    const next = applyDiscussionTemplate(first.draft, select('engineering-review'), retained);
    expect(next.draft.seats.map(s => [s.uid, s.label])).toEqual([[12, '軟體／系統架構師'], [11, 'Keep UID 11'], [99, '安全審查員']]);
    expect(next.draft.seats[0]!.stance).toBe(select('engineering-review').roles[0]!.stance);
  });

  it('does not transfer retired edits when a seat preset replaces every UID', () => {
    const first = applyDiscussionTemplate(draft(), select('decision-lab'), emptyTemplateOrigins());
    first.origins.seats[10]!.label = 'user';
    const replaced = { ...first.draft, seats: draft(4).seats.map(s => ({ ...s, uid: s.uid + 100 })) };
    const origins = retainTemplateSeats(first.origins, replaced.seats);
    expect(origins.seats).toEqual({}); expect(replaced.seats.every(s => s.label === '' && s.stance === '')).toBe(true);
    expect(applyDiscussionTemplate(replaced, select('decision-lab'), origins).draft.seats[0]!.label).toBe('方案分析');
  });

  it('preserves every unmanaged field and never mutates its inputs', () => {
    const form = draft(4), origins = emptyTemplateOrigins(), before = structuredClone({ form, origins });
    const result = applyDiscussionTemplate(form, select('research-council'), origins);
    expect({ form, origins }).toEqual(before);
    const unmanaged = (value: typeof form) => ({ ...value, goal: '', kind: 'discussion', mode: 'manual', seats: value.seats.map(s => ({ ...s, label: '', stance: '' })) });
    expect(unmanaged(result.draft)).toEqual(unmanaged(form));
    expect(Object.keys(result.draft).sort()).toEqual(Object.keys(form).sort());
  });

  it('refuses any partial application to selection, including its hidden mode draft', () => {
    const form = draft(), origins = emptyTemplateOrigins(); form.kind = 'selection'; form.mode = 'auto';
    const next = applyDiscussionTemplate(form, select('simulation-arena'), origins);
    expect(next.draft).toBe(form); expect(next.origins).toBe(origins);
  });

  it('keeps a localized snapshot through language changes and reapplication', () => {
    const snapshot = select('decision-lab'), first = applyDiscussionTemplate(draft(), snapshot, emptyTemplateOrigins());
    setLocale('en'); expect(select('decision-lab').goal).not.toBe(snapshot.goal);
    expect(applyDiscussionTemplate(first.draft, snapshot, first.origins)).toEqual(first);
    expect(first.draft.seats[0]!.label).toBe('方案分析');
    const next = applyDiscussionTemplate(first.draft, select('research-council'), first.origins);
    expect(next.draft.seats[0]!.label).toBe('Claims and Evidence');
  });

  it('explicit reset replaces user-managed fields while preserving all other settings and the undo source', () => {
    const first = applyDiscussionTemplate(draft(4), select('decision-lab'), emptyTemplateOrigins());
    first.draft.goal = ''; first.draft.kind = 'debate'; first.draft.mode = 'auto';
    first.origins.goal = 'user'; first.origins.kind = 'user'; first.origins.mode = 'user';
    first.draft.seats[0]!.label = 'Custom'; first.draft.seats[1]!.stance = '';
    first.origins.seats[10]!.label = 'user'; first.origins.seats[11]!.stance = 'user';
    const before = structuredClone(first), template = select('decision-lab');
    const reset = applyDiscussionTemplate(first.draft, template, first.origins, true);
    expect(first).toEqual(before);
    expect(reset.draft).toEqual({ ...first.draft, goal: template.goal, kind: template.kind, mode: template.mode,
      seats: first.draft.seats.map((seat, index) => ({ ...seat, ...template.roles[index] })) });
    expect(reset.origins.goal).toBe('template'); expect(reset.origins.kind).toBe('template'); expect(reset.origins.mode).toBe('template');
    for (const seat of reset.draft.seats) expect(reset.origins.seats[seat.uid]).toEqual({ label: 'template', stance: 'template' });
    expect(applyDiscussionTemplate(reset.draft, template, reset.origins, true)).toEqual(reset);
  });

  it('explicit reset also refuses selection without altering its origins', () => {
    const form = draft(), origins = emptyTemplateOrigins(); form.kind = 'selection'; origins.kind = 'user';
    expect(applyDiscussionTemplate(form, select('decision-lab'), origins, true)).toEqual({ draft: form, origins });
  });

  it.each([
    ['zh-TW', ['軟體／系統架構師', 'SRE／維運', '安全審查員', '效能／成本審查員']],
    ['en', ['Software / System Architect', 'SRE / Operations', 'Security Reviewer', 'Performance / Cost Reviewer']],
  ] as const)('localizes Engineering Review roles in %s while retaining the inserted snapshot', (locale, labels) => {
    setLocale(locale);
    const snapshot = select('engineering-review'), first = applyDiscussionTemplate(draft(4), snapshot, emptyTemplateOrigins());
    expect(first.draft.seats.map(s => s.label)).toEqual(labels);
    setLocale(locale === 'en' ? 'zh-TW' : 'en');
    expect(applyDiscussionTemplate(first.draft, snapshot, first.origins).draft.seats.map(s => s.label)).toEqual(labels);
    expect(applyDiscussionTemplate(first.draft, select('engineering-review'), first.origins).draft.seats.map(s => s.label)).not.toEqual(labels);
  });

  it('provides complete English goals, descriptions and role instructions within field limits', () => {
    setLocale('en');
    for (const template of discussionTemplates()) {
      expect(template.goal.length).toBeLessThanOrEqual(32000); expect(template.goal).not.toMatch(/[\u3400-\u9fff]/);
      expect(template.description).not.toMatch(/[\u3400-\u9fff]/);
      for (const role of template.roles) {
        expect(role.label.length).toBeLessThanOrEqual(40); expect(role.label).not.toMatch(/[\u3400-\u9fff]/);
        expect(role.stance.length).toBeLessThanOrEqual(4000); expect(role.stance).not.toMatch(/[\u3400-\u9fff]/);
      }
    }
  });
});
