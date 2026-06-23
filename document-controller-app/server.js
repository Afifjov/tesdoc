const http = require("http");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const PORT = Number(process.env.PORT || 5178);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const DATA_DIR = path.join(ROOT, "data");
const DB_FILE = path.join(DATA_DIR, "db.json");
const FILE_DIR = path.join(DATA_DIR, "customer-files");
const PM_ATTACHMENT_DIR = path.join(DATA_DIR, "pm-attachments");
const ADMIN_ATTACHMENT_DIR = path.join(DATA_DIR, "admin-attachments");

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".pdf": "application/pdf"
};

function ensureStore() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.mkdirSync(FILE_DIR, { recursive: true });
  fs.mkdirSync(PM_ATTACHMENT_DIR, { recursive: true });
  fs.mkdirSync(ADMIN_ATTACHMENT_DIR, { recursive: true });
  if (!fs.existsSync(DB_FILE)) {
    writeDb({
      masterEquipment: [
        { id: "EQ-PRD-001", name: "Pressure Vessel A-100", area: "Process Area", discipline: "Mechanical" },
        { id: "EQ-PMP-024", name: "Transfer Pump P-024", area: "Utility", discipline: "Mechanical" },
        { id: "EQ-ELE-088", name: "MCC Panel 88", area: "Electrical Room", discipline: "Electrical" },
        { id: "EQ-INS-042", name: "Flow Transmitter FT-042", area: "Line 12", discipline: "Instrumentation" },
        { id: "EQ-PKG-310", name: "Skid Package 310", area: "Package Unit", discipline: "Package" }
      ],
      documents: [],
      outbox: []
    });
  }
}

function readDb() {
  ensureStore();
  return JSON.parse(fs.readFileSync(DB_FILE, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(DB_FILE, JSON.stringify(db, null, 2));
}

function stamp() {
  return new Date().toISOString();
}

function makeId(prefix) {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
}

function cleanFilename(name) {
  return String(name || "uploaded-file")
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, "_")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140) || "uploaded-file";
}

function normalizeHeader(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "_")
    .replace(/[^a-z0-9_]/g, "");
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    const next = text[i + 1];

    if (quoted) {
      if (char === '"' && next === '"') {
        cell += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      row.push(cell);
      cell = "";
    } else if (char === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else if (char !== "\r") {
      cell += char;
    }
  }

  row.push(cell);
  rows.push(row);
  return rows.filter(items => items.some(item => String(item).trim()));
}

function parseMasterEquipmentCsv(csvText) {
  const rows = parseCsv(String(csvText || "").replace(/^\uFEFF/, ""));
  if (rows.length < 2) {
    return { records: [], errors: ["CSV harus memiliki header dan minimal satu baris data."] };
  }

  const headers = rows[0].map(normalizeHeader);
  const aliases = {
    id: ["equipment_id", "equipmentid", "id", "no_doc_equipment", "doc_equipment", "equipment_no", "no_equipment"],
    name: ["equipment_name", "equipmentname", "name", "nama_equipment", "equipment"],
    area: ["area", "location", "lokasi"],
    discipline: ["discipline", "disiplin", "department", "dept"]
  };
  const index = Object.fromEntries(Object.entries(aliases).map(([key, names]) => [
    key,
    headers.findIndex(header => names.includes(header))
  ]));

  const errors = [];
  if (index.id < 0) errors.push("Kolom equipment_id wajib ada.");
  if (index.name < 0) errors.push("Kolom equipment_name wajib ada.");
  if (errors.length) return { records: [], errors };

  const seen = new Set();
  const records = [];
  rows.slice(1).forEach((rowData, offset) => {
    const line = offset + 2;
    const id = String(rowData[index.id] || "").trim().toUpperCase();
    const name = String(rowData[index.name] || "").trim();
    const area = index.area >= 0 ? String(rowData[index.area] || "").trim() : "";
    const discipline = index.discipline >= 0 ? String(rowData[index.discipline] || "").trim() : "";

    if (!id && !name) return;
    if (!id) errors.push(`Baris ${line}: equipment_id kosong.`);
    if (!name) errors.push(`Baris ${line}: equipment_name kosong.`);
    if (seen.has(id)) errors.push(`Baris ${line}: equipment_id ${id} duplikat di file import.`);
    seen.add(id);
    records.push({ id, name, area, discipline, updatedAt: stamp() });
  });

  return { records, errors };
}

