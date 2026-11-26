import fs from 'node:fs';
import path from 'node:path';
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  jidDecode,
  useMultiFileAuthState,
  type WASocket,
  type WAMessage,
} from '@whiskeysockets/baileys';
import qrcode from 'qrcode-terminal';
import { childLogger, errMsg, logger } from '../util/logger.js';
import type { Sender } from './outbox.js';

const log = childLogger('whatsapp');

export interface WhatsAppOptions {
  dataDir: string;
  /** Main personal number that receives alerts and may send commands (digits only). */
  ownerNumber: string;
  /** Optional: the BOT's own number, to link with an 8-character pairing code instead of a QR. */
  pairingNumber?: string;
  onCommand: (text: string) => void;
  onOpen?: () => void;
}

/** Pulls the phone number out of a JID like "15195551234@s.whatsapp.net" or "15195551234:3@s.whatsapp.net". */
export function phoneFromJid(jid: string | undefined | null): string | null {
  if (!jid) return null;
  const d = jidDecode(jid);
  if (!d || d.server !== 's.whatsapp.net') return null; // LIDs (@lid) are not phone numbers
  return d.user;
}

/**
 * Decides whether an incoming message is a command from the owner.
 * Only 1:1 chats, never our own messages, and the sender's phone number must equal the owner's.
 * Newer WhatsApp versions may address the sender by LID; Baileys then puts the phone JID in remoteJidAlt.
 */
export function ownerCommandText(m: WAMessage, ownerNumber: string): string | null {
  const key = m.key;
  if (!key || key.fromMe) return null;
  const jid = key.remoteJid ?? '';
  if (jid.endsWith('@g.us') || jid.endsWith('@broadcast') || jid.endsWith('@newsletter')) return null;
  const senders = [phoneFromJid(jid), phoneFromJid(key.remoteJidAlt), phoneFromJid(key.participant), phoneFromJid(key.participantAlt)];
  if (!senders.includes(ownerNumber)) return null;
  const msg = m.message;
  const text = msg?.conversation ?? msg?.extendedTextMessage?.text ?? msg?.ephemeralMessage?.message?.extendedTextMessage?.text ?? null;
  return text?.trim() || null;
}

export class WhatsAppClient implements Sender {
  private sock: WASocket | undefined;
  private connected = false;
  private stopped = false;
  private retry = 0;
  private pairingRequested = false;
  private readonly authDir: string;
  private readonly ownerJid: string;
  connectedSince: number | null = null;
  lastDisconnectReason: string | null = null;

  constructor(private readonly opts: WhatsAppOptions) {
    this.authDir = path.join(opts.dataDir, 'whatsapp-auth');
    this.ownerJid = `${opts.ownerNumber}@s.whatsapp.net`;
  }

  isReady(): boolean {
    return this.connected && !!this.sock;
  }

  async send(text: string): Promise<void> {
    if (!this.sock || !this.connected) throw new Error('WhatsApp not connected');
    await this.sock.sendMessage(this.ownerJid, { text });
  }

  async start(): Promise<void> {
    this.stopped = false;
    await this.connect();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.connected = false;
    try {
      this.sock?.end(undefined);
    } catch {
      /* already closed */
    }
  }

  private async connect(): Promise<void> {
    fs.mkdirSync(this.authDir, { recursive: true });
    const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
    let version: [number, number, number] | undefined;
    try {
      version = (await fetchLatestBaileysVersion()).version;
    } catch {
      /* fall back to the library default */
    }

    const sock = makeWASocket({
      auth: state,
      version,
      browser: Browsers.ubuntu('Gold Alerts'),
      logger: logger.child({ mod: 'baileys' }, { level: 'warn' }) as never,
      markOnlineOnConnect: false,
      syncFullHistory: false,
    });
    this.sock = sock;

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('connection.update', async (u) => {
      const { connection, lastDisconnect, qr } = u;

      if (qr) {
        if (this.opts.pairingNumber && !this.pairingRequested) {
          this.pairingRequested = true;
          try {
            const code = await sock.requestPairingCode(this.opts.pairingNumber);
            log.warn(
              `\n\n=== LINK THE BOT NUMBER ===\nOn the BOT phone: WhatsApp > Settings > Linked devices > Link a device > "Link with phone number instead"\nEnter this code: ${code}\n`,
            );
          } catch (err) {
            log.error({ err: errMsg(err) }, 'could not get pairing code; falling back to QR');
            this.printQr(qr);
          }
        } else if (!this.opts.pairingNumber) {
          this.printQr(qr);
        }
      }

      if (connection === 'open') {
        this.connected = true;
        this.retry = 0;
        this.connectedSince = Date.now();
        this.lastDisconnectReason = null;
        log.info({ me: sock.user?.id }, 'WhatsApp connected');
        void this.checkOwnerNumber();
        this.opts.onOpen?.();
      }

      if (connection === 'close') {
        this.connected = false;
        this.connectedSince = null;
        const code = (lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)?.output?.statusCode;
        this.lastDisconnectReason = `${code ?? '?'} ${errMsg(lastDisconnect?.error ?? '')}`.trim();
        if (this.stopped) return;

        if (code === DisconnectReason.loggedOut) {
          log.error(
            '\n\n*** WhatsApp session LOGGED OUT (device removed or session expired). ***\n' +
              'Clearing the saved session — a NEW QR code will be printed below. Scan it again with the BOT number.\n',
          );
          fs.rmSync(this.authDir, { recursive: true, force: true });
          this.pairingRequested = false;
          setTimeout(() => void this.connect(), 2_000);
          return;
        }
        if (code === DisconnectReason.connectionReplaced) {
          log.error('Another WhatsApp Web session replaced this one. Retrying in 60s (close the other session if this repeats).');
          setTimeout(() => void this.connect(), 60_000);
          return;
        }
        const delay = code === DisconnectReason.restartRequired ? 500 : Math.min(60_000, 2_000 * 2 ** this.retry++);
        log.warn({ code, retryInMs: delay }, 'WhatsApp disconnected, reconnecting');
        setTimeout(() => void this.connect().catch((e) => log.error({ err: errMsg(e) }, 'reconnect failed')), delay);
      }
    });

    sock.ev.on('messages.upsert', ({ messages, type }) => {
      if (type !== 'notify') return;
      for (const m of messages) {
        const text = ownerCommandText(m, this.opts.ownerNumber);
        if (text) this.opts.onCommand(text);
      }
    });
  }

  private printQr(qr: string) {
    log.warn('\n\n=== SCAN THIS QR WITH THE *BOT* NUMBER\'s WhatsApp (Settings > Linked devices > Link a device) ===\n');
    qrcode.generate(qr, { small: true });
  }

  private async checkOwnerNumber() {
    try {
      const res = await this.sock?.onWhatsApp(this.opts.ownerNumber);
      if (res && res.length > 0 && !res[0]?.exists) {
        log.error({ number: this.opts.ownerNumber }, 'MY_WHATSAPP_NUMBER does not seem to be on WhatsApp — check the number in .env');
      }
    } catch {
      /* lookup is best-effort */
    }
  }
}
