// Abstract roles. Engine cares about team + ability, themes only rename them (client side).
export const ROLES = {
  killer:    { team: 'evil',    order: 10, night: true }, // werewolf / mafioso
  protector: { team: 'good',    order: 15, night: true }, // doctor / bodyguard
  inspector: { team: 'good',    order: 20, night: true }, // seer / detective
  hunter:    { team: 'good',    order: 30 }, // shoots on death
  jester:    { team: 'neutral', order: 40 }, // wins if lynched
  townsfolk: { team: 'good',    order: 99 },
};

export function defaultRoles(n) {
  const r = { killer: Math.max(1, Math.floor(n / 4)) };
  if (n >= 6) { r.inspector = 1; r.protector = 1; }
  return r;
}

// roles: {roleId: count}; remainder becomes townsfolk. Returns error string or null.
export function validateRoles(roles, n) {
  let total = 0;
  for (const [id, c] of Object.entries(roles)) {
    if (!ROLES[id] || id === 'townsfolk') return `unknown role ${id}`;
    if (!Number.isInteger(c) || c < 0 || c > 10) return `bad count for ${id}`;
    total += c;
  }
  if (total > n) return 'more roles than players';
  if ((roles.killer || 0) < 1) return 'need at least one killer';
  if ((roles.killer || 0) * 2 >= n) return 'killers must be under half of players';
  return null;
}
