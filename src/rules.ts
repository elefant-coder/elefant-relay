import { loadRules, saveRules, newId, type Mode, type Rule } from "./state.js";

export type Decision = { action: "allow" | "deny" | "ask"; rule?: Rule };

const active = (r: Rule, now: number): boolean => !r.until || Date.parse(r.until) > now;

/**
 * Pick the most specific active rule for (peer, mode).
 * Specific peer beats "*"; specific mode beats "*"; on a tie, deny wins.
 */
export function decide(peer: string, mode: Mode, rules: Rule[] = loadRules(), now = Date.now()): Decision {
  const score = (r: Rule): number => (r.peer === "*" ? 0 : 2) + (r.mode === "*" ? 0 : 1);
  const hits = rules.filter((r) => active(r, now) && (r.peer === "*" || r.peer === peer) && (r.mode === "*" || r.mode === mode));
  if (hits.length === 0) return { action: "ask" };
  hits.sort((a, b) => score(b) - score(a) || (a.action === "deny" ? -1 : 1) - (b.action === "deny" ? -1 : 1));
  const top = hits[0]!;
  return { action: top.action, rule: top };
}

export interface RuleInput { peer: string; mode: Mode | "*"; action: "allow" | "deny"; until?: string; note?: string }

/** Add a rule, replacing any existing rule for the same (peer, mode). */
export function setRule(input: RuleInput): Rule {
  if (input.until && Number.isNaN(Date.parse(input.until))) throw new Error(`"until" is not a date: ${input.until}`);
  const rules = loadRules().filter((r) => !(r.peer === input.peer && r.mode === input.mode));
  const rule: Rule = { id: newId(), ...input, created: new Date().toISOString() };
  if (!rule.until) delete rule.until;
  if (!rule.note) delete rule.note;
  rules.push(rule);
  saveRules(rules);
  return rule;
}

export function removeRule(idOrPeer: string): number {
  const rules = loadRules();
  const kept = rules.filter((r) => r.id !== idOrPeer && r.peer !== idOrPeer);
  saveRules(kept);
  return rules.length - kept.length;
}
