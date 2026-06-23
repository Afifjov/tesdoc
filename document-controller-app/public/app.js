const state = {
  masterEquipment: [],
  documents: [],
  outbox: [],
  masterImports: [],
  selectedMailId: null
};

const statusLabels = {
  WAITING_ADMIN: ["Waiting Admin", "warn"],
  READY_FOR_CUSTOMER: ["Ready for Customer", "info"],
  RETURNED_TO_PM: ["Returned to PM", "bad"],
  FORWARDED: ["Forwarded", "info"],
  SENT_TO_CUSTOMER: ["Sent to Customer", "info"],
  CUSTOMER_IN_REVIEW: ["Under Review", "warn"],
  CUSTOMER_UNDER_REVIEW: ["Under Review", "warn"],
  CUSTOMER_APPROVED: ["Customer Approved", ""],
  CUSTOMER_REJECTED: ["Customer Rejected", "bad"],
  CUSTOMER_FORWARDED: ["Customer Forwarded", "info"]
};

const $ = selector => document.querySelector(selector);
const $$ = selector => Array.from(document.querySelectorAll(selector));

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, char => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const details = Array.isArray(payload.details) ? ` ${payload.details.join(" ")}` : "";
    throw new Error(`${payload.error || "Request gagal."}${details}`);
  }
  return payload;
}

async function loadState() {
  const payload = await api("/api/state");
  Object.assign(state, payload);
  if (!state.selectedMailId && state.outbox[0]) state.selectedMailId = state.outbox[0].id;
  render();
}

function pill(status) {
  const [label, kind] = statusLabels[status] || [status, "neutral"];
  return `<span class="pill ${kind}">${label}</span>`;
}

function render() {
  renderMetrics();
  renderMaster();
  renderPmStatus();
  renderImportResult();
  renderAdmin();
  renderOutbox();
  renderCustomerAction();
  renderArchive();
}

function renderMetrics() {
  const counts = {
    total: state.documents.length,
    waiting: state.documents.filter(doc => doc.status === "WAITING_ADMIN").length,
    customer: state.documents.filter(doc => ["SENT_TO_CUSTOMER", "CUSTOMER_IN_REVIEW", "CUSTOMER_UNDER_REVIEW"].includes(doc.status)).length,
    approved: state.documents.filter(doc => doc.status === "CUSTOMER_APPROVED").length
  };
  $("#metrics").innerHTML = [
    ["Total Document", counts.total],
    ["Waiting Admin", counts.waiting],
    ["At Customer", counts.customer],
    ["Customer Approved", counts.approved]
  ].map(([label, value]) => `<div class="metric"><strong>${value}</strong><span>${label}</span></div>`).join("");
}

function renderMaster() {
  $("#equipmentSelect").innerHTML = `<option value="">Pilih dari master data</option>` + state.masterEquipment.map(item => (
    `<option value="${escapeHtml(item.id)}">${escapeHtml(item.id)} - ${escapeHtml(item.name)}</option>`
  )).join("");
  $("#masterList").innerHTML = state.masterEquipment.map(item => (
    `<div class="equipment-item">
      <strong>${escapeHtml(item.id)}</strong>
      <span>${escapeHtml(item.name)} · ${escapeHtml(item.area)} · ${escapeHtml(item.discipline)}</span>
    </div>`
  )).join("");
}

function renderPmStatus() {
  const target = $("#pmStatusBoard");
  if (!target) return;
  if (!state.documents.length) {
    target.innerHTML = `<div class="empty">Belum ada dokumen yang disubmit PM.</div>`;
    return;
  }
  target.innerHTML = state.documents.map(doc => `
    <div class="equipment-item">
      <strong>${escapeHtml(doc.docNo)}</strong>
      <span>${escapeHtml(doc.title)} · ${pill(doc.status)} · ${escapeHtml(doc.pmName)}</span>
      ${doc.pmAttachments?.length ? `<div class="doc-meta">${doc.pmAttachments.length} attachment PM terkirim ke Admin</div>` : `<div class="doc-meta">Belum ada attachment PM</div>`}
      ${doc.status === "RETURNED_TO_PM" ? `<div class="notice">Dokumen dikembalikan ke Project Manager untuk revisi.</div>` : ""}
    </div>
  `).join("");
}

function docCard(doc, extra = "") {
  return `<article class="doc-card">
    <div class="doc-main">
      <span class="status">${pill(doc.status)}</span>
      <h3>${escapeHtml(doc.docNo)}</h3>
      <p>${escapeHtml(doc.title)}</p>
      <div class="doc-meta">
        Rev ${escapeHtml(doc.revision)} · ${escapeHtml(doc.equipment.name)} · PM ${escapeHtml(doc.pmName)}
      </div>
      ${doc.notes ? `<p>${escapeHtml(doc.notes)}</p>` : ""}
    </div>
    ${extra}
  </article>`;
}

