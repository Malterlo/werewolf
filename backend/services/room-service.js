import { THEMES, MAX_ROOMS, MIN_PLAYERS, newCode, token } from '../config.js';
import { createRoom as makeRoom, restoreRoom } from '../domain/game.js';
import { loadRooms, removeRoom, saveRoom } from '../persistence/database.js';

function createRoom(rooms, theme) {
  if (rooms.size >= MAX_ROOMS) return null;
  let code;
  do code = newCode(); while (rooms.has(code));
  const room = makeRoom(code, THEMES.has(theme) ? theme : 'werewolf', token());
  rooms.set(code, room);
  saveRoom(room, 'create');
  return room;
}

function restoreRooms(rooms) {
  for (const saved of loadRooms()) {
    const room = restoreRoom(saved);
    rooms.set(room.code, room);
  }
}

function deleteRoom(rooms, code) {
  rooms.delete(code);
  removeRoom(code);
}

export { createRoom, deleteRoom, restoreRooms, MIN_PLAYERS };
