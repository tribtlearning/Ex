/**
 * =======================================================================================
 * Trợ lý Học tập HG - Highlight-only (fix trùng nội dung câu hỏi)
 * =======================================================================================
 */
console.log("HG Assistant: Bắt đầu chạy content.js...");

const TRIAL_DAYS = 90;
const SELECTORS = {
  questionBlock: ".que",
  questionText: ".qtext",
  answerOption: ".answer div, .answer label, .answer .r0, .answer .r1",
};

/* ---------------- KIỂM TRA LICENSE (Đã nâng cấp từ v2.0) ---------------- */

/**
 * Hàm này kiểm tra key (đã mã hóa base64)
 * Key hợp lệ có dạng "RDI-YYYYMMDD" (sau khi giải mã)
 */
function validateLicenseKey(encryptedKey) {
     try {
         const decryptedKey = atob(encryptedKey); // Giải mã Base64
         // Key phải bắt đầu bằng RDI- và có đủ 12 ký tự (RDI-YYYYMMDD)
         if (!decryptedKey.startsWith('RDI-') || decryptedKey.length !== 12) return null;
         
         const dateStr = decryptedKey.substring(4); // Lấy phần YYYYMMDD
         const year = parseInt(dateStr.substring(0, 4), 10);
         const month = parseInt(dateStr.substring(4, 6), 10) - 1; // Tháng trong JS bắt đầu từ 0
         const day = parseInt(dateStr.substring(6, 8), 10);
         
         const expiryDate = new Date(year, month, day);
         expiryDate.setHours(23, 59, 59, 999); // Đặt hạn tới cuối ngày
         
         return isNaN(expiryDate.getTime()) ? null : expiryDate;
     } catch (e) {
         // Lỗi nếu encryptedKey không phải là Base64 hợp lệ
         return null;
     }
}

async function checkLicenseStatus() {
     try {
         // Ưu tiên kiểm tra key bản quyền vĩnh viễn
         const licenseData = await chrome.storage.local.get('encryptedLicenseKey');
         if (licenseData.encryptedLicenseKey) {
             const expiryDate = validateLicenseKey(licenseData.encryptedLicenseKey);
            // Nếu key hợp lệ VÀ còn hạn
             if (expiryDate && new Date() < expiryDate) return 'ACTIVE';
         }
         
         // Nếu không có key, kiểm tra hạn dùng thử
         const trialData = await chrome.storage.local.get('installDate');
         if (!trialData.installDate) {
             await chrome.storage.local.set({ installDate: new Date().toISOString() });
             return 'TRIAL';
         }
         
         const installDate = new Date(trialData.installDate);
         const expiryDate = new Date(installDate);
         expiryDate.setDate(installDate.getDate() + TRIAL_DAYS);
         
         if (new Date() < expiryDate) return 'TRIAL';
         
         return 'EXPIRED'; // Hết hạn dùng thử
     } catch (error) {
         console.error("HG Assistant Lỗi: Không thể truy cập chrome.storage.", error);
         return 'ERROR';
     }
}

// =================================================================
// ===== HÀM ĐỌC FILE (ĐÃ DI CHUYỂN LÊN TRÊN)
// =================================================================
pdfjsLib.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.js");

function handleFile(e) {
  const file = e.target.files[0];
  if (!file) return;
  
  // Lấy các element UI mới
  const statusEl = document.getElementById("hg-status");
  statusEl.textContent = "📖 Đang đọc file...";
  statusEl.className = ""; // Reset màu

  const reader = new FileReader();

  reader.onload = (ev) => {
    const ext = file.name.split(".").pop().toLowerCase();
    const content = ev.target.result;
    let lines = [];
    let aoa = []; // Array of Arrays

    try {
      if (ext === "xlsx" || ext === "xls") {
        const data = XLSX.read(content, { type: "binary" });
        const sheet = data.Sheets[data.SheetNames[0]];
        // *** THAY ĐỔI: Đọc file sang Array of Arrays (header: 1)
        aoa = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "" }); 
        lines = convertAoaToLines(aoa); // Dùng hàm trợ giúp mới
        processAnswers(lines);
      } 
      else if (ext === "csv") {
        const results = Papa.parse(content, {
            // *** THAY ĐỔI: Không dùng header, đọc sang Array of Arrays
            header: false, 
            skipEmptyLines: true,
        });
        aoa = results.data;
        lines = convertAoaToLines(aoa); // Dùng chung hàm trợ giúp
        processAnswers(lines);
      } 
      else { // Mặc định là .txt
        lines = content.split(/\r?\n/).filter(l => l.trim());
        processAnswers(lines); // Hàm này dùng extractQA cũ, vốn dành cho .txt
      }
      
    } catch (err) {
      console.error("HG Assistant Lỗi xử lý file:", err);
      statusEl.textContent = "❌ Lỗi khi đọc file!";
      statusEl.className = "hg-error";
    }
  };
  
  reader.onerror = () => {
      statusEl.textContent = "❌ Lỗi khi đọc file!";
      statusEl.className = "hg-error";
  };

  if (/\.(xlsx|xls)$/i.test(file.name)) reader.readAsBinaryString(file);
  else reader.readAsText(file); // CSV và TXT đều đọc dạng text
}