function documentFolder(doc) {
  const safeDoc = cleanFilename(doc.docNo || doc.id).replace(/\s/g, "_");
  const folder = path.join(FILE_DIR, safeDoc);
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

function pmAttachmentFolder(doc) {
  const safeDoc = cleanFilename(doc.docNo || doc.id).replace(/\s/g, "_");
  const folder = path.join(PM_ATTACHMENT_DIR, safeDoc);
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

function adminAttachmentFolder(doc) {
  const safeDoc = cleanFilename(doc.docNo || doc.id).replace(/\s/g, "_");
  const folder = path.join(ADMIN_ATTACHMENT_DIR, safeDoc);
  fs.mkdirSync(folder, { recursive: true });
  return folder;
}

function saveDataUrlFile(file, folder, by) {
  if (!file.name || !file.dataUrl) return null;
  const [, base64] = String(file.dataUrl).split(",");
  if (!base64) return null;
  const originalName = cleanFilename(file.name);
  const storedName = `${Date.now()}-${crypto.randomBytes(2).toString("hex").toUpperCase()}-${originalName}`;
  const filepath = path.join(folder, storedName);
  fs.writeFileSync(filepath, Buffer.from(base64, "base64"));
  return {
    name: originalName,
    storedName,
    size: Number(file.size || 0),
    path: filepath,
    folder,
    by,
    uploadedAt: stamp()
  };
}

function sendJson(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", chunk => {
      raw += chunk;
      if (raw.length > 25 * 1024 * 1024) {
        reject(new Error("Request terlalu besar."));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error("Format JSON tidak valid."));
      }
    });
    req.on("error", reject);
  });
}

function publicDoc(doc) {
  return {
    ...doc,
    pmAttachments: (doc.pmAttachments || []).map(file => ({
      name: file.name,
      size: file.size,
      uploadedAt: file.uploadedAt,
      by: file.by,
      folder: file.folder
    })),
    adminAttachments: (doc.adminAttachments || []).map(file => ({
      name: file.name,
      size: file.size,
      uploadedAt: file.uploadedAt,
      by: file.by,
      folder: file.folder
    })),
    customerFiles: (doc.customerFiles || []).map(file => ({
      name: file.name,
      size: file.size,
      uploadedAt: file.uploadedAt,
      by: file.by,
      folder: file.folder
    }))
  };
}