function renderAdmin() {
  if (!state.documents.length) {
    $("#adminBoard").innerHTML = `<div class="empty">Belum ada dokumen dari Project Manager.</div>`;
    return;
  }
  $("#adminBoard").innerHTML = state.documents.map(doc => docCard(doc, adminControls(doc))).join("");
}

function renderImportResult() {
  const target = $("#importResult");
  if (!target) return;
  const latest = state.masterImports?.[0];
  if (!latest) {
    target.innerHTML = `<div class="empty">Belum ada import master data.</div>`;
    return;
  }
  target.innerHTML = `<div class="notice">
    Import terakhir: ${escapeHtml(latest.importedRows)} row dari ${escapeHtml(latest.filename)}.
    Mode ${escapeHtml(latest.mode)}. Total master data sekarang ${escapeHtml(latest.after)}.
  </div>`;
}

function adminControls(doc) {
  const pmAttachmentBox = `
    <div class="admin-send">
      <h3>Attachment dari Project Manager</h3>
      ${doc.pmAttachments?.length ? doc.pmAttachments.map(file => `<div class="timeline-item">${escapeHtml(file.name)} · ${Math.ceil(file.size / 1024)} KB · ${escapeHtml(file.folder)}</div>`).join("") : `<div class="notice">PM belum melampirkan file untuk dicek Admin.</div>`}
    </div>`;

  const decisionBox = doc.status === "WAITING_ADMIN" ? `
    <div class="admin-decision">
      <h3>Peninjauan Admin</h3>
      <label>Catatan Admin
        <textarea data-admin-note="${doc.id}" rows="3" placeholder="Catatan approval/reject/forward"></textarea>
      </label>
      <div class="actions">
        <button class="secondary" data-admin="${doc.id}" data-decision="APPROVED">Approve</button>
        <button class="danger" data-admin="${doc.id}" data-decision="REJECTED">Reject</button>
        <button class="ghost" data-admin="${doc.id}" data-decision="FORWARDED">Fwd</button>
      </div>
    </div>` : "";

  const sendBox = doc.status === "READY_FOR_CUSTOMER" ? `
    <div class="admin-send">
      <h3>Kirim ke Customer External</h3>
      <label>Attachment Document
        <input type="file" multiple data-admin-attachments="${doc.id}">
      </label>
      <div class="recipient-grid" data-recipients="${doc.id}">
        ${recipientRow()}
        ${recipientRow("Customer Decision", "decision")}
      </div>
      <div class="actions">
        <button class="ghost" data-add-recipient="${doc.id}">Tambah Customer</button>
        <button class="primary" data-send-customer="${doc.id}">Send Email Customer</button>
      </div>
    </div>` : "";

  const recipients = doc.customerRecipients.length ? `
    <div class="admin-send">
      <h3>Customer Recipients</h3>
      ${doc.customerRecipients.map(rec => `<div class="timeline-item">${escapeHtml(rec.name)} · ${escapeHtml(rec.email)} · ${escapeHtml(rec.role)} · ${escapeHtml(rec.decision)}</div>`).join("")}
    </div>` : "";

  const attachments = doc.adminAttachments?.length ? `
    <div class="admin-send">
      <h3>Admin Attachments</h3>
      ${doc.adminAttachments.map(file => `<div class="timeline-item">${escapeHtml(file.name)} · ${Math.ceil(file.size / 1024)} KB · ${escapeHtml(file.folder)}</div>`).join("")}
    </div>` : "";

  return pmAttachmentBox + decisionBox + sendBox + recipients + attachments;
}

function recipientRow(name = "Customer Review", role = "review") {
  return `<div class="recipient-row">
    <input data-field="name" placeholder="${escapeHtml(name)}">
    <input data-field="email" placeholder="email@customer.com">
    <select data-field="role">
      <option value="review"${role === "review" ? " selected" : ""}>Review only</option>
      <option value="decision"${role === "decision" ? " selected" : ""}>Decision</option>
    </select>
    <button class="ghost" type="button" data-remove-row>×</button>
  </div>`;
}

function renderOutbox() {
  if (!state.outbox.length) {
    $("#outboxList").innerHTML = `<div class="empty">Belum ada email customer.</div>`;
    return;
  }
  $("#outboxList").innerHTML = state.outbox.map(mail => (
    `<div class="mail-item ${mail.id === state.selectedMailId ? "active" : ""}" data-mail="${mail.id}">
      <strong>${escapeHtml(mail.subject)}</strong>
      <span>${mail.recipients.length} recipient · ${new Date(mail.createdAt).toLocaleString()}</span>
    </div>`
  )).join("");
}

