import crypto from 'node:crypto';
import 'dotenv/config';
import { log } from './logger.js';

const PORT = +process.env.PORT || 8080;
const ALLOWED_ORIGIN = process.env.ALLOWED_ORIGIN || '';
const SIM_KEY = process.env.SIM_KEY || '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID || '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET || '';
const GOOGLE_REDIRECT_URI = process.env.GOOGLE_REDIRECT_URI || `http://localhost:${PORT}/auth/google/callback`;
const SESSION_SECRET = process.env.SESSION_SECRET || '';
const ADMIN_EMAILS = new Set((process.env.ADMIN_EMAILS || '').split(',').map((email) => email.trim().toLowerCase()).filter(Boolean));
const MIN_PLAYERS = +process.env.MIN_PLAYERS || 4;
const MAX_ROOMS = 50;
const MAX_PLAYERS = 20;
const ALPHA = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const THEMES = new Set(['werewolf', 'mafia']);
const GM_WORDS = ['amber', 'birch', 'cabin', 'cinder', 'clover', 'coral', 'dawn', 'ember', 'harbor', 'lunar', 'maple', 'meadow', 'orbit', 'pebble', 'river', 'thistle'];

if (!ALLOWED_ORIGIN) log('warn', 'ALLOWED_ORIGIN not set: cross-origin access is unrestricted (dev only)');

const token = () => crypto.randomBytes(16).toString('hex');
const newCode = () => Array.from({ length: 4 }, () => ALPHA[crypto.randomInt(ALPHA.length)]).join('');

export {
  ADMIN_EMAILS, ALLOWED_ORIGIN, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REDIRECT_URI,
  GM_WORDS, MAX_PLAYERS, MAX_ROOMS, MIN_PLAYERS, PORT, SESSION_SECRET, SIM_KEY, THEMES,
  newCode, token,
};