/**
 * Chuyển đổi một mảng của các mảng (AOA) sang định dạng 'lines'.
 * Tự động tìm hàng tiêu đề (header) và bỏ qua các dòng rác ở trên.
 */
function convertAoaToLines(aoa) {
    const lines = [];
    if (!aoa || aoa.length === 0) {
        console.error("HG Assistant: Dữ liệu file (AOA) rỗng.");
        return lines;
    }

    let questionColIndex = -1;
    let answerColIndex = -1;
    let headerRowFound = false;
    let headerRowIndex = -1;

    // 1. Tìm hàng tiêu đề (header) và chỉ mục các cột
    for (let i = 0; i < aoa.length; i++) {
        const row = aoa[i];
        if (!Array.isArray(row)) continue; // Bỏ qua nếu không phải mảng

        // Tìm chỉ mục cột cho 'câu hỏi' và 'đáp án'
        const tempQIndex = row.findIndex(cell => typeof cell === 'string' && cell.toLowerCase().includes('câu hỏi'));
        const tempAIndex = row.findIndex(cell => typeof cell === 'string' && cell.toLowerCase().includes('đáp án'));

        // Nếu tìm thấy cả hai cột trong cùng một hàng
        if (tempQIndex !== -1 && tempAIndex !== -1) {
            questionColIndex = tempQIndex;
            answerColIndex = tempAIndex;
            headerRowFound = true;
            headerRowIndex = i; // Ghi lại chỉ mục của hàng tiêu đề
            break; // Dừng tìm kiếm
        }
    }

    // 2. Kiểm tra xem đã tìm thấy tiêu đề chưa
    if (!headerRowFound) {
        console.error(`HG Assistant: Không tìm thấy hàng tiêu đề chứa 'câu hỏi' và 'đáp án'.`);
        const statusEl = document.getElementById("hg-status");
        if(statusEl) {
          statusEl.textContent = "Lỗi: File thiếu cột 'Câu hỏi' hoặc 'Đáp án'.";
          statusEl.className = "hg-error";
        }
        return lines; // Trả về mảng rỗng
    }
    
    // 3. Xử lý các hàng dữ liệu (từ hàng ngay sau hàng tiêu đề)
    for (let i = headerRowIndex + 1; i < aoa.length; i++) {
        const row = aoa[i];
        if (!Array.isArray(row)) continue; // Bỏ qua nếu không phải mảng

        const question = row[questionColIndex];
        const answer = row[answerColIndex];

        // Chỉ thêm nếu cả câu hỏi và đáp án đều có nội dung
        if (question && answer) {
            lines.push(`Câu hỏi: ${String(question).trim()}`);
            lines.push(`Đáp án đúng: ${String(answer).trim()}`);
        }
    }

    return lines;
}
// =================================================================
// ===== KẾT THÚC HÀM ĐỌC FILE
// =================================================================


