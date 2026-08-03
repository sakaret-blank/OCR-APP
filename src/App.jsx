import React, { useEffect, useRef, useState } from 'react';
import {
  AlertTriangle,
  BarChart3,
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

// บีบอัดรูปภาพก่อนส่ง API
const compressImage = (file, maxWidth = 1600) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      const img = new Image();
      img.src = event.target.result;
      img.onload = () => {
        const canvas = document.createElement('canvas');
        const ratio = maxWidth / img.width;
        const width = img.width > maxWidth ? maxWidth : img.width;
        const height = img.width > maxWidth ? img.height * ratio : img.height;

        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);
        
        const base64String = canvas.toDataURL('image/jpeg', 0.7).split(',')[1];
        resolve(base64String);
      };
    };
    reader.onerror = (error) => reject(error);
  });
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

  const isPowerOutage = remark.includes('ไฟดับ') || remark.includes('power outage') || remark.includes('power fail');
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

export default function App() {
  const [data, setData] = useState(generateEmptyData());
  const [docInfo, setDocInfo] = useState({ date: new Date().toLocaleDateString('th-TH'), code: 'FM-PD-010 Rev.1' });
  const [appState, setAppState] = useState('ready');
  const [activeTab, setActiveTab] = useState('table');
  const [selectedShift, setSelectedShift] = useState('ALL');
  const [showChartEvents, setShowChartEvents] = useState(true);
  const [showChartGradient, setShowChartGradient] = useState(true);
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
  const fileInputRef = useRef(null);
  const jsonImportRef = useRef(null);

  useEffect(() => {
    try {
      const savedHistory = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (savedHistory) {
        setHistory(JSON.parse(savedHistory));
      }
    } catch (e) {
      console.error('ไม่สามารถดึงประวัติได้:', e);
    }
  }, []);

  const saveHistoryToStorage = (newHistory) => {
    setHistory(newHistory);
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newHistory));
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

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      const url = URL.createObjectURL(file);
      setImageSrc(url);
      setShowImagePane(true);
      setAppState('uploaded');
      setData(generateEmptyData());
      setDocInfo({ date: new Date().toLocaleDateString('th-TH'), code: 'FM-PD-010 Rev.1' });
      setAnalysisSummary('');
      setSummaryGeneratedAt('');
      setSummaryNeedsRefresh(false);
    }
    e.target.value = null;
  };

  const handleScanDocument = async () => {
    if (!selectedFile) return;
    setAppState('scanning');
    
    try {
      const base64Image = await compressImage(selectedFile);
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

      if (result.rows && Array.isArray(result.rows)) {
        const newDate = result.reportDate || docInfo.date;
        const newCode = result.documentCode || docInfo.code;
        setDocInfo({ date: newDate, code: newCode });
        
        const formattedRows = result.rows.map((row, idx) => normalizeOcrRow(row, idx));
        
        setData(formattedRows);
        setAnalysisSummary('');
        setSummaryGeneratedAt('');
        setSummaryNeedsRefresh(false);
        autoSaveToHistory(newDate, newCode, formattedRows);
        setShowImagePane(false);
      } else {
        throw new Error("ข้อมูลตอบกลับจาก AI ไม่พบรายการแถว (rows)");
      }
      
      setAppState('ready');
      setSaveStatus('สแกนและบันทึกประวัติเรียบร้อยแล้ว');
    } catch (error) {
      console.error("Scanning failed:", error);
      setStatusMessage(`⚠️ เกิดข้อผิดพลาดในการสแกน: ${error.message}`);
      setAppState('uploaded');
    }
  };

  const autoSaveToHistory = (dateStr, codeStr, rowsData) => {
    const reportId = `${dateStr}_${Date.now()}`;
    const newRecord = {
      id: reportId,
      date: dateStr,
      code: codeStr,
      timestamp: new Date().toISOString(),
      rows: rowsData
    };

    const existingIndex = history.findIndex(h => h.date === dateStr);
    let updatedHistory = [...history];
    if (existingIndex >= 0) {
      updatedHistory[existingIndex] = newRecord;
    } else {
      updatedHistory.unshift(newRecord);
    }

    saveHistoryToStorage(updatedHistory);
  };

  const handleManualSave = () => {
    autoSaveToHistory(docInfo.date, docInfo.code, data);
    setSaveStatus('บันทึกประวัติลงเครื่องเรียบร้อยแล้ว');
    setTimeout(() => setSaveStatus(''), 3000);
  };

  const loadReportFromHistory = (record) => {
    setDocInfo({ date: record.date, code: record.code });
    setData(record.rows);
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
          history.forEach(item => mergedMap.set(item.date, item));
          importedData.forEach(item => mergedMap.set(item.date, item));
          const mergedList = Array.from(mergedMap.values());
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
              <p className="text-xs text-slate-500">{docInfo.code} | วันที่เอกสาร: <strong className="text-blue-700">{docInfo.date}</strong></p>
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
              <button onClick={handleScanDocument} className="px-3 py-1.5 bg-emerald-600 rounded-lg text-white hover:bg-emerald-700 flex items-center text-xs font-bold shadow-md animate-pulse">
                <ScanLine className="w-4 h-4 mr-1" /> เริ่มสแกน
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
                <span>เอกสารอ้างอิง</span>
                <button onClick={() => setShowImagePane(false)} className="text-slate-400 hover:text-white p-1">
                  <X className="w-4 h-4" />
                </button>
              </div>
              <div className="flex-1 overflow-auto p-3 flex items-center justify-center">
                <img src={imageSrc} alt="Document" className="max-w-full h-auto max-h-full object-contain rounded shadow-lg border border-slate-700" />
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
                    <div className="flex items-center space-x-2">
                      <Clock className="w-5 h-5 text-blue-600" />
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
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <button type="button" onClick={() => setShowChartEvents((value) => !value)} className={`dashboard-toggle ${showChartEvents ? 'is-active' : ''}`}>
                        <span className="toggle-dot" /> {showChartEvents ? 'แสดงจุดหยุด/เริ่มเครื่อง' : 'ซ่อนจุดหยุด/เริ่มเครื่อง'}
                      </button>
                      <button type="button" onClick={() => setShowChartGradient((value) => !value)} className={`dashboard-toggle ${showChartGradient ? 'is-active' : ''}`}>
                        <span className="toggle-dot" /> เงาสีใต้กราฟ
                      </button>
                    </div>

                    <div className="flex items-center space-x-4 text-xs font-medium text-slate-300">
                      <span className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 mr-1.5"></span> ปกติ (Green)</span>
                      <span className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 mr-1.5"></span> เฝ้าระวัง (Yellow)</span>
                      <span className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-red-500 mr-1.5"></span> วิกฤต (Red)</span>
                    </div>
                  </div>

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
                      <ProcessChart dataset={currentFilteredData} resolvedTypes={resolvedFilteredProductTypes} field="hotAirIn" minY={100} maxY={180} ticks={[100,120,140,160,180]} target={[140,160]} lineColor="#fb923c" unit="°C" valueLabel="ลมร้อนเข้า IN" showEventTimeline showEvents={showChartEvents} showGradient={showChartGradient} />
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
                      <ProcessChart dataset={currentFilteredData} resolvedTypes={resolvedFilteredProductTypes} field="hotAirOut" minY={35} maxY={85} ticks={[40,50,60,70,80]} target={[50,65]} lineColor="#fbbf24" unit="°C" valueLabel="ปลายปล่อง OUT" showEvents={showChartEvents} showGradient={showChartGradient} />
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
                      <ProcessChart dataset={currentFilteredData} resolvedTypes={resolvedFilteredProductTypes} field="wetCakeMoisture" minY={20} maxY={45} ticks={[20,25,30,35,38,40,45]} target={[30,38]} lineColor="#818cf8" unit="%" valueLabel="ความชื้นแป้งหมาด WET" showEvents={showChartEvents} showGradient={showChartGradient} />
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
                      <ProcessChart dataset={currentFilteredData} resolvedTypes={resolvedFilteredProductTypes} field="productMoisture" minY={8} maxY={18} ticks={[8,10,11,12.5,14,16,18]} target={[11,12.5]} lineColor="#60a5fa" unit="%" valueLabel="ความชื้นแป้งแห้ง PROD" showEvents={showChartEvents} showGradient={showChartGradient} />
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

                  <footer className="print-source-footer" aria-label="แหล่งที่มาของรายงาน">
                    แหล่งที่มา: Windows, Mac/PC, OPPO (และยี่ห้ออื่น)/Android, iPad, iPhone/iOS
                  </footer>

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
                {history.length === 0 ? (
                  <p className="text-center text-slate-500 py-8 text-xs">ยังไม่มีประวัติในเครื่อง กด "บันทึกประวัติ" หลังสแกนเพื่อเก็บบันทึก</p>
                ) : (
                  history.map((record) => (
                    <div key={record.id} className="p-3 bg-slate-50 hover:bg-blue-50/50 border border-slate-200 rounded-lg flex items-center justify-between">
                      <div>
                        <p className="font-bold text-slate-800 text-xs">📅 วันที่: {record.date}</p>
                        <p className="text-[11px] text-slate-500">รหัสเอกสาร: {record.code} | เวลา: {new Date(record.timestamp).toLocaleString('th-TH')}</p>
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
    const event = normalizeProcessEvent(row);
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
        <div className="border-t border-slate-800 bg-slate-900/90 px-3 py-2">
          <div className="mb-1 flex items-center justify-between gap-2 text-[10px] text-slate-400">
            <span>เหตุการณ์ในช่วงที่เลือก</span>
            <span>{timelineEvents.length} รายการ</span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {timelineEvents.map(({ index, event }) => (
              <span
                key={`${index}-${event.type}-${event.time}`}
                className="rounded-md border px-2 py-1 text-[10px] font-semibold"
                style={{ borderColor: `${event.color}66`, color: event.color, backgroundColor: `${event.color}14` }}
              >
                {event.time} · {event.label}
              </span>
            ))}
          </div>
        </div>
      )}
      {hoverIndex !== null && dataset[hoverIndex] && (() => {
        const row = dataset[hoverIndex];
        const event = normalizeProcessEvent(row);
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
