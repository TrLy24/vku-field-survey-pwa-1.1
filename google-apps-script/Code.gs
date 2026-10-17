// ======================================================
// VKU Field Survey — Google Apps Script Backend
// Ghi dữ liệu phiên khảo sát vào Google Sheets
// ======================================================

const SHEET_NAME = "Surveys";
const SPREADSHEET_ID_PROPERTY = "SPREADSHEET_ID";
const HEADERS = [
  "Survey ID",
  "Họ tên người được khảo sát",
  "Họ tên người phỏng vấn",
  "Thời gian phỏng vấn",
  "Vị trí (lat, lng)",
  "Giai đoạn học",
  "Loại việc làm mong muốn",
  "Vai trò / ngành nghề mong muốn",
  "Thời điểm bắt đầu mong muốn",
  "Hình thức làm việc",
  "Thu nhập kỳ vọng (VND/tháng)",
  "Kỹ năng / kinh nghiệm",
  "Khó khăn tìm việc",
  "Hỗ trợ cần thiết",
  "Ghi chú thêm",
  "URL ảnh hiện trường",
  "Thời gian nộp",
  "Thời gian đồng bộ"
];

// ======================================================
// Điểm vào chính — nhận POST từ PWA
// ======================================================
function doGet() {
  try {
    var ss = getSpreadsheet_();
    var sheetStatus = ss.getSheetByName(SHEET_NAME) ? "đã sẵn sàng" : "sẽ được tạo khi nhận khảo sát đầu tiên";
    return HtmlService.createHtmlOutput(
      "<h1>VKU Survey Sync đang hoạt động</h1><p>Trang tính Surveys " + sheetStatus + ".</p>"
    ).setTitle("VKU Survey Sync");
  } catch (err) {
    return HtmlService.createHtmlOutput(
      "<h1>VKU Survey Sync chưa được cấu hình</h1><p>" + escapeHtml_(err.message) + "</p>"
    ).setTitle("VKU Survey Sync");
  }
}

function doPost(e) {
  var nonce = "";
  var surveyId = "";
  try {
    var raw = e && e.parameter && e.parameter.payload;
    if (!raw) throw new Error("Thiếu payload.");
    var data = JSON.parse(raw);

    nonce = String(data.nonce || "");
    surveyId = String(data.id || "");

    if (!surveyId) throw new Error("Thiếu Survey ID.");
    var fields = data.fields || {};
    if (!String(fields.respondentName || "").trim()) throw new Error("Thiếu tên người được khảo sát.");
    if (!String(fields.interviewerName || "").trim()) throw new Error("Thiếu tên người phỏng vấn.");

    var lock = LockService.getScriptLock();
    lock.waitLock(20000);
    var result;
    try {
      var sheet = getOrCreateSheet_();

      if (isDuplicate_(sheet, surveyId)) {
        result = { ok: true, id: surveyId, duplicate: true };
      } else {
        // Lưu ảnh riêng — lỗi ảnh không chặn ghi dữ liệu
        var photoUrl = "";
        try {
          photoUrl = savePhoto_(data, surveyId);
        } catch (photoErr) {
          console.warn("Không lưu được ảnh: " + photoErr.message);
        }

        sheet.appendRow([
          surveyId,
          safe_(fields.respondentName),
          safe_(fields.interviewerName),
          safe_(fields.interviewTime),
          safe_(fields.location),
          safe_(fields.studyStage),
          safe_(fields.jobType),
          safe_(fields.desiredRole),
          safe_(fields.startTiming),
          safe_(fields.workMode),
          safe_(fields.expectedIncome),
          safe_(fields.skills),
          safe_(fields.challenge),
          safe_(fields.supportNeeded),
          safe_(fields.notes),
          photoUrl,
          safe_(data.submittedAt),
          new Date().toISOString()
        ]);

        result = { ok: true, id: surveyId, duplicate: false };
      }
    } finally {
      lock.releaseLock();
    }

    return respond_(nonce, result);

  } catch (err) {
    console.error(err.stack || err.message || err);
    return respond_(nonce, { ok: false, id: surveyId, message: String(err.message || "Không lưu được khảo sát.") });
  }
}

// ======================================================
// Hàm nội bộ
// ======================================================

/** Lấy sheet Surveys, tạo mới + thêm header nếu chưa có */
function getOrCreateSheet_() {
  var ss = getSpreadsheet_();
  var sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  } else if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