/* ---------------- GIAO DIỆN (ĐÃ THIẾT KẾ LẠI) ---------------- */
function showMainUI() {
  if (document.getElementById("hg-assistant-container")) return;

  // 1. Tạo container chính
  const container = document.createElement("div");
  container.id = "hg-assistant-container";
  container.innerHTML = `
    <div id="hg-header">
      <strong>Trợ lý Học tập HG</strong>
      <button id="hg-toggle-btn" title="Thu nhỏ/Mở rộng">-</button>
    </div>
    <div id="hg-body">
      <div id="hg-dropzone">
        <svg xmlns="http://www.w3.org/2000/svg" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" style="color: #007bff; margin-bottom: 10px;">
          <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
          <polyline points="17 8 12 3 7 8"></polyline>
          <line x1="12" y1="3" x2="12" y2="15"></line>
        </svg>
        <span>Kéo & thả file hoặc <strong>nhấn để chọn</strong></span>
        <span id="hg-file-name"></span>
      </div>
      <div id="hg-status"></div>
      <div id="hg-disclaimer">
        Miễn trừ trách nhiệm: Công cụ này chỉ hỗ trợ học tập. Không khuyến khích sử dụng trong thi cử.
      </div>
    </div>
    <input type="file" id="hg-file-input" accept=".xlsx,.xls,.csv,.txt" style="display:none;">
  `;
  document.body.appendChild(container);

  // 2. Thêm CSS (ĐÃ CẬP NHẬT Z-INDEX VÀ !IMPORTANT)
  const style = document.createElement("style");
  style.textContent = `
    #hg-assistant-container {
      position: fixed !important;
      bottom: 20px !important;
      right: 20px !important;
      z-index: 2147483647 !important; /* Đặt z-index cao nhất */
      width: 300px !important;
      display: block !important;
      visibility: visible !important;
      opacity: 1 !important;
      border-radius: 12px;
      background: #ffffff;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Arial, sans-serif;
      box-shadow: 0 5px 20px rgba(0, 0, 0, 0.15);
      overflow: hidden;
      transition: all 0.3s ease;
      border: 1px solid #e0e0e0;
    }
    #hg-assistant-container.hg-minimized {
      height: 40px !important;
      width: 200px !important;
      bottom: 0 !important;
      right: 20px !important;
      border-bottom-left-radius: 0;
      border-bottom-right-radius: 0;
    }
    #hg-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 10px 15px;
      background: #f7f9fa;
      border-bottom: 1px solid #e0e0e0;
      color: #333;
    }
    #hg-toggle-btn {
      background: #e0e0e0;
      border: none;
      border-radius: 50%;
      width: 20px;
      height: 20px;
      cursor: pointer;
      font-weight: bold;
      line-height: 18px;
      padding: 0;
      color: #555;
      transition: transform 0.3s ease;
    }
    #hg-assistant-container.hg-minimized #hg-body {
      display: none;
    }
    #hg-assistant-container.hg-minimized #hg-toggle-btn {
      transform: rotate(180deg);
    }
    #hg-body {
      padding: 15px;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    #hg-dropzone {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 20px;
      border: 2px dashed #007bff;
      border-radius: 8px;
      background: #f4f8ff;
      text-align: center;
      cursor: pointer;
      transition: background 0.2s ease;
    }
    #hg-dropzone.hg-dragover {
      background: #e6f0ff;
      border-color: #0056b3;
    }
    #hg-dropzone span {
      font-size: 13px;
      color: #555;
    }
    #hg-dropzone span#hg-file-name {
      font-size: 12px;
      color: #0056b3;
      font-weight: bold;
      margin-top: 8px;
    }
    #hg-status {
      font-size: 13px;
      font-weight: 500;
      text-align: center;
      color: #333;
      padding: 5px;
    }
    #hg-status.hg-success {
      color: #28a745;
    }
    #hg-status.hg-error {
      color: #dc3545;
    }
    #hg-disclaimer {
      font-size: 11px;
      color: #888;
      text-align: center;
      border-top: 1px solid #eee;
      padding-top: 10px;
    }
    
    /* CSS cho Nút Kích hoạt (thêm mới) */
    #hg-assistant-container button.hg-activate-btn {
        background-color: #007bff; color: white; padding: 12px; 
        border: none; border-radius: 5px; cursor: pointer; font-size: 16px;
        width: 100%; margin-top: 10px;
    }
    #hg-assistant-container button.hg-upload-lic-btn {
        background-color: #6c757d; color: white; padding: 12px; 
        border: none; border-radius: 5px; cursor: pointer; font-size: 16px;
        width: 100%; margin-top: 5px;
    }
    #hg-assistant-container input.hg-license-input {
        width: calc(100% - 20px); padding: 10px; margin-top: 15px; 
        border: 1px solid #ccc; border-radius: 4px; box-sizing: border-box;
    }
    #hg-activation-status {
        margin-top: 10px; text-align: center; font-weight: bold;
    }
  `;
  document.head.appendChild(style);

  // 3. Lấy các element
  const dropzone = document.getElementById("hg-dropzone");
  const fileInput = document.getElementById("hg-file-input");
  const toggleBtn = document.getElementById("hg-toggle-btn");
  const fileNameEl = document.getElementById("hg-file-name");
  
  // 🔥 THAY ĐỔI: Lấy statusEl và hiển thị link template ngay
  const statusEl = document.getElementById("hg-status");
  try {
    const templateUrl = chrome.runtime.getURL('template/template_import.xlsx');
    const link = document.createElement('a');
    link.href = templateUrl;
    link.textContent = 'Tải file mẫu (template)';
    link.download = 'template_import.xlsx'; // Gợi ý tên file khi tải
    link.style.color = "#0056b3";
    link.style.textDecoration = "underline";
    link.style.fontSize = "12px";
    link.style.cursor = "pointer";
    
    statusEl.appendChild(link);
  } catch (err) {
    console.error("Lỗi khi tạo link tải file mẫu:", err);
  }

  // 4. Gắn sự kiện
  dropzone.onclick = () => fileInput.click();
  
  // Thu nhỏ
  toggleBtn.onclick = () => {
    container.classList.toggle("hg-minimized");
  };

  // Kéo thả file
  dropzone.ondragover = (e) => {
    e.preventDefault();
    dropzone.classList.add("hg-dragover");
  };
  dropzone.ondragleave = () => {
    dropzone.classList.remove("hg-dragover");
  };
  dropzone.ondrop = (e) => {
    e.preventDefault();
    dropzone.classList.remove("hg-dragover");
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      const file = e.dataTransfer.files[0];
      fileInput.files = e.dataTransfer.files; // Gán file vào input
      fileNameEl.textContent = file.name;
      handleFile({ target: fileInput }); // Gọi hàm handleFile
    }
  };

  // Sự kiện onchange của input (khi chọn file bằng cách click)
  fileInput.onchange = (e) => {
    const file = e.target.files[0];
    if (file) {
      fileNameEl.textContent = file.name;
      handleFile(e); // Gọi hàm handleFile
    }
  };
}


