const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

const TIMES = [
  '08.00', '09.00', '10.00', '11.00', '12.00', '13.00',
  '14.00', '15.00', '16.00', '17.00', '18.00', '19.00',
  '20.00', '21.00', '22.00', '23.00', '24.00', '01.00',
  '02.00', '03.00', '04.00', '05.00', '06.00', '07.00',
];

const MODELS_TO_TRY = ['gemini-3.6-flash', 'gemini-3.5-flash'];

const CORE_FIELDS = [
  'hotAirIn', 'hotAirOut', 'speed',
  'wetCakeMoisture', 'productMoisture',
];

const ALL_FIELDS = [
  'productType', 'dw1', 'dw2', 'dw3', 'dw4', 'dw5',
  ...CORE_FIELDS, 'changeDwFilter', 'remark',
];

const emptyRow = (time) => ({
  time,
  productType: '',
  dw1: '', dw2: '', dw3: '', dw4: '', dw5: '',
  hotAirIn: '', hotAirOut: '', speed: '',
  wetCakeMoisture: '', productMoisture: '',
  changeDwFilter: '', remark: '', unreadableFields: [],
});

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'application/json; charset=utf-8',
    },
  });
}

function cleanText(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}

function normalizeTime(value) {
  const raw = cleanText(value).replace(':', '.');
  const match = raw.match(/^(\d{1,2})\.(\d{2})$/);
  if (!match || match[2] !== '00') return '';
  const hour = Number(match[1]);
  if (hour < 0 || hour > 24) return '';
  return `${String(hour).padStart(2, '0')}.00`;
}

function normalizeMark(value) {
  const raw = cleanText(value);
  if (!raw) return '';
  return /^(\/|1|I|i|l|\||✓|✔|√|⁄)$/u.test(raw) ? '/' : '';
}

function parseJsonSafely(text) {
  let cleaned = cleanText(text)
    .replace(/^```json\s*/i, '')
    .replace(/^```\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    const startObject = cleaned.indexOf('{');
    const endObject = cleaned.lastIndexOf('}');
    if (startObject >= 0 && endObject > startObject) {
      return JSON.parse(cleaned.slice(startObject, endObject + 1));
    }
    throw new Error('ไม่สามารถแปลงผล OCR เป็น JSON ได้');
  }
}

function extractCandidateText(apiData) {
  const parts = apiData?.candidates?.[0]?.content?.parts;
  if (!Array.isArray(parts)) return '';
  return parts.map((part) => part?.text || '').join('').trim();
}

async function callGemini({ apiKey, imageBase64, systemInstruction, prompt }) {
  const errors = [];

  for (const model of MODELS_TO_TRY) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
      const response = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey,
        },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemInstruction }] },
          contents: [{
            role: 'user',
            parts: [
              { text: prompt },
              { inlineData: { mimeType: 'image/jpeg', data: imageBase64 } },
            ],
          }],
          generationConfig: {
            responseMimeType: 'application/json',
            maxOutputTokens: 16384,
          },
        }),
      });

      const raw = await response.text();
      let apiData;
      try { apiData = JSON.parse(raw); }
      catch { throw new Error(`${model}: API ส่งข้อมูลผิดรูปแบบ`); }

      if (!response.ok) {
        throw new Error(`${model}: ${apiData?.error?.message || `HTTP ${response.status}`}`);
      }

      const text = extractCandidateText(apiData);
      if (!text) throw new Error(`${model}: ไม่พบผล OCR`);

      return { model, data: parseJsonSafely(text) };
    } catch (error) {
      console.error(error);
      errors.push(error?.message || `${model}: เกิดข้อผิดพลาด`);
    }
  }

  throw new Error(errors.join(' | ') || 'ไม่สามารถเรียกใช้งาน Gemini ได้');
}

function rowsByTime(sourceRows) {
  const map = new Map();
  for (const row of Array.isArray(sourceRows) ? sourceRows : []) {
    const time = normalizeTime(row?.time);
    if (TIMES.includes(time) && !map.has(time)) map.set(time, row);
  }
  return map;
}

function normalizeMainResult(result) {
  const sourceMap = rowsByTime(result?.rows);
  return {
    reportDate: cleanText(result?.reportDate),
    documentCode: cleanText(result?.documentCode) || 'FM-PD-010 Rev.1',
    rows: TIMES.map((time) => {
      const source = sourceMap.get(time);
      const row = emptyRow(time);
      if (!source) {
        row.unreadableFields = ['missingRow'];
        return row;
      }
      for (const field of ['productType', ...CORE_FIELDS, 'remark']) {
        row[field] = cleanText(source[field]);
      }
      row.unreadableFields = Array.isArray(source?.unreadableFields)
        ? [...new Set(source.unreadableFields.map(cleanText).filter(Boolean))]
        : [];
      return row;
    }),
  };
}