async function handleApi(req, res, pathname) {
  try {
    if (req.method === "GET" && pathname === "/api/state") {
      const db = readDb();
      return sendJson(res, 200, {
        masterEquipment: db.masterEquipment,
        documents: db.documents.map(publicDoc),
        outbox: db.outbox,
        masterImports: db.masterImports || []
      });
    }

    if (req.method === "POST" && pathname === "/api/master-equipment/import") {
      const body = await parseBody(req);
      const mode = body.mode === "replace" ? "replace" : "upsert";
      const parsed = parseMasterEquipmentCsv(body.csvText);
      if (parsed.errors.length) {
        return sendJson(res, 400, { error: "Import master data gagal.", details: parsed.errors });
      }
      if (!parsed.records.length) {
        return sendJson(res, 400, { error: "Tidak ada data equipment valid untuk diimport." });
      }

      const db = readDb();
      const before = db.masterEquipment.length;
      if (mode === "replace") {
        db.masterEquipment = parsed.records;
      } else {
        const byId = new Map(db.masterEquipment.map(item => [item.id, item]));
        parsed.records.forEach(item => byId.set(item.id, { ...(byId.get(item.id) || {}), ...item }));
        db.masterEquipment = Array.from(byId.values()).sort((a, b) => a.id.localeCompare(b.id));
      }
      const after = db.masterEquipment.length;
      const importLog = {
        id: makeId("IMP"),
        filename: cleanFilename(body.filename || "master-equipment.csv"),
        mode,
        importedRows: parsed.records.length,
        before,
        after,
        by: String(body.by || "Admin"),
        at: stamp()
      };
      db.masterImports = [importLog, ...(db.masterImports || [])].slice(0, 20);
      writeDb(db);
      return sendJson(res, 200, { importLog, masterEquipment: db.masterEquipment });
    }

    if (req.method === "POST" && pathname === "/api/documents") {
      const body = await parseBody(req);
      if (!body.equipmentId || !body.title || !body.pmName) {
        return sendJson(res, 400, { error: "Equipment, judul dokumen, dan nama PM wajib diisi." });
      }
      const db = readDb();
      const equipment = db.masterEquipment.find(item => item.id === body.equipmentId);
      if (!equipment) return sendJson(res, 404, { error: "Master data equipment tidak ditemukan." });

      const seq = String(db.documents.length + 1).padStart(4, "0");
      const doc = {
        id: makeId("DOC"),
        docNo: `DOC-${equipment.id}-${seq}`,
        equipment,
        title: String(body.title).trim(),
        revision: String(body.revision || "A").trim(),
        priority: String(body.priority || "Normal"),
        pmName: String(body.pmName).trim(),
        notes: String(body.notes || "").trim(),
        status: "WAITING_ADMIN",
        adminDecision: null,
        customerRecipients: [],
        pmAttachments: [],
        adminAttachments: [],
        customerFiles: [],
        history: [
          { at: stamp(), actor: body.pmName, action: "Submitted by Project Manager", note: "Document registered from master equipment data." }
        ],
        createdAt: stamp(),
        updatedAt: stamp()
      };
      const pmFolder = pmAttachmentFolder(doc);
      const pmAttachments = [];
      for (const file of Array.isArray(body.attachments) ? body.attachments : []) {
        const saved = saveDataUrlFile(file, pmFolder, body.pmName);
        if (saved) pmAttachments.push(saved);
      }
      doc.pmAttachments = pmAttachments;
      if (pmAttachments.length) {
        doc.history.push({
          at: stamp(),
          actor: body.pmName,
          action: "PM attached document",
          note: `${pmAttachments.length} file(s) submitted to Admin.`
        });
      }
      db.documents.unshift(doc);
      writeDb(db);
      return sendJson(res, 201, { document: publicDoc(doc) });
    }

    if (req.method === "POST" && pathname.match(/^\/api\/documents\/[^/]+\/admin-decision$/)) {
      const id = decodeURIComponent(pathname.split("/")[3]);
      const body = await parseBody(req);
      const allowed = ["APPROVED", "REJECTED", "FORWARDED"];
      if (!allowed.includes(body.decision)) return sendJson(res, 400, { error: "Decision admin tidak valid." });

      const db = readDb();
      const doc = db.documents.find(item => item.id === id);
      if (!doc) return sendJson(res, 404, { error: "Dokumen tidak ditemukan." });

      doc.adminDecision = {
        decision: body.decision,
        by: String(body.by || "Admin"),
        note: String(body.note || "").trim(),
        at: stamp()
      };
      doc.status = body.decision === "APPROVED" ? "READY_FOR_CUSTOMER" : body.decision === "REJECTED" ? "RETURNED_TO_PM" : "FORWARDED";
      doc.updatedAt = stamp();
      doc.history.push({
        at: stamp(),
        actor: doc.adminDecision.by,
        action: `Admin ${body.decision.toLowerCase()}`,
        note: doc.adminDecision.note
      });
      writeDb(db);
      return sendJson(res, 200, { document: publicDoc(doc) });
    }

    if (req.method === "POST" && pathname.match(/^\/api\/documents\/[^/]+\/send-customer$/)) {
      const id = decodeURIComponent(pathname.split("/")[3]);
      const body = await parseBody(req);
      const db = readDb();
      const doc = db.documents.find(item => item.id === id);
      if (!doc) return sendJson(res, 404, { error: "Dokumen tidak ditemukan." });
      if (doc.status !== "READY_FOR_CUSTOMER") {
        return sendJson(res, 409, { error: "Dokumen harus approved admin sebelum dikirim ke customer." });
      }

      const recipients = Array.isArray(body.recipients) ? body.recipients : [];
      const normalized = recipients
        .map(item => ({
          id: makeId("CUS"),
          name: String(item.name || "").trim(),
          email: String(item.email || "").trim(),
          role: item.role === "decision" ? "decision" : "review",
          decision: item.role === "decision" ? "PENDING" : "REVIEW_ONLY",
          note: "",
          decidedAt: null
        }))
        .filter(item => item.name && item.email);

      if (!normalized.length) return sendJson(res, 400, { error: "Minimal satu customer wajib diisi." });

      const attachmentFolder = adminAttachmentFolder(doc);
      const savedAttachments = [];
      for (const file of Array.isArray(body.attachments) ? body.attachments : []) {
        const saved = saveDataUrlFile(file, attachmentFolder, String(body.by || "Admin"));
        if (saved) savedAttachments.push(saved);
      }

      doc.customerRecipients = normalized;
      doc.adminAttachments = [...(doc.adminAttachments || []), ...savedAttachments];
      doc.status = "SENT_TO_CUSTOMER";
      doc.updatedAt = stamp();
      doc.history.push({
        at: stamp(),
        actor: String(body.by || "Admin"),
        action: "Sent to external customer",
        note: `${normalized.length} customer recipient(s), ${savedAttachments.length} attachment(s).`
      });
      db.outbox.unshift({
        id: makeId("MAIL"),
        docId: doc.id,
        docNo: doc.docNo,
        subject: `Customer Review: ${doc.docNo} - ${doc.title}`,
        recipients: normalized,
        createdAt: stamp()
      });
      writeDb(db);
      return sendJson(res, 200, { document: publicDoc(doc) });
    }

    if (req.method === "POST" && pathname.match(/^\/api\/documents\/[^/]+\/customer-view$/)) {
      const id = decodeURIComponent(pathname.split("/")[3]);
      const body = await parseBody(req);
      const db = readDb();
      const doc = db.documents.find(item => item.id === id);
      if (!doc) return sendJson(res, 404, { error: "Dokumen tidak ditemukan." });
      const recipient = doc.customerRecipients.find(item => item.id === body.recipientId);
      if (!recipient) return sendJson(res, 404, { error: "Customer recipient tidak ditemukan." });

      recipient.viewedAt = recipient.viewedAt || stamp();
      if (doc.status === "SENT_TO_CUSTOMER") {
        doc.status = "CUSTOMER_UNDER_REVIEW";
        doc.history.push({
          at: stamp(),
          actor: recipient.email,
          action: "Customer opened document",
          note: "Status changed to under review."
        });
      }
      doc.updatedAt = stamp();
      writeDb(db);
      return sendJson(res, 200, { document: publicDoc(doc) });
    }

    if (req.method === "POST" && pathname.match(/^\/api\/documents\/[^/]+\/customer-decision$/)) {
      const id = decodeURIComponent(pathname.split("/")[3]);
      const body = await parseBody(req);
      const db = readDb();
      const doc = db.documents.find(item => item.id === id);
      if (!doc) return sendJson(res, 404, { error: "Dokumen tidak ditemukan." });
      const recipient = doc.customerRecipients.find(item => item.id === body.recipientId);
      if (!recipient) return sendJson(res, 404, { error: "Customer recipient tidak ditemukan." });
      if (recipient.role !== "decision") return sendJson(res, 403, { error: "Customer review hanya bisa melihat dokumen." });
      if (!["APPROVED", "REJECTED", "FORWARDED", "COMMENTED"].includes(body.decision)) {
        return sendJson(res, 400, { error: "Decision customer tidak valid." });
      }

      const savedFiles = [];
      for (const file of Array.isArray(body.files) ? body.files : []) {
        const folder = documentFolder(doc);
        const saved = saveDataUrlFile(file, folder, recipient.email);
        if (saved) savedFiles.push(saved);
      }

      recipient.decision = body.decision;
      recipient.note = String(body.note || "").trim();
      recipient.decidedAt = stamp();
      doc.customerFiles.push(...savedFiles);
      const decisionRecipients = doc.customerRecipients.filter(item => item.role === "decision");
      if (decisionRecipients.length && decisionRecipients.every(item => item.decision === "APPROVED")) {
        doc.status = "CUSTOMER_APPROVED";
      } else if (decisionRecipients.some(item => item.decision === "REJECTED")) {
        doc.status = "CUSTOMER_REJECTED";
      } else if (decisionRecipients.some(item => item.decision === "FORWARDED")) {
        doc.status = "CUSTOMER_FORWARDED";
      } else {
        doc.status = "CUSTOMER_UNDER_REVIEW";
      }
      doc.updatedAt = stamp();
      doc.history.push({
        at: stamp(),
        actor: recipient.email,
        action: `Customer ${body.decision.toLowerCase()}`,
        note: savedFiles.length ? `${savedFiles.length} file uploaded.` : recipient.note
      });
      writeDb(db);
      return sendJson(res, 200, { document: publicDoc(doc) });
    }

    return sendJson(res, 404, { error: "Endpoint tidak ditemukan." });
  } catch (error) {
    return sendJson(res, 500, { error: error.message || "Server error." });
  }
}

function serveStatic(req, res, pathname) {
  const requested = pathname === "/" ? "/index.html" : pathname;
  const filepath = path.normalize(path.join(PUBLIC_DIR, requested));
  if (!filepath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    return res.end("Forbidden");
  }
  fs.readFile(filepath, (error, data) => {
    if (error) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      return res.end("Not found");
    }
    res.writeHead(200, { "Content-Type": MIME[path.extname(filepath)] || "application/octet-stream" });
    res.end(data);
  });
}

ensureStore();

http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname.startsWith("/api/")) return handleApi(req, res, url.pathname);
  return serveStatic(req, res, url.pathname);
}).listen(PORT, () => {
  console.log(`Document Controller running at http://localhost:${PORT}`);
});