/* ---------------- GIAO DIỆN KÍCH HOẠT (đã FIX) ---------------- */
function showActivationUI() {
  try {
    // 🔥 FIX: luôn xóa UI cũ nếu còn tồn tại
    const oldContainer = document.getElementById('hg-assistant-container');
    if (oldContainer) {
      oldContainer.style.transition = "opacity 0.3s ease";
      oldContainer.style.opacity = "0";
      setTimeout(() => oldContainer.remove(), 300);
    }

    const container = document.createElement('div');
    container.id = 'hg-assistant-container';
    container.innerHTML = `
      <div id="hg-header"><strong>Trợ lý Học tập HG</strong></div>
      <div id="hg-body">
        <div style="font-size:16px;font-weight:bold;text-align:center;color:#e74c3c;">Hết hạn dùng thử!</div>
        <div style="font-size:12px;color:#333;margin-top:10px;text-align:center;">Vui lòng kích hoạt bản quyền để tiếp tục sử dụng.</div>
        <input type="text" id="license-key-input" class="hg-license-input" placeholder="Nhập key bản quyền...">
        <button id="activate-btn" class="hg-activate-btn">Kích hoạt</button>
        <button id="upload-lic-btn" class="hg-upload-lic-btn">... hoặc tải file license (.lic)</button>
        <div id="hg-activation-status"></div>
        <input type="file" id="license-file-input" accept=".lic,.txt" style="display:none;">
      </div>
    `;
    document.body.appendChild(container);

    // CSS này sẽ được áp dụng bởi style chung trong showMainUI
    // nhưng chúng ta cần đảm bảo border và các style riêng cho UI này
    // (Lưu ý: CSS từ showMainUI đã được thêm vào head)
    container.style.borderColor = "#e74c3c";
    
    // Thêm CSS riêng cho Activation UI nếu CSS chung chưa được tải
    if (!document.head.textContent.includes("#hg-assistant-container button.hg-activate-btn")) {
        const css = document.createElement('style');
        css.textContent = `
          #hg-assistant-container { position:fixed;bottom:20px;right:20px;z-index:2147483647;width:300px;border:2px solid #e74c3c;border-radius:12px;background:#fff;padding:15px;box-shadow:0 5px 20px rgba(0,0,0,0.15);}
          #hg-assistant-container button.hg-activate-btn{background-color:#007bff;color:white;padding:10px;border:none;border-radius:5px;cursor:pointer;width:100%;margin-top:10px;}
          #hg-assistant-container button.hg-upload-lic-btn{background-color:#6c757d;color:white;padding:10px;border:none;border-radius:5px;cursor:pointer;width:100%;margin-top:5px;}
          .hg-license-input{width:calc(100% - 20px);padding:10px;margin-top:15px;border:1px solid #ccc;border-radius:4px;}
          #hg-activation-status{text-align:center;margin-top:10px;font-weight:bold;}
        `;
        document.head.appendChild(css);
    }

    document.getElementById('activate-btn').addEventListener('click', handleActivation);
    document.getElementById('upload-lic-btn').addEventListener('click', () => document.getElementById('license-file-input').click());
    document.getElementById('license-file-input').addEventListener('change', handleLicFile);
  } catch (error) {
    console.error("HG Assistant: Lỗi khi hiển thị giao diện kích hoạt", error);
  }
}