function renderCustomerAction() {
  const mail = state.outbox.find(item => item.id === state.selectedMailId);
  if (!mail) {
    $("#customerAction").innerHTML = `<div class="empty">Pilih email customer untuk melihat detail dokumen.</div>`;
    return;
  }
  const doc = state.documents.find(item => item.id === mail.docId);
  if (!doc) return;
  const recipientOptions = doc.customerRecipients.map(rec => (
    `<option value="${escapeHtml(rec.id)}">${escapeHtml(rec.name)} · ${escapeHtml(rec.role)} · ${escapeHtml(rec.email)}</option>`
  )).join("");

  $("#customerAction").innerHTML = `
    <div class="customer-doc">
      <div class="viewer">
        ${pill(doc.status)}
        <h3>${escapeHtml(doc.docNo)}</h3>
        <p>${escapeHtml(doc.title)}</p>
        <p>Equipment: ${escapeHtml(doc.equipment.name)} · Revision ${escapeHtml(doc.revision)}</p>
      </div>
      <div>
        <h3>Document Attachments</h3>
        ${doc.adminAttachments?.length ? doc.adminAttachments.map(file => `<div class="timeline-item">${escapeHtml(file.name)} · ${Math.ceil(file.size / 1024)} KB · sent by ${escapeHtml(file.by)}</div>`).join("") : `<div class="empty">Belum ada attachment dari Admin.</div>`}
      </div>
      <label>Customer
        <select id="customerRecipient">${recipientOptions}</select>
      </label>
      <div id="customerPermission"></div>
      <div class="customer-form" id="decisionForm"></div>
    </div>`;
  renderDecisionForm();
}

function renderDecisionForm() {
  const select = $("#customerRecipient");
  if (!select) return;
  const mail = state.outbox.find(item => item.id === state.selectedMailId);
  const doc = state.documents.find(item => item.id === mail.docId);
  const recipient = doc.customerRecipients.find(item => item.id === select.value) || doc.customerRecipients[0];
  if (!recipient) return;

  if (recipient.role === "review") {
    $("#customerPermission").innerHTML = `<div class="notice">Customer review hanya bisa melihat dokumen. Tombol keputusan dan upload file tidak ditampilkan.</div>`;
    $("#decisionForm").innerHTML = "";
    return;
  }

  $("#customerPermission").innerHTML = `<div class="notice">Customer decision dapat approve, reject, fwd, memberikan catatan, dan mengirim file baru.</div>`;
  $("#decisionForm").innerHTML = `
    <div class="grid-form">
      <label>Decision
        <select id="decisionValue">
          <option value="APPROVED">Approved</option>
          <option value="FORWARDED">Fwd</option>
          <option value="REJECTED">Rejected</option>
        </select>
      </label>
      <label>Upload Document Baru
        <input id="customerFiles" type="file" multiple>
      </label>
      <label class="wide">Catatan Customer
        <textarea id="customerNote" rows="4" placeholder="Catatan customer"></textarea>
      </label>
      <button class="primary wide" data-customer-submit="${doc.id}">Submit Customer Decision</button>
    </div>
    ${doc.customerFiles.length ? `<h3>Uploaded Files</h3>${doc.customerFiles.map(file => `<div class="timeline-item">${escapeHtml(file.name)} · ${Math.ceil(file.size / 1024)} KB · ${escapeHtml(file.folder)}</div>`).join("")}` : ""}`;
}

function renderArchive() {
  if (!state.documents.length) {
    $("#archiveList").innerHTML = `<div class="empty">Archive masih kosong.</div>`;
    return;
  }
  $("#archiveList").innerHTML = state.documents.map(doc => docCard(doc, `
    <div class="admin-send">
      <h3>History</h3>
      ${doc.history.map(item => `<div class="timeline-item">${new Date(item.at).toLocaleString()} · ${escapeHtml(item.actor)} · ${escapeHtml(item.action)} ${item.note ? `· ${escapeHtml(item.note)}` : ""}</div>`).join("")}
      ${doc.adminAttachments?.length ? `<h3>Admin Attachments</h3>${doc.adminAttachments.map(file => `<div class="timeline-item">${escapeHtml(file.name)} · ${escapeHtml(file.by)} · ${escapeHtml(file.folder)}</div>`).join("")}` : ""}
      ${doc.customerFiles.length ? `<h3>Customer Files</h3>${doc.customerFiles.map(file => `<div class="timeline-item">${escapeHtml(file.name)} · ${escapeHtml(file.by)} · ${escapeHtml(file.folder)}</div>`).join("")}` : ""}
    </div>
  `)).join("");
}

async function filesToPayload(input) {
  const files = Array.from(input?.files || []);
  return Promise.all(files.map(file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve({ name: file.name, size: file.size, dataUrl: reader.result });
    reader.onerror = reject;
    reader.readAsDataURL(file);
  })));
}

