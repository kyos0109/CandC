import { z } from 'zod';

// Delivery metadata describes the answer; it does not prescribe how to discuss a topic.
export const deliverySchema = z.object({
  status: z.enum(['complete', 'partial']),
  kind: z.enum(['answer', 'disagreement', 'undetermined']),
  basis: z.array(z.string().trim().min(1).max(4_000)).min(1).max(30),
}).strict();
export const conclusionReviewSchema = z.object({
  adequate: z.boolean(), reason: z.string().trim().min(1).max(4_000),
  gaps: z.array(z.string().trim().min(1).max(4_000)).max(30),
}).strict();
export type ConclusionDelivery = z.infer<typeof deliverySchema>;

export function deliveryProblem(action: { result: string; delivery?: ConclusionDelivery | undefined; unresolved: string[] }): string | null {
  if (!action.result.trim()) return 'The proposed result contains no answer. Supply the requested content before proposing delivery.';
  if (!action.delivery) return 'The proposed result has no delivery assessment or supporting basis. Produce the requested answer itself, with its basis and material limitations; choose a form appropriate to the original request.';
  if (action.delivery.status === 'partial' && !action.unresolved.some(text => text.trim()))
    return 'A partial result must identify what part of the requested answer remains missing.';
  return null;
}

export const conclusionPolicy = 'Deliver an answer to the original topic and goal, incorporating subsequent user clarifications without replacing the original request. Discussion methods, perspectives, length and answer form are chosen to suit the request; no domain, scenario, fixed stages, decision framework, preferred stance or predetermined verdict is imposed. User-requested perspectives and creative forms remain valid. A proposed result must contain the requested answer itself, understandable without reconstructing the transcript, with an appropriate basis and material limitations. Future work alone is insufficient unless the user requested a plan or next steps. Do not claim implementation or verification that did not occur. A conditional answer, reasoned disagreement or justified inability to determine an answer can be a complete response; do not manufacture certainty or unanimity. Mark a result partial when substantive requested content is still missing, and list those gaps in unresolved. In delivery, use status complete|partial, kind answer|disagreement|undetermined and basis (reasons, evidence, reasoning or fidelity to the requested form, as appropriate). Before confirming an exact proposal, independently assess whether its result actually answers the user request at the requested depth, retains material objections and is supported by the available record. Include review {adequate,reason,gaps}; disagreement with a position alone does not make a faithful account of that disagreement inadequate. If content is missing, set adequate false, explain the specific gaps and request revision rather than endorsing delivery. These assessments are model judgments, not proof of factual correctness. Do not force all unknowns to be resolved or require external research for every topic. Additional substantive corrections belong in a new proposal, not only in a confirmation message. User stop, manual boundaries, limits and storage barriers still apply; never schedule work beyond them.';
