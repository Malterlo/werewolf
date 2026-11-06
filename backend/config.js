import crypto from 'node:crypto';
import { log } from './logger.js';

const PORT = +process.env.PORT || 8080;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const HOST_KEY = process.env.HOST_KEY || '';
const MIN_PLAYERS = +process.env.MIN_PLAYERS || 4;
const MAX_ROOMS = 50;
const MAX_PLAYERS = 20;
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const THEMES = new Set(['werewolf', 'mafia']);

if (!HOST_KEY) log('warn', 'HOST_KEY not set: anyone can create rooms (dev only)');
if (!ALLOWED_ORIGIN) log('warn', 'ALLOWED_ORIGIN not set: cross-origin access is unrestricted (dev only)');

const token = () => crypto.randomBytes(16).toString('hex');
const newCode = () => Array.from({ length: 4 }, () => ALPHA[crypto.randomInt(ALPHA.length)]).join('');

export {
  ALLOWED_ORIGIN, HOST_KEY, MAX_PLAYERS, MAX_ROOMS, MIN_PLAYERS, PORT, THEMES,
  newCode, token,
};