async function markCustomerViewed(recipientId) {
  const mail = state.outbox.find(item => item.id === state.selectedMailId);
  if (!mail) return;
  const doc = state.documents.find(item => item.id === mail.docId);
  const recipient = doc?.customerRecipients.find(item => item.id === recipientId) || doc?.customerRecipients[0];
  if (!doc || !recipient) return;
  await api(`/api/documents/${encodeURIComponent(doc.id)}/customer-view`, {
    method: "POST",
    body: JSON.stringify({ recipientId: recipient.id })
  });
}

document.addEventListener("click", async event => {
  const tab = event.target.closest(".tab");
  if (tab) {
    $$(".tab").forEach(item => item.classList.toggle("active", item === tab));
    $$(".view").forEach(view => view.classList.toggle("active", view.id === `view-${tab.dataset.view}`));
    if (tab.dataset.view === "customer" && state.selectedMailId) {
      await markCustomerViewed();
      await loadState();
    }
  }

  if (event.target.id === "refreshBtn") loadState();

  const adminButton = event.target.closest("[data-admin]");
  if (adminButton) {
    const id = adminButton.dataset.admin;
    const note = document.querySelector(`[data-admin-note="${id}"]`)?.value || "";
    await api(`/api/documents/${encodeURIComponent(id)}/admin-decision`, {
      method: "POST",
      body: JSON.stringify({ decision: adminButton.dataset.decision, note, by: "Admin" })
    });
    await loadState();
  }

  const addRecipient = event.target.closest("[data-add-recipient]");
  if (addRecipient) {
    document.querySelector(`[data-recipients="${addRecipient.dataset.addRecipient}"]`).insertAdjacentHTML("beforeend", recipientRow());
  }

  if (event.target.closest("[data-remove-row]")) {
    event.target.closest(".recipient-row").remove();
  }

  const sendButton = event.target.closest("[data-send-customer]");
  if (sendButton) {
    const id = sendButton.dataset.sendCustomer;
    const rows = Array.from(document.querySelectorAll(`[data-recipients="${id}"] .recipient-row`));
    const recipients = rows.map(row => ({
      name: row.querySelector('[data-field="name"]').value,
      email: row.querySelector('[data-field="email"]').value,
      role: row.querySelector('[data-field="role"]').value
    }));
    const attachments = await filesToPayload(document.querySelector(`[data-admin-attachments="${id}"]`));
    await api(`/api/documents/${encodeURIComponent(id)}/send-customer`, {
      method: "POST",
      body: JSON.stringify({ recipients, attachments, by: "Admin" })
    });
    await loadState();
    $("[data-view='customer']").click();
  }

  const mail = event.target.closest("[data-mail]");
  if (mail) {
    state.selectedMailId = mail.dataset.mail;
    await markCustomerViewed();
    await loadState();
  }

  const submitCustomer = event.target.closest("[data-customer-submit]");
  if (submitCustomer) {
    const files = await filesToPayload($("#customerFiles"));
    await api(`/api/documents/${encodeURIComponent(submitCustomer.dataset.customerSubmit)}/customer-decision`, {
      method: "POST",
      body: JSON.stringify({
        recipientId: $("#customerRecipient").value,
        decision: $("#decisionValue").value,
        note: $("#customerNote").value,
        files
      })
    });
    await loadState();
  }
});

document.addEventListener("change", async event => {
  if (event.target.id === "customerRecipient") {
    await markCustomerViewed(event.target.value);
    await loadState();
  }
});

$("#importForm").addEventListener("submit", async event => {
  event.preventDefault();
  const file = $("#masterCsvFile").files[0];
  if (!file) return;
  const form = new FormData(event.currentTarget);
  const csvText = await file.text();
  try {
    const result = await api("/api/master-equipment/import", {
      method: "POST",
      body: JSON.stringify({
        filename: file.name,
        csvText,
        mode: form.get("mode"),
        by: form.get("by")
      })
    });
    state.masterEquipment = result.masterEquipment;
    await loadState();
    event.currentTarget.reset();
    event.currentTarget.querySelector('[name="by"]').value = "Admin";
  } catch (error) {
    $("#importResult").innerHTML = `<div class="notice">${escapeHtml(error.message)}</div>`;
  }
});

$("#pmForm").addEventListener("submit", async event => {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const body = Object.fromEntries(form.entries());
  body.attachments = await filesToPayload($("#pmAttachments"));
  await api("/api/documents", {
    method: "POST",
    body: JSON.stringify(body)
  });
  event.currentTarget.reset();
  event.currentTarget.revision.value = "A";
  await loadState();
  $("[data-view='admin']").click();
});

loadState().catch(error => {
  document.body.innerHTML = `<main class="shell"><div class="panel"><h1>Gagal memuat aplikasi</h1><p>${escapeHtml(error.message)}</p></div></main>`;
});
