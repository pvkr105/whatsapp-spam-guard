const path = require('path');
const qrcode = require('qrcode-terminal');
const { Boom } = require('@hapi/boom');
const { baileys: baileysLogger } = require('./logger');

const AUTH_DIR = path.join(__dirname, '..', 'auth');
const RECONNECT_DELAY_MS = 5000;

async function startSocket({ botPhoneNumber, logger, onMessages, onStatus = () => {}, onConnected = () => {} }) {
  onStatus('connecting');
  const {
    default: makeWASocket,
    useMultiFileAuthState,
    DisconnectReason,
    Browsers,
    fetchLatestBaileysVersion,
  } = await import('@whiskeysockets/baileys');

  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  const { version } = await fetchLatestBaileysVersion();

  const sock = makeWASocket({
    version,
    auth: state,
    printQRInTerminal: false,
    browser: Browsers.ubuntu('Chrome'),
    logger: baileysLogger,
  });

  sock.ev.on('creds.update', saveCreds);

  sock.ev.on('connection.update', (update) => {
    const { connection, lastDisconnect, qr } = update;

    if (qr) {
      onStatus('connecting', 'waiting for QR scan');
      logger.info('Scan this QR code: WhatsApp > Linked Devices > Link a device');
      qrcode.generate(qr, { small: true });
    }

    if (connection === 'close') {
      const statusCode = lastDisconnect?.error instanceof Boom
        ? lastDisconnect.error.output?.statusCode
        : undefined;
      const loggedOut = statusCode === DisconnectReason.loggedOut || statusCode === DisconnectReason.badSession;

      logger.warn({ statusCode, loggedOut }, 'Connection closed');

      if (loggedOut) {
        onStatus('logged-out');
        logger.error('Logged out (or bad session) - delete the auth/ folder and re-pair manually by restarting the process.');
        return;
      }

      onStatus('reconnecting');
      setTimeout(() => {
        startSocket({ botPhoneNumber, logger, onMessages, onStatus, onConnected }).catch((err) => {
          logger.error({ err }, 'Reconnect attempt failed');
        });
      }, RECONNECT_DELAY_MS);
    } else if (connection === 'open') {
      onStatus('online');
      logger.info('Connected to WhatsApp');
      Promise.resolve(onConnected(sock)).catch((err) => {
        logger.error({ err }, 'onConnected handler failed');
      });
    }
  });

  sock.ev.on('messages.upsert', async ({ messages, type }) => {
    if (type !== 'notify' && type !== 'append') return;
    const isOffline = type === 'append';
    for (const msg of messages) {
      try {
        await onMessages(sock, msg, { isOffline });
      } catch (err) {
        logger.error({ err, key: msg.key }, 'Message handler failed');
      }
    }
  });

  return sock;
}

module.exports = { startSocket };
