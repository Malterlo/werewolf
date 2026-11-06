import { defaultRoles } from '../../shared/roles.js';
import { MIN_PLAYERS } from '../config.js';
import { ROLES, tally, winCheck } from '../domain/game.js';

function viewFor(r, who) {
  const list = [...r.players.values()];
  const shown = new Set(r.revealOrder.slice(0, r.revealCount));
  const done = r.phase === 'over' && r.revealCount >= r.revealOrder.length;
  const base = {
    code: r.code, theme: r.theme, phase: r.phase, round: r.round, log: r.log.slice(-40),
    inPlay: r.dealt ? [...new Set(list.map((p) => p.role))].sort() : [],
    reveal: r.phase === 'over' ? { shown: r.revealCount, total: r.revealOrder.length } : null,
  };
  if (who.role === 'gm') {
    const steps = !r.dealt ? [] : Object.keys(ROLES).filter((id) => ROLES[id].night && list.some((p) => p.role === id))
      .sort((a, b) => ROLES[a].order - ROLES[b].order).map((id) => ({
        role: id, closed: !!r.night.closed[id],
        holders: list.filter((p) => p.role === id).map((p) => ({ id: p.id, name: p.name, alive: p.alive, pick: r.night.picks[p.id] || null })),
        tally: id === 'killer' ? tally(r) : null,
      }));
    return {
      ...base, you: 'gm', winner: r.winner, roles: r.roles || defaultRoles(Math.max(list.length, MIN_PLAYERS)),
      hunterPending: r.hunterPending, suggest: winCheck(r), canUndo: r.history.length > 0, catalog: Object.keys(ROLES),
      night: { open: r.night.open, steps },
      nextReveal: r.phase === 'over' && !done ? r.players.get(r.revealOrder[r.revealCount])?.name : null,
      players: list.map((p) => ({ id: p.id, name: p.name, alive: p.alive, role: p.role, seen: p.seen,
        team: p.role ? ROLES[p.role].team : null, online: r.sockets.has(p.id) })),
    };
  }
  const me = r.players.get(who.id);
  const acting = r.phase === 'night' && r.night.open && me.alive && me.role === r.night.open;
  const isKiller = me.role === 'killer';
  return {
    ...base, you: 'player', winner: done ? r.winner : null,
    me: { id: me.id, name: me.name, role: me.alive ? me.role : null, alive: me.alive, seen: me.seen },
    turn: acting ? {
      role: me.role, pick: r.night.picks[me.id] || null,
      mates: isKiller ? list.filter((p) => p.role === 'killer' && p.alive && p.id !== me.id)
        .map((p) => ({ id: p.id, name: p.name, pick: r.night.picks[p.id] || null })) : [],
      targets: list.filter((p) => p.alive && !(me.role === 'inspector' && p.id === me.id) && !(isKiller && p.role === 'killer'))
        .map((p) => ({ id: p.id, name: p.name })),
    } : null,
    players: list.map((p) => ({ id: p.id, name: p.name, alive: p.alive, role: shown.has(p.id) ? p.role : null })),
  };
}

export { viewFor };
