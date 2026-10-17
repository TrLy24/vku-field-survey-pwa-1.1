const DB_NAME = "vku-field-survey";
const DB_VERSION = 1;
const STORE_NAME = "surveys";
const ENDPOINT_KEY = "vku-survey-endpoint";
const ACTIVE_KEY = "vku-survey-active";
const LAST_SYNC_KEY = "vku-survey-last-sync";
const MAX_PHOTO_BYTES = 450 * 1024;

const form = document.querySelector("#survey-form");
const photoInput = document.querySelector("#site-photo");
const photoPreview = document.querySelector("#photo-preview");
const photoImage = document.querySelector("#photo-image");
const endpointInput = document.querySelector("#endpoint-input");
const syncFrame = document.querySelector("#sync-frame");
const toastElement = document.querySelector("#toast");
let database;
let activeId;
let photoBlob;
let photoName = "";
let previewUrl;
let saveTimer;
let toastTimer;
let syncing = false;

function openDatabase() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onupgradeneeded = () => {
      const store = request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      store.createIndex("updatedAt", "updatedAt");
      store.createIndex("status", "status");
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Không thể mở bộ nhớ trên thiết bị."));
    request.onblocked = () => reject(new Error("Bộ nhớ đang được dùng ở thẻ khác. Hãy đóng các thẻ VKU Survey còn lại rồi tải lại trang."));
  });
}

function storeRequest(mode, operation) {
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    let result;
    request.onsuccess = () => { result = request.result; };
    request.onerror = () => reject(request.error || new Error("Không thể đọc dữ liệu khảo sát."));
    transaction.oncomplete = () => resolve(result);
    transaction.onerror = () => reject(transaction.error || new Error("Giao dịch lưu dữ liệu thất bại."));
    transaction.onabort = () => reject(transaction.error || new Error("Giao dịch lưu dữ liệu đã bị hủy."));
  });
}

function getSurvey(id) {
  return storeRequest("readonly", store => store.get(id));
}

function getAllSurveys() {
  return storeRequest("readonly", store => store.getAll());
}

function putSurvey(survey) {
  return storeRequest("readwrite", store => store.put(survey));
}

function deleteSurvey(id) {
  return storeRequest("readwrite", store => store.delete(id));
}

function showToast(message, isError = false) {
  toastElement.textContent = message;
  toastElement.classList.toggle("error", isError);
  toastElement.classList.add("show");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toastElement.classList.remove("show"), 4200);
}

function setConnectionState() {
  const online = navigator.onLine;
  document.querySelector("#connection-dot").classList.toggle("online", online);
  document.querySelector("#connection-label").textContent = online ? "Đang trực tuyến" : "Đang ngoại tuyến";
}

function displayDate(dateValue) {
  if (!dateValue) return "Chưa có thời gian";
  const date = new Date(dateValue);
  return Number.isNaN(date.valueOf()) ? "Chưa có thời gian" : date.toLocaleString("vi-VN");
}