function mergeMarks(rows, markResult) {
  const markMap = rowsByTime(markResult?.rows);
  return rows.map((row) => {
    const source = markMap.get(row.time);
    if (!source) return row;
    return {
      ...row,
      dw1: normalizeMark(source.dw1),
      dw2: normalizeMark(source.dw2),
      dw3: normalizeMark(source.dw3),
      dw4: normalizeMark(source.dw4),
      dw5: normalizeMark(source.dw5),
      changeDwFilter: normalizeMark(source.changeDwFilter),
    };
  });
}

function populatedCoreCount(row) {
  return CORE_FIELDS.reduce((count, field) => count + (cleanText(row[field]) ? 1 : 0), 0);
}

function findSuspiciousTimes(rows) {
  const suspicious = new Set();

  rows.forEach((row, index) => {
    const count = populatedCoreCount(row);
    const prevCount = index > 0 ? populatedCoreCount(rows[index - 1]) : 0;
    const nextCount = index < rows.length - 1 ? populatedCoreCount(rows[index + 1]) : 0;
    const unreadableCore = row.unreadableFields.some((field) => CORE_FIELDS.includes(field));
    const hasRemark = Boolean(cleanText(row.remark));

    // แถวหายหรือเหลือเพียงบางค่า ทั้งที่แถวข้างเคียงมีข้อมูลครบ
    if ((count === 0 && prevCount >= 3 && nextCount >= 3) ||
        (count <= 2 && prevCount >= 4 && nextCount >= 4) ||
        unreadableCore) {
      suspicious.add(row.time);
    }

    // แถวที่มี Stop/Start/เหตุการณ์ ต้องตรวจซ้ำ เพราะมักมีข้อความล้ำเส้นและค่าบางส่วนก่อนหยุด
    if (hasRemark || /stop|start|หยุด|เริ่ม|ไฟดับ|ซ่อม/i.test(row.remark)) {
      suspicious.add(row.time);
      if (index > 0) suspicious.add(rows[index - 1].time);
      if (index < rows.length - 1) suspicious.add(rows[index + 1].time);
    }
  });

  return [...suspicious].slice(0, 10);
}

function mergeVerifiedRows(rows, verifyResult, suspiciousTimes) {
  const verifyMap = rowsByTime(verifyResult?.rows);
  const suspiciousSet = new Set(suspiciousTimes);

  return rows.map((row) => {
    if (!suspiciousSet.has(row.time)) return row;
    const verified = verifyMap.get(row.time);
    if (!verified) return row;

    const merged = { ...row };
    const verifiedUnreadable = new Set(
      Array.isArray(verified.unreadableFields)
        ? verified.unreadableFields.map(cleanText).filter(Boolean)
        : []
    );

    // เติมเฉพาะช่องที่รอบหลักว่าง หรือรอบหลักระบุว่าอ่านไม่ชัด
    for (const field of ['productType', ...CORE_FIELDS, 'remark']) {
      const current = cleanText(row[field]);
      const candidate = cleanText(verified[field]);
      const wasUnreadable = row.unreadableFields.includes(field) || row.unreadableFields.includes('missingRow');
      if ((!current || wasUnreadable) && candidate && !verifiedUnreadable.has(field)) {
        merged[field] = candidate;
      }
    }

    merged.unreadableFields = [...new Set([
      ...row.unreadableFields.filter((field) => cleanText(merged[field]) === ''),
      ...verifiedUnreadable,
    ])];

    return merged;
  });
}

const MAIN_SYSTEM = `
You are a high-precision OCR transcription engine for an industrial DRYING PROCESS OPERATION REPORT.
Read only these fields: report date, document code, PRODUCT TYPE, HOT AIR IN, HOT AIR OUT, SPEED, WET CAKE MOISTURE, PRODUCT MOISTURE, and REMARK.
Do NOT read DW1-DW5 or Change Dryer Filter in this pass.
Use the printed TIME column as the absolute row anchor. Read horizontally within each exact grid row.
Return exactly 24 rows in this order: ${TIMES.join(', ')}.
Blank cells must be empty strings. Never infer, repeat, average, translate, or copy values from another row.
Keep ditto marks (" or 〃) exactly as visible. Never expand them.
If uncertain, return an empty string and add the field name to unreadableFields.
Return JSON only, with keys reportDate, documentCode, rows.
`;