/* ---------------- XỬ LÝ LICENSE ---------------- */
async function handleLicFile(event) {
  const file = event.target.files[0];
  const statusEl = document.getElementById('hg-activation-status');
  if (!file) return;

  statusEl.style.color = '#e67e22';
  statusEl.textContent = 'Đang đọc file license...';

  const reader = new FileReader();
  reader.onload = async e => {
    try {
      const keyFromFile = e.target.result.trim();
      if (!keyFromFile) {
        statusEl.style.color = 'red';
        statusEl.textContent = 'File rỗng hoặc không đọc được!';
        return;
      }
      document.getElementById('license-key-input').value = keyFromFile;
      statusEl.textContent = 'Đã đọc key. Đang kích hoạt...';
      await handleActivation();
    } catch {
      statusEl.style.color = 'red';
      statusEl.textContent = 'Lỗi khi đọc file.';
    }
  };
  reader.readAsText(file);
}

async function handleActivation() {
  const statusEl = document.getElementById('hg-activation-status');
  const keyInput = document.getElementById('license-key-input');
  if (!keyInput) {
      console.error("Không tìm thấy #license-key-input");
      return;
  }
  const key = keyInput.value.trim();
  if (!key) {
    statusEl.style.color = 'red';
    statusEl.textContent = 'Vui lòng nhập key bản quyền!';
    return;
  }

  const expiryDate = validateLicenseKey(key);
  if (expiryDate && new Date() < expiryDate) {
    await chrome.storage.local.set({ encryptedLicenseKey: key });
    await chrome.storage.local.remove('installDate');
    statusEl.style.color = 'green';
    statusEl.textContent = 'Kích hoạt thành công! Đang tải lại...';
    setTimeout(() => location.reload(), 1500);
  } else {
    statusEl.style.color = 'red';
    statusEl.textContent = 'Key không hợp lệ hoặc đã hết hạn!';
  }
}


/* ---------------- HÀM HỖ TRỢ (ĐÃ THAY THẾ) ---------------- */
/**
 * Hàm làm sạch văn bản (từ v2.0 của bạn)
 * Sẽ thay thế cho hàm normalize cũ
 */
function normalize(text) {
  if (typeof text !== 'string') return '';
  return text
      .toLowerCase() // 1. Chuyển thành chữ thường
      .replace(/^(chọn một:|select one:|([a-z])\.)\s*/i, '') // 2. Xóa tiền tố "A. "
      .replace(/[\u2018\u2019]/g, "'") // Chuẩn hóa dấu nháy đơn
      .replace(/[\u201C\u201D]/g, '"') // Chuẩn hóa dấu nháy kép
      .replace(/[\u200B-\u200D\uFEFF]/g, '') // 3. Xóa các ký tự "vô hình"
      .replace(/\s+/g, ' ') // 4. Chuẩn hóa tất cả khoảng trắng
      .trim(); // 5. Xóa khoảng trắng thừa ở đầu/cuối
}