function fileSize(bytes) {
  return bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function createId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function readForm() {
  return Object.fromEntries(
    [...new FormData(form).entries()].filter(([name]) => name !== "sitePhoto")
  );
}

function setFormValues(fields) {
  for (const [name, value] of Object.entries(fields || {})) {
    const input = form.elements.namedItem(name);
    if (input && input.type !== "file") input.value = value ?? "";
  }
}

function markDraftSaved(saved) {
  const indicator = document.querySelector("#draft-indicator");
  indicator.textContent = saved ? "Lưu trên thiết bị" : "Chưa lưu";
  indicator.classList.toggle("saved", saved);
}

function makeDraft() {
  const existing = photoBlob;
  return {
    id: activeId,
    fields: readForm(),
    photo: existing || null,
    photoName,
    status: "draft",
    updatedAt: new Date().toISOString()
  };
}

async function persistDraft() {
  if (!activeId || !database) return;
  await putSurvey(makeDraft());
  markDraftSaved(true);
  await refreshSurveys();
}

function scheduleDraftSave() {
  markDraftSaved(false);
  window.clearTimeout(saveTimer);
  saveTimer = window.setTimeout(() => {
    persistDraft().catch(error => showToast(`Không lưu được trên thiết bị: ${error.message}`, true));
  }, 450);
}

function renderPhoto(blob, filename = "Ảnh hiện trường") {
  if (previewUrl) URL.revokeObjectURL(previewUrl);
  previewUrl = null;
  if (!blob) {
    photoPreview.hidden = true;
    photoImage.removeAttribute("src");
    document.querySelector("#photo-name").textContent = "";
    document.querySelector("#photo-size").textContent = "";
    return;
  }
  previewUrl = URL.createObjectURL(blob);
  photoImage.src = previewUrl;
  document.querySelector("#photo-name").textContent = filename;
  document.querySelector("#photo-size").textContent = fileSize(blob.size);
  photoPreview.hidden = false;
}

async function compressPhoto(file) {
  if (!file.type.startsWith("image/")) throw new Error("Vui lòng chọn tệp ảnh hợp lệ.");
  if (file.size <= MAX_PHOTO_BYTES && file.type === "image/jpeg") return file;
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Thiết bị không thể xử lý ảnh này.");
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  let quality = 0.78;
  let result = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
  while (result && result.size > MAX_PHOTO_BYTES && quality > 0.38) {
    quality -= 0.1;
    result = await new Promise(resolve => canvas.toBlob(resolve, "image/jpeg", quality));
  }
  if (!result) throw new Error("Không thể chuyển đổi ảnh.");
  if (result.size > MAX_PHOTO_BYTES) throw new Error("Ảnh sau nén vượt quá giới hạn 450 KB.");
  return result;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

async function refreshSurveys() {
  const surveys = (await getAllSurveys()).sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  const pending = surveys.filter(survey => survey.status === "pending").length;
  const draft = surveys.filter(survey => survey.status === "draft").length;
  document.querySelector("#queue-count").textContent = `${pending} phiên chờ đồng bộ`;
  document.querySelector("#total-count").textContent = surveys.length;
  const lastSync = localStorage.getItem(LAST_SYNC_KEY);
  document.querySelector("#last-sync").textContent = lastSync
    ? `Đồng bộ gần nhất: ${displayDate(lastSync)}${draft ? ` · ${draft} bản nháp` : ""}`
    : `${draft ? `${draft} bản nháp · ` : ""}Dữ liệu được lưu trên thiết bị của bạn`;

  const list = document.querySelector("#survey-list");
  if (!surveys.length) {
    list.innerHTML = '<div class="empty-state">Các phiên đã lưu sẽ xuất hiện ở đây.</div>';
    return;
  }
  list.innerHTML = surveys.slice(0, 30).map(survey => {
    const respondent = survey.fields?.respondentName?.trim() || "Phiên khảo sát chưa đặt tên";
    const label = survey.status === "synced" ? "Đã đồng bộ" : survey.status === "draft" ? "Bản nháp" : "Chờ đồng bộ";
    const statusClass = survey.status === "synced" ? "synced" : survey.status === "draft" ? "draft" : "";
    const openAction = survey.status === "draft" ? `<button type="button" data-action="edit" data-id="${escapeHtml(survey.id)}">Mở</button>` : `<button type="button" data-action="view" data-id="${escapeHtml(survey.id)}">Xem</button>`;
    const deleteAction = `<button class="delete" type="button" data-action="delete" data-id="${escapeHtml(survey.id)}">Xóa</button>`;
    return `<article class="survey-item"><div class="survey-item-top"><div><strong>${escapeHtml(respondent)}</strong><small>${escapeHtml(displayDate(survey.fields?.interviewTime))}</small></div><span class="status-pill ${statusClass}">${label}</span></div><div class="item-actions">${openAction}${survey.status === "pending" ? `<button type="button" data-action="sync" data-id="${escapeHtml(survey.id)}">Đồng bộ</button>` : ""}${deleteAction}</div></article>`;
  }).join("");
}

async function loadSurvey(id, readOnly = false) {
  const survey = await getSurvey(id);
  if (!survey) return;
  activeId = survey.id;
  localStorage.setItem(ACTIVE_KEY, survey.id);
  setFormValues(survey.fields);
  photoBlob = survey.photo || null;
  photoName = survey.photoName || "";
  renderPhoto(photoBlob, photoName || "Ảnh hiện trường");
  const location = form.elements.namedItem("location").value;
  document.querySelector("#location-status").textContent = location || "Chưa ghi nhận vị trí";
  form.querySelectorAll("input:not([type=hidden]), select, textarea").forEach(control => {
    control.disabled = readOnly;
  });
  photoInput.disabled = readOnly;
  document.querySelector("#location-button").disabled = readOnly;
  document.querySelector("#remove-photo").disabled = readOnly;
  document.querySelector("#save-button").hidden = readOnly;
  document.querySelector("#new-button").textContent = readOnly ? "Tạo phiên khảo sát mới" : "Phiên khảo sát mới";
  document.querySelector("#form-title").textContent = readOnly ? "Xem phiên khảo sát" : "Thông tin phỏng vấn";
  markDraftSaved(true);
  document.querySelector("#form-title").scrollIntoView({ behavior: "smooth", block: "center" });
}

function resetForNewSurvey() {
  form.reset();
  activeId = createId();
  photoBlob = null;
  photoName = "";
  renderPhoto(null);
  const input = form.elements.namedItem("interviewTime");
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  input.value = now.toISOString().slice(0, 16);
  form.querySelectorAll("input, select, textarea").forEach(control => { control.disabled = false; });
  document.querySelector("#location-button").disabled = false;
  document.querySelector("#remove-photo").disabled = false;
  document.querySelector("#save-button").hidden = false;
  document.querySelector("#new-button").textContent = "Phiên khảo sát mới";
  document.querySelector("#form-title").textContent = "Thông tin phỏng vấn";
  document.querySelector("#location-status").textContent = "Chưa ghi nhận vị trí";
  localStorage.setItem(ACTIVE_KEY, activeId);
  markDraftSaved(false);
}

async function saveSubmission(event) {
  event.preventDefault();
  if (!form.reportValidity()) return;
  const button = document.querySelector("#save-button");
  button.disabled = true;
  try {
    const previous = await getSurvey(activeId);
    if (previous?.status === "synced") {
      throw new Error("Phiên này đã đồng bộ và chỉ được xem. Hãy tạo phiên mới để ghi nhận khảo sát.");
    }
    const submission = {
      id: activeId,
      fields: readForm(),
      photo: photoBlob || null,
      photoName: photoName || previous?.photoName || "",
      status: "pending",
      updatedAt: new Date().toISOString()
    };
    await putSurvey(submission);
    await refreshSurveys();
    await loadSurvey(submission.id, true);
    showToast("Đã lưu phiên trên thiết bị. Đang thử đồng bộ khi có kết nối.");
    await syncPending();
  } catch (error) {
    showToast(`Không thể lưu phiên khảo sát: ${error.message}`, true);
  } finally {
    button.disabled = false;
  }
}

function makePayload(survey) {
  return new Promise((resolve, reject) => {
    const payload = {
      id: survey.id,
      fields: survey.fields,
      submittedAt: survey.updatedAt,
      photo: null
    };
    if (!survey.photo) {
      resolve(payload);
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      payload.photo = {
        data: String(reader.result).split(",")[1],
        mimeType: survey.photo.type || "image/jpeg",
        name: survey.photoName || "vku-survey-photo.jpg"
      };
      resolve(payload);
    };
    reader.onerror = () => reject(new Error("Không đọc được ảnh để đồng bộ."));
    reader.readAsDataURL(survey.photo);
  });
}

function postToAppsScript(endpoint, payload) {
  return new Promise((resolve, reject) => {
    const nonce = createId();
    const formElement = document.createElement("form");
    formElement.method = "POST";
    formElement.action = endpoint;
    formElement.target = syncFrame.name;
    formElement.hidden = true;
    const payloadInput = document.createElement("input");
    payloadInput.type = "hidden";
    payloadInput.name = "payload";
    payloadInput.value = JSON.stringify({ ...payload, nonce });
    formElement.append(payloadInput);
    document.body.append(formElement);

    const timeout = window.setTimeout(() => finish(new Error("Hết thời gian chờ phản hồi từ Google Sheets.")), 60000);
    function finish(error, result) {
      window.clearTimeout(timeout);
      window.removeEventListener("message", onMessage);
      formElement.remove();
      if (error) reject(error);
      else resolve(result);
    }
    function onMessage(event) {
      if (event.data?.type !== "vku-survey-sync" || event.data?.nonce !== nonce) return;
      if (event.data.ok === true && event.data.id === payload.id) finish(null, event.data);
      else finish(new Error(event.data.message || "Google Sheets không xác nhận đã lưu dữ liệu."));
    }
    window.addEventListener("message", onMessage);
    try {
      formElement.submit();
    } catch (error) {
      finish(new Error(`Không gửi được dữ liệu tới Google Sheets: ${error.message}`));
    }
  });
}

async function syncOne(survey) {
  const endpoint = localStorage.getItem(ENDPOINT_KEY);
  if (!endpoint) throw new Error("Hãy nhập URL Apps Script để đồng bộ.");
  const payload = await makePayload(survey);
  const response = await postToAppsScript(endpoint, payload);
  const fresh = await getSurvey(survey.id);
  if (fresh && fresh.status !== "synced") {
    fresh.status = "synced";
    fresh.syncedAt = new Date().toISOString();
    fresh.updatedAt = fresh.syncedAt;
    await putSurvey(fresh);
  }
  localStorage.setItem(LAST_SYNC_KEY, new Date().toISOString());
  return response;
}

async function syncPending(onlyId, notifyWhenEmpty = false) {
  if (syncing) return;
  let pending;
  try {
    pending = (await getAllSurveys()).filter(survey =>
      survey.status === "pending" && (!onlyId || survey.id === onlyId)
    );
  } catch (error) {
    showToast(`Không đọc được hàng đợi đồng bộ trên thiết bị: ${error.message}`, true);
    return;
  }
  if (!pending.length) {
    if (onlyId || notifyWhenEmpty) showToast("Không có phiên nào đang chờ đồng bộ.");
    return;
  }
  if (!navigator.onLine) {
    showToast("Đang ngoại tuyến. Phiên được lưu trên thiết bị và sẽ đồng bộ khi có mạng.");
    return;
  }
  const endpoint = localStorage.getItem(ENDPOINT_KEY);
  if (!endpoint) {
    showToast("Phiên đã lưu trên thiết bị. Cấu hình URL Google Apps Script để đồng bộ.");
    return;
  }
  syncing = true;
  const syncButton = document.querySelector("#sync-now");
  syncButton.disabled = true;
  try {
    const surveys = (await getAllSurveys()).filter(survey =>
      survey.status === "pending" && (!onlyId || survey.id === onlyId)
    ).sort((left, right) => left.updatedAt.localeCompare(right.updatedAt));
    if (!surveys.length) {
      if (onlyId) showToast("Không tìm thấy phiên đang chờ đồng bộ.");
      else showToast("Không có phiên nào đang chờ đồng bộ.");
      return;
    }
    let completed = 0;
    for (const survey of surveys) {
      try {
        await syncOne(survey);
        completed += 1;
      } catch (error) {
        await refreshSurveys();
        showToast(`${completed ? `Đã đồng bộ ${completed} phiên. ` : ""}Chưa đồng bộ được: ${error.message} Dữ liệu vẫn còn trên thiết bị.`, true);
        return;
      }
    }
    await refreshSurveys();
    showToast(`Đồng bộ thành công ${completed} phiên lên Google Sheets.`);
  } finally {
    syncing = false;
    syncButton.disabled = false;
    await refreshSurveys();
  }
}

async function getLocation() {
  const button = document.querySelector("#location-button");
  const status = document.querySelector("#location-status");
  if (!window.isSecureContext) {
    status.textContent = "Cần HTTPS hoặc localhost để lấy vị trí";
    showToast("Địa chỉ hiện tại dùng HTTP không an toàn nên trình duyệt chặn GPS. Hãy mở localhost trên máy tính hoặc dùng link HTTPS.", true);
    return;
  }
  if (!navigator.geolocation) {
    showToast("Trình duyệt này không hỗ trợ truy xuất vị trí.", true);
    return;
  }
  button.disabled = true;
  status.textContent = "Đang lấy vị trí…";
  navigator.geolocation.getCurrentPosition(position => {
    const { latitude, longitude, accuracy } = position.coords;
    form.elements.namedItem("location").value = `${latitude.toFixed(6)}, ${longitude.toFixed(6)}`;
    status.textContent = `${latitude.toFixed(5)}, ${longitude.toFixed(5)} · ±${Math.round(accuracy)} m`;
    button.disabled = false;
    scheduleDraftSave();
  }, error => {
    const reasons = {
      1: "Quyền vị trí đang bị chặn. Cho phép Location trong cài đặt quyền của trang rồi tải lại.",
      2: "Không xác định được vị trí. Thử lại khi ra ngoài trời.",
      3: "Hết thời gian chờ lấy vị trí."
    };
    status.textContent = "Chưa ghi nhận vị trí";
    button.disabled = false;
    showToast(reasons[error.code] || "Không thể lấy vị trí.", true);
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 30000 });
}

async function handleSurveyAction(event) {
  const button = event.target.closest("button[data-action]");
  if (!button) return;
  const { action, id } = button.dataset;
  try {
    if (action === "edit") await loadSurvey(id);
    if (action === "view") await loadSurvey(id, true);
    if (action === "sync") await syncPending(id);
    if (action === "delete") {
      const survey = await getSurvey(id);
      const confirmed = window.confirm(survey?.status === "synced"
        ? "Xóa phiên này khỏi thiết bị? Bản sao trên Google Sheets không bị xóa."
        : "Xóa phiên khảo sát này khỏi thiết bị? Thao tác này không thể hoàn tác.");
      if (confirmed) {
        await deleteSurvey(id);
        if (activeId === id) resetForNewSurvey();
        await refreshSurveys();
        showToast("Đã xóa phiên khỏi thiết bị.");
      }
    }
  } catch (error) {
    showToast(`Không thể xử lý phiên khảo sát: ${error.message}`, true);
  }
}

async function initialize() {
  if (!("indexedDB" in window)) throw new Error("Trình duyệt không hỗ trợ IndexedDB để lưu khảo sát ngoại tuyến.");
  database = await openDatabase();
  endpointInput.value = localStorage.getItem(ENDPOINT_KEY) || "";
  endpointInput.addEventListener("change", () => endpointInput.setCustomValidity(""));
  document.querySelector("#save-settings").addEventListener("click", () => {
    const endpoint = endpointInput.value.trim();
    if (endpoint && (!/^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec\/?$/.test(endpoint))) {
      endpointInput.setCustomValidity("Nhập URL triển khai Web App có dạng https://script.google.com/macros/s/.../exec");
      endpointInput.reportValidity();
      return;
    }
    endpointInput.setCustomValidity("");
    if (endpoint) localStorage.setItem(ENDPOINT_KEY, endpoint);
    else localStorage.removeItem(ENDPOINT_KEY);
    showToast(endpoint ? "Đã lưu cấu hình Google Sheets trên thiết bị." : "Đã xóa cấu hình Google Sheets.");
    if (navigator.onLine) syncPending();
  });
  form.addEventListener("input", scheduleDraftSave);
  form.addEventListener("change", scheduleDraftSave);
  form.addEventListener("submit", saveSubmission);
  document.querySelector("#location-button").addEventListener("click", getLocation);
  document.querySelector("#sync-now").addEventListener("click", () => syncPending(undefined, true));
  document.querySelector("#survey-list").addEventListener("click", handleSurveyAction);
  document.querySelector("#new-button").addEventListener("click", async () => {
    try {
      window.clearTimeout(saveTimer);
      const current = await getSurvey(activeId);
      if (!current || current.status === "draft") await persistDraft();
      resetForNewSurvey();
    } catch (error) {
      showToast(`Không thể lưu bản nháp trên thiết bị: ${error.message}`, true);
    }
  });
  document.querySelector("#remove-photo").addEventListener("click", () => {
    photoBlob = null;
    photoName = "";
    form.elements.namedItem("sitePhoto").value = "";
    renderPhoto(null);
    scheduleDraftSave();
  });
  photoInput.addEventListener("change", async () => {
    const file = photoInput.files?.[0];
    if (!file) return;
    try {
      photoBlob = await compressPhoto(file);
      photoName = file.name || "anh-hien-truong.jpg";
      renderPhoto(photoBlob, photoName);
      await persistDraft();
      showToast(`Đã lưu ảnh khảo sát trên thiết bị (${fileSize(photoBlob.size)}).`);
    } catch (error) {
      photoInput.value = "";
      showToast(error.message, true);
    }
  });
  window.addEventListener("online", () => {
    setConnectionState();
    syncPending();
  });
  window.addEventListener("offline", setConnectionState);
  setConnectionState();
  resetForNewSurvey();
  const activeIdInStorage = localStorage.getItem(ACTIVE_KEY);
  const existingDraft = activeIdInStorage ? await getSurvey(activeIdInStorage) : null;
  if (existingDraft && existingDraft.status !== "synced") await loadSurvey(existingDraft.id);
  await refreshSurveys();
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(error => {
      console.error("Không đăng ký được service worker:", error);
    });
  }
  if (navigator.onLine) syncPending();
}

function startApplication() {
  initialize().catch(error => {
    console.error(error);
    showToast(error.message || "Không thể khởi tạo ứng dụng.", true);
  });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", startApplication, { once: true });
} else {
  startApplication();
}