const MAIN_PROMPT = `
Transcribe the full document image once. Focus only on the main numeric/text fields and remarks.
Each row object must contain:
time, productType, hotAirIn, hotAirOut, speed, wetCakeMoisture, productMoisture, remark, unreadableFields.
Do not include guessed values. Preserve blank downtime cells.
`;

const MARK_SYSTEM = `
You are reading only mark cells in the same industrial table.
Ignore all numbers and text except the printed TIME anchors, DW1, DW2, DW3, DW4, DW5, and Change Dryer Filter.
For every visible slash/check mark return "/". For a blank cell return "".
Never return 1, I, l, or |. Never copy a mark into an adjacent column or row.
Return exactly 24 rows in this order: ${TIMES.join(', ')}.
Return JSON only with rows containing time, dw1, dw2, dw3, dw4, dw5, changeDwFilter.
`;

const MARK_PROMPT = `
Inspect the complete image, but transcribe only DW RUNNING marks and Change Dryer Filter marks.
Trace each printed time row horizontally and each mark column vertically before answering.
`;

function verificationSystem(times) {
  return `
You are performing a second-pass verification of ONLY these time rows: ${times.join(', ')}.
Use the full original image, but ignore every other row.
For each requested time, trace horizontally inside the exact printed row and transcribe:
productType, hotAirIn, hotAirOut, speed, wetCakeMoisture, productMoisture, remark.
Blank means "". Never infer from neighboring rows. Preserve ditto marks exactly.
If uncertain, return "" and add the field to unreadableFields.
Return JSON only with a rows array. Do not return unrequested rows.
`;
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }
    if (request.method !== 'POST') {
      return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
      if (!env.GEMINI_API_KEY) throw new Error('ยังไม่ได้ตั้งค่า GEMINI_API_KEY ใน Cloudflare');

      const body = await request.json();
      const imageBase64 = cleanText(body?.imageBase64).replace(
        /^data:image\/[a-zA-Z0-9.+-]+;base64,/,
        ''
      );
      if (!imageBase64) throw new Error('ไม่พบข้อมูลรูปภาพ imageBase64');

      // Pass 1: ตัวเลข ข้อความ และ Remark
      const main = await callGemini({
        apiKey: env.GEMINI_API_KEY,
        imageBase64,
        systemInstruction: MAIN_SYSTEM,
        prompt: MAIN_PROMPT,
      });
      const normalizedMain = normalizeMainResult(main.data);

      // Pass 2: อ่านเฉพาะเครื่องหมาย DW และ Filter เพื่อลดการรบกวนตัวเลข
      const marks = await callGemini({
        apiKey: env.GEMINI_API_KEY,
        imageBase64,
        systemInstruction: MARK_SYSTEM,
        prompt: MARK_PROMPT,
      });
      let rows = mergeMarks(normalizedMain.rows, marks.data);

      // Pass 3: ตรวจซ้ำเฉพาะแถวที่ขาด/ไม่ชัด/มีเหตุการณ์
      const suspiciousTimes = findSuspiciousTimes(rows);
      let verifyModel = '';
      if (suspiciousTimes.length > 0) {
        const verification = await callGemini({
          apiKey: env.GEMINI_API_KEY,
          imageBase64,
          systemInstruction: verificationSystem(suspiciousTimes),
          prompt: `Verify only these rows: ${suspiciousTimes.join(', ')}. Return no other rows.`,
        });
        verifyModel = verification.model;
        rows = mergeVerifiedRows(rows, verification.data, suspiciousTimes);
      }

      const reviewCellCount = rows.reduce(
        (sum, row) => sum + row.unreadableFields.length,
        0
      );

      return jsonResponse({
        reportDate: normalizedMain.reportDate,
        documentCode: normalizedMain.documentCode,
        rows,
        ocrMeta: {
          strategy: 'multi-pass-full-image-v18',
          mainModel: main.model,
          markModel: marks.model,
          verifyModel,
          verifiedTimes: suspiciousTimes,
          reviewCellCount,
        },
      });
    } catch (error) {
      console.error(error);
      return jsonResponse({ error: error?.message || 'เกิดข้อผิดพลาดที่ไม่ทราบสาเหตุ' }, 500);
    }
  },
};
