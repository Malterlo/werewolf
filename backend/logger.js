import crypto from 'node:crypto';

const requestId = () => crypto.randomUUID();

function log(level, message, fields = {}) {
  const entry = { time: new Date().toISOString(), level, message, ...fields };
  const output = level === 'error' ? console.error : level === 'warn' ? console.warn : console.log;
  output(JSON.stringify(entry));
}

export { log, requestId };
