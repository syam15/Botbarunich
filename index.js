const { default: makeWASocket, DisconnectReason, makeInMemoryStore, jidDecode, proto, getContentType, useMultiFileAuthState } = require("@whiskeysockets/baileys");
const pino = require("pino");
const { Boom } = require("@hapi/boom");
const fs = require("fs");
const readline = require("readline");
const PhoneNumber = require("awesome-phonenumber");

// Membuat penyimpanan in-memory untuk menangani event WhatsApp
const store = makeInMemoryStore({ logger: pino().child({ level: "silent", stream: "store" }) });

// Fungsi untuk memulai bot WhatsApp
async function startBotz() {
  // Menggunakan autentikasi multi-file
  const { state, saveCreds } = await useMultiFileAuthState("session");
  
  // Inisialisasi koneksi ke WhatsApp
  const ptz = makeWASocket({
    logger: pino({ level: "silent" }),
    printQRInTerminal: true, // Menampilkan QR code di terminal untuk login
    auth: state,
    connectTimeoutMs: 60000,
    defaultQueryTimeoutMs: 0,
    keepAliveIntervalMs: 10000,
    emitOwnEvents: true,
    fireInitQueries: true,
    generateHighQualityLinkPreview: true,
    syncFullHistory: true,
    markOnlineOnConnect: true,
    browser: ["Ubuntu", "Chrome", "20.0.04"],
  });

  // Menghubungkan store dengan event WhatsApp
  store.bind(ptz.ev);

  // Event handler untuk pesan masuk
  ptz.ev.on("messages.upsert", async (chatUpdate) => {
    try {
      let mek = chatUpdate.messages[0];
      if (!mek.message) return;
      mek.message = Object.keys(mek.message)[0] === "ephemeralMessage" ? mek.message.ephemeralMessage.message : mek.message;
      if (mek.key && mek.key.remoteJid === "status@broadcast") return;
      if (!ptz.public && !mek.key.fromMe && chatUpdate.type === "notify") return;
      if (mek.key.id.startsWith("BAE5") && mek.key.id.length === 16) return;
      let m = smsg(ptz, mek, store);
      require("./case")(ptz, m, chatUpdate, store);
    } catch (err) {
      console.log(err);
    }
  });

  // Event handler untuk pembaruan koneksi
  ptz.ev.on("connection.update", (update) => {
    const { connection, lastDisconnect } = update;
    if (connection === "close") {
      let reason = new Boom(lastDisconnect?.error)?.output.statusCode;
      if (
        reason === DisconnectReason.badSession ||
        reason === DisconnectReason.connectionClosed ||
        reason === DisconnectReason.connectionLost ||
        reason === DisconnectReason.connectionReplaced ||
        reason === DisconnectReason.restartRequired ||
        reason === DisconnectReason.timedOut
      ) {
        startBotz(); // Restart bot jika koneksi terputus
      } else if (reason === DisconnectReason.loggedOut) {
        console.log("Logged out. Please scan the QR code again.");
      } else {
        console.log(`Unknown DisconnectReason: ${reason}|${connection}`);
      }
    } else if (connection === "open") {
      console.log("[Connected] " + JSON.stringify(ptz.user.id, null, 2));
    }
  });

  // Menyimpan kredensial saat diperbarui
  ptz.ev.on("creds.update", saveCreds);

  return ptz;
}

// Fungsi untuk memformat pesan yang diterima
function smsg(ptz, m, store) {
  if (!m) return m;
  let M = proto.WebMessageInfo;
  if (m.key) {
    m.id = m.key.id;
    m.isBaileys = m.id.startsWith("BAE5") && m.id.length === 16;
    m.chat = m.key.remoteJid;
    m.fromMe = m.key.fromMe;
    m.isGroup = m.chat.endsWith("@g.us");
    m.sender = ptz.decodeJid(m.fromMe && ptz.user.id || m.participant || m.key.participant || m.chat || "");
    if (m.isGroup) m.participant = ptz.decodeJid(m.key.participant) || "";
  }
  if (m.message) {
    m.mtype = getContentType(m.message);
    m.msg = m.mtype == "viewOnceMessage" ? m.message[m.mtype].message[getContentType(m.message[m.mtype].message)] : m.message[m.mtype];
    m.body = m.message.conversation || m.msg.caption || m.msg.text;
  }
  return m;
}

// Menjalankan bot WhatsApp
startBotz();

// Memantau perubahan file dan me-restart jika ada perubahan
let file = require.resolve(__filename);
fs.watchFile(file, () => {
  fs.unwatchFile(file);
  console.log(`Update ${__filename}`);
  delete require.cache[file];
  require(file);
});