/** Chốt spreadsheet đích để Web App không phụ thuộc ngữ cảnh active spreadsheet. */
function getSpreadsheet_() {
  var spreadsheetId = PropertiesService.getScriptProperties()
    .getProperty(SPREADSHEET_ID_PROPERTY);
  if (spreadsheetId) return SpreadsheetApp.openById(spreadsheetId);

  var activeSpreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (activeSpreadsheet) return activeSpreadsheet;
  throw new Error("Chưa cấu hình spreadsheet đích. Hãy chạy setupSpreadsheet() trong Apps Script Editor.");
}

/** Chạy một lần từ Apps Script Editor khi mở bằng spreadsheet cần nhận dữ liệu. */
function setupSpreadsheet() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error("Hãy mở Apps Script từ spreadsheet đích qua Extensions > Apps Script.");
  PropertiesService.getScriptProperties()
    .setProperty(SPREADSHEET_ID_PROPERTY, ss.getId());
  getOrCreateSheet_();
  Logger.log("Đã cấu hình spreadsheet đích: " + ss.getUrl());
}

function escapeHtml_(value) {
  return String(value).replace(/[&<>"']/g, function (character) {
    return {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    }[character];
  });
}

/** Kiểm tra Survey ID đã tồn tại chưa */
function isDuplicate_(sheet, id) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return false;
  var found = sheet.getRange(2, 1, lastRow - 1, 1)
    .createTextFinder(id)
    .matchEntireCell(true)
    .findNext();
  return found !== null;
}

/** Lưu ảnh base64 vào Google Drive, trả về URL chia sẻ */
function savePhoto_(data, surveyId) {
  if (!data.photo || !data.photo.data) return "";
  var mimeType = String(data.photo.mimeType || "image/jpeg");
  if (!/^image\/(jpeg|png|webp)$/.test(mimeType)) throw new Error("Định dạng ảnh không hợp lệ.");
  var bytes = Utilities.base64Decode(data.photo.data);
  var ext = mimeType === "image/png" ? "png" : "jpg";
  var blob = Utilities.newBlob(bytes, mimeType, surveyId + "-photo." + ext);
  var file = DriveApp.createFile(blob);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  return file.getUrl();
}

/** Làm sạch giá trị ô — tránh injection công thức, giới hạn 2000 ký tự */
function safe_(value) {
  var text = String(value == null ? "" : value).slice(0, 2000).trim();
  return /^[=+\-@|]/.test(text) ? "'" + text : text;
}

/** Trả về HTML nhúng postMessage để PWA nhận kết quả */
function respond_(nonce, result) {
  var payload = JSON.stringify(Object.assign({ type: "vku-survey-sync", nonce: nonce }, result))
    .replace(/</g, "\\u003c");
  var html = "<script>window.top.postMessage(" + payload + ", \"*\");<\/script><p>Đã xử lý. Bạn có thể đóng khung này.</p>";
  return HtmlService.createHtmlOutput(html)
    .setTitle("VKU Survey Sync")
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// ======================================================
// Hàm kiểm thử — chạy trực tiếp từ Apps Script Editor
// Chọn hàm "testDoPost" trong dropdown rồi bấm ▶ Run
// ======================================================
function testDoPost() {
  var fakePayload = JSON.stringify({
    id: "test-" + Math.random().toString(36).slice(2, 10),
    nonce: "test-nonce-123",
    submittedAt: new Date().toISOString(),
    fields: {
      respondentName:  "Nguyễn Văn A (TEST)",
      interviewerName: "Trần Thị B (TEST)",
      interviewTime:   new Date().toISOString().slice(0, 16),
      location:        "15.979330, 108.251560",
      studyStage:      "Năm 3",
      jobType:         "Toàn thời gian",
      desiredRole:     "Kỹ sư phần mềm",
      startTiming:     "Sau khi tốt nghiệp",
      workMode:        "Kết hợp",
      expectedIncome:  "12000000",
      skills:          "JavaScript, Python",
      challenge:       "Thiếu kinh nghiệm thực tế",
      supportNeeded:   "Kết nối doanh nghiệp",
      notes:           "Đây là dữ liệu test — có thể xóa"
    },
    photo: null
  });

  var fakeEvent = { parameter: { payload: fakePayload } };
  var output = doPost(fakeEvent);
  Logger.log("Kết quả: " + output.getContent());
}
