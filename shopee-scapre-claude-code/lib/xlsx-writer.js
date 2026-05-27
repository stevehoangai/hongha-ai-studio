// Minimal dependency-free XLSX writer.
// Sinh file .xlsx hợp lệ bằng cách đóng gói các phần XML vào 1 ZIP STORE (không nén).
// Hỗ trợ 1 sheet, kiểu inlineStr cho text và <v> cho số. Đủ dùng cho dữ liệu bảng.

(function (global) {
  const crcTable = (function () {
    const table = new Uint32Array(256);
    for (let i = 0; i < 256; i++) {
      let c = i;
      for (let k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(data) {
    let crc = 0xFFFFFFFF;
    for (let i = 0; i < data.length; i++) {
      crc = crcTable[(crc ^ data[i]) & 0xFF] ^ (crc >>> 8);
    }
    return (crc ^ 0xFFFFFFFF) >>> 0;
  }

  const enc = new TextEncoder();
  function strToBytes(s) { return enc.encode(s); }

  // Regex các ký tự control mà XML 1.0 không cho phép. Tạo bằng new RegExp để giữ nguyên escape.
  const CTRL_CHARS = new RegExp('[\\u0000-\\u0008\\u000B\\u000C\\u000E-\\u001F]', 'g');
  const XML_SPECIAL = /[<>&"']/g;
  const XML_MAP = { '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' };

  function escapeXml(s) {
    return String(s).replace(CTRL_CHARS, '').replace(XML_SPECIAL, function (c) { return XML_MAP[c]; });
  }

  function colLetter(n) {
    let s = '';
    while (n > 0) {
      const m = (n - 1) % 26;
      s = String.fromCharCode(65 + m) + s;
      n = Math.floor((n - 1) / 26);
    }
    return s;
  }

  function buildSheetXml(rows) {
    let xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
      + '<sheetData>';
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      xml += '<row r="' + (i + 1) + '">';
      for (let j = 0; j < row.length; j++) {
        const cell = row[j];
        if (cell === null || cell === undefined || cell === '') continue;
        const ref = colLetter(j + 1) + (i + 1);
        if (typeof cell === 'number' && isFinite(cell)) {
          xml += '<c r="' + ref + '"><v>' + cell + '</v></c>';
        } else {
          xml += '<c r="' + ref + '" t="inlineStr"><is><t xml:space="preserve">'
            + escapeXml(cell) + '</t></is></c>';
        }
      }
      xml += '</row>';
    }
    xml += '</sheetData></worksheet>';
    return xml;
  }

  function makeZip(files) {
    const localChunks = [];
    const centralChunks = [];
    let offset = 0;

    for (const f of files) {
      const nameBytes = strToBytes(f.name);
      const data = f.data;
      const crc = crc32(data);
      const size = data.length;

      const lh = new Uint8Array(30 + nameBytes.length);
      const lv = new DataView(lh.buffer);
      lv.setUint32(0, 0x04034b50, true);
      lv.setUint16(4, 20, true);
      lv.setUint16(6, 0, true);
      lv.setUint16(8, 0, true);
      lv.setUint16(10, 0, true);
      lv.setUint16(12, 0, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);
      lv.setUint32(22, size, true);
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);
      lh.set(nameBytes, 30);

      localChunks.push(lh, data);

      const ch = new Uint8Array(46 + nameBytes.length);
      const cv = new DataView(ch.buffer);
      cv.setUint32(0, 0x02014b50, true);
      cv.setUint16(4, 20, true);
      cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true);
      cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true);
      cv.setUint16(14, 0, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);
      cv.setUint16(32, 0, true);
      cv.setUint16(34, 0, true);
      cv.setUint16(36, 0, true);
      cv.setUint32(38, 0, true);
      cv.setUint32(42, offset, true);
      ch.set(nameBytes, 46);
      centralChunks.push(ch);

      offset += lh.length + data.length;
    }

    const centralStart = offset;
    let centralSize = 0;
    for (const c of centralChunks) centralSize += c.length;

    const eocd = new Uint8Array(22);
    const ev = new DataView(eocd.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, files.length, true);
    ev.setUint16(10, files.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, centralStart, true);
    ev.setUint16(20, 0, true);

    const total = offset + centralSize + 22;
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of localChunks) { out.set(c, p); p += c.length; }
    for (const c of centralChunks) { out.set(c, p); p += c.length; }
    out.set(eocd, p);
    return out;
  }

  function buildXlsx(rows, sheetName) {
    const safeName = (sheetName || 'Sheet1').replace(/[\\/?*\[\]:]/g, ' ').slice(0, 31) || 'Sheet1';
    const sheetXml = buildSheetXml(rows);

    const contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      + '<Default Extension="xml" ContentType="application/xml"/>'
      + '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      + '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
      + '</Types>';

    const rootRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
      + '</Relationships>';

    const workbook = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
      + '<sheets><sheet name="' + escapeXml(safeName) + '" sheetId="1" r:id="rId1"/></sheets>'
      + '</workbook>';

    const workbookRels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
      + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
      + '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>'
      + '</Relationships>';

    const files = [
      { name: '[Content_Types].xml', data: strToBytes(contentTypes) },
      { name: '_rels/.rels', data: strToBytes(rootRels) },
      { name: 'xl/workbook.xml', data: strToBytes(workbook) },
      { name: 'xl/_rels/workbook.xml.rels', data: strToBytes(workbookRels) },
      { name: 'xl/worksheets/sheet1.xml', data: strToBytes(sheetXml) },
    ];

    return makeZip(files);
  }

  global.XlsxWriter = { buildXlsx: buildXlsx };
})(typeof window !== 'undefined' ? window : self);