// Hàm này vẫn cần thiết cho định dạng .txt
function extractQA(lines) {
  const qa = [];
  let q = "", a = "";
  for (let line of lines) {
    // 🔥 FIX: Chỉ coi là câu hỏi nếu bắt đầu bằng "Câu [số]" hoặc "Câu hỏi:"
    if (/^câu\s*\d+/i.test(line) || line.toLowerCase().startsWith("câu hỏi:")) {
      if (q && a) qa.push({ q, a }); // Push previous
      q = line.replace(/^câu\s*\d*:*/i, "").replace(/^câu hỏi:*/i, "").trim();
      a = "";
    } 
    else if (/^đáp án/i.test(line)) {
      a = line.replace(/^đáp án(\s*đúng)?:*/i, "").trim();
    } 
    else { // Continuation line
      if (!a) q += " " + line; // continuation of question
      else a += " " + line; // continuation of answer
    }
  }
  if (q && a) qa.push({ q, a }); // Push the last one
  return qa;
}

function similarity(a, b) {
  const longer = a.length > b.length ? a : b;
  const shorter = a.length > b.length ? b : a;
  if (!longer.length) return 1;
  const same = longer.length - editDistance(longer, shorter);
  return same / longer.length;
}

function editDistance(a, b) {
  const matrix = Array.from({ length: b.length + 1 }, (_, i) => [i]);
  for (let j = 0; j <= a.length; j++) matrix[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      matrix[i][j] =
        b[i - 1] === a[j - 1]
          ? matrix[i - 1][j - 1]
          : Math.min(matrix[i - 1][j - 1] + 1, matrix[i][j - 1] + 1, matrix[i - 1][j] + 1);
    }
  }
  return matrix[b.length][a.length];
}

