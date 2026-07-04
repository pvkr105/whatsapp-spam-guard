const fs = require('fs');
const path = require('path');
const pino = require('pino');

const LOG_DIR = path.join(__dirname, '..', 'logs');
if (!fs.existsSync(LOG_DIR)) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
}

const level = process.env.LOG_LEVEL || 'info';

// Both targets use pino-pretty so combined.log reads as plain text
// ("[2026-07-03 22:14:16] INFO (baileys): connected to WA") instead of raw JSON.
// Stdout is colorized for the terminal; the file isn't (color escape codes are just
// noise in a text editor). This is the detailed/technical log - see actionsLog.js
// and logs/actions.log for the plain-English record of what the bot actually did.
const stdoutTarget = {
  target: 'pino-pretty',
  options: { colorize: true, translateTime: 'yyyy-mm-dd HH:MM:ss', ignore: 'pid,hostname' },
  level,
};

const fileTarget = {
  target: 'pino-pretty',
  options: {
    colorize: false,
    translateTime: 'yyyy-mm-dd HH:MM:ss',
    ignore: 'pid,hostname',
    destination: path.join(LOG_DIR, 'combined.log'),
    mkdir: true,
  },
  level,
};

const logger = pino({ level }, pino.transport({ targets: [stdoutTarget, fileTarget] }));

// Baileys' internal logging (session churn, init-query timeouts, protocol retries)
// is essential when debugging against combined.log, but on the terminal it reads as
// alarming noise - AGENTS.md's "harmless noise" list is mostly Baileys error-level
// output that isn't actually fatal. So Baileys gets a logger that writes to
// combined.log only; the terminal stays reserved for this bot's own plain-language
// lines. Two transports appending to the same file is safe: each flush is a batch
// of complete lines through an O_APPEND handle, so lines never interleave mid-line.
const baileysLogger = pino({ level }, pino.transport({ targets: [fileTarget] })).child({ module: 'baileys' });

module.exports = logger;
module.exports.baileys = baileysLogger;
