import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ArrowUpDown,
  CheckCircle2,
  Clock,
  Database,
  Download,
  Droplets,
  Eye,
  EyeOff,
  FileText,
  Loader2,
  Moon,
  Mail,
  Printer,
  Pencil,
  RotateCcw,
  RotateCw,
  Save,
  ScanLine,
  Sparkles,
  Sun,
  Table as TableIcon,
  Thermometer,
  Trash2,
  Upload,
  X,
} from 'lucide-react';

const WORKER_API_URL = 'https://ocr-api.sakaretblank.workers.dev';
const LOCAL_STORAGE_KEY = 'drying_process_history_v3';

// ดึง JSON ออกจากข้อความตอบกลับ แม้ AI จะครอบด้วย Markdown code fence
const parseSafeJson = (text) => {
  if (!text) {
    throw new Error('ไม่พบข้อมูลตอบกลับจากเซิร์ฟเวอร์');
  }

  const cleaned = text
    .trim()
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```\s*$/i, '')
    .trim();

try {
    return JSON.parse(cleaned);
  } catch (e) {
    const start = cleaned.indexOf('{');
    const end = cleaned.lastIndexOf('}');
    if (start !== -1 && end !== -1 && end > start) {
      const jsonSub = cleaned.substring(start, end + 1);
      return JSON.parse(jsonSub);
    }
    throw new Error('ไม่สามารถแปลงข้อมูลที่เซิร์ฟเวอร์ส่งกลับมาเป็น JSON ได้');
  }
};

// โหลดไฟล์รูปเป็น Image object
const loadImageFromFile = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('ไม่สามารถอ่านไฟล์รูปภาพได้'));
    reader.onload = (event) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('ไม่สามารถเปิดไฟล์รูปภาพได้'));
      img.src = event.target.result;
    };
    reader.readAsDataURL(file);
  });
};

// ปรับมุมหมุนให้เป็น 0 / 90 / 180 / 270 (ตามเข็มนาฬิกา)
const normalizeRotation = (value) => {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return (((Math.round(number / 90) * 90) % 360) + 360) % 360;
};

// วาดรูปลง canvas พร้อมหมุนตามเข็มนาฬิกา แล้วคืนเป็น data URL แบบ JPEG
// maxWidth จำกัดความกว้าง "หลังหมุนแล้ว"
const renderRotatedJpeg = (img, rotation = 0, maxWidth = 2400, quality = 0.88) => {
  const degrees = normalizeRotation(rotation);
  const swapped = degrees === 90 || degrees === 270;
  const rotatedWidth = swapped ? img.height : img.width;
  const rotatedHeight = swapped ? img.width : img.height;
  const scale = rotatedWidth > maxWidth ? maxWidth / rotatedWidth : 1;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(rotatedWidth * scale);
  canvas.height = Math.round(rotatedHeight * scale);

  const drawWidth = img.width * scale;
  const drawHeight = img.height * scale;
  const ctx = canvas.getContext('2d');
  ctx.translate(canvas.width / 2, canvas.height / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(img, -drawWidth / 2, -drawHeight / 2, drawWidth, drawHeight);

  return canvas.toDataURL('image/jpeg', quality);
};

// บีบอัดรูปภาพ (และหมุนตามที่ระบุ) ก่อนส่ง API
const compressImage = async (file, maxWidth = 2400, rotation = 0) => {
  const img = await loadImageFromFile(file);
  return renderRotatedJpeg(img, rotation, maxWidth).split(',')[1];
};

// ขอให้ Worker ตรวจทิศทางภาพ (โหมด precheck) ใช้เฉพาะภาพแนวตั้งเพื่อประหยัดโควตา
// ฟอร์มนี้เป็นแนวนอน ภาพแนวตั้งจึงมักหมุนมา 90°
const requestOrientationCheck = async (file) => {
  const img = await loadImageFromFile(file);
  if (img.height <= img.width) return { checked: false };

  const imageBase64 = renderRotatedJpeg(img, 0, 1200, 0.8).split(',')[1];
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 25000);

  try {
    const response = await fetch(WORKER_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: 'precheck', imageBase64 }),
      signal: controller.signal,
    });
    const responseText = await response.text();
    const result = parseSafeJson(responseText);
    if (!response.ok) throw new Error(result.error || `HTTP Error ${response.status}`);
    return { checked: true, ...result };
  } finally {
    clearTimeout(timer);
  }
};

const generateEmptyData = () => {
  const times = ['08.00', '09.00', '10.00', '11.00', '12.00', '13.00', '14.00', '15.00', '16.00', '17.00', '18.00', '19.00', '20.00', '21.00', '22.00', '23.00', '24.00', '01.00', '02.00', '03.00', '04.00', '05.00', '06.00', '07.00'];
  return times.map((time, index) => ({
    id: index + 1, time, productType: '', dw1: '', dw2: '', dw3: '', dw4: '', dw5: '', hotAirIn: '', hotAirOut: '', speed: '', wetCakeMoisture: '', productMoisture: '', changeDwFilter: '', remark: '', unreadableFields: []
  }));
};

// ฟังก์ชันแปลงเครื่องหมายซ้ำ (") เป็นชื่อแป้งจริง
const resolveProductTypesList = (rows) => {
  let lastType = '';
  return rows.map((row) => {
    const raw = (row.productType || '').trim();
    if (raw === '"' || raw === '〃' || raw === "''" || raw === '”' || raw === '″' || raw === '“') {
      return lastType || '-';
    }
    if (raw !== '') {
      lastType = raw;
      return raw;
    }
    return lastType || '-';
  });
};


const parseNumericValue = (value) => {
  const text = String(value ?? '').trim().replace(/,/g, '');
  if (!/^-?\d+(?:\.\d+)?%?$/.test(text)) return null;
  const parsed = Number.parseFloat(text.replace('%', ''));
  return Number.isFinite(parsed) ? parsed : null;
};

// คำมาตรฐานที่ QC ใช้บ่อยในช่องความชื้น
const MOISTURE_TEXT_OPTIONS = {
  wetCakeMoisture: [
    'แป้งไม่ลง',
    'แซะสลัด',
  ],
  productMoisture: [
    'แป้งไม่ลง',
    'แป้งไม่ลง หยุดรอความเหนียว',
    'แป้งไม่ลง หยุดซ่อม',
  ],
};

// ลดความแตกต่างจากช่องว่าง เครื่องหมาย และอักขระที่ OCR มักอ่านเกินมา
const compactOcrText = (value) => String(value ?? '')
  .normalize('NFC')
  .toLowerCase()
  .replace(/[\s.,:;!?'"`~_\-–—/\\|()[\]{}]+/g, '')
  .replace(/[๐-๙]/g, (digit) => String('๐๑๒๓๔๕๖๗๘๙'.indexOf(digit)))
  .trim();

