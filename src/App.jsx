import React, { useState, useEffect, useRef } from 'react';
import { 
  Download, Upload, BarChart3, Clock, Calendar, Sun, Moon, 
  Printer, Save, Trash2, Database, AlertTriangle, CheckCircle2, 
  Loader2, Table as TableIcon, Eye, EyeOff, X, ScanLine, 
  Thermometer, Droplets, Sparkles 
} from 'lucide-react';

const WORKER_API_URL = 'https://ocr-api.sakaretblank.workers.dev'; 
const LOCAL_STORAGE_KEY = 'drying_process_history_v3';

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

export default function App() {
  const [data, setData] = useState(generateEmptyData());
  const [docInfo, setDocInfo] = useState({ date: new Date().toLocaleDateString('th-TH'), code: 'FM-PD-010 Rev.1' });
  const [appState, setAppState] = useState('ready');
  const [activeTab, setActiveTab] = useState('table'); // 'table' | 'analytics'
  const [selectedShift, setSelectedShift] = useState('ALL'); // 'ALL' | 'DAY' | 'NIGHT'
  const [saveStatus, setSaveStatus] = useState('');
  
  // ซ่อน/แสดงรูปอ้างอิง
  const [showImagePane, setShowImagePane] = useState(false);

  // ประวัติการบันทึก
  const [history, setHistory] = useState([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

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
  };

  // แปลงเครื่องหมาย " ในตารางทั้งหมดให้เป็นชื่อแป้งเต็ม
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
        result = JSON.parse(responseText);
      } catch (parseError) {
        throw new Error(`เซิร์ฟเวอร์ตอบกลับผิดรูปแบบ: ${responseText.substring(0, 100)}`);
      }

      if (!response.ok) {
        throw new Error(result.error || `HTTP Error ${response.status}`);
      }

      if (result.rows && Array.isArray(result.rows)) {
        const newDate = result.reportDate || docInfo.date;
        const newCode = result.documentCode || docInfo.code;
        setDocInfo({ date: newDate, code: newCode });
        
        const formattedRows = result.rows.map((row, idx) => ({
          ...row,
          id: idx + 1,
          unreadableFields: Array.isArray(row.unreadableFields) ? row.unreadableFields : []
        }));
        
        setData(formattedRows);
        autoSaveToHistory(newDate, newCode, formattedRows);
        setShowImagePane(false); // ซ่อนรูปเพื่อขยายเต็มจอ
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
  const resolvedProductTypes = resolveProductTypesList(currentFilteredData);

  // สรุปสถิติ
  const calculateAnalytics = (dataset) => {
    let totalWet = 0, wetCount = 0;
    let totalProd = 0, prodCount = 0;
    let totalTempIn = 0, tempInCount = 0;
    let totalTempOut = 0, tempOutCount = 0;
    let stopCount = 0;
    const anomalies = [];

    dataset.forEach((row, idx) => {
      const pType = resolvedProductTypes[idx] || row.productType || '-';

      // 1. อุณหภูมิ IN (เกณฑ์ปกติ 140 - 159.9)
      const tempIn = parseFloat(row.hotAirIn);
      if (!isNaN(tempIn)) { 
        totalTempIn += tempIn; tempInCount++; 
        if (tempIn < 130) {
          anomalies.push({ time: row.time, pType, issue: `อุณหภูมิลมเข้าต่ำกว่าเกณฑ์วิกฤต (${tempIn}°C)`, level: 'red' });
        } else if ((tempIn >= 130 && tempIn < 140) || tempIn >= 160) {
          anomalies.push({ time: row.time, pType, issue: `อุณหภูมิลมเข้าไม่อยู่ในเกณฑ์มาตรฐาน (${tempIn}°C)`, level: 'yellow' });
        }
      }

      // 2. อุณหภูมิ OUT (เกณฑ์ปกติ 50 - 65)
      const tempOut = parseFloat(row.hotAirOut);
      if (!isNaN(tempOut)) { 
        totalTempOut += tempOut; tempOutCount++; 
        if (tempOut < 50 || tempOut > 65) {
          anomalies.push({ time: row.time, pType, issue: `อุณหภูมิปลายปล่อง (OUT) ผิดปกติ (${tempOut}°C)`, level: 'yellow' });
        }
      }

      // 3. ความชื้นแป้งหมาด (เกณฑ์ปกติ 30 - 38%)
      const wet = parseFloat(row.wetCakeMoisture);
      if (!isNaN(wet)) { 
        totalWet += wet; wetCount++; 
        if (wet > 38.0) {
          anomalies.push({ time: row.time, pType, issue: `ความชื้นแป้งหมาดสูงเกิน 38% (${wet}%)`, level: 'red' });
        } else if (wet < 30.0) {
          anomalies.push({ time: row.time, pType, issue: `ความชื้นแป้งหมาดต่ำกว่า 30% (${wet}%)`, level: 'yellow' });
        }
      }

      // 4. ความชื้นแป้งแห้ง (เกณฑ์ปกติ 11.0 - 12.5%)
      const prod = parseFloat(row.productMoisture);
      if (!isNaN(prod)) {
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
      {/* Container ขยายเต็มจอ 100% */}
      <div className="w-full bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden flex flex-col flex-1 min-h-[98vh]">
        
        {/* Header Bar */}
        <header className="bg-white border-b border-slate-200 px-3 py-2 flex flex-wrap items-center justify-between gap-2 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="bg-blue-600 text-white p-2 rounded-lg shadow-sm">
              <TableIcon className="w-5 h-5" />
            </div>
            <div>
              <h1 className="text-base md:text-lg font-bold text-slate-800 leading-tight">ระบบวิเคราะห์รายงานการอบแป้ง (DRYING PROCESS)</h1>
              <p className="text-xs text-slate-500">{docInfo.code} | วันที่เอกสาร: <strong className="text-blue-700">{docInfo.date}</strong></p>
            </div>
          </div>
          
          <div className="flex flex-wrap items-center gap-1.5">
            {/* ปุ่มสลับแสดง/ซ่อนรูปภาพอ้างอิง */}
            {imageSrc && (
              <button 
                onClick={() => setShowImagePane(!showImagePane)}
                className={`px-2.5 py-1.5 border rounded-lg text-xs font-semibold flex items-center transition-all shadow-sm ${showImagePane ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}
              >
                {showImagePane ? <EyeOff className="w-4 h-4 mr-1 text-amber-400" /> : <Eye className="w-4 h-4 mr-1 text-blue-600" />}
                {showImagePane ? 'ซ่อนรูปอ้างอิง' : 'แสดงรูปอ้างอิง'}
              </button>
            )}

            {/* ปุ่มแปลงเครื่องหมาย " */}
            {appState === 'ready' && activeTab === 'table' && (
              <button 
                onClick={autoFixDittoMarks}
                className="px-2.5 py-1.5 bg-amber-50 text-amber-800 border border-amber-300 rounded-lg hover:bg-amber-100 text-xs font-semibold flex items-center"
                title='เปลี่ยนเครื่องหมาย " ให้กลายเป็นชื่อชนิดแป้งเต็ม'
              >
                <Sparkles className="w-3.5 h-3.5 mr-1 text-amber-600" /> แปลงเครื่องหมายซ้ำ (")
              </button>
            )}

            {/* ปุ่มคลังประวัติ */}
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
                    className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${activeTab === 'table' ? 'bg-blue-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    <TableIcon className="w-3.5 h-3.5 inline mr-1" /> ตารางบันทึก
                  </button>
                  <button 
                    onClick={() => setActiveTab('analytics')}
                    className={`px-3 py-1 rounded-md text-xs font-bold transition-all ${activeTab === 'analytics' ? 'bg-blue-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}`}
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
                  <button 
                    onClick={() => window.print()}
                    className="px-2.5 py-1.5 bg-slate-800 text-white rounded-lg hover:bg-slate-700 flex items-center text-xs font-semibold shadow-sm"
                  >
                    <Printer className="w-3.5 h-3.5 mr-1" /> พิมพ์ PDF
                  </button>
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

        {/* Status Toast */}
        {(statusMessage || saveStatus) && (
          <div className="bg-blue-50 px-4 py-1 text-xs text-blue-800 border-b border-blue-100 flex justify-between items-center font-medium">
            <span>{statusMessage || saveStatus}</span>
          </div>
        )}

        {/* Content Area - Full Width Split */}
        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row bg-slate-100 w-full">
          
          {/* Image Pane (แสดง/ซ่อนได้ตามต้องการ) */}
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

          {/* Main Content Area (ขยายเต็ม 100% ของ PC Screen เมื่อซ่อนรูป) */}
          {appState === 'ready' && (
            <div className="flex-1 overflow-auto bg-white flex flex-col w-full">
              
              {/* TAB 1: TABLE VIEW */}
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
                        const resolvedType = resolvedProductTypes[index];
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

              {/* TAB 2: ANALYTICS DASHBOARD (4 SEPARATE HIGH-PRECISION CHARTS) */}
              {activeTab === 'analytics' && (
                <div className="p-3 md:p-5 overflow-auto flex-1 bg-slate-50 space-y-5 w-full">
                  
                  {/* Shift Selection Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-3 bg-white p-3 rounded-xl shadow-sm border border-slate-200 w-full">
                    <div className="flex items-center space-x-2">
                      <Clock className="w-5 h-5 text-blue-600" />
                      <span className="text-sm font-bold text-slate-700">เลือกช่วงเวลา/กะ:</span>
                      <div className="inline-flex rounded-lg border border-slate-200 p-1 bg-slate-50">
                        <button 
                          onClick={() => setSelectedShift('ALL')}
                          className={`px-3 py-1 rounded-md text-xs font-bold ${selectedShift === 'ALL' ? 'bg-blue-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}`}
                        >
                          ทั้งวัน (24 ชม.)
                        </button>
                        <button 
                          onClick={() => setSelectedShift('DAY')}
                          className={`px-3 py-1 rounded-md text-xs font-bold flex items-center ${selectedShift === 'DAY' ? 'bg-amber-500 text-white shadow' : 'text-slate-600 hover:text-slate-900'}`}
                        >
                          <Sun className="w-3.5 h-3.5 mr-1" /> กะกลางวัน (08:00 - 20:00)
                        </button>
                        <button 
                          onClick={() => setSelectedShift('NIGHT')}
                          className={`px-3 py-1 rounded-md text-xs font-bold flex items-center ${selectedShift === 'NIGHT' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}`}
                        >
                          <Moon className="w-3.5 h-3.5 mr-1" /> กะกลางคืน (20:00 - 08:00)
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center space-x-4 text-xs font-medium text-slate-600">
                      <span className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500 mr-1.5"></span> ปกติ (Green)</span>
                      <span className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-amber-500 mr-1.5"></span> เฝ้าระวัง (Yellow)</span>
                      <span className="flex items-center"><span className="w-2.5 h-2.5 rounded-full bg-red-500 mr-1.5"></span> วิกฤต/เกินเกณฑ์ (Red)</span>
                    </div>
                  </div>

                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-3 w-full">
                    <div className="bg-white p-3.5 rounded-xl shadow-sm border border-slate-200">
                      <p className="text-[11px] font-bold text-slate-500 uppercase">อุณหภูมิลมเข้า IN (เฉลี่ย)</p>
                      <p className="text-2xl font-extrabold text-orange-600 mt-1">{analytics.avgTempIn} <span className="text-xs font-normal text-slate-500">°C</span></p>
                      <p className="text-[11px] text-slate-500 mt-1">เกณฑ์ปกติ: 140°C - 160°C</p>
                    </div>

                    <div className="bg-white p-3.5 rounded-xl shadow-sm border border-slate-200">
                      <p className="text-[11px] font-bold text-slate-500 uppercase">อุณหภูมิปลายปล่อง OUT (เฉลี่ย)</p>
                      <p className="text-2xl font-extrabold text-amber-600 mt-1">{analytics.avgTempOut} <span className="text-xs font-normal text-slate-500">°C</span></p>
                      <p className="text-[11px] text-slate-500 mt-1">เกณฑ์ปกติ: 50°C - 65°C</p>
                    </div>

                    <div className="bg-white p-3.5 rounded-xl shadow-sm border border-slate-200">
                      <p className="text-[11px] font-bold text-slate-500 uppercase">ความชื้นแป้งหมาด WET (เฉลี่ย)</p>
                      <p className="text-2xl font-extrabold text-indigo-600 mt-1">{analytics.avgWetMoist} <span className="text-xs font-normal text-slate-500">%</span></p>
                      <p className="text-[11px] text-slate-500 mt-1">เกณฑ์ปกติ: 30% - 38%</p>
                    </div>

                    <div className="bg-white p-3.5 rounded-xl shadow-sm border border-slate-200">
                      <p className="text-[11px] font-bold text-slate-500 uppercase">ความชื้นแป้งแห้ง PROD (เฉลี่ย)</p>
                      <p className="text-2xl font-extrabold text-blue-600 mt-1">{analytics.avgProdMoist} <span className="text-xs font-normal text-slate-500">%</span></p>
                      <p className="text-[11px] text-emerald-600 font-semibold mt-1">เกณฑ์ปกติ: 11.0% - 12.5%</p>
                    </div>
                  </div>

                  {/* 4 SEPARATE DETAILED CHARTS GRID (2x2 GRID ON PC) */}
                  <div className="grid grid-cols-1 xl:grid-cols-2 gap-4 w-full">
                    
                    {/* CHART 1: อุณหภูมิ IN (อบแป้ง) */}
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 space-y-2">
                      <div className="flex justify-between items-center border-b pb-2">
                        <div>
                          <h3 className="text-sm font-bold text-slate-800 flex items-center">
                            <Thermometer className="w-4 h-4 mr-1.5 text-orange-500" /> 1. กราฟอุณหภูมิลมร้อนขาเข้า IN (อบแป้ง)
                          </h3>
                          <p className="text-[10px] text-slate-500">ปกติ: 140-160°C | เหลือง: &lt;140°C หรือ &ge;160°C | แดง: &lt;130°C</p>
                        </div>
                        <span className="text-xs font-bold text-orange-600 bg-orange-50 px-2 py-0.5 rounded border border-orange-200">
                          {analytics.avgTempIn} °C
                        </span>
                      </div>
                      <ChartHotAirIn dataset={currentFilteredData} resolvedTypes={resolvedProductTypes} />
                    </div>

                    {/* CHART 2: อุณหภูมิ OUT (ปลายปล่อง) */}
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 space-y-2">
                      <div className="flex justify-between items-center border-b pb-2">
                        <div>
                          <h3 className="text-sm font-bold text-slate-800 flex items-center">
                            <Thermometer className="w-4 h-4 mr-1.5 text-amber-500" /> 2. กราฟอุณหภูมิปลายปล่อง OUT (แป้งแห้ง)
                          </h3>
                          <p className="text-[10px] text-slate-500">ปกติ: 50°C - 65°C | นอกเกณฑ์: สีเหลือง</p>
                        </div>
                        <span className="text-xs font-bold text-amber-600 bg-amber-50 px-2 py-0.5 rounded border border-amber-200">
                          {analytics.avgTempOut} °C
                        </span>
                      </div>
                      <ChartHotAirOut dataset={currentFilteredData} resolvedTypes={resolvedProductTypes} />
                    </div>

                    {/* CHART 3: ความชื้นแป้งหมาด WET */}
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 space-y-2">
                      <div className="flex justify-between items-center border-b pb-2">
                        <div>
                          <h3 className="text-sm font-bold text-slate-800 flex items-center">
                            <Droplets className="w-4 h-4 mr-1.5 text-indigo-500" /> 3. กราฟความชื้นแป้งหมาด (% WET MOISTURE)
                          </h3>
                          <p className="text-[10px] text-slate-500">ปกติ: 30% - 38% | เหลือง: &lt;30% | แดง: &gt;38%</p>
                        </div>
                        <span className="text-xs font-bold text-indigo-600 bg-indigo-50 px-2 py-0.5 rounded border border-indigo-200">
                          {analytics.avgWetMoist} %
                        </span>
                      </div>
                      <ChartWetMoisture dataset={currentFilteredData} resolvedTypes={resolvedProductTypes} />
                    </div>

                    {/* CHART 4: ความชื้นแป้งแห้ง PROD (HIGH PRECISION SCALE) */}
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200 space-y-2">
                      <div className="flex justify-between items-center border-b pb-2">
                        <div>
                          <h3 className="text-sm font-bold text-slate-800 flex items-center">
                            <Droplets className="w-4 h-4 mr-1.5 text-blue-600" /> 4. กราฟความชื้นแป้งแห้ง (% PRODUCT MOISTURE)
                          </h3>
                          <p className="text-[10px] text-slate-500">ปกติ: 11.0-12.5% | เหลือง: 0-10.9% หรือ 12.5-14% | แดง: &gt;14%</p>
                        </div>
                        <span className="text-xs font-bold text-blue-600 bg-blue-50 px-2 py-0.5 rounded border border-blue-200">
                          {analytics.avgProdMoist} %
                        </span>
                      </div>
                      <ChartProdMoisture dataset={currentFilteredData} resolvedTypes={resolvedProductTypes} />
                    </div>

                  </div>

                  {/* Anomaly / Warning Section */}
                  <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                    <h3 className="text-sm font-bold text-slate-800 mb-2 flex items-center">
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

                </div>
              )}

            </div>
          )}
        </div>

        {/* MODAL: History Store */}
        {showHistoryModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden">
              <div className="p-4 bg-slate-100 border-b border-slate-200 flex justify-between items-center">
                <h3 className="font-bold text-slate-800 flex items-center">
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

// ==========================================
// CHART 1: HOT AIR IN (°C)
// Rules: <130 Red, 130-139.9 Yellow, 140-159.9 Green, >=160 Yellow
// ==========================================
function ChartHotAirIn({ dataset, resolvedTypes }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  if (!dataset || dataset.length === 0) return null;

  const width = 600;
  const height = 180;
  const padding = 35;
  const minY = 100;
  const maxY = 180;

  const getX = (i) => padding + (i / (dataset.length - 1 || 1)) * (width - padding * 2);
  const getY = (val) => {
    const v = parseFloat(val) || minY;
    const clamped = Math.max(minY, Math.min(maxY, v));
    return height - padding - ((clamped - minY) / (maxY - minY)) * (height - padding * 2);
  };

  const getPointColor = (val) => {
    const v = parseFloat(val);
    if (isNaN(v)) return '#94a3b8';
    if (v < 130) return '#ef4444'; // Red
    if (v >= 140 && v < 160) return '#10b981'; // Green
    return '#f59e0b'; // Yellow
  };

  const polylinePoints = dataset.map((d, i) => `${getX(i)},${getY(d.hotAirIn)}`).join(' ');

  return (
    <div className="relative w-full bg-slate-900 rounded-lg p-2 text-white">
      <svg className="w-full h-44 overflow-visible" viewBox={`0 0 ${width} ${height}`}>
        {/* Target Zone Box (Green Zone 140°C - 160°C) */}
        <rect 
          x={padding} 
          y={getY(160)} 
          width={width - padding * 2} 
          height={getY(140) - getY(160)} 
          fill="#10b981" 
          opacity="0.15" 
        />

        {/* Grid lines */}
        {[100, 120, 140, 160, 180].map((t) => (
          <g key={t}>
            <line x1={padding} y1={getY(t)} x2={width - padding} y2={getY(t)} stroke="#334155" strokeDasharray="3 3" />
            <text x={padding - 6} y={getY(t) + 3} fill="#94a3b8" fontSize="9" textAnchor="end">{t}°C</text>
          </g>
        ))}

        {/* Polyline */}
        <polyline fill="none" stroke="#f97316" strokeWidth="2.5" points={polylinePoints} />

        {/* Colored Points */}
        {dataset.map((d, i) => {
          const x = getX(i);
          const y = getY(d.hotAirIn);
          const color = getPointColor(d.hotAirIn);
          const isHovered = hoverIndex === i;

          return (
            <g key={i}>
              <circle cx={x} cy={y} r={isHovered ? "6" : "3.5"} fill={color} stroke="#ffffff" strokeWidth="1.5" />
              {isHovered && <line x1={x} y1={padding} x2={x} y2={height - padding} stroke="#cbd5e1" strokeDasharray="2 2" />}
              <rect 
                x={x - (width / dataset.length / 2)} 
                y={0} 
                width={width / dataset.length} 
                height={height} 
                fill="transparent" 
                className="cursor-pointer"
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex(null)}
              />
            </g>
          );
        })}
      </svg>

      <div className="flex justify-between px-6 text-[10px] text-slate-400 font-mono mt-1">
        {dataset.map((d, i) => <span key={i} className={hoverIndex === i ? "text-amber-400 font-bold" : ""}>{d.time}</span>)}
      </div>

      {hoverIndex !== null && dataset[hoverIndex] && (
        <div 
          className="absolute top-2 bg-slate-800/95 border border-slate-600 text-white p-2 rounded-lg shadow-xl text-xs space-y-0.5 pointer-events-none z-20"
          style={{ left: `${Math.min(Math.max(hoverIndex * (100 / dataset.length), 5), 70)}%` }}
        >
          <p className="font-bold text-amber-400">🕒 {dataset[hoverIndex].time} น. ({resolvedTypes[hoverIndex] || '-'})</p>
          <p className="text-orange-300 font-bold">🔥 ลมเข้า IN: {dataset[hoverIndex].hotAirIn || '-'} °C</p>
          <p className="text-[10px] text-slate-300">
            สถานะ: {parseFloat(dataset[hoverIndex].hotAirIn) < 130 ? '🔴 วิกฤตต่ำเกิน' : (parseFloat(dataset[hoverIndex].hotAirIn) >= 140 && parseFloat(dataset[hoverIndex].hotAirIn) < 160) ? '🟢 ปกติ' : '🟡 เฝ้าระวัง'}
          </p>
        </div>
      )}
    </div>
  );
}

// ==========================================
// CHART 2: HOT AIR OUT (°C)
// Rules: 50.0 - 65.0 Green, Outside Yellow
// ==========================================
function ChartHotAirOut({ dataset, resolvedTypes }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  if (!dataset || dataset.length === 0) return null;

  const width = 600;
  const height = 180;
  const padding = 35;
  const minY = 35;
  const maxY = 85;

  const getX = (i) => padding + (i / (dataset.length - 1 || 1)) * (width - padding * 2);
  const getY = (val) => {
    const v = parseFloat(val) || minY;
    const clamped = Math.max(minY, Math.min(maxY, v));
    return height - padding - ((clamped - minY) / (maxY - minY)) * (height - padding * 2);
  };

  const getPointColor = (val) => {
    const v = parseFloat(val);
    if (isNaN(v)) return '#94a3b8';
    if (v >= 50.0 && v <= 65.0) return '#10b981'; // Green
    return '#f59e0b'; // Yellow
  };

  const polylinePoints = dataset.map((d, i) => `${getX(i)},${getY(d.hotAirOut)}`).join(' ');

  return (
    <div className="relative w-full bg-slate-900 rounded-lg p-2 text-white">
      <svg className="w-full h-44 overflow-visible" viewBox={`0 0 ${width} ${height}`}>
        {/* Target Zone Box (Green Zone 50°C - 65°C) */}
        <rect 
          x={padding} 
          y={getY(65)} 
          width={width - padding * 2} 
          height={getY(50) - getY(65)} 
          fill="#10b981" 
          opacity="0.15" 
        />

        {/* Grid lines */}
        {[40, 50, 60, 70, 80].map((t) => (
          <g key={t}>
            <line x1={padding} y1={getY(t)} x2={width - padding} y2={getY(t)} stroke="#334155" strokeDasharray="3 3" />
            <text x={padding - 6} y={getY(t) + 3} fill="#94a3b8" fontSize="9" textAnchor="end">{t}°C</text>
          </g>
        ))}

        {/* Polyline */}
        <polyline fill="none" stroke="#f59e0b" strokeWidth="2.5" points={polylinePoints} />

        {/* Colored Points */}
        {dataset.map((d, i) => {
          const x = getX(i);
          const y = getY(d.hotAirOut);
          const color = getPointColor(d.hotAirOut);
          const isHovered = hoverIndex === i;

          return (
            <g key={i}>
              <circle cx={x} cy={y} r={isHovered ? "6" : "3.5"} fill={color} stroke="#ffffff" strokeWidth="1.5" />
              {isHovered && <line x1={x} y1={padding} x2={x} y2={height - padding} stroke="#cbd5e1" strokeDasharray="2 2" />}
              <rect 
                x={x - (width / dataset.length / 2)} 
                y={0} 
                width={width / dataset.length} 
                height={height} 
                fill="transparent" 
                className="cursor-pointer"
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex(null)}
              />
            </g>
          );
        })}
      </svg>

      <div className="flex justify-between px-6 text-[10px] text-slate-400 font-mono mt-1">
        {dataset.map((d, i) => <span key={i} className={hoverIndex === i ? "text-amber-400 font-bold" : ""}>{d.time}</span>)}
      </div>

      {hoverIndex !== null && dataset[hoverIndex] && (
        <div 
          className="absolute top-2 bg-slate-800/95 border border-slate-600 text-white p-2 rounded-lg shadow-xl text-xs space-y-0.5 pointer-events-none z-20"
          style={{ left: `${Math.min(Math.max(hoverIndex * (100 / dataset.length), 5), 70)}%` }}
        >
          <p className="font-bold text-amber-400">🕒 {dataset[hoverIndex].time} น. ({resolvedTypes[hoverIndex] || '-'})</p>
          <p className="text-amber-300 font-bold">💨 ลมออก OUT: {dataset[hoverIndex].hotAirOut || '-'} °C</p>
          <p className="text-[10px] text-slate-300">
            สถานะ: {(parseFloat(dataset[hoverIndex].hotAirOut) >= 50 && parseFloat(dataset[hoverIndex].hotAirOut) <= 65) ? '🟢 ปกติ' : '🟡 นอกเกณฑ์มาตรฐาน'}
          </p>
        </div>
      )}
    </div>
  );
}

// ==========================================
// CHART 3: WET MOISTURE (%)
// Rules: 30-38% Green, <30% Yellow, >38% Red
// ==========================================
function ChartWetMoisture({ dataset, resolvedTypes }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  if (!dataset || dataset.length === 0) return null;

  const width = 600;
  const height = 180;
  const padding = 35;
  const minY = 20;
  const maxY = 45;

  const getX = (i) => padding + (i / (dataset.length - 1 || 1)) * (width - padding * 2);
  const getY = (val) => {
    const v = parseFloat(val) || minY;
    const clamped = Math.max(minY, Math.min(maxY, v));
    return height - padding - ((clamped - minY) / (maxY - minY)) * (height - padding * 2);
  };

  const getPointColor = (val) => {
    const v = parseFloat(val);
    if (isNaN(v)) return '#94a3b8';
    if (v > 38.0) return '#ef4444'; // Red
    if (v >= 30.0 && v <= 38.0) return '#10b981'; // Green
    return '#f59e0b'; // Yellow
  };

  const polylinePoints = dataset.map((d, i) => `${getX(i)},${getY(d.wetCakeMoisture)}`).join(' ');

  return (
    <div className="relative w-full bg-slate-900 rounded-lg p-2 text-white">
      <svg className="w-full h-44 overflow-visible" viewBox={`0 0 ${width} ${height}`}>
        {/* Target Zone Box (Green Zone 30% - 38%) */}
        <rect 
          x={padding} 
          y={getY(38)} 
          width={width - padding * 2} 
          height={getY(30) - getY(38)} 
          fill="#10b981" 
          opacity="0.15" 
        />

        {/* Grid lines */}
        {[20, 25, 30, 35, 38, 40, 45].map((m) => (
          <g key={m}>
            <line x1={padding} y1={getY(m)} x2={width - padding} y2={getY(m)} stroke="#334155" strokeDasharray="3 3" />
            <text x={padding - 6} y={getY(m) + 3} fill="#94a3b8" fontSize="9" textAnchor="end">{m}%</text>
          </g>
        ))}

        {/* Polyline */}
        <polyline fill="none" stroke="#6366f1" strokeWidth="2.5" points={polylinePoints} />

        {/* Colored Points */}
        {dataset.map((d, i) => {
          const x = getX(i);
          const y = getY(d.wetCakeMoisture);
          const color = getPointColor(d.wetCakeMoisture);
          const isHovered = hoverIndex === i;

          return (
            <g key={i}>
              <circle cx={x} cy={y} r={isHovered ? "6" : "3.5"} fill={color} stroke="#ffffff" strokeWidth="1.5" />
              {isHovered && <line x1={x} y1={padding} x2={x} y2={height - padding} stroke="#cbd5e1" strokeDasharray="2 2" />}
              <rect 
                x={x - (width / dataset.length / 2)} 
                y={0} 
                width={width / dataset.length} 
                height={height} 
                fill="transparent" 
                className="cursor-pointer"
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex(null)}
              />
            </g>
          );
        })}
      </svg>

      <div className="flex justify-between px-6 text-[10px] text-slate-400 font-mono mt-1">
        {dataset.map((d, i) => <span key={i} className={hoverIndex === i ? "text-indigo-400 font-bold" : ""}>{d.time}</span>)}
      </div>

      {hoverIndex !== null && dataset[hoverIndex] && (
        <div 
          className="absolute top-2 bg-slate-800/95 border border-slate-600 text-white p-2 rounded-lg shadow-xl text-xs space-y-0.5 pointer-events-none z-20"
          style={{ left: `${Math.min(Math.max(hoverIndex * (100 / dataset.length), 5), 70)}%` }}
        >
          <p className="font-bold text-indigo-300">🕒 {dataset[hoverIndex].time} น. ({resolvedTypes[hoverIndex] || '-'})</p>
          <p className="text-indigo-200 font-bold">💧 แป้งหมาด WET: {dataset[hoverIndex].wetCakeMoisture || '-'} %</p>
          <p className="text-[10px] text-slate-300">
            สถานะ: {parseFloat(dataset[hoverIndex].wetCakeMoisture) > 38 ? '🔴 วิกฤตชื้นสูง' : (parseFloat(dataset[hoverIndex].wetCakeMoisture) >= 30) ? '🟢 ปกติ' : '🟡 ต่ำกว่าเกณฑ์'}
          </p>
        </div>
      )}
    </div>
  );
}

// ==========================================
// CHART 4: PRODUCT MOISTURE (%) HIGH PRECISION
// Rules: 11.0 - 12.5% Green, 0-10.9% Yellow, 12.5-14.0% Yellow, >14.0% Red
// Scale range: 8% - 18% for high precision!
// ==========================================
function ChartProdMoisture({ dataset, resolvedTypes }) {
  const [hoverIndex, setHoverIndex] = useState(null);
  if (!dataset || dataset.length === 0) return null;

  const width = 600;
  const height = 180;
  const padding = 35;
  const minY = 8;
  const maxY = 18;

  const getX = (i) => padding + (i / (dataset.length - 1 || 1)) * (width - padding * 2);
  const getY = (val) => {
    const v = parseFloat(val) || minY;
    const clamped = Math.max(minY, Math.min(maxY, v));
    return height - padding - ((clamped - minY) / (maxY - minY)) * (height - padding * 2);
  };

  const getPointColor = (val) => {
    const v = parseFloat(val);
    if (isNaN(v)) return '#94a3b8';
    if (v > 14.0) return '#ef4444'; // Red (>14%)
    if (v >= 11.0 && v <= 12.5) return '#10b981'; // Green (11 - 12.5%)
    return '#f59e0b'; // Yellow
  };

  const polylinePoints = dataset.map((d, i) => `${getX(i)},${getY(d.productMoisture)}`).join(' ');

  return (
    <div className="relative w-full bg-slate-900 rounded-lg p-2 text-white">
      <svg className="w-full h-44 overflow-visible" viewBox={`0 0 ${width} ${height}`}>
        {/* Target Zone Box (Green Zone 11.0% - 12.5%) */}
        <rect 
          x={padding} 
          y={getY(12.5)} 
          width={width - padding * 2} 
          height={getY(11.0) - getY(12.5)} 
          fill="#10b981" 
          opacity="0.20" 
        />

        {/* Warning Zone Box (Yellow Zone 12.5% - 14.0%) */}
        <rect 
          x={padding} 
          y={getY(14.0)} 
          width={width - padding * 2} 
          height={getY(12.5) - getY(14.0)} 
          fill="#f59e0b" 
          opacity="0.10" 
        />

        {/* Grid lines */}
        {[8, 10, 11, 12.5, 14, 16, 18].map((m) => (
          <g key={m}>
            <line x1={padding} y1={getY(m)} x2={width - padding} y2={getY(m)} stroke="#334155" strokeDasharray="3 3" />
            <text x={padding - 6} y={getY(m) + 3} fill={m === 11 || m === 12.5 ? "#34d399" : "#94a3b8"} fontSize="9" textAnchor="end">{m}%</text>
          </g>
        ))}

        {/* Polyline */}
        <polyline fill="none" stroke="#3b82f6" strokeWidth="2.5" points={polylinePoints} />

        {/* Colored Points */}
        {dataset.map((d, i) => {
          const x = getX(i);
          const y = getY(d.productMoisture);
          const color = getPointColor(d.productMoisture);
          const isHovered = hoverIndex === i;

          return (
            <g key={i}>
              <circle cx={x} cy={y} r={isHovered ? "6" : "3.5"} fill={color} stroke="#ffffff" strokeWidth="1.5" />
              {isHovered && <line x1={x} y1={padding} x2={x} y2={height - padding} stroke="#cbd5e1" strokeDasharray="2 2" />}
              <rect 
                x={x - (width / dataset.length / 2)} 
                y={0} 
                width={width / dataset.length} 
                height={height} 
                fill="transparent" 
                className="cursor-pointer"
                onMouseEnter={() => setHoverIndex(i)}
                onMouseLeave={() => setHoverIndex(null)}
              />
            </g>
          );
        })}
      </svg>

      <div className="flex justify-between px-6 text-[10px] text-slate-400 font-mono mt-1">
        {dataset.map((d, i) => <span key={i} className={hoverIndex === i ? "text-blue-400 font-bold" : ""}>{d.time}</span>)}
      </div>

      {hoverIndex !== null && dataset[hoverIndex] && (
        <div 
          className="absolute top-2 bg-slate-800/95 border border-slate-600 text-white p-2 rounded-lg shadow-xl text-xs space-y-0.5 pointer-events-none z-20"
          style={{ left: `${Math.min(Math.max(hoverIndex * (100 / dataset.length), 5), 70)}%` }}
        >
          <p className="font-bold text-blue-300">🕒 {dataset[hoverIndex].time} น. ({resolvedTypes[hoverIndex] || '-'})</p>
          <p className="text-blue-400 font-bold">✨ แป้งแห้ง PROD: {dataset[hoverIndex].productMoisture || '-'} %</p>
          <p className="text-[10px] text-slate-300">
            สถานะ: {parseFloat(dataset[hoverIndex].productMoisture) > 14 ? '🔴 วิกฤตชื้นสูง' : (parseFloat(dataset[hoverIndex].productMoisture) >= 11 && parseFloat(dataset[hoverIndex].productMoisture) <= 12.5) ? '🟢 ปกติสมบูรณ์' : '🟡 เบี่ยงเบนจากเกณฑ์'}
          </p>
        </div>
      )}
    </div>
  );
}