/* ---------------- HIGHLIGHT (ĐÃ ĐIỀU CHỈNH) ---------------- */
function processAnswers(lines) {
  // Hàm này vẫn dùng extractQA, vì lines bây giờ đã là định dạng chuẩn
  // (ví dụ: ["Câu hỏi: ...", "Đáp án đúng: ..."])
  // bất kể file gốc là xlsx, csv hay txt.
  const qaPairs = extractQA(lines); 
  // console.log("📘 Đã nạp", qaPairs.length, "câu hỏi từ file."); // <--- ĐÃ XÓA THEO YÊU CẦU
  const statusEl = document.getElementById("hg-status"); // Lấy status element

  if (qaPairs.length === 0) {
      console.warn("Không nạp được cặp câu hỏi/đáp án nào. Kiểm tra lại file.");
      if(statusEl && !statusEl.classList.contains('hg-error')) { // Chỉ cập nhật nếu chưa có lỗi nặng hơn
          statusEl.textContent = "⚠️ Không tìm thấy QA trong file.";
          statusEl.className = "hg-error";
      }
      return; // Dừng lại nếu không có gì để highlight
  }

  const questions = document.querySelectorAll(SELECTORS.questionBlock);
  let highlightedCount = 0;

  // Xóa các highlight cũ trước khi bắt đầu
  document.querySelectorAll('.hg-highlighted-answer').forEach(el => { 
    el.style.backgroundColor = ''; 
    el.classList.remove('hg-highlighted-answer'); 
  });

  questions.forEach((qEl, idx) => {
    // Sử dụng hàm normalize (mới) để làm sạch câu hỏi trên trang
    const qText = normalize(qEl.querySelector(SELECTORS.questionText)?.innerText || "");
    let pair = qaPairs[idx]; // Ưu tiên theo thứ tự

    // Nếu khác biệt quá lớn -> fallback fuzzy match
    // Sử dụng hàm normalize (mới) để làm sạch câu hỏi từ file
    if (!pair || similarity(normalize(pair.q), qText) < 0.5) {
      let best = null, bestScore = 0;
      qaPairs.forEach(p => {
        const s = similarity(normalize(p.q), qText);
        if (s > bestScore) { bestScore = s; best = p; }
      });
      pair = best;
    }

    if (!pair) return;
    
    // Sử dụng hàm normalize (mới) để làm sạch đáp án từ file
    const answerFromFile = normalize(pair.a);

    qEl.querySelectorAll(SELECTORS.answerOption).forEach(opt => {
      // Sử dụng hàm normalize (mới) để làm sạch đáp án trên trang
      const optTextOnPage = normalize(opt.innerText || opt.textContent);
      
      // Khôi phục style cũ trước khi highlight
      opt.style.backgroundColor = "";
      opt.style.border = "";
      opt.style.transition = "";
      opt.classList.remove('hg-highlighted-answer');

      // ===== THAY ĐỔI LOGIC SO KHỚP (theo v2.0) =====
      // Sử dụng so sánh BẰNG NHAU (===) sau khi đã làm sạch
      if (optTextOnPage && answerFromFile && optTextOnPage === answerFromFile) {
        opt.style.backgroundColor = "#fff1a0"; // Giữ màu vàng nhạt
        opt.classList.add('hg-highlighted-answer'); // Thêm class để theo dõi
        // ===========================================
        highlightedCount++;
      }
    });
  });

  console.log(`✅ Đã highlight ${highlightedCount} đáp án.`); // Giữ log console, nhưng thay đổi UI
  
  if(statusEl && !statusEl.classList.contains('hg-error')) {
      // Xóa nội dung cũ (ví dụ: "📖 Đang đọc file...")
      statusEl.innerHTML = ""; 
      statusEl.className = ""; // Reset class

      // Tạo link tải file mẫu
      try {
        const templateUrl = chrome.runtime.getURL('template/templat_import.xlsx');
        const link = document.createElement('a');
        link.href = templateUrl;
        link.textContent = 'Tải file mẫu (template)';
        link.download = 'templat_import.xlsx'; // Gợi ý tên file khi tải
        link.style.color = "#0056b3";
        link.style.textDecoration = "underline";
        link.style.fontSize = "12px";
        link.style.cursor = "pointer";
        
        statusEl.appendChild(link);
      } catch (err) {
        console.error("Lỗi khi tạo link tải file mẫu:", err);
        // Fallback nếu getURL lỗi (ví dụ: chưa thêm vào manifest)
        // Hiển thị lại số câu đã highlight
        statusEl.textContent = `✅ Đã highlight ${highlightedCount} đáp án.`;
        statusEl.className = "hg-success";
      }
  }
}

/* ---------------- KHỞI ĐỘNG (ĐÃ CẬP NHẬT) ---------------- */
// 🔥 THAY ĐỔI: Chờ DOM tải xong mới chạy
function runAssistant() {
    (async () => {
      // === BỎ DEBUGGING LOGS ===
      // console.log("--- BẮT ĐẦU KIỂM TRA KHỞI ĐỘNG ---");
      const { allowedDomains = [] } = await chrome.storage.local.get("allowedDomains");
      // console.log("Domains đã lưu:", JSON.stringify(allowedDomains));
      
      const host = window.location.hostname.toLowerCase();
      // console.log("Host hiện tại:", host);
    
      const valid = allowedDomains.some(d => host.includes(d.toLowerCase().replace(/^https?:\/\//, "")));
      // console.log("Domain có hợp lệ không? (valid):", valid);
      // === KẾT THÚC DEBUGGING ===
    
      if (!valid) return console.log("HG Assistant: Domain không hợp lệ (ĐÃ DỪNG TẠI ĐÂY).");
      
      // console.log("Domain hợp lệ, tiếp tục kiểm tra status..."); 
      
      const status = await checkLicenseStatus();
      // console.log("Trạng thái license:", status);
      
      if (status === 'ACTIVE' || status === 'TRIAL') {
             // console.log("Hiển thị Main UI");
             showMainUI();
      } else if (status === 'EXPIRED') {
             // console.log("Hiển thị Activation UI");
             showActivationUI();
      }
      // Nếu là 'ERROR', sẽ không làm gì cả (chỉ log lỗi ở console)
    })();
}

// Chờ cho document sẵn sàng
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', runAssistant);
} else {
    runAssistant(); // Chạy ngay nếu DOM đã tải
}