const levenshteinDistance = (left, right) => {
  const a = Array.from(left);
  const b = Array.from(right);
  const previous = Array.from({ length: b.length + 1 }, (_, index) => index);

  for (let i = 1; i <= a.length; i += 1) {
    const current = [i];
    for (let j = 1; j <= b.length; j += 1) {
      current[j] = Math.min(
        current[j - 1] + 1,
        previous[j] + 1,
        previous[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
    previous.splice(0, previous.length, ...current);
  }

  return previous[b.length];
};

const similarityScore = (left, right) => {
  if (!left || !right) return 0;
  const longest = Math.max(Array.from(left).length, Array.from(right).length);
  return longest === 0 ? 1 : 1 - (levenshteinDistance(left, right) / longest);
};

// แก้คำไทยที่ OCR อ่านเพี้ยน โดยไม่แตะค่าตัวเลขจริง
const normalizeMoistureText = (value, field) => {
  const raw = String(value ?? '').trim();
  if (!raw || parseNumericValue(raw) !== null) {
    return { value: raw, corrected: false, confidence: 1 };
  }

  const compact = compactOcrText(raw);
  const options = MOISTURE_TEXT_OPTIONS[field] || [];
  if (!compact || options.length === 0) {
    return { value: raw, corrected: false, confidence: 0 };
  }

  // กฎตามความหมาย ช่วยกรณีลายมือเพี้ยนหลายตัวแต่ยังจับคำสำคัญได้
  if (field === 'wetCakeMoisture') {
    if ((compact.includes('แซะ') || compact.includes('แชะ') || compact.includes('เซะ')) &&
        (compact.includes('สลัด') || compact.includes('สลัต') || compact.includes('สลต'))) {
      return { value: 'แซะสลัด', corrected: raw !== 'แซะสลัด', confidence: 0.98 };
    }
    if ((compact.includes('แป้ง') || compact.includes('แปง')) &&
        (compact.includes('ไม่ลง') || compact.includes('ไมลง') || compact.includes('ม่ลง'))) {
      return { value: 'แป้งไม่ลง', corrected: raw !== 'แป้งไม่ลง', confidence: 0.98 };
    }
  }

  if (field === 'productMoisture') {
    const looksLikeNoProduct = (compact.includes('แป้ง') || compact.includes('แปง')) &&
      (compact.includes('ไม่ลง') || compact.includes('ไมลง') || compact.includes('ม่ลง'));
    const looksLikeViscosityWait = compact.includes('ความเหนียว') || compact.includes('เหนียว') || compact.includes('รอความ');
    const looksLikeRepair = compact.includes('ซ่อม') || compact.includes('ช่อม') || compact.includes('ส่อม');

    if (looksLikeViscosityWait) {
      return { value: 'แป้งไม่ลง หยุดรอความเหนียว', corrected: raw !== 'แป้งไม่ลง หยุดรอความเหนียว', confidence: 0.98 };
    }
    if (looksLikeRepair) {
      return { value: 'แป้งไม่ลง หยุดซ่อม', corrected: raw !== 'แป้งไม่ลง หยุดซ่อม', confidence: 0.98 };
    }
    if (looksLikeNoProduct) {
      return { value: 'แป้งไม่ลง', corrected: raw !== 'แป้งไม่ลง', confidence: 0.98 };
    }
  }

  const candidates = options.map((option) => ({
    option,
    score: similarityScore(compact, compactOcrText(option)),
  })).sort((a, b) => b.score - a.score);

  const best = candidates[0];
  // เกณฑ์ค่อนข้างเข้ม เพื่อไม่เปลี่ยนข้อความอื่นของ QC โดยผิดความหมาย
  if (best && best.score >= 0.72) {
    return {
      value: best.option,
      corrected: raw !== best.option,
      confidence: best.score,
    };
  }

  return { value: raw, corrected: false, confidence: best?.score || 0 };
};



const CANONICAL_REPORT_TIMES = [
  '08.00', '09.00', '10.00', '11.00', '12.00', '13.00',
  '14.00', '15.00', '16.00', '17.00', '18.00', '19.00',
  '20.00', '21.00', '22.00', '23.00', '24.00', '01.00',
  '02.00', '03.00', '04.00', '05.00', '06.00', '07.00',
];

const normalizeReportTime = (value) => {
  const raw = String(value ?? '').trim();
  const match = raw.match(/^(?:เวลา\s*)?([0-2]?\d)[:.]([0-5]\d)$/i);
  if (!match) return '';
  let hour = Number(match[1]);
  if (hour === 0 && raw.startsWith('24')) hour = 24;
  return `${String(hour).padStart(2, '0')}.${match[2]}`;
};

const FIELD_RANGES = {
  hotAirIn: [80, 200],
  hotAirOut: [20, 100],
  speed: [0, 100],
  wetCakeMoisture: [15, 50],
  productMoisture: [5, 25],
};

const validateNumericField = (value, field) => {
  const raw = String(value ?? '').trim();
  if (!raw) return { value: '', suspicious: false };
  const numeric = parseNumericValue(raw);
  if (numeric === null) return { value: raw, suspicious: false };
  const range = FIELD_RANGES[field];
  if (!range) return { value: raw, suspicious: false };
  const suspicious = numeric < range[0] || numeric > range[1];
  return { value: raw, suspicious };
};

// จัดผล OCR กลับเข้ากับ 24 แถวตามเวลา เพื่อลดปัญหาแถวไหลหรือข้อมูลเลื่อนตำแหน่ง
const alignOcrRowsToCanonicalTimes = (rows) => {
  const sourceRows = Array.isArray(rows) ? rows : [];
  const byTime = new Map();
  const duplicateTimes = new Set();

  sourceRows.forEach((row) => {
    const time = normalizeReportTime(row?.time);
    if (!CANONICAL_REPORT_TIMES.includes(time)) return;
    if (byTime.has(time)) duplicateTimes.add(time);
    else byTime.set(time, row);
  });

  return CANONICAL_REPORT_TIMES.map((time, index) => {
    const source = byTime.get(time) || {};
    const sourceTime = normalizeReportTime(source.time);
    const alignmentWarning = sourceTime && sourceTime !== time;
    const unreadableFields = Array.isArray(source.unreadableFields)
      ? [...source.unreadableFields]
      : [];

    if ((alignmentWarning || duplicateTimes.has(time)) && !unreadableFields.includes('time')) {
      unreadableFields.push('time');
    }

    const validated = {};
    ['hotAirIn', 'hotAirOut', 'speed', 'wetCakeMoisture', 'productMoisture'].forEach((field) => {
      const check = validateNumericField(source[field], field);
      validated[field] = check.value;
      if (check.suspicious && !unreadableFields.includes(field)) unreadableFields.push(field);
    });

    return normalizeOcrRow({
      ...source,
      ...validated,
      time,
      unreadableFields,
    }, index);
  });
};

// ตรวจจับค่าที่กระโดดผิดธรรมชาติ เพื่อให้ผู้ใช้ตรวจซ้ำ โดยไม่แก้ค่าจริงให้อัตโนมัติ
const flagIsolatedNumericOutliers = (rows) => {
  const fields = ['hotAirIn', 'hotAirOut', 'speed', 'wetCakeMoisture', 'productMoisture'];
  const thresholds = {
    hotAirIn: 12,
    hotAirOut: 10,
    speed: 15,
    wetCakeMoisture: 4,
    productMoisture: 2,
  };

  return rows.map((row, index) => {
    const unreadableFields = Array.isArray(row.unreadableFields) ? [...row.unreadableFields] : [];
    fields.forEach((field) => {
      const current = parseNumericValue(row[field]);
      const previous = index > 0 ? parseNumericValue(rows[index - 1]?.[field]) : null;
      const next = index < rows.length - 1 ? parseNumericValue(rows[index + 1]?.[field]) : null;
      if (current === null || previous === null || next === null) return;
      const neighbourAverage = (previous + next) / 2;
      if (Math.abs(current - neighbourAverage) >= thresholds[field] && !unreadableFields.includes(field)) {
        unreadableFields.push(field);
      }
    });
    return { ...row, unreadableFields };
  });
};

const normalizeOcrRow = (row, idx) => {
  const wetResult = normalizeMoistureText(row.wetCakeMoisture, 'wetCakeMoisture');
  const productResult = normalizeMoistureText(row.productMoisture, 'productMoisture');
  const unreadableFields = Array.isArray(row.unreadableFields) ? [...row.unreadableFields] : [];

  // ถ้าเป็นข้อความที่ไม่ตรงคำมาตรฐานและความมั่นใจต่ำ ให้คงข้อความเดิมและเตือนผู้ใช้ตรวจสอบ
  if (wetResult.value && parseNumericValue(wetResult.value) === null && wetResult.confidence < 0.72 && !unreadableFields.includes('wetCakeMoisture')) {
    unreadableFields.push('wetCakeMoisture');
  }
  if (productResult.value && parseNumericValue(productResult.value) === null && productResult.confidence < 0.72 && !unreadableFields.includes('productMoisture')) {
    unreadableFields.push('productMoisture');
  }

  return {
    ...row,
    id: idx + 1,
    wetCakeMoisture: wetResult.value,
    productMoisture: productResult.value,
    unreadableFields,
    ocrCorrections: {
      wetCakeMoisture: wetResult.corrected,
      productMoisture: productResult.corrected,
    },
  };
};

const extractEventTime = (...values) => {
  for (const value of values) {
    const text = String(value || '');
    const match = text.match(/(?:^|\D)([01]?\d|2[0-4])[:.]([0-5]\d)(?:\D|$)/);
    if (match) {
      return `${String(Number(match[1])).padStart(2, '0')}:${match[2]}`;
    }
  }
  return null;
};

const normalizeProcessEvent = (row) => {
  const remarkRaw = String(row.remark || '').trim();
  const wetRaw = String(row.wetCakeMoisture || '').trim();
  const productRaw = String(row.productMoisture || '').trim();
  const remark = remarkRaw.toLowerCase();
  const wetText = wetRaw.toLowerCase();
  const productText = productRaw.toLowerCase();
  const eventTime = extractEventTime(remarkRaw, wetRaw, productRaw) || String(row.time || '').replace('.', ':');

  const isPowerOutage = remark.includes('ไฟดับ') || remark.includes('power outage') || remark.includes('power fail') || remark.includes('power stop') || remark.includes('power off');
  const isStopDryer = /(^|\s)(stop dryer|stop)(\s|$)/i.test(remark) || remark.includes('หยุดอบแป้ง');
  const isStartDryer = /(^|\s)(start dryer|start|power start)(\s|$)/i.test(remark) || remark === 'อบแป้ง' || remark.includes('เริ่มอบแป้ง');
  const isClothAction = ['แซะผ้า', 'เปลี่ยนผ้า', 'แซะสลัด', 'แซะผ้าสลัด'].some((word) => wetText.includes(word));
  const isMachineStop = ['แป้งไม่ลง', 'หยุดเครื่อง'].some((word) => productText.includes(word));

  if (isPowerOutage) return { type: 'powerOutage', label: 'ไฟดับ', color: '#60a5fa', source: remarkRaw, time: eventTime };
  if (isStopDryer) return { type: 'stopDryer', label: 'หยุดอบแป้ง', color: '#ef4444', source: remarkRaw, time: eventTime };
  if (isStartDryer) return { type: 'startDryer', label: 'เริ่มอบแป้ง', color: '#22c55e', source: remarkRaw, time: eventTime };
  if (isClothAction) return { type: 'clothAction', label: 'แซะ/เปลี่ยนผ้าสลัด', color: '#38bdf8', source: wetRaw, time: eventTime };
  if (isMachineStop) return { type: 'machineStop', label: 'หยุดเครื่อง', color: '#f59e0b', source: productRaw, time: eventTime };
  return null;
};


const EVENT_COLORS = {
  powerOutage: '#60a5fa',
  stopDryer: '#ef4444',
  startDryer: '#22c55e',
  clothAction: '#38bdf8',
  machineStop: '#f59e0b',
};

const getEventOverrideKey = (row, index = 0) => String(row?.id ?? row?.time ?? index);

const resolveProcessEvent = (row, index, eventOverrides = {}) => {
  const detected = normalizeProcessEvent(row);
  const override = eventOverrides?.[getEventOverrideKey(row, index)];
  if (override?.hidden) return null;
  if (!detected && !override?.label) return null;
  const type = override?.type || detected?.type || 'machineStop';
  return {
    ...(detected || {}),
    ...override,
    type,
    time: override?.time || detected?.time || String(row?.time || '').replace('.', ':'),
    label: override?.label || detected?.label || 'เหตุการณ์',
    color: EVENT_COLORS[type] || override?.color || detected?.color || '#94a3b8',
    edited: Boolean(override),
  };
};


const parseReportDate = (value) => {
  const raw = String(value || '').trim();
  const match = raw.match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{2,4})/);
  if (!match) return null;
  const day = Number(match[1]);
  const month = Number(match[2]);
  let year = Number(match[3]);
  if (year < 100) year = year >= 60 ? year + 1957 : year + 2000;
  if (year > 2400) year -= 543;
  const date = new Date(year, month - 1, day);
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
  return date;
};

const formatReportDateDisplay = (date) => {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
  return `${String(date.getDate()).padStart(2, '0')}/${String(date.getMonth() + 1).padStart(2, '0')}/${date.getFullYear() + 543}`;
};

const normalizeReportDateDisplay = (value) => {
  const parsed = parseReportDate(value);
  return parsed ? formatReportDateDisplay(parsed) : String(value || '').trim();
};

const formatDateKey = (date) => {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
};

const parseDateKey = (value) => {
  const match = String(value || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(date.getTime())) return null;
  if (date.getFullYear() !== Number(match[1]) || date.getMonth() !== Number(match[2]) - 1 || date.getDate() !== Number(match[3])) return null;
  return date;
};

const getRecordDateKey = (record) => {
  const parsed = parseReportDate(record?.date || record?.reportDate);
  return parsed ? formatDateKey(parsed) : '';
};

const getRecordTimestamp = (record) => {
  const parsed = new Date(record?.timestamp || record?.updatedAt || record?.createdAt || 0).getTime();
  return Number.isFinite(parsed) ? parsed : 0;
};

const sortHistoryRecords = (records, mode = 'DATE_DESC') => [...records].sort((left, right) => {
  const leftDate = parseReportDate(left?.date || left?.reportDate)?.getTime() || 0;
  const rightDate = parseReportDate(right?.date || right?.reportDate)?.getTime() || 0;
  if (mode === 'DATE_ASC') return leftDate - rightDate || getRecordTimestamp(left) - getRecordTimestamp(right);
  if (mode === 'SAVED_DESC') return getRecordTimestamp(right) - getRecordTimestamp(left);
  return rightDate - leftDate || getRecordTimestamp(right) - getRecordTimestamp(left);
});

const formatShortThaiDate = (date) => new Intl.DateTimeFormat('th-TH', {
  day: 'numeric', month: 'short'
}).format(date);

const summarizeHistoryRecord = (record) => {
  const rows = Array.isArray(record?.rows) ? record.rows : [];
  const avg = (field) => {
    const values = rows.map((row) => parseNumericValue(row?.[field])).filter((value) => value !== null);
    return values.length ? Number((values.reduce((sum, value) => sum + value, 0) / values.length).toFixed(2)) : null;
  };
  const numericCount = rows.reduce((count, row) => count + [
    'hotAirIn', 'hotAirOut', 'wetCakeMoisture', 'productMoisture'
  ].filter((field) => parseNumericValue(row?.[field]) !== null).length, 0);
  return {
    hasProduction: numericCount > 0,
    hotAirIn: avg('hotAirIn'),
    hotAirOut: avg('hotAirOut'),
    wetCakeMoisture: avg('wetCakeMoisture'),
    productMoisture: avg('productMoisture'),
  };
};

function WeeklyTrendChart({ days, field, label, unit, minY, maxY, target, lineColor }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  const width = 900;
  const height = 280;
  const left = 58;
  const right = 24;
  const top = 38;
  const bottom = 52;
  const chartWidth = width - left - right;
  const chartHeight = height - top - bottom;
  const xFor = (index) => left + (index / Math.max(days.length - 1, 1)) * chartWidth;
  const yFor = (value) => top + (1 - ((value - minY) / (maxY - minY))) * chartHeight;
  const points = days.map((day, index) => ({ ...day, index, value: day.summary?.[field] ?? null }));
  const segments = [];
  let current = [];
  points.forEach((point) => {
    if (point.value === null || !point.summary?.hasProduction) {
      if (current.length) segments.push(current);
      current = [];
    } else current.push(point);
  });
  if (current.length) segments.push(current);
  const ticks = [minY, (minY + maxY) / 2, maxY];
  const gradientId = `weekly-gradient-${field}`;
  const glowId = `weekly-glow-${field}`;
  const baselineY = height - bottom;
  const statusFor = (value) => {
    if (value === null) return { label: 'ไม่มีข้อมูล', color: '#64748b' };
    if (field === 'hotAirIn' && value < 130) return { label: 'วิกฤต', color: '#ef4444' };
    if (field === 'wetCakeMoisture' && value > 38) return { label: 'วิกฤต', color: '#ef4444' };
    if (field === 'productMoisture' && value > 14) return { label: 'วิกฤต', color: '#ef4444' };
    if (value >= target[0] && value <= target[1]) return { label: 'ปกติ', color: '#22c55e' };
    return { label: 'เฝ้าระวัง', color: '#f59e0b' };
  };
  const makeSmoothPath = (segment) => {
    if (!segment.length) return '';
    let path = `M ${xFor(segment[0].index)} ${yFor(segment[0].value)}`;
    for (let i = 1; i < segment.length; i += 1) {
      const previous = segment[i - 1];
      const point = segment[i];
      const previousX = xFor(previous.index);
      const currentX = xFor(point.index);
      const midX = (previousX + currentX) / 2;
      path += ` C ${midX} ${yFor(previous.value)}, ${midX} ${yFor(point.value)}, ${currentX} ${yFor(point.value)}`;
    }
    return path;
  };
  const hovered = hoverIndex === null ? null : points[hoverIndex];
  return (
    <article className="weekly-chart-card">
      <div className="weekly-chart-header"><div><h3>{label}</h3><p>ค่าเฉลี่ยรายวัน · เส้นจะไม่เชื่อมข้ามวันที่ไม่มีข้อมูล</p></div><span>{unit}</span></div>
      <div className="weekly-chart-stage">
        <svg viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none" className="weekly-chart-svg" role="img" aria-label={label}>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor={lineColor} stopOpacity="0.40"/><stop offset="100%" stopColor={lineColor} stopOpacity="0"/></linearGradient>
            <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="3" result="blur"/><feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
          </defs>
          <rect x={left} y={yFor(target[1])} width={chartWidth} height={Math.max(1, yFor(target[0]) - yFor(target[1]))} fill="#10b981" opacity="0.13" />
          {ticks.map((tick) => <g key={tick}><line x1={left} x2={width-right} y1={yFor(tick)} y2={yFor(tick)} stroke="#334155" strokeDasharray="4 5"/><text x={left-10} y={yFor(tick)+4} textAnchor="end" fill="#94a3b8" fontSize="11">{tick}{unit}</text></g>)}
          {days.map((day, index) => !day.record ? <rect key={`empty-${day.key}`} x={xFor(index)-Math.min(34, chartWidth/Math.max(days.length,1)/2)} y={top} width={Math.min(68, chartWidth/Math.max(days.length,1))} height={chartHeight} fill="#64748b" opacity="0.055" rx="7" /> : null)}
          {segments.map((segment, idx) => {
            const path = makeSmoothPath(segment);
            const firstX = xFor(segment[0].index);
            const lastX = xFor(segment[segment.length-1].index);
            return <g key={idx}><path d={`${path} L ${lastX} ${baselineY} L ${firstX} ${baselineY} Z`} fill={`url(#${gradientId})`} opacity="0.9"/><path d={path} fill="none" stroke={lineColor} strokeWidth="3.6" strokeLinecap="round" strokeLinejoin="round" filter={`url(#${glowId})`}/></g>;
          })}
          {hovered && <line x1={xFor(hovered.index)} x2={xFor(hovered.index)} y1={top} y2={baselineY} stroke="#cbd5e1" strokeDasharray="3 5" opacity="0.55"/>}
          {points.map((point) => point.value !== null && point.summary?.hasProduction ? <g key={point.key}><circle cx={xFor(point.index)} cy={yFor(point.value)} r={hoverIndex===point.index?7:5} fill="#08111f" stroke={lineColor} strokeWidth="3" filter={`url(#${glowId})`}/><circle cx={xFor(point.index)} cy={yFor(point.value)} r={hoverIndex===point.index?3.2:2.4} fill={statusFor(point.value).color}/></g> : null)}
          {days.map((day, index) => <g key={day.key}><rect x={xFor(index)-Math.max(18, chartWidth/Math.max(days.length,1)/2)} y={top} width={Math.max(36, chartWidth/Math.max(days.length,1))} height={chartHeight+38} fill="transparent" onMouseEnter={()=>setHoverIndex(index)} onMouseLeave={()=>setHoverIndex(null)}/><text x={xFor(index)} y={height-23} textAnchor="middle" fill={hoverIndex===index?'#f8fafc':'#cbd5e1'} fontSize="11" fontWeight={hoverIndex===index?'700':'400'}>{day.label}</text>{!day.record && <text x={xFor(index)} y={height-8} textAnchor="middle" fill="#64748b" fontSize="9">ไม่มีรายงาน</text>}</g>)}
        </svg>
        {hovered && <div className="weekly-chart-tooltip"><strong>{hovered.label}</strong><span>{hovered.value === null ? (hovered.record ? 'ไม่มีการผลิต' : 'ไม่มีรายงาน') : `${hovered.value}${unit}`}</span>{hovered.value !== null && <small style={{color:statusFor(hovered.value).color}}>{statusFor(hovered.value).label}</small>}</div>}
      </div>
    </article>
  );
}

export default function App() {
  const [data, setData] = useState(generateEmptyData());
  const [docInfo, setDocInfo] = useState({ date: new Date().toLocaleDateString('th-TH'), code: 'FM-PD-010 Rev.1' });
  const [appState, setAppState] = useState('ready');
  const [activeTab, setActiveTab] = useState('table');
  const [selectedShift, setSelectedShift] = useState('ALL');
  const [analyticsView, setAnalyticsView] = useState('DAILY');
  const [rangeStartDateKey, setRangeStartDateKey] = useState('');
  const [rangeEndDateKey, setRangeEndDateKey] = useState('');
  const [historyDisplayMode, setHistoryDisplayMode] = useState('ALL_DAYS');
  const [reportDateRaw, setReportDateRaw] = useState('');
  const [dateEditedByUser, setDateEditedByUser] = useState(false);
  const [currentHistoryId, setCurrentHistoryId] = useState(null);
  const [historySortMode, setHistorySortMode] = useState('DATE_DESC');
  const [showChartEvents, setShowChartEvents] = useState(true);
  const [showChartGradient, setShowChartGradient] = useState(true);
  const [eventOverrides, setEventOverrides] = useState({});
  const [saveStatus, setSaveStatus] = useState('');
  
  const [showImagePane, setShowImagePane] = useState(false);
  const [history, setHistory] = useState([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');
  const [analysisSummary, setAnalysisSummary] = useState('');
  const [summaryGeneratedAt, setSummaryGeneratedAt] = useState('');
  const [summaryNeedsRefresh, setSummaryNeedsRefresh] = useState(false);

  const [imageSrc, setImageSrc] = useState(null);
  const [selectedFile, setSelectedFile] = useState(null);
  const [imageRotation, setImageRotation] = useState(0);
  const [previewSrc, setPreviewSrc] = useState(null);
  const [orientationChecking, setOrientationChecking] = useState(false);
  const orientationRunRef = useRef(0);
  const fileInputRef = useRef(null);
  const jsonImportRef = useRef(null);

  // สร้างภาพตัวอย่างตามมุมหมุนปัจจุบัน เพื่อให้สิ่งที่เห็นตรงกับสิ่งที่ส่งสแกน
  useEffect(() => {
    if (!selectedFile) return undefined;
    let cancelled = false;
    loadImageFromFile(selectedFile)
      .then((img) => {
        if (!cancelled) setPreviewSrc(renderRotatedJpeg(img, imageRotation, 1400, 0.85));
      })
      .catch(() => {
        if (!cancelled) setPreviewSrc(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedFile, imageRotation]);

  useEffect(() => {
    try {
      const savedHistory = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (savedHistory) {
        setHistory(sortHistoryRecords(JSON.parse(savedHistory), 'DATE_DESC'));
      }
    } catch (e) {
      console.error('ไม่สามารถดึงประวัติได้:', e);
    }
  }, []);


  useEffect(() => {
    if (analyticsView !== 'WEEKLY' || (rangeStartDateKey && rangeEndDateKey)) return;
    const datedRecords = history
      .map((record) => parseReportDate(record?.date || record?.reportDate))
      .filter(Boolean)
      .sort((a, b) => b - a);
    const endDate = datedRecords[0] || parseReportDate(docInfo.date) || new Date();
    const startDate = new Date(endDate);
    startDate.setDate(endDate.getDate() - 6);
    setRangeStartDateKey(formatDateKey(startDate));
    setRangeEndDateKey(formatDateKey(endDate));
  }, [analyticsView, rangeStartDateKey, rangeEndDateKey, history, docInfo.date]);

  const saveHistoryToStorage = (newHistory) => {
    const orderedHistory = sortHistoryRecords(newHistory, 'DATE_DESC');
    setHistory(orderedHistory);
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(orderedHistory));
    } catch (e) {
      console.error('บันทึกลงความจำเครื่องไม่สำเร็จ:', e);
    }
  };

  const handleCellChange = (index, field, value) => {
    const newData = [...data];
    newData[index][field] = value;
    if (newData[index].unreadableFields?.includes(field)) {
      newData[index].unreadableFields = newData[index].unreadableFields.filter(f => f !== field);
    }
    setData(newData);
    setSaveStatus('มีการแก้ไขยังไม่ได้บันทึก');
    if (analysisSummary) setSummaryNeedsRefresh(true);
  };

  const editDetectedEvent = (row, index, detectedEvent) => {
    const key = getEventOverrideKey(row, index);
    const nextTime = window.prompt('แก้ไขเวลาเหตุการณ์ (HH:MM)', detectedEvent.time || String(row.time || '').replace('.', ':'));
    if (nextTime === null) return;
    if (!/^([01]?\d|2[0-4]):[0-5]\d$/.test(nextTime.trim())) {
      setStatusMessage('⚠️ รูปแบบเวลาไม่ถูกต้อง กรุณาใช้ HH:MM เช่น 12:58');
      return;
    }
    const nextLabel = window.prompt('แก้ไขชื่อเหตุการณ์', detectedEvent.label || 'เหตุการณ์');
    if (nextLabel === null || !nextLabel.trim()) return;
    setEventOverrides((current) => ({
      ...current,
      [key]: { ...(current[key] || {}), time: nextTime.trim().padStart(5, '0'), label: nextLabel.trim(), type: detectedEvent.type, hidden: false },
    }));
    setSaveStatus('แก้ไขเหตุการณ์แล้ว กรุณาบันทึกประวัติ');
  };

  const hideDetectedEvent = (row, index, detectedEvent) => {
    if (!window.confirm(`ซ่อนเหตุการณ์ “${detectedEvent.time} · ${detectedEvent.label}” ออกจากกราฟและรายงานหรือไม่?\nข้อมูลต้นฉบับในตารางจะยังคงอยู่`)) return;
    const key = getEventOverrideKey(row, index);
    setEventOverrides((current) => ({ ...current, [key]: { ...(current[key] || {}), hidden: true, type: detectedEvent.type } }));
    setSaveStatus('ซ่อนเหตุการณ์แล้ว กรุณาบันทึกประวัติ');
  };

  const restoreDetectedEvents = () => {
    if (!Object.keys(eventOverrides).length) return;
    if (!window.confirm('คืนค่ารายการเหตุการณ์ทั้งหมดให้ตรวจจับจากข้อมูลในตารางอีกครั้งหรือไม่?')) return;
    setEventOverrides({});
    setSaveStatus('คืนค่าเหตุการณ์จากข้อมูลต้นฉบับแล้ว กรุณาบันทึกประวัติ');
  };

  const autoFixDittoMarks = () => {
    let lastType = '';
    const newData = data.map((row) => {
      const raw = (row.productType || '').trim();
      if (raw === '"' || raw === '〃' || raw === "''" || raw === '”' || raw === '″') {
        return { ...row, productType: lastType };
      }
      if (raw !== '') {
        lastType = raw;
      }
      return row;
    });
    setData(newData);
    setStatusMessage('แปลงเครื่องหมายซ้ำ (") เป็นชื่อชนิดแป้งเต็มเรียบร้อยแล้ว');
    setTimeout(() => setStatusMessage(''), 3000);
  };

  // ตรวจทิศทางภาพอัตโนมัติ (เฉพาะภาพแนวตั้ง) แล้วตั้งมุมหมุนให้ ผู้ใช้ปรับเองได้ตลอด
  const runOrientationCheck = async (file) => {
    const runId = orientationRunRef.current + 1;
    orientationRunRef.current = runId;
    setOrientationChecking(true);
    try {
      const result = await requestOrientationCheck(file);
      if (runId !== orientationRunRef.current || !result.checked) return;

      const degrees = normalizeRotation(result.rotationDegrees);
      setImageRotation(degrees);
      if (result.isDryingReport === false) {
        setStatusMessage('⚠️ รูปนี้อาจไม่ใช่ Drying Process Operation Report กรุณาตรวจสอบก่อนสแกน');
      } else if (degrees !== 0) {
        setStatusMessage(`ตรวจพบภาพหมุน และหมุนให้อัตโนมัติแล้ว (${degrees}° ตามเข็มนาฬิกา) ปรับเองได้ที่ปุ่มหมุนในรูปอ้างอิง`);
      }
    } catch (error) {
      if (runId !== orientationRunRef.current) return;
      console.warn('ตรวจทิศทางภาพอัตโนมัติไม่สำเร็จ:', error);
      setStatusMessage('ตรวจทิศทางภาพอัตโนมัติไม่สำเร็จ กรุณาดูรูปอ้างอิงและหมุนเองหากจำเป็น');
    } finally {
      if (runId === orientationRunRef.current) setOrientationChecking(false);
    }
  };

  const rotateImage = (delta) => {
    // ผู้ใช้ปรับเอง: ยกเลิกผลตรวจอัตโนมัติที่ยังค้างอยู่ ไม่ให้มาทับภายหลัง
    orientationRunRef.current += 1;
    setOrientationChecking(false);
    setStatusMessage('');
    setImageRotation((current) => normalizeRotation(current + delta));
  };

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      setImageRotation(0);
      setPreviewSrc(null);
      setStatusMessage('');
      const url = URL.createObjectURL(file);
      setImageSrc(url);
      setShowImagePane(true);
      setAppState('uploaded');
      runOrientationCheck(file);
      setData(generateEmptyData());
      setDocInfo({ date: normalizeReportDateDisplay(new Date().toLocaleDateString('th-TH')), code: 'FM-PD-010 Rev.1' });
      setReportDateRaw('');
      setDateEditedByUser(false);
      setCurrentHistoryId(null);
      setEventOverrides({});
      setAnalysisSummary('');
      setSummaryGeneratedAt('');
      setSummaryNeedsRefresh(false);
    }
    e.target.value = null;
  };

  const handleScanDocument = async () => {
    if (!selectedFile || orientationChecking) return;
    setStatusMessage('');
    setAppState('scanning');

    try {
      const base64Image = await compressImage(selectedFile, 2400, imageRotation);
      const response = await fetch(WORKER_API_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ imageBase64: base64Image })
      });

      const responseText = await response.text();
      let result;
      try {
        result = parseSafeJson(responseText);
      } catch (parseError) {
        throw new Error(`เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ: ${responseText.substring(0, 80)}...`);
      }

      if (!response.ok) {
        throw new Error(result.error || `HTTP Error ${response.status}`);
      }

      let formattedRows = [];
      if (result.rows && Array.isArray(result.rows)) {
        const rawDate = result.reportDate || docInfo.date;
        const newDate = normalizeReportDateDisplay(rawDate);
        const newCode = result.documentCode || docInfo.code;
        setReportDateRaw(String(rawDate || '').trim());
        setDateEditedByUser(false);
        setDocInfo({ date: newDate, code: newCode });
        
        formattedRows = flagIsolatedNumericOutliers(alignOcrRowsToCanonicalTimes(result.rows));
        
        setData(formattedRows);
        setEventOverrides({});
        setAnalysisSummary('');
        setSummaryGeneratedAt('');
        setSummaryNeedsRefresh(false);
        const savedId = autoSaveToHistory(newDate, newCode, formattedRows, { reportDateRaw: String(rawDate || '').trim(), dateEditedByUser: false });
        setCurrentHistoryId(savedId);
        setShowImagePane(false);
      } else {
        throw new Error("ข้อมูลตอบกลับจาก AI ไม่พบรายการแถว (rows)");
      }
      
      setAppState('ready');
      const reviewCount = formattedRows.reduce((sum, row) => sum + (row.unreadableFields?.length || 0), 0);
      setSaveStatus(reviewCount > 0
        ? `สแกนเสร็จแล้ว พบ ${reviewCount} ช่องที่ควรตรวจสอบกับเอกสารต้นฉบับ`
        : 'สแกนและบันทึกประวัติเรียบร้อยแล้ว');
    } catch (error) {
      console.error("Scanning failed:", error);
      setStatusMessage(`⚠️ เกิดข้อผิดพลาดในการสแกน: ${error.message}`);
      setAppState('uploaded');
    }
  };

  const autoSaveToHistory = (dateStr, codeStr, rowsData, metadata = {}) => {
    const parsedDate = parseReportDate(dateStr);
    if (!parsedDate) return null;
    const normalizedDate = formatReportDateDisplay(parsedDate);
    const dateKey = formatDateKey(parsedDate);
    const reportId = metadata.id || currentHistoryId || `${dateKey}_${Date.now()}`;
    const newRecord = {
      id: reportId,
      date: normalizedDate,
      reportDateRaw: metadata.reportDateRaw ?? reportDateRaw ?? dateStr,
      dateEditedByUser: metadata.dateEditedByUser ?? dateEditedByUser,
      reportDateISO: dateKey,
      code: codeStr,
      timestamp: new Date().toISOString(),
      rows: rowsData,
      eventOverrides: metadata.eventOverrides ?? eventOverrides
    };

    let updatedHistory = history.filter((item) => item.id !== reportId);
    const duplicateIndex = updatedHistory.findIndex((item) => getRecordDateKey(item) === dateKey);
    if (duplicateIndex >= 0) updatedHistory[duplicateIndex] = newRecord;
    else updatedHistory.push(newRecord);

    saveHistoryToStorage(updatedHistory);
    setRangeEndDateKey((current) => current || dateKey);
    return reportId;
  };


  const handleManualSave = () => {
    const parsedDate = parseReportDate(docInfo.date);
    if (!parsedDate) {
      setStatusMessage('⚠️ วันที่เอกสารไม่ถูกต้อง กรุณาตรวจสอบก่อนบันทึกประวัติ');
      return;
    }
    const dateKey = formatDateKey(parsedDate);
    const duplicate = history.find((item) => item.id !== currentHistoryId && getRecordDateKey(item) === dateKey);
    const savedId = autoSaveToHistory(docInfo.date, docInfo.code, data, {
      id: currentHistoryId,
      reportDateRaw: reportDateRaw || docInfo.date,
      dateEditedByUser,
      eventOverrides,
    });
    setCurrentHistoryId(savedId);
    setSaveStatus(duplicate ? 'แทนที่รายงานเดิมของวันที่นี้เรียบร้อยแล้ว' : 'บันทึกประวัติลงเครื่องเรียบร้อยแล้ว');
    setTimeout(() => setSaveStatus(''), 3000);
  };

  const loadReportFromHistory = (record) => {
    setDocInfo({ date: normalizeReportDateDisplay(record.date), code: record.code });
    setReportDateRaw(record.reportDateRaw || record.date || '');
    setDateEditedByUser(Boolean(record.dateEditedByUser));
    setCurrentHistoryId(record.id);
    setData(record.rows);
    setEventOverrides(record.eventOverrides || {});
    setAnalysisSummary('');
    setSummaryGeneratedAt('');
    setSummaryNeedsRefresh(false);
    setShowHistoryModal(false);
    setStatusMessage(`โหลดข้อมูลประวัติวันที่ ${record.date} เรียบร้อยแล้ว`);
    setTimeout(() => setStatusMessage(''), 3000);
  };

  const deleteHistoryRecord = (id) => {
    const filtered = history.filter(h => h.id !== id);
    saveHistoryToStorage(filtered);
  };

  const exportHistoryJSON = () => {
    const jsonStr = JSON.stringify(history, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `drying_reports_history_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleImportJSON = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target.result);
        if (Array.isArray(importedData)) {
          const mergedMap = new Map();
          [...history, ...importedData].forEach((item, index) => {
            const key = getRecordDateKey(item) || `invalid-${index}-${item?.id || ''}`;
            const existing = mergedMap.get(key);
            if (!existing || getRecordTimestamp(item) >= getRecordTimestamp(existing)) mergedMap.set(key, item);
          });
          const mergedList = sortHistoryRecords(Array.from(mergedMap.values()), 'DATE_DESC');
          saveHistoryToStorage(mergedList);
          setStatusMessage(`นำเข้าประวัติสำเร็จ! รวมทั้งสิ้น ${mergedList.length} รายการ`);
          setTimeout(() => setStatusMessage(''), 4000);
        }
      } catch (err) {
        setStatusMessage('เกิดข้อผิดพลาดในการอ่านไฟล์ JSON');
      }
    };
    reader.readAsText(file);
    e.target.value = null;
  };

  const triggerFileInput = () => fileInputRef.current.click();

  const getFilteredDataForShift = () => {
    if (selectedShift === 'DAY') return data.slice(0, 12);
    if (selectedShift === 'NIGHT') return data.slice(12, 24);
    return data;
  };

  const currentFilteredData = getFilteredDataForShift();
  const historyByDate = new Map();
  history.forEach((record) => {
    const key = getRecordDateKey(record);
    if (!key) return;
    const current = historyByDate.get(key);
    if (!current || getRecordTimestamp(record) >= getRecordTimestamp(current)) historyByDate.set(key, record);
  });

  const latestHistoryDate = [...historyByDate.keys()].map(parseDateKey).filter(Boolean).sort((a,b) => b-a)[0] || null;
  const defaultEnd = latestHistoryDate || parseReportDate(docInfo.date) || new Date();
  const defaultStart = new Date(defaultEnd);
  defaultStart.setDate(defaultEnd.getDate() - 6);
  const requestedStart = parseDateKey(rangeStartDateKey) || defaultStart;
  const requestedEnd = parseDateKey(rangeEndDateKey) || defaultEnd;
  const normalizedStart = requestedStart <= requestedEnd ? requestedStart : requestedEnd;
  const normalizedEnd = requestedStart <= requestedEnd ? requestedEnd : requestedStart;
  const dayCount = Math.min(93, Math.round((normalizedEnd - normalizedStart) / 86400000) + 1);

  const allRangeDays = Array.from({ length: dayCount }, (_, index) => {
    const date = new Date(normalizedStart);
    date.setDate(normalizedStart.getDate() + index);
    const key = formatDateKey(date);
    const record = historyByDate.get(key) || null;
    const summary = record ? summarizeHistoryRecord(record) : null;
    return { key, date, label: formatShortThaiDate(date), record, summary };
  });

  const weeklyDays = historyDisplayMode === 'PRODUCTION_ONLY'
    ? allRangeDays.filter((day) => day.summary?.hasProduction)
    : allRangeDays;
  const weeklyProductionDays = allRangeDays.filter((day) => day.summary?.hasProduction).length;
  const weeklyNoProductionDays = allRangeDays.filter((day) => day.record && !day.summary?.hasProduction).length;
  const weeklyMissingDays = allRangeDays.filter((day) => !day.record).length;
  const weeklyReportCount = allRangeDays.filter((day) => day.record).length;
  const sortedHistory = sortHistoryRecords(history, historySortMode);
  const moveWeeklyRange = (days) => {
    const startDate = new Date(normalizedStart);
    const endDate = new Date(normalizedEnd);
    startDate.setDate(startDate.getDate() + days);
    endDate.setDate(endDate.getDate() + days);
    setRangeStartDateKey(formatDateKey(startDate));
    setRangeEndDateKey(formatDateKey(endDate));
  };
  const resolvedAllProductTypes = resolveProductTypesList(data);
  const resolvedFilteredProductTypes = resolveProductTypesList(currentFilteredData);

  const calculateAnalytics = (dataset) => {
    let totalWet = 0, wetCount = 0;
    let totalProd = 0, prodCount = 0;
    let totalTempIn = 0, tempInCount = 0;
    let totalTempOut = 0, tempOutCount = 0;
    let stopCount = 0;
    const anomalies = [];

    dataset.forEach((row, idx) => {
      const pType = resolvedFilteredProductTypes[idx] || row.productType || '-';

      const tempIn = parseNumericValue(row.hotAirIn);
      if (tempIn !== null) { 
        totalTempIn += tempIn; tempInCount++; 
        if (tempIn < 130) {
          anomalies.push({ time: row.time, pType, issue: `อุณหภูมิลมเข้าต่ำกว่าเกณฑ์วิกฤต (${tempIn}°C)`, level: 'red' });
        } else if ((tempIn >= 130 && tempIn < 140) || tempIn >= 160) {
          anomalies.push({ time: row.time, pType, issue: `อุณหภูมิลมเข้าไม่อยู่ในเกณฑ์มาตรฐาน (${tempIn}°C)`, level: 'yellow' });
        }
      }

      const tempOut = parseNumericValue(row.hotAirOut);
      if (tempOut !== null) { 
        totalTempOut += tempOut; tempOutCount++; 
        if (tempOut < 50 || tempOut > 65) {
          anomalies.push({ time: row.time, pType, issue: `อุณหภูมิปลายปล่อง (OUT) ผิดปกติ (${tempOut}°C)`, level: 'yellow' });
        }
      }

      const wet = parseNumericValue(row.wetCakeMoisture);
      if (wet !== null) { 
        totalWet += wet; wetCount++; 
        if (wet > 38.0) {
          anomalies.push({ time: row.time, pType, issue: `ความชื้นแป้งหมาดสูงเกิน 38% (${wet}%)`, level: 'red' });
        } else if (wet < 30.0) {
          anomalies.push({ time: row.time, pType, issue: `ความชื้นแป้งหมาดต่ำกว่า 30% (${wet}%)`, level: 'yellow' });
        }
      }

      const prod = parseNumericValue(row.productMoisture);
      if (prod !== null) {
        totalProd += prod; prodCount++;
        if (prod > 14.0) {
          anomalies.push({ time: row.time, pType, issue: `ความชื้นแป้งแห้งชื้นเกินเกณฑ์วิกฤต 14% (${prod}%)`, level: 'red' });
        } else if ((prod >= 0 && prod < 11.0) || (prod > 12.5 && prod <= 14.0)) {
          anomalies.push({ time: row.time, pType, issue: `ความชื้นแป้งแห้งเบี่ยงเบนจากเกณฑ์ 11-12.5% (${prod}%)`, level: 'yellow' });
        }
      }

      if (row.remark && (row.remark.includes('หยุด') || row.remark.includes('stop') || row.remark.includes('ซ่อม') || row.remark.includes('break'))) {
        stopCount++;
      }
    });

    return {
      avgWetMoist: wetCount > 0 ? (totalWet / wetCount).toFixed(2) : '0.00',
      avgProdMoist: prodCount > 0 ? (totalProd / prodCount).toFixed(2) : '0.00',
      avgTempIn: tempInCount > 0 ? (totalTempIn / tempInCount).toFixed(1) : '0.0',
      avgTempOut: tempOutCount > 0 ? (totalTempOut / tempOutCount).toFixed(1) : '0.0',
      stopCount,
      anomalies
    };
  };

  const analytics = calculateAnalytics(currentFilteredData);

  const getShiftLabel = () => {
    if (selectedShift === 'DAY') return 'กะกลางวัน (08:00 - 20:00 น.)';
    if (selectedShift === 'NIGHT') return 'กะกลางคืน (20:00 - 08:00 น.)';
    return 'ทั้งวัน (24 ชั่วโมง)';
  };

  const getReportFileBaseName = () => {
    const safeDate = String(docInfo.date || new Date().toLocaleDateString('th-TH'))
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '_');
    const safeCode = String(docInfo.code || 'FM-PD-010')
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, '_');
    return `รายงานการอบแป้ง_${safeDate}_${safeCode}`;
  };

  const escapeHtml = (value) => String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');

  const buildHtmlReport = () => {
    const summary = analysisSummary || buildAnalysisSummary();
    const anomalyRows = analytics.anomalies.length > 0
      ? analytics.anomalies.map((item) => `
          <tr>
            <td>${escapeHtml(item.time)}</td>
            <td>${escapeHtml(item.pType)}</td>
            <td>${escapeHtml(item.issue)}</td>
          </tr>`).join('')
      : '<tr><td colspan="3">ไม่พบค่าที่อยู่นอกเกณฑ์ในช่วงเวลาที่เลือก</td></tr>';

    const tableRows = data.map((row) => {
      const dw = ['dw1','dw2','dw3','dw4','dw5']
        .map((key, index) => row[key] ? String(index + 1) : '')
        .filter(Boolean)
        .join(', ');
      return `
        <tr>
          <td>${escapeHtml(row.time)}</td>
          <td>${escapeHtml(row.productType)}</td>
          <td>${escapeHtml(dw)}</td>
          <td>${escapeHtml(row.hotAirIn)}</td>
          <td>${escapeHtml(row.hotAirOut)}</td>
          <td>${escapeHtml(row.speed)}</td>
          <td>${escapeHtml(row.wetCakeMoisture)}</td>
          <td>${escapeHtml(row.productMoisture)}</td>
          <td>${escapeHtml(row.changeDwFilter)}</td>
          <td class="remark">${escapeHtml(row.remark)}</td>
        </tr>`;
    }).join('');

    const getChartSvg = (selector) => {
      const svg = document.querySelector(selector);
      if (!svg) return '<div class="chart-empty">ไม่พบกราฟสำหรับส่งออก</div>';
      const clone = svg.cloneNode(true);
      clone.removeAttribute('width');
      clone.removeAttribute('height');
      clone.setAttribute('preserveAspectRatio', 'none');
      clone.setAttribute('style', 'display:block;width:100%;height:100%;');
      return clone.outerHTML;
    };

    const chart1 = getChartSvg('.print-chart-1 .process-chart svg');
    const chart2 = getChartSvg('.print-chart-2 .process-chart svg');
    const chart3 = getChartSvg('.print-chart-3 .process-chart svg');
    const chart4 = getChartSvg('.print-chart-4 .process-chart svg');

    const printedAt = new Date().toLocaleString('th-TH');
    return `<!doctype html>
<html lang="th">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${escapeHtml(getReportFileBaseName())}</title>
<style>
  :root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#070b14;color:#e2e8f0;font-family:Arial,'Tahoma',sans-serif}.wrap{max-width:1440px;margin:0 auto;padding:18px}
  .header{display:flex;align-items:center;gap:14px;background:#0f172a;border:1px solid #334155;border-radius:16px;padding:16px 18px;margin-bottom:14px}.logo{width:54px;height:54px;border-radius:12px}.header h1{margin:0 0 5px;font-size:24px;color:#f8fafc}.header p{margin:0;color:#94a3b8}
  .kpis{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:12px;margin-bottom:14px}.kpi,.section,.chart-card{background:#0f172a;border:1px solid #334155;border-radius:15px}.kpi{padding:15px;position:relative;overflow:hidden}.kpi small{color:#94a3b8}.kpi strong{display:block;font-size:27px;margin:7px 0 4px}.orange{color:#fb923c}.amber{color:#fbbf24}.indigo{color:#818cf8}.blue{color:#60a5fa}
  .charts{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin-bottom:14px}.chart-card{padding:14px}.chart-card h2{margin:0 0 10px;font-size:16px;color:#f8fafc;border-bottom:1px solid #334155;padding-bottom:9px}.chart-box{height:310px;background:#050914;border:1px solid #273449;border-radius:12px;overflow:hidden}.chart-box svg{width:100%!important;height:100%!important}
  .section{padding:17px;margin-bottom:14px}.section h2{margin:0 0 12px;font-size:18px;color:#f8fafc}.summary{white-space:pre-wrap;line-height:1.62;color:#cbd5e1}
  .table-scroll{overflow:auto;border-radius:10px}table{width:100%;border-collapse:collapse;font-size:12px;background:#fff;color:#0f172a}th,td{border:1px solid #cbd5e1;padding:5px 6px;text-align:center;vertical-align:top}th{background:#e2e8f0;position:sticky;top:0}.remark{text-align:left;min-width:145px}.footer{text-align:center;color:#64748b;font-size:12px;padding:8px}.chart-empty{display:flex;align-items:center;justify-content:center;height:100%;color:#94a3b8}
  @media(max-width:900px){.kpis{grid-template-columns:repeat(2,1fr)}.charts{grid-template-columns:1fr}.chart-box{height:280px}.wrap{padding:10px}.header h1{font-size:19px}.logo{width:44px;height:44px}}
  @media print{body{background:#fff}.wrap{max-width:none;padding:0}.header,.kpi,.chart-card,.section{break-inside:avoid}.charts{grid-template-columns:1fr}.chart-box{height:250px}.footer{margin-top:10px}}
</style>
</head>
<body><div class="wrap">
  <div class="header"><img class="logo" src="${window.location.origin}/app-icon-64.png" alt="Drying OCR"><div><h1>ระบบวิเคราะห์รายงานการอบแป้ง (DRYING PROCESS)</h1><p>${escapeHtml(docInfo.code)} | วันที่เอกสาร: ${escapeHtml(docInfo.date)} | ${escapeHtml(getShiftLabel())}</p></div></div>
  <div class="kpis">
    <div class="kpi"><small>อุณหภูมิลมเข้า IN</small><strong class="orange">${escapeHtml(analytics.avgTempIn)} °C</strong><small>เกณฑ์ 140–160°C</small></div>
    <div class="kpi"><small>อุณหภูมิปลายปล่อง OUT</small><strong class="amber">${escapeHtml(analytics.avgTempOut)} °C</strong><small>เกณฑ์ 50–65°C</small></div>
    <div class="kpi"><small>ความชื้นแป้งหมาด WET</small><strong class="indigo">${escapeHtml(analytics.avgWetMoist)} %</strong><small>เกณฑ์ 30–38%</small></div>
    <div class="kpi"><small>ความชื้นแป้งแห้ง PROD</small><strong class="blue">${escapeHtml(analytics.avgProdMoist)} %</strong><small>เกณฑ์ 11.0–12.5%</small></div>
  </div>
  <div class="charts">
    <div class="chart-card"><h2>1. กราฟอุณหภูมิลมร้อนขาเข้า IN (อบแป้ง)</h2><div class="chart-box">${chart1}</div></div>
    <div class="chart-card"><h2>2. กราฟอุณหภูมิปลายปล่อง OUT (แป้งแห้ง)</h2><div class="chart-box">${chart2}</div></div>
    <div class="chart-card"><h2>3. กราฟความชื้นแป้งหมาด (% WET MOISTURE)</h2><div class="chart-box">${chart3}</div></div>
    <div class="chart-card"><h2>4. กราฟความชื้นแป้งแห้ง (% PRODUCT MOISTURE)</h2><div class="chart-box">${chart4}</div></div>
  </div>
  <div class="section"><h2>สรุปผลการวิเคราะห์</h2><div class="summary">${escapeHtml(summary)}</div></div>
  <div class="section"><h2>รายการความผิดปกติ (${analytics.anomalies.length} รายการ)</h2><div class="table-scroll"><table><thead><tr><th>เวลา</th><th>ชนิดแป้ง</th><th>รายละเอียด</th></tr></thead><tbody>${anomalyRows}</tbody></table></div></div>
  <div class="section"><h2>ตารางข้อมูลอ้างอิง 24 ชั่วโมง</h2><div class="table-scroll"><table><thead><tr><th>เวลา</th><th>ชนิดแป้ง</th><th>DW</th><th>IN</th><th>OUT</th><th>Speed</th><th>Wet</th><th>Prod</th><th>Filter</th><th>หมายเหตุ</th></tr></thead><tbody>${tableRows}</tbody></table></div></div>
  <div class="footer">จัดทำเมื่อ ${escapeHtml(printedAt)}</div>
</div></body></html>`;
  };

  const handleDownloadHtmlReport = () => {
    const html = buildHtmlReport();
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `${getReportFileBaseName()}.html`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  const buildAnalysisSummary = () => {
    const criticalItems = analytics.anomalies.filter((item) => item.level === 'red');
    const warningItems = analytics.anomalies.filter((item) => item.level === 'yellow');
    const overallStatus = criticalItems.length > 0
      ? 'พบค่าระดับวิกฤตที่ต้องตรวจสอบและติดตามการแก้ไข'
      : warningItems.length > 0
        ? 'กระบวนการโดยรวมอยู่ในระดับเฝ้าระวัง และควรติดตามค่าที่เบี่ยงเบนจากเกณฑ์'
        : 'กระบวนการอบแป้งอยู่ในเกณฑ์ควบคุมตามค่าพารามิเตอร์ที่บันทึก';

    const observations = analytics.anomalies.length > 0
      ? analytics.anomalies.slice(0, 10).map((item, index) =>
          `${index + 1}. เวลา ${item.time} น. ชนิดแป้ง ${item.pType}: ${item.issue}`
        ).join('\n')
      : 'ไม่พบค่าพารามิเตอร์ที่อยู่นอกเกณฑ์จากข้อมูลที่บันทึกในช่วงเวลานี้';

    return [
      'สรุปผลการวิเคราะห์กระบวนการอบแป้ง',
      `ประจำวันที่ ${docInfo.date} | ${getShiftLabel()}`,
      `รหัสเอกสาร: ${docInfo.code}`,
      '',
      'ผลการประเมินภาพรวม',
      overallStatus,
      '',
      'ค่าพารามิเตอร์เฉลี่ย',
      `• อุณหภูมิลมร้อนเข้า ${analytics.avgTempIn} °C (เกณฑ์มาตรฐาน 140-160 °C)`,
      `• อุณหภูมิปลายปล่อง ${analytics.avgTempOut} °C (เกณฑ์มาตรฐาน 50-65 °C)`,
      `• ความชื้นแป้งหมาด ${analytics.avgWetMoist}% (เกณฑ์มาตรฐาน 30-38%)`,
      `• ความชื้นแป้งแห้ง ${analytics.avgProdMoist}% (เกณฑ์มาตรฐาน 11.0-12.5%)`,
      '',
      `พบรายการเฝ้าระวัง ${warningItems.length} รายการ และรายการระดับวิกฤต ${criticalItems.length} รายการ`,
      '',
      'ข้อสังเกตจากข้อมูล',
      observations,
      '',
      'ข้อเสนอแนะ',
      criticalItems.length > 0
        ? 'ควรตรวจสอบสาเหตุของค่าระดับวิกฤต ดำเนินการแก้ไข และบันทึกผลการติดตามอย่างเป็นระบบ'
        : warningItems.length > 0
          ? 'ควรติดตามค่าที่เบี่ยงเบนจากเกณฑ์ในรอบการผลิตถัดไป และตรวจสอบความสัมพันธ์กับเหตุการณ์การเดินเครื่อง'
          : 'ควรรักษาเงื่อนไขการเดินเครื่องในระดับปัจจุบัน และติดตามแนวโน้มอย่างต่อเนื่อง',
    ].join('\n');
  };

  const handleGenerateAnalysisSummary = () => {
    setAnalysisSummary(buildAnalysisSummary());
    setSummaryGeneratedAt(new Date().toLocaleString('th-TH'));
    setSummaryNeedsRefresh(false);
    window.setTimeout(() => {
      document.getElementById('analysis-summary-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 50);
  };

  const buildFormalEmailSummary = () => {
    const criticalCount = analytics.anomalies.filter((item) => item.level === 'red').length;
    const warningCount = analytics.anomalies.filter((item) => item.level === 'yellow').length;
    const overallStatus = criticalCount > 0
      ? 'พบค่าระดับวิกฤตที่ควรตรวจสอบ'
      : warningCount > 0
        ? 'พบค่าที่ควรเฝ้าระวัง'
        : 'ค่าพารามิเตอร์อยู่ในเกณฑ์มาตรฐาน';

    const anomalyLines = analytics.anomalies.length > 0
      ? analytics.anomalies.slice(0, 12).map((item, index) =>
          `${index + 1}. เวลา ${item.time} น. ชนิดแป้ง ${item.pType}: ${item.issue}`
        ).join('\n')
      : 'ไม่พบรายการค่าผิดปกติจากข้อมูลที่บันทึก';

    return [
      'เรียน ผู้เกี่ยวข้อง',
      '',
      `ขอส่งรายงานการวิเคราะห์กระบวนการอบแป้ง ประจำวันที่ ${docInfo.date}`,
      `รหัสเอกสาร: ${docInfo.code}`,
      `ช่วงเวลาที่วิเคราะห์: ${getShiftLabel()}`,
      '',
      'สรุปผลการวิเคราะห์',
      `1. อุณหภูมิลมร้อนเข้าเฉลี่ย ${analytics.avgTempIn} °C (เกณฑ์ 140-160 °C)`,
      `2. อุณหภูมิปลายปล่องเฉลี่ย ${analytics.avgTempOut} °C (เกณฑ์ 50-65 °C)`,
      `3. ความชื้นแป้งหมาดเฉลี่ย ${analytics.avgWetMoist}% (เกณฑ์ 30-38%)`,
      `4. ความชื้นแป้งแห้งเฉลี่ย ${analytics.avgProdMoist}% (เกณฑ์ 11.0-12.5%)`,
      `5. จำนวนรายการเฝ้าระวัง ${warningCount} รายการ และระดับวิกฤต ${criticalCount} รายการ`,
      `6. ผลการประเมินโดยรวม: ${overallStatus}`,
      '',
      'รายการที่ควรตรวจสอบ',
      anomalyLines,
      '',
      'โปรดตรวจสอบรายละเอียดจากเอกสารรายงานที่แนบมากับอีเมลฉบับนี้',
      '',
      'ขอแสดงความนับถือ',
      'ผู้จัดทำรายงาน',
    ].join('\n');
  };

  const handleEmailReport = () => {
    window.alert('อย่าลืมแนบไฟล์เอกสารรายงานก่อนกดส่งอีเมล');

    const to = 'admin_cms@kengsenggroup.com';
    const cc = [
      'admin.asst.manager-cms@kengsenggroup.com',
      'tana.r@kengsenggroup.com',
    ].join(',');
    const subject = `รายงานการวิเคราะห์กระบวนการอบแป้ง ประจำวันที่ ${docInfo.date}`;
    const body = analysisSummary
      ? `${analysisSummary}\n\nโปรดตรวจสอบรายละเอียดจากเอกสารรายงานที่แนบมากับอีเมลฉบับนี้\n\nขอแสดงความนับถือ\nผู้จัดทำรายงาน`
      : buildFormalEmailSummary();
    const mailto = `mailto:${to}?cc=${encodeURIComponent(cc)}&subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
    window.location.href = mailto;
  };

  const handlePrintReport = () => {
    const previousTitle = document.title;
    const reportTitle = getReportFileBaseName();
    document.title = reportTitle;

    const restoreTitle = () => {
      document.title = previousTitle;
      window.removeEventListener('afterprint', restoreTitle);
    };

    window.addEventListener('afterprint', restoreTitle);
    window.print();
    window.setTimeout(restoreTitle, 3000);
  };

  if (appState === 'scanning') {
    return (
      <div className="min-h-screen bg-slate-900 text-white flex flex-col items-center justify-center space-y-4">
        <Loader2 className="w-12 h-12 text-blue-500 animate-spin" />
        <h2 className="text-2xl font-bold">กำลังประมวลผลเอกสารและวิเคราะห์...</h2>
        <p className="text-slate-400">ระบบ AI กำลังอ่านข้อมูลและอัปเดตลงตาราง</p>
      </div>
    );
  }

  return (
    <div className="w-full min-h-screen bg-slate-100 p-1 md:p-2 font-sans flex flex-col">
      <div className="w-full bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden flex flex-col flex-1 min-h-[98vh]">
        
        {/* Header Bar */}
        <header className="print-report-main-header bg-white border-b border-slate-200 px-3 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center space-x-3">
            <img
              src="/app-icon-192.png"
              alt="Drying Process OCR"
              className="w-10 h-10 rounded-xl object-contain shadow-md shrink-0"
            />
            <div>
              <h1 className="text-base md:text-lg font-bold text-slate-800 leading-tight">ระบบวิเคราะห์รายงานการอบแป้ง (DRYING PROCESS)</h1>
              <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500">
                <span>{docInfo.code} | วันที่เอกสาร:</span>
                <input
                  aria-label="วันที่เอกสาร"
                  value={docInfo.date}
                  onChange={(event) => { setDocInfo((current) => ({ ...current, date: event.target.value })); setDateEditedByUser(true); setSaveStatus('แก้ไขวันที่แล้ว กรุณาบันทึกประวัติ'); }}
                  onBlur={() => { const normalized = normalizeReportDateDisplay(docInfo.date); if (normalized) setDocInfo((current) => ({ ...current, date: normalized })); }}
                  className="report-date-input"
                  placeholder="DD/MM/YYYY"
                />
                {reportDateRaw && <span className="report-date-raw">อ่านจากต้นฉบับ: {reportDateRaw}{dateEditedByUser ? ' • แก้ไขแล้ว' : ''}</span>}
              </div>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-1.5">
            {imageSrc && (
              <button 
                onClick={() => setShowImagePane(!showImagePane)}
                className={`px-2.5 py-1.5 border rounded-lg text-xs font-semibold flex items-center transition-all shadow-sm ${showImagePane ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}
              >
                {showImagePane ? <EyeOff className="w-4 h-4 mr-1 text-amber-400" /> : <Eye className="w-4 h-4 mr-1 text-blue-600" />}
                {showImagePane ? 'ซ่อนรูปอ้างอิง' : 'แสดงรูปอ้างอิง'}
              </button>
            )}

            {appState === 'ready' && activeTab === 'table' && (
              <button 
                onClick={autoFixDittoMarks}
                className="px-2.5 py-1.5 bg-amber-50 text-amber-800 border border-amber-300 rounded-lg hover:bg-amber-100 text-xs font-semibold flex items-center"
              >
                <Sparkles className="w-3.5 h-3.5 mr-1 text-amber-600" /> แปลงเครื่องหมายซ้ำ (")
              </button>
            )}

            <button 
              onClick={() => setShowHistoryModal(true)}
              className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold flex items-center transition-colors"
            >
              <Database className="w-4 h-4 mr-1 text-blue-600" />
              คลังประวัติ ({history.length})
            </button>

            {appState === 'ready' && (
              <>
                <div className="bg-slate-100 p-1 rounded-lg flex space-x-1 border border-slate-200">
                  <button 
                    onClick={() => setActiveTab('table')}
                    className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${activeTab === 'table' ? 'bg-blue-600 text-white shadow' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                  >
                    <TableIcon className="w-3.5 h-3.5 inline mr-1" /> ตารางบันทึก
                  </button>
                  <button 
                    onClick={() => setActiveTab('analytics')}
                    className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${activeTab === 'analytics' ? 'bg-blue-600 text-white shadow' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                  >
                    <BarChart3 className="w-3.5 h-3.5 inline mr-1" /> แดชบอร์ดวิเคราะห์
                  </button>
                </div>

                <button 
                  onClick={handleManualSave}
                  className="px-2.5 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center text-xs font-semibold shadow-sm"
                >
                  <Save className="w-3.5 h-3.5 mr-1" /> บันทึกประวัติ
                </button>

                {activeTab === 'analytics' && (
                  <>
                    <button
                      onClick={handleGenerateAnalysisSummary}
                      className="px-2.5 py-1.5 bg-violet-600 text-white rounded-lg hover:bg-violet-700 flex items-center text-xs font-semibold shadow-sm"
                    >
                      <FileText className="w-3.5 h-3.5 mr-1" /> จัดทำสรุปผลการวิเคราะห์
                    </button>
                    <button
                      onClick={handleDownloadHtmlReport}
                      className="px-2.5 py-1.5 bg-cyan-600 text-white rounded-lg hover:bg-cyan-700 flex items-center text-xs font-semibold shadow-sm"
                    >
                      <Download className="w-3.5 h-3.5 mr-1" /> ดาวน์โหลด HTML
                    </button>
                    <button
                      onClick={handleEmailReport}
                      className="px-2.5 py-1.5 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center text-xs font-semibold shadow-sm"
                    >
                      <Mail className="w-3.5 h-3.5 mr-1" /> ส่งอีเมล
                    </button>
                    <button 
                      onClick={handlePrintReport}
                      className="px-2.5 py-1.5 bg-slate-800 text-white rounded-lg hover:bg-slate-700 flex items-center text-xs font-semibold shadow-sm"
                    >
                      <Printer className="w-3.5 h-3.5 mr-1" /> พิมพ์ PDF
                    </button>
                  </>
                )}
              </>
            )}

            <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageUpload} className="hidden" />
            <input type="file" accept=".json" ref={jsonImportRef} onChange={handleImportJSON} className="hidden" />
            
            {appState === 'uploaded' ? (
              <button
                onClick={handleScanDocument}
                disabled={orientationChecking}
                className={`px-3 py-1.5 bg-emerald-600 rounded-lg text-white hover:bg-emerald-700 flex items-center text-xs font-bold shadow-md ${orientationChecking ? 'opacity-70 cursor-wait' : 'animate-pulse'}`}
              >
                {orientationChecking
                  ? <><Loader2 className="w-4 h-4 mr-1 animate-spin" /> กำลังตรวจทิศทางภาพ...</>
                  : <><ScanLine className="w-4 h-4 mr-1" /> เริ่มสแกน</>}
              </button>
            ) : (
              <button onClick={triggerFileInput} className="px-2.5 py-1.5 bg-indigo-50 border border-indigo-200 rounded-lg text-indigo-700 hover:bg-indigo-100 flex items-center text-xs font-semibold">
                อัปโหลดรูป
              </button>
            )}
          </div>
        </header>

        {(statusMessage || saveStatus) && (
          <div className="bg-blue-50 px-4 py-1 text-xs text-blue-800 border-b border-blue-100 flex justify-between items-center font-medium">
            <span>{statusMessage || saveStatus}</span>
          </div>
        )}

        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row bg-slate-100 w-full">
          
          {showImagePane && imageSrc && (
            <div className="w-full lg:w-1/3 bg-slate-900 border-b lg:border-b-0 lg:border-r border-slate-700 flex flex-col shrink-0 relative transition-all">
              <div className="p-2 bg-slate-800 text-white text-xs flex justify-between items-center font-semibold border-b border-slate-700">
                <span>เอกสารอ้างอิง{imageRotation !== 0 ? ` (หมุน ${imageRotation}°)` : ''}</span>
                <div className="flex items-center gap-1">
                  {appState === 'uploaded' && (
                    <>
                      <button type="button" onClick={() => rotateImage(-90)} title="หมุนซ้าย 90°" className="text-slate-300 hover:text-white px-1.5 py-1 flex items-center gap-1 rounded hover:bg-slate-700">
                        <RotateCcw className="w-4 h-4" /> หมุนซ้าย
                      </button>
                      <button type="button" onClick={() => rotateImage(90)} title="หมุนขวา 90°" className="text-slate-300 hover:text-white px-1.5 py-1 flex items-center gap-1 rounded hover:bg-slate-700">
                        <RotateCw className="w-4 h-4" /> หมุนขวา
                      </button>
                    </>
                  )}
                  <button onClick={() => setShowImagePane(false)} className="text-slate-400 hover:text-white p-1">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              </div>
              <div className="flex-1 overflow-auto p-3 flex items-center justify-center">
                <img src={previewSrc || imageSrc} alt="Document" className="max-w-full h-auto max-h-full object-contain rounded shadow-lg border border-slate-700" />
              </div>
            </div>
          )}

          {appState === 'ready' && (
            <div className="flex-1 overflow-auto bg-white flex flex-col w-full">
              
              {activeTab === 'table' && (
                <div className="flex-1 overflow-auto w-full">
                  <table className="w-full text-xs md:text-sm text-left border-collapse min-w-[1100px]">
                    <thead className="bg-slate-100 text-slate-700 sticky top-0 z-10 text-center font-semibold text-[11px] uppercase tracking-wider shadow-sm">
                      <tr>
                        <th rowSpan="2" className="border-b-2 border-r border-slate-300 p-2 min-w-[60px] bg-slate-200">Time</th>
                        <th rowSpan="2" className="border-b-2 border-r border-slate-300 p-2 min-w-[140px] bg-slate-200">PRODUCT TYPE</th>
                        <th colSpan="5" className="border-b border-r border-slate-300 p-1 bg-blue-50/80">DW RUNNING</th>
                        <th colSpan="2" className="border-b border-r border-slate-300 p-1 bg-orange-50/80">HOT AIR TEMP (°C)</th>
                        <th rowSpan="2" className="border-b-2 border-r border-slate-300 p-2 bg-slate-100">% SPEED</th>
                        <th rowSpan="2" className="border-b-2 border-r border-slate-300 p-2 bg-indigo-50">% WET MOIST</th>
                        <th rowSpan="2" className="border-b-2 border-r border-slate-300 p-2 bg-blue-50">% PROD MOIST</th>
                        <th rowSpan="2" className="border-b-2 border-r border-slate-300 p-2 bg-slate-100">Filter</th>
                        <th rowSpan="2" className="border-b-2 border-slate-300 p-2 min-w-[160px] bg-slate-100">REMARK</th>
                      </tr>
                      <tr>
                        <th className="border-b-2 border-r border-slate-300 p-1 w-8 bg-blue-50">1</th>
                        <th className="border-b-2 border-r border-slate-300 p-1 w-8 bg-blue-50">2</th>
                        <th className="border-b-2 border-r border-slate-300 p-1 w-8 bg-blue-50">3</th>
                        <th className="border-b-2 border-r border-slate-300 p-1 w-8 bg-blue-50">4</th>
                        <th className="border-b-2 border-r border-slate-300 p-1 w-8 bg-blue-50">5</th>
                        <th className="border-b-2 border-r border-slate-300 p-1 min-w-[65px] bg-orange-50">IN</th>
                        <th className="border-b-2 border-r border-slate-300 p-1 min-w-[65px] bg-orange-50">OUT</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-800">
                      {data.map((row, index) => {
                        const resolvedType = resolvedAllProductTypes[index];
                        const isDitto = row.productType === '"' || row.productType === '〃' || row.productType === "''";

                        return (
                          <tr key={row.id} className="hover:bg-blue-50/40 border-b border-slate-200 transition-colors">
                            <td className="border-r border-slate-200 text-center bg-slate-50 font-bold text-slate-700">{row.time}</td>
                            <td className="border-r border-slate-200 p-0 relative group">
                              <input 
                                type="text" 
                                value={row.productType} 
                                onChange={(e) => handleCellChange(index, 'productType', e.target.value)} 
                                className={`w-full h-full p-2 text-center bg-transparent focus:bg-white outline-none font-bold ${isDitto ? 'text-amber-600' : 'text-slate-800'}`} 
                              />
                              {isDitto && (
                                <span className="absolute right-1 top-1/2 -translate-y-1/2 text-[10px] bg-amber-100 text-amber-800 px-1 rounded opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                                  ={resolvedType}
                                </span>
                              )}
                            </td>
                            {['dw1', 'dw2', 'dw3', 'dw4', 'dw5'].map(f => (
                              <td key={f} className="border-r border-slate-200 p-0 text-center">
                                <input type="text" value={row[f]} onChange={(e) => handleCellChange(index, f, e.target.value)} className="w-full h-full p-1 text-center font-bold text-blue-600 bg-transparent focus:bg-white outline-none" />
                              </td>
                            ))}
                            <td className="border-r border-slate-200 p-0">
                              <input type="text" value={row.hotAirIn} onChange={(e) => handleCellChange(index, 'hotAirIn', e.target.value)} className="w-full h-full p-2 text-center bg-transparent focus:bg-white outline-none text-orange-600 font-bold" />
                            </td>
                            <td className="border-r border-slate-200 p-0">
                              <input type="text" value={row.hotAirOut} onChange={(e) => handleCellChange(index, 'hotAirOut', e.target.value)} className="w-full h-full p-2 text-center bg-transparent focus:bg-white outline-none text-amber-600 font-bold" />
                            </td>
                            <td className="border-r border-slate-200 p-0">
                              <input type="text" value={row.speed} onChange={(e) => handleCellChange(index, 'speed', e.target.value)} className="w-full h-full p-2 text-center bg-transparent focus:bg-white outline-none" />
                            </td>
                            <td className="border-r border-slate-200 p-0">
                              <input type="text" value={row.wetCakeMoisture} onChange={(e) => handleCellChange(index, 'wetCakeMoisture', e.target.value)} className="w-full h-full p-2 text-center bg-indigo-50/30 focus:bg-white outline-none text-indigo-700 font-bold" />
                            </td>
                            <td className="border-r border-slate-200 p-0">
                              <input type="text" value={row.productMoisture} onChange={(e) => handleCellChange(index, 'productMoisture', e.target.value)} className="w-full h-full p-2 text-center bg-blue-50/30 focus:bg-white outline-none text-blue-700 font-bold" />
                            </td>
                            <td className="border-r border-slate-200 p-0">
                              <input type="text" value={row.changeDwFilter} onChange={(e) => handleCellChange(index, 'changeDwFilter', e.target.value)} className="w-full h-full p-2 text-center bg-transparent focus:bg-white outline-none text-blue-600 font-bold" />
                            </td>
                            <td className="p-0">
                              <input type="text" value={row.remark} onChange={(e) => handleCellChange(index, 'remark', e.target.value)} className="w-full h-full p-2 text-left text-red-600 text-xs bg-transparent focus:bg-white outline-none" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}

              {activeTab === 'analytics' && (
                <div className="analytics-shell print-report p-3 md:p-5 overflow-auto flex-1 space-y-5 w-full">
                  
                  <div className="glass-panel print-control-bar flex flex-wrap items-center justify-between gap-3 p-3 rounded-2xl w-full">
                    <div className="flex flex-wrap items-center gap-3">
                      <div className="flex items-center gap-2">
                        <CalendarDays className="w-5 h-5 text-cyan-400" />
                        <span className="text-sm font-bold text-slate-100">มุมมองข้อมูล:</span>
                        <div className="inline-flex rounded-xl border border-slate-700 bg-slate-950/70 p-1">
                          <button onClick={() => setAnalyticsView('DAILY')} className={`px-3 py-1 rounded-md text-xs font-bold ${analyticsView === 'DAILY' ? 'bg-blue-600 text-white shadow' : 'text-slate-300 hover:bg-slate-800'}`}>รายวัน</button>
                          <button onClick={() => setAnalyticsView('WEEKLY')} className={`px-3 py-1 rounded-md text-xs font-bold ${analyticsView === 'WEEKLY' ? 'bg-cyan-600 text-white shadow' : 'text-slate-300 hover:bg-slate-800'}`}>7 วัน</button>
                          <button disabled title="จะพัฒนาหลังจากมุมมอง 7 วันผ่านการทดสอบ" className="px-3 py-1 rounded-md text-xs font-bold text-slate-600 cursor-not-allowed">1 เดือน</button>
                        </div>
                      </div>
                      {analyticsView === 'DAILY' && <div className="flex items-center space-x-2">
                      <Clock className="w-5 h-5 text-blue-400" />
                      <span className="text-sm font-bold text-slate-100">เลือกช่วงเวลา/กะ:</span>
                      <div className="inline-flex flex-wrap rounded-xl border border-slate-700 bg-slate-950/70 p-1">
                        <button 
                          onClick={() => setSelectedShift('ALL')}
                          className={`px-3 py-1 rounded-md text-xs font-bold ${selectedShift === 'ALL' ? 'bg-blue-600 text-white shadow' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                        >
                          ทั้งวัน (24 ชม.)
                        </button>
                        <button 
                          onClick={() => setSelectedShift('DAY')}
                          className={`px-3 py-1 rounded-md text-xs font-bold flex items-center ${selectedShift === 'DAY' ? 'bg-amber-500 text-white shadow' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                        >
                          <Sun className="w-3.5 h-3.5 mr-1" /> กะกลางวัน (08:00 - 20:00)
                        </button>
                        <button 
                          onClick={() => setSelectedShift('NIGHT')}
                          className={`px-3 py-1 rounded-md text-xs font-bold flex items-center ${selectedShift === 'NIGHT' ? 'bg-indigo-600 text-white shadow' : 'text-slate-300 hover:bg-slate-800 hover:text-white'}`}
                        >
                          <Moon className="w-3.5 h-3.5 mr-1" /> กะกลางคืน (20:00 - 08:00)
                        </button>
                      </div>
                    </div>}
                    </div>

                    {analyticsView === 'DAILY' && <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => setShowChartEvents((value) => !value)} className={`dashboard-toggle ${showChartEvents ? 'is-active' : ''}`}>
                        <span className="toggle-dot" /> {showChartEvents ? 'แสดงจุดหยุด/เริ่มเครื่อง' : 'ซ่อนจุดหยุด/เริ่มเครื่อง'}
                      </button>
                      <button type="button" onClick={() => setShowChartGradient((value) => !value)} className={`dashboard-toggle ${showChartGradient ? 'is-active' : ''}`}>
                        <span className="toggle-dot" /> เงาสีใต้กราฟ
                      </button>
                    </div>}

                    <div className="flex items-center space-x-4 text-xs font-medium text-slate-300">
                      <span className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 mr-1.5"></span> ปกติ (Green)</span>
                      <span className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 mr-1.5"></span> เฝ้าระวัง (Yellow)</span>
                      <span className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-red-500 mr-1.5"></span> วิกฤต (Red)</span>
                    </div>
                  </div>

                  {analyticsView === 'WEEKLY' ? (
                    <section className="weekly-dashboard space-y-4">
                      <div className="weekly-range-panel">
                        <div className="weekly-range-controls">
                          <button type="button" onClick={() => moveWeeklyRange(-7)} className="weekly-range-button"><ChevronLeft className="h-4 w-4" /> เลื่อนย้อนหลัง</button>
                          <label className="weekly-date-field"><span>วันที่เริ่มต้น</span><input type="date" value={formatDateKey(normalizedStart)} onChange={(event) => setRangeStartDateKey(event.target.value)} /></label>
                          <span className="weekly-date-separator">ถึง</span>
                          <label className="weekly-date-field"><span>วันที่สิ้นสุด</span><input type="date" value={formatDateKey(normalizedEnd)} onChange={(event) => setRangeEndDateKey(event.target.value)} /></label>
                          <button type="button" onClick={() => moveWeeklyRange(7)} className="weekly-range-button">เลื่อนไปข้างหน้า <ChevronRight className="h-4 w-4" /></button>
                        </div>
                        <div className="weekly-display-toggle">
                          <span>การแสดงผล:</span>
                          <button type="button" className={historyDisplayMode === 'ALL_DAYS' ? 'active' : ''} onClick={() => setHistoryDisplayMode('ALL_DAYS')}>วันที่ทั้งหมด</button>
                          <button type="button" className={historyDisplayMode === 'PRODUCTION_ONLY' ? 'active' : ''} onClick={() => setHistoryDisplayMode('PRODUCTION_ONLY')}>เฉพาะวันที่มีข้อมูลการผลิต</button>
                        </div>
                      </div>
                      <div className="weekly-summary-grid">
                        <div><span>ช่วงวันที่</span><strong>{formatShortThaiDate(normalizedStart)} – {formatShortThaiDate(normalizedEnd)}</strong><small>{dayCount} วัน (รวมวันแรกและวันสุดท้าย)</small></div>
                        <div><span>วันที่มีการผลิต</span><strong>{weeklyProductionDays} วัน</strong></div>
                        <div><span>ไม่มีการผลิต</span><strong>{weeklyNoProductionDays} วัน</strong><small>มีรายงานแต่ไม่มีค่าการผลิต</small></div>
                        <div><span>ไม่มีรายงาน</span><strong>{weeklyMissingDays} วัน</strong></div>
                        <div><span>รายงานในช่วงนี้</span><strong>{weeklyReportCount} ฉบับ</strong><small>ทั้งหมดในคลัง {history.length} ฉบับ</small></div>
                      </div>
                      <div className="weekly-notice">ระบบแยก “มีการผลิต”, “ไม่มีการผลิต” และ “ไม่มีรายงาน” ออกจากกัน โดยไม่ใช้ค่า 0 แทนวันที่ว่าง</div>
                      <div className="weekly-chart-grid">
                        <WeeklyTrendChart days={weeklyDays} field="hotAirIn" label="อุณหภูมิลมเข้า IN เฉลี่ยรายวัน" unit="°C" minY={100} maxY={180} target={[140,160]} lineColor="#fb923c" />
                        <WeeklyTrendChart days={weeklyDays} field="hotAirOut" label="อุณหภูมิปลายปล่อง OUT เฉลี่ยรายวัน" unit="°C" minY={35} maxY={85} target={[50,65]} lineColor="#fbbf24" />
                        <WeeklyTrendChart days={weeklyDays} field="wetCakeMoisture" label="ความชื้นแป้งหมาด WET เฉลี่ยรายวัน" unit="%" minY={20} maxY={45} target={[30,38]} lineColor="#818cf8" />
                        <WeeklyTrendChart days={weeklyDays} field="productMoisture" label="ความชื้นแป้งแห้ง PROD เฉลี่ยรายวัน" unit="%" minY={8} maxY={18} target={[11,12.5]} lineColor="#60a5fa" />
                      </div>
                    </section>
                  ) : <>
                  <div className="print-kpi-grid grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 w-full">
                    <div className="kpi-card kpi-orange">
                      <p className="text-[11px] font-bold text-slate-400 uppercase">อุณหภูมิลมเข้า IN (เฉลี่ย)</p>
                      <p className="text-2xl font-extrabold text-orange-600 mt-1">{analytics.avgTempIn} <span className="text-xs font-normal text-slate-500">°C</span></p>
                      <p className="text-[11px] text-slate-400 mt-1">เกณฑ์ปกติ: 140°C - 160°C</p>
                    </div>

                    <div className="kpi-card kpi-amber">
                      <p className="text-[11px] font-bold text-slate-400 uppercase">อุณหภูมิปลายปล่อง OUT (เฉลี่ย)</p>
                      <p className="text-2xl font-extrabold text-amber-600 mt-1">{analytics.avgTempOut} <span className="text-xs font-normal text-slate-500">°C</span></p>
                      <p className="text-[11px] text-slate-400 mt-1">เกณฑ์ปกติ: 50°C - 65°C</p>
                    </div>

                    <div className="kpi-card kpi-indigo">
                      <p className="text-[11px] font-bold text-slate-400 uppercase">ความชื้นแป้งหมาด WET (เฉลี่ย)</p>
                      <p className="text-2xl font-extrabold text-indigo-600 mt-1">{analytics.avgWetMoist} <span className="text-xs font-normal text-slate-500">%</span></p>
                      <p className="text-[11px] text-slate-400 mt-1">เกณฑ์ปกติ: 30% - 38%</p>
                    </div>

                    <div className="kpi-card kpi-blue">
                      <p className="text-[11px] font-bold text-slate-400 uppercase">ความชื้นแป้งแห้ง PROD (เฉลี่ย)</p>
                      <p className="text-2xl font-extrabold text-blue-600 mt-1">{analytics.avgProdMoist} <span className="text-xs font-normal text-slate-500">%</span></p>
                      <p className="text-[11px] text-emerald-600 font-semibold mt-1">เกณฑ์ปกติ: 11.0% - 12.5%</p>
                    </div>
                  </div>

                  <div className="print-chart-grid grid grid-cols-1 xl:grid-cols-2 gap-4 w-full">
                    
                    <div className="chart-glass-card print-chart-card print-chart-1 space-y-3">
                      <div className="flex justify-between items-center border-b border-slate-700/80 pb-3">
                        <div>
                          <h3 className="text-sm font-bold text-slate-100 flex items-center">
                            <Thermometer className="w-4 h-4 mr-1.5 text-orange-500" /> 1. กราฟอุณหภูมิลมร้อนขาเข้า IN (อบแป้ง)
                          </h3>
                          <p className="text-[10px] text-slate-400">{"ปกติ: 140-160°C | เหลือง: ต่ำกว่า 140°C หรือ 160°C ขึ้นไป | แดง: ต่ำกว่า 130°C"}</p>
                        </div>
                        <span className="text-xs font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded border border-orange-200">
                          {analytics.avgTempIn} °C
                        </span>
                      </div>
                      <ProcessChart dataset={currentFilteredData} resolvedTypes={resolvedFilteredProductTypes} field="hotAirIn" minY={100} maxY={180} ticks={[100,120,140,160,180]} target={[140,160]} lineColor="#fb923c" unit="°C" valueLabel="ลมร้อนเข้า IN" showEventTimeline showEvents={showChartEvents} showGradient={showChartGradient} eventOverrides={eventOverrides} onEditEvent={editDetectedEvent} onHideEvent={hideDetectedEvent} onRestoreEvents={restoreDetectedEvents} />
                    </div>

                    <div className="chart-glass-card print-chart-card print-chart-2 print-page-break space-y-3">
                      <div className="flex justify-between items-center border-b border-slate-700/80 pb-3">
                        <div>
                          <h3 className="text-sm font-bold text-slate-100 flex items-center">
                            <Thermometer className="w-4 h-4 mr-1.5 text-amber-500" /> 2. กราฟอุณหภูมิปลายปล่อง OUT (แป้งแห้ง)
                          </h3>
                          <p className="text-[10px] text-slate-400">{"ปกติ: 50°C - 65°C | นอกเกณฑ์: สีเหลือง"}</p>
                        </div>
                        <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                          {analytics.avgTempOut} °C
                        </span>
                      </div>
                      <ProcessChart dataset={currentFilteredData} resolvedTypes={resolvedFilteredProductTypes} field="hotAirOut" minY={35} maxY={85} ticks={[40,50,60,70,80]} target={[50,65]} lineColor="#fbbf24" unit="°C" valueLabel="ปลายปล่อง OUT" showEvents={showChartEvents} showGradient={showChartGradient} eventOverrides={eventOverrides} />
                    </div>

                    <div className="chart-glass-card print-chart-card print-chart-3 space-y-3">
                      <div className="flex justify-between items-center border-b border-slate-700/80 pb-3">
                        <div>
                          <h3 className="text-sm font-bold text-slate-100 flex items-center">
                            <Droplets className="w-4 h-4 mr-1.5 text-indigo-500" /> 3. กราฟความชื้นแป้งหมาด (% WET MOISTURE)
                          </h3>
                          <p className="text-[10px] text-slate-400">{"ปกติ: 30% - 38% | เหลือง: ต่ำกว่า 30% | แดง: มากกว่า 38%"}</p>
                        </div>
                        <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                          {analytics.avgWetMoist} %
                        </span>
                      </div>
                      <ProcessChart dataset={currentFilteredData} resolvedTypes={resolvedFilteredProductTypes} field="wetCakeMoisture" minY={20} maxY={45} ticks={[20,25,30,35,38,40,45]} target={[30,38]} lineColor="#818cf8" unit="%" valueLabel="ความชื้นแป้งหมาด WET" showEvents={showChartEvents} showGradient={showChartGradient} eventOverrides={eventOverrides} />
                    </div>

                    <div className="chart-glass-card print-chart-card print-chart-4 print-page-break space-y-3">
                      <div className="flex justify-between items-center border-b border-slate-700/80 pb-3">
                        <div>
                          <h3 className="text-sm font-bold text-slate-100 flex items-center">
                            <Droplets className="w-4 h-4 mr-1.5 text-blue-600" /> 4. กราฟความชื้นแป้งแห้ง (% PRODUCT MOISTURE)
                          </h3>
                          <p className="text-[10px] text-slate-400">{"ปกติ: 11.0-12.5% | เหลือง: 0-10.9% หรือ 12.5-14% | แดง: มากกว่า 14%"}</p>
                        </div>
                        <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                          {analytics.avgProdMoist} %
                        </span>
                      </div>
                      <ProcessChart dataset={currentFilteredData} resolvedTypes={resolvedFilteredProductTypes} field="productMoisture" minY={8} maxY={18} ticks={[8,10,11,12.5,14,16,18]} target={[11,12.5]} lineColor="#60a5fa" unit="%" valueLabel="ความชื้นแป้งแห้ง PROD" showEvents={showChartEvents} showGradient={showChartGradient} eventOverrides={eventOverrides} />
                    </div>

                  </div>

                  <div className="glass-panel print-anomaly-summary p-4 rounded-2xl">
                    <h3 className="text-sm font-bold text-slate-100 mb-2 flex items-center">
                      <AlertTriangle className="w-4 h-4 mr-1.5 text-amber-500" /> รายงานความผิดปกติในกะนี้ ({analytics.anomalies.length} รายการ)
                    </h3>
                    {analytics.anomalies.length > 0 ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                        {analytics.anomalies.map((item, idx) => (
                          <div 
                            key={idx} 
                            className={`p-2.5 rounded-lg text-xs flex justify-between items-center border ${
                              item.level === 'red' 
                                ? 'bg-red-50 border-red-200 text-red-800 font-semibold' 
                                : 'bg-amber-50 border-amber-200 text-amber-800'
                            }`}
                          >
                            <div>
                              <span>🕒 <strong>{item.time} น.</strong> ({item.pType})</span>
                              <p className="text-[11px] mt-0.5">{item.issue}</p>
                            </div>
                            <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase ${item.level === 'red' ? 'bg-red-200 text-red-900' : 'bg-amber-200 text-amber-900'}`}>
                              {item.level === 'red' ? 'วิกฤต' : 'เตือน'}
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-emerald-700 bg-emerald-50 border border-emerald-200 p-3 rounded-lg text-xs flex items-center">
                        <CheckCircle2 className="w-4 h-4 mr-2 text-emerald-600" /> ค่าการทำงานอยู่ในเกณฑ์มาตรฐานตลอดทั้งกะ
                      </div>
                    )}
                  </div>

                  <section id="analysis-summary-section" className="glass-panel print-analysis-summary p-4 rounded-2xl space-y-3">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="text-sm font-bold text-slate-100 flex items-center">
                          <FileText className="w-4 h-4 mr-1.5 text-violet-400" /> จัดทำสรุปผลการวิเคราะห์
                        </h3>
                        <p className="text-[11px] text-slate-400 mt-1">สร้างบทสรุปภาษาทางการจากข้อมูลที่แสดงในแดชบอร์ด และสามารถตรวจแก้ก่อนพิมพ์หรือส่งอีเมล</p>
                      </div>
                      <button
                        onClick={handleGenerateAnalysisSummary}
                        className="px-3 py-2 bg-violet-600 hover:bg-violet-700 text-white rounded-lg text-xs font-semibold flex items-center shadow-sm"
                      >
                        <FileText className="w-4 h-4 mr-1.5" />
                        {analysisSummary ? 'จัดทำสรุปใหม่' : 'จัดทำสรุปผลการวิเคราะห์'}
                      </button>
                    </div>

                    {summaryNeedsRefresh && (
                      <div className="rounded-lg border border-amber-400/40 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                        ข้อมูลมีการเปลี่ยนแปลง กรุณาจัดทำสรุปผลการวิเคราะห์ใหม่ก่อนพิมพ์หรือส่งอีเมล
                      </div>
                    )}

                    {analysisSummary ? (
                      <>
                        <textarea
                          value={analysisSummary}
                          onChange={(event) => { setAnalysisSummary(event.target.value); setSummaryNeedsRefresh(false); }}
                          className="analysis-summary-editor w-full min-h-[280px] rounded-xl border border-slate-600 bg-slate-950/60 p-4 text-sm leading-6 text-slate-100 outline-none focus:border-violet-400"
                          aria-label="ข้อความสรุปผลการวิเคราะห์"
                        />
                        <div className="analysis-summary-print whitespace-pre-wrap text-sm leading-6 text-slate-900">
                          {analysisSummary}
                        </div>
                        <div className="flex flex-wrap justify-between gap-2 text-[10px] text-slate-400">
                          <span>จัดทำล่าสุด: {summaryGeneratedAt || '-'}</span>
                          <span>ข้อความนี้จะถูกใช้ในรายงานพิมพ์และเนื้อหาอีเมล</span>
                        </div>
                      </>
                    ) : (
                      <div className="rounded-xl border border-dashed border-slate-600 bg-slate-950/30 px-4 py-8 text-center text-xs text-slate-400">
                        ยังไม่ได้จัดทำสรุปผลการวิเคราะห์
                      </div>
                    )}
                  </section>
                  </>}

                  <footer className="print-source-footer" aria-label="ข้อมูลการพิมพ์รายงาน">
                    วันที่พิมพ์: {new Date().toLocaleDateString('th-TH')} เวลา: {new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.
                  </footer>

                  {/* รายงานสำหรับพิมพ์ A4 แนวตั้ง 3 หน้า */}
                  <div className="print-landscape-report" aria-label="รายงาน A4 แนวตั้ง">
                    <section className="print-landscape-page print-landscape-page-1">
                      <div className="print-landscape-header">
                        <img src="/app-icon-64.png" alt="Drying OCR" />
                        <div><h1>ระบบวิเคราะห์รายงานการอบแป้ง (DRYING PROCESS)</h1><p>{docInfo.code} | วันที่เอกสาร: {docInfo.date}</p></div>
                      </div>
                      <div className="print-landscape-kpis">
                        <div><span>อุณหภูมิลมเข้า IN</span><strong>{analytics.avgTempIn} °C</strong><small>เกณฑ์ 140–160°C</small></div>
                        <div><span>อุณหภูมิปลายปล่อง OUT</span><strong>{analytics.avgTempOut} °C</strong><small>เกณฑ์ 50–65°C</small></div>
                        <div><span>ความชื้นแป้งหมาด WET</span><strong>{analytics.avgWetMoist} %</strong><small>เกณฑ์ 30–38%</small></div>
                        <div><span>ความชื้นแป้งแห้ง PROD</span><strong>{analytics.avgProdMoist} %</strong><small>เกณฑ์ 11.0–12.5%</small></div>
                      </div>
                      <div className="print-portrait-three-charts">
                        <article className="print-landscape-chart-card"><h2>1. กราฟอุณหภูมิลมร้อนขาเข้า IN (อบแป้ง)</h2><ProcessChart dataset={currentFilteredData} resolvedTypes={resolvedFilteredProductTypes} field="hotAirIn" minY={100} maxY={180} ticks={[100,120,140,160,180]} target={[140,160]} lineColor="#fb923c" unit="°C" valueLabel="ลมร้อนเข้า IN" showEvents={showChartEvents} showGradient={showChartGradient} eventOverrides={eventOverrides} /></article>
                        <article className="print-landscape-chart-card"><h2>2. กราฟอุณหภูมิปลายปล่อง OUT (แป้งแห้ง)</h2><ProcessChart dataset={currentFilteredData} resolvedTypes={resolvedFilteredProductTypes} field="hotAirOut" minY={35} maxY={85} ticks={[40,50,60,70,80]} target={[50,65]} lineColor="#fbbf24" unit="°C" valueLabel="ปลายปล่อง OUT" showEvents={showChartEvents} showGradient={showChartGradient} eventOverrides={eventOverrides} /></article>
                        <article className="print-landscape-chart-card"><h2>3. กราฟความชื้นแป้งหมาด (% WET MOISTURE)</h2><ProcessChart dataset={currentFilteredData} resolvedTypes={resolvedFilteredProductTypes} field="wetCakeMoisture" minY={20} maxY={45} ticks={[20,25,30,35,38,40,45]} target={[30,38]} lineColor="#818cf8" unit="%" valueLabel="ความชื้นแป้งหมาด WET" showEvents={showChartEvents} showGradient={showChartGradient} eventOverrides={eventOverrides} /></article>
                      </div>
                      <div className="print-page-footer"><span>วันที่พิมพ์: {new Date().toLocaleDateString('th-TH')} เวลา: {new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</span><span>หน้า 1 / 3</span></div>
                    </section>
                    <section className="print-landscape-page print-landscape-page-2">
                      <div className="print-landscape-section-title"><div><h1>กราฟความชื้นแป้งแห้งและสรุปผลการวิเคราะห์</h1><p>{docInfo.code} | วันที่เอกสาร: {docInfo.date}</p></div></div>
                      <div className="print-portrait-chart-summary-v24">
                        <article className="print-landscape-chart-card"><h2>4. กราฟความชื้นแป้งแห้ง (% PRODUCT MOISTURE)</h2><ProcessChart dataset={currentFilteredData} resolvedTypes={resolvedFilteredProductTypes} field="productMoisture" minY={8} maxY={18} ticks={[8,10,11,12.5,14,16,18]} target={[11,12.5]} lineColor="#60a5fa" unit="%" valueLabel="ความชื้นแป้งแห้ง PROD" showEvents={showChartEvents} showGradient={showChartGradient} eventOverrides={eventOverrides} /></article>
                        <div className="print-summary-box"><h2>สรุปผลการวิเคราะห์</h2><div className="print-summary-text">{analysisSummary || buildAnalysisSummary()}</div><h3>รายการความผิดปกติ ({analytics.anomalies.length} รายการ)</h3>{analytics.anomalies.length > 0 ? <ul>{analytics.anomalies.slice(0, 10).map((item, idx) => <li key={idx}>{item.time} น. ({item.pType}) — {item.issue}</li>)}</ul> : <p>ไม่พบค่าที่อยู่นอกเกณฑ์ในช่วงเวลาที่เลือก</p>}</div>
                      </div>
                      <div className="print-page-footer"><span>วันที่พิมพ์: {new Date().toLocaleDateString('th-TH')} เวลา: {new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</span><span>หน้า 2 / 3</span></div>
                    </section>
                    <section className="print-landscape-page print-landscape-page-3">
                      <div className="print-landscape-section-title"><div><h1>ตารางข้อมูลอ้างอิง 24 ชั่วโมง</h1><p>{docInfo.code} | วันที่เอกสาร: {docInfo.date}</p></div></div>
                      <div className="print-reference-table-wrap"><table className="print-reference-table"><thead><tr><th>เวลา</th><th>ชนิดแป้ง</th><th>DW</th><th>IN</th><th>OUT</th><th>Speed</th><th>Wet</th><th>Prod</th><th>Filter</th><th>หมายเหตุ</th></tr></thead><tbody>{data.map((row) => { const dw = ['dw1','dw2','dw3','dw4','dw5'].map((key, i) => row[key] ? String(i + 1) : '').filter(Boolean).join(','); return <tr key={`print-${row.id}`}><td>{row.time}</td><td>{row.productType}</td><td>{dw}</td><td>{row.hotAirIn}</td><td>{row.hotAirOut}</td><td>{row.speed}</td><td>{row.wetCakeMoisture}</td><td>{row.productMoisture}</td><td>{row.changeDwFilter}</td><td>{row.remark}</td></tr>; })}</tbody></table></div>
                      <div className="print-page-footer"><span>วันที่พิมพ์: {new Date().toLocaleDateString('th-TH')} เวลา: {new Date().toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' })} น.</span><span>หน้า 3 / 3</span></div>
                    </section>
                  </div>

                </div>
              )}

            </div>
          )}
        </div>

        {showHistoryModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden">
              <div className="p-4 bg-slate-100 border-b border-slate-200 flex justify-between items-center">
                <h3 className="font-bold text-slate-100 flex items-center">
                  <Database className="w-5 h-5 mr-2 text-blue-600" /> คลังประวัติเอกสารย้อนหลัง
                </h3>
                <button onClick={() => setShowHistoryModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 overflow-auto flex-1 space-y-2">
                {history.length > 0 && (
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-white p-2">
                    <span className="inline-flex items-center gap-1 text-xs font-bold text-slate-600"><ArrowUpDown className="h-4 w-4" /> จัดเรียงรายงาน</span>
                    <select value={historySortMode} onChange={(event) => setHistorySortMode(event.target.value)} className="rounded-md border border-slate-300 bg-white px-2 py-1.5 text-xs font-semibold text-slate-700">
                      <option value="DATE_DESC">วันที่ใหม่ → เก่า</option>
                      <option value="DATE_ASC">วันที่เก่า → ใหม่</option>
                      <option value="SAVED_DESC">บันทึกล่าสุด</option>
                    </select>
                  </div>
                )}
                {history.length === 0 ? (
                  <p className="text-center text-slate-500 py-8 text-xs">ยังไม่มีประวัติในเครื่อง กด "บันทึกประวัติ" หลังสแกนเพื่อเก็บบันทึก</p>
                ) : (
                  sortedHistory.map((record) => (
                    <div key={record.id} className="p-3 bg-slate-50 hover:bg-blue-50/50 border border-slate-200 rounded-lg flex items-center justify-between">
                      <div>
                        <p className="font-bold text-slate-800 text-xs">📅 วันที่เอกสาร: {record.date}</p>
                        {record.reportDateRaw && record.reportDateRaw !== record.date && <p className="text-[10px] text-slate-500">อ่านจากต้นฉบับ: {record.reportDateRaw}{record.dateEditedByUser ? ' • แก้ไขแล้ว' : ''}</p>}
                        <p className="text-[11px] text-slate-500">รหัสเอกสาร: {record.code} | บันทึก: {new Date(record.timestamp).toLocaleString('th-TH')}</p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button 
                          onClick={() => loadReportFromHistory(record)}
                          className="px-2.5 py-1 bg-blue-600 text-white rounded text-xs font-semibold hover:bg-blue-700"
                        >
                          ดึงข้อมูล
                        </button>
                        <button 
                          onClick={() => deleteHistoryRecord(record.id)}
                          className="p-1 text-red-500 hover:bg-red-50 rounded"
                          title="ลบ"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="p-3 bg-slate-100 border-t border-slate-200 flex flex-wrap justify-between items-center gap-2">
                <div className="flex space-x-2">
                  <button onClick={exportHistoryJSON} className="px-3 py-1 bg-white border border-slate-300 rounded text-slate-700 hover:bg-slate-50 text-xs font-semibold flex items-center">
                    <Download className="w-3.5 h-3.5 mr-1" /> ส่งออก .JSON
                  </button>
                  <button onClick={() => jsonImportRef.current.click()} className="px-3 py-1 bg-white border border-slate-300 rounded text-slate-700 hover:bg-slate-50 text-xs font-semibold flex items-center">
                    <Upload className="w-3.5 h-3.5 mr-1" /> นำเข้า .JSON
                  </button>
                </div>
                <button onClick={() => setShowHistoryModal(false)} className="px-3 py-1 bg-slate-800 text-white rounded text-xs font-semibold">
                  ปิด
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

function ProcessChart({
  dataset,
  resolvedTypes,
  field,
  minY,
  maxY,
  ticks,
  target,
  lineColor,
  unit,
  valueLabel,
  showEventTimeline = false,
  showEvents = true,
  showGradient = true,
  eventOverrides = {},
  onEditEvent = null,
  onHideEvent = null,
  onRestoreEvents = null,
}) {
  const [hoverIndex, setHoverIndex] = useState(null);
  if (!dataset || dataset.length === 0) return null;

  const width = 900;
  const height = 270;
  const padding = { left: 58, right: 20, top: 48, bottom: 54 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const parseMinutes = (value) => {
    const match = String(value || '').trim().match(/^(\d{1,2})[:.](\d{2})$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    if (hours === 24) return 24 * 60 + minutes;
    return hours * 60 + minutes;
  };

  const firstMinute = parseMinutes(dataset[0]?.time) ?? 0;
  const rowMinutes = dataset.map((row, index) => {
    let minute = parseMinutes(row.time);
    if (minute === null) return firstMinute + index * 60;
    while (minute < firstMinute) minute += 24 * 60;
    return minute;
  });
  const domainStart = rowMinutes[0];
  const domainEnd = rowMinutes[rowMinutes.length - 1] || domainStart + 60;
  const getXFromMinute = (minute) => padding.left + ((minute - domainStart) / Math.max(domainEnd - domainStart, 1)) * plotWidth;
  const getX = (index) => getXFromMinute(rowMinutes[index]);
  const baselineY = height - padding.bottom;
  const getY = (value) => {
    const parsed = parseNumericValue(value);
    if (parsed === null) return null;
    const clamped = Math.max(minY, Math.min(maxY, parsed));
    return padding.top + ((maxY - clamped) / (maxY - minY)) * plotHeight;
  };
  const getStatus = (value) => {
    const parsed = parseNumericValue(value);
    if (parsed === null) return { label: 'ไม่มีข้อมูลตัวอย่าง', color: '#94a3b8' };
    if (field === 'hotAirIn') {
      if (parsed < 130) return { label: 'วิกฤต', color: '#ef4444' };
      if (parsed >= 140 && parsed < 160) return { label: 'ปกติ', color: '#22c55e' };
      return { label: 'เฝ้าระวัง', color: '#f59e0b' };
    }
    if (field === 'hotAirOut') return parsed >= 50 && parsed <= 65 ? { label: 'ปกติ', color: '#22c55e' } : { label: 'เฝ้าระวัง', color: '#f59e0b' };
    if (field === 'wetCakeMoisture') {
      if (parsed > 38) return { label: 'วิกฤต', color: '#ef4444' };
      return parsed >= 30 ? { label: 'ปกติ', color: '#22c55e' } : { label: 'เฝ้าระวัง', color: '#f59e0b' };
    }
    if (parsed > 14) return { label: 'วิกฤต', color: '#ef4444' };
    return parsed >= 11 && parsed <= 12.5 ? { label: 'ปกติ', color: '#22c55e' } : { label: 'เฝ้าระวัง', color: '#f59e0b' };
  };

  const events = dataset.map((row, index) => {
    const event = resolveProcessEvent(row, index, eventOverrides);
    if (!event) return null;
    let minute = parseMinutes(event.time);
    if (minute === null) minute = rowMinutes[index];
    while (minute < domainStart) minute += 24 * 60;
    return { index, minute, x: getXFromMinute(minute), event };
  }).filter(Boolean).filter(({ minute }) => minute >= domainStart && minute <= domainEnd)
    .sort((a, b) => a.minute - b.minute);

  const segments = [];
  const dashedBridges = [];
  let current = [];
  let previousValidPoint = null;
  let gapStarted = false;

  dataset.forEach((row, index) => {
    const y = getY(row[field]);
    if (y === null) {
      if (current.length > 1) segments.push(current);
      current = [];
      if (previousValidPoint) gapStarted = true;
      return;
    }

    const point = { x: getX(index), y, minute: rowMinutes[index] };
    if (gapStarted && previousValidPoint) {
      dashedBridges.push([previousValidPoint, point]);
      gapStarted = false;
    }
    current.push(point);
    previousValidPoint = point;
  });
  if (current.length > 1) segments.push(current);

  const timelineEvents = events.filter(({ event }) =>
    ['stopDryer', 'startDryer', 'powerOutage', 'machineStop', 'clothAction'].includes(event.type)
  );

  const makeSmoothPath = (points) => {
    if (!points.length) return '';
    if (points.length === 1) return `M ${points[0].x} ${points[0].y}`;
    let path = `M ${points[0].x} ${points[0].y}`;
    for (let i = 1; i < points.length; i += 1) {
      const previous = points[i - 1];
      const currentPoint = points[i];
      const midX = (previous.x + currentPoint.x) / 2;
      path += ` C ${midX} ${previous.y}, ${midX} ${currentPoint.y}, ${currentPoint.x} ${currentPoint.y}`;
    }
    return path;
  };

  const gradientId = `gradient-${field}`;
  const glowId = `glow-${field}`;

  return (
    <div className="process-chart relative w-full overflow-hidden rounded-2xl border border-slate-700/80 bg-[#080d18] text-white">
      <svg className="block h-[285px] w-full" viewBox={`0 0 ${width} ${height}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={lineColor} stopOpacity="0.38" />
            <stop offset="100%" stopColor={lineColor} stopOpacity="0" />
          </linearGradient>
          <filter id={glowId} x="-30%" y="-30%" width="160%" height="160%">
            <feGaussianBlur stdDeviation="2.8" result="blur" />
            <feMerge><feMergeNode in="blur" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>
        <rect x={padding.left} y={getY(target[1])} width={plotWidth} height={getY(target[0]) - getY(target[1])} fill="#22c55e" opacity="0.12" />
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={padding.left} y1={getY(tick)} x2={width - padding.right} y2={getY(tick)} stroke="#334155" strokeDasharray="4 5" />
            <text x={padding.left - 9} y={getY(tick) + 4} fill="#94a3b8" fontSize="10" textAnchor="end">{tick}{unit}</text>
          </g>
        ))}


        {showEvents && events.map(({ index, x, event }, eventIndex) => {
          const labelY = 16 + (eventIndex % 2) * 14;
          return (
            <g key={`event-${index}-${event.type}-${event.time}`}>
              <line
                x1={x}
                y1={padding.top - 4}
                x2={x}
                y2={baselineY}
                stroke={event.color}
                strokeWidth="1.4"
                strokeDasharray="5 5"
                opacity="0.95"
              />
              <text
                x={x}
                y={labelY}
                fill={event.color}
                fontSize="9"
                textAnchor="middle"
                fontWeight="700"
              >
                {event.time}
              </text>
              <text
                x={x}
                y={labelY + 10}
                fill={event.color}
                fontSize="8"
                textAnchor="middle"
                fontWeight="600"
              >
                {event.label}
              </text>
            </g>
          );
        })}

        {segments.map((points, i) => {
          const path = makeSmoothPath(points);
          const areaPath = `${path} L ${points[points.length - 1].x} ${baselineY} L ${points[0].x} ${baselineY} Z`;
          return (
            <g key={`solid-${i}`}>
              {showGradient && <path d={areaPath} fill={`url(#${gradientId})`} opacity="0.85" />}
              <path d={path} fill="none" stroke={lineColor} strokeWidth="3.4" strokeLinejoin="round" strokeLinecap="round" filter={`url(#${glowId})`} />
            </g>
          );
        })}
        {dashedBridges.map((points, i) => (
          <line
            key={`bridge-${i}`}
            x1={points[0].x}
            y1={points[0].y}
            x2={points[1].x}
            y2={points[1].y}
            stroke={lineColor}
            strokeWidth="2.4"
            strokeDasharray="6 6"
            strokeLinecap="round"
            opacity="0.9"
          />
        ))}
        {dataset.map((row, index) => {
          const y = getY(row[field]);
          const x = getX(index);
          const status = getStatus(row[field]);
          return <g key={index}>
            {y !== null && (
              <g className={status.label === 'วิกฤต' ? 'critical-point' : status.label === 'เฝ้าระวัง' ? 'warning-point' : ''}>
                <circle cx={x} cy={y} r={hoverIndex === index ? 7 : 5} fill="#08111f" stroke={lineColor} strokeWidth="3" filter={`url(#${glowId})`} />
                <circle cx={x} cy={y} r={hoverIndex === index ? 3 : 2.3} fill={status.color} />
              </g>
            )}
            <rect x={x - Math.max(plotWidth / dataset.length / 2, 12)} y={padding.top} width={Math.max(plotWidth / dataset.length, 24)} height={plotHeight + 35} fill="transparent" onMouseEnter={() => setHoverIndex(index)} onMouseLeave={() => setHoverIndex(null)} />
            <text x={x} y={height - 18} fill={hoverIndex === index ? '#f8fafc' : '#94a3b8'} fontSize="10" textAnchor="middle" fontWeight={hoverIndex === index ? '700' : '400'}>{row.time}</text>
          </g>;
        })}
      </svg>
      {showEvents && showEventTimeline && timelineEvents.length > 0 && (
        <div className="print-hide-event-timeline border-t border-slate-800 bg-slate-900/90 px-3 py-2">
          <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-slate-400">
            <span>เหตุการณ์ในช่วงที่เลือก</span>
            <span className="flex items-center gap-2"><span>{timelineEvents.length} รายการ</span>{onRestoreEvents && Object.keys(eventOverrides).length > 0 && <button type="button" onClick={onRestoreEvents} className="event-restore-button"><RotateCcw className="h-3 w-3"/> คืนค่า AI</button>}</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {timelineEvents.map(({ index, event }) => (
              <span
                key={`${index}-${event.type}-${event.time}`}
                className="event-edit-chip"
                style={{ borderColor: `${event.color}66`, color: event.color, backgroundColor: `${event.color}14` }}
              >
                <span>{event.time} · {event.label}{event.edited ? ' (แก้ไขแล้ว)' : ''}</span>
                {onEditEvent && <button type="button" title="แก้ไขเหตุการณ์" onClick={() => onEditEvent(dataset[index], index, event)}><Pencil className="h-3 w-3"/></button>}
                {onHideEvent && <button type="button" title="ซ่อนเหตุการณ์" onClick={() => onHideEvent(dataset[index], index, event)}><EyeOff className="h-3 w-3"/></button>}
              </span>
            ))}
          </div>
        </div>
      )}
      {hoverIndex !== null && dataset[hoverIndex] && (() => {
        const row = dataset[hoverIndex];
        const event = resolveProcessEvent(row, hoverIndex, eventOverrides);
        const status = getStatus(row[field]);
        return <div className="chart-tooltip pointer-events-none absolute left-3 top-3 z-20 min-w-[220px] rounded-xl border border-white/10 bg-slate-950/90 p-3 text-xs shadow-2xl backdrop-blur-xl">
          <p className="font-bold text-white">{row.time} น. · {resolvedTypes[hoverIndex] || '-'}</p>
          <p className="mt-1 font-bold" style={{ color: lineColor }}>{valueLabel}: {parseNumericValue(row[field]) === null ? '-' : row[field]} {unit}</p>
          <p className="mt-1 text-slate-300">สถานะ: <span style={{ color: status.color }} className="font-bold">{status.label}</span></p>
          {event && <p className="mt-1 border-t border-slate-700 pt-1 font-semibold" style={{ color: event.color }}>เหตุการณ์: {event.label} {event.time}</p>}
          {parseNumericValue(row[field]) === null && !event && <p className="mt-1 text-slate-400">ไม่พบสาเหตุที่ระบุไว้ในแถวนี้</p>}
        </div>;
      })()}
    </div>
  );
}
