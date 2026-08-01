import React, { useState, useEffect, useRef } from 'react';
import { Download, Upload, FileText, BarChart3, Clock, Calendar, Sun, Moon, Printer, Save, Trash2, Database, AlertTriangle, CheckCircle2, Loader2, Table as TableIcon, Eye, FolderOpen, RefreshCw, X, ScanLine, Plus } from 'lucide-react';

// URL API Backend สำหรับส่งไปสแกนที่ Cloudflare Worker
const WORKER_API_URL = 'https://ocr-api.sakaretblank.workers.dev'; 
const LOCAL_STORAGE_KEY = 'drying_process_history_v2';

// ฟังก์ชันบีบอัดรูปภาพก่อนส่ง
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

// สร้างแถวเปล่า 24 แถวตามเอกสาร
const generateEmptyData = () => {
  const times = ['08.00', '09.00', '10.00', '11.00', '12.00', '13.00', '14.00', '15.00', '16.00', '17.00', '18.00', '19.00', '20.00', '21.00', '22.00', '23.00', '24.00', '01.00', '02.00', '03.00', '04.00', '05.00', '06.00', '07.00'];
  return times.map((time, index) => ({
    id: index + 1, time, productType: '', dw1: '', dw2: '', dw3: '', dw4: '', dw5: '', hotAirIn: '', hotAirOut: '', speed: '', wetCakeMoisture: '', productMoisture: '', changeDwFilter: '', remark: '', unreadableFields: []
  }));
};

export default function App() {
  const [data, setData] = useState(generateEmptyData());
  const [docInfo, setDocInfo] = useState({ date: new Date().toLocaleDateString('th-TH'), code: 'FM-PD-010 Rev.1' });
  const [appState, setAppState] = useState('ready'); // 'ready', 'uploaded', 'scanning'
  const [activeTab, setActiveTab] = useState('table'); // 'table' หรือ 'analytics'
  const [selectedShift, setSelectedShift] = useState('ALL'); // 'ALL', 'DAY', 'NIGHT'
  const [analyticsPeriod, setAnalyticsPeriod] = useState('shift'); // 'shift', 'monthly'
  const [saveStatus, setSaveStatus] = useState('');
  
  // ประวัติการบันทึกข้อมูล (History State)
  const [history, setHistory] = useState([]);
  const [showHistoryModal, setShowHistoryModal] = useState(false);
  const [statusMessage, setStatusMessage] = useState('');

  const [imageSrc, setImageSrc] = useState(null); 
  const [selectedFile, setSelectedFile] = useState(null);
  const [showImagePane, setShowImagePane] = useState(false);
  const fileInputRef = useRef(null);
  const jsonImportRef = useRef(null);

  // โหลดประวัติเก่าจาก Local Storage เมื่อเปิดเว็บครั้งแรก
  useEffect(() => {
    try {
      const savedHistory = localStorage.getItem(LOCAL_STORAGE_KEY);
      if (savedHistory) {
        const parsed = JSON.parse(savedHistory);
        setHistory(parsed);
      }
    } catch (e) {
      console.error('ไม่สามารถดึงประวัติเก่าได้:', e);
    }
  }, []);

  // บันทึกประวัติลง Local Storage ทุกครั้งที่มีการเปลี่ยนแปลง
  const saveHistoryToStorage = (newHistory) => {
    setHistory(newHistory);
    try {
      localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(newHistory));
    } catch (e) {
      console.error('ไม่สามารถบันทึกลงความจำเครื่องได้:', e);
    }
  };

  const handleCellChange = (index, field, value) => {
    const newData = [...data];
    newData[index][field] = value;
    if (newData[index].unreadableFields?.includes(field)) {
      newData[index].unreadableFields = newData[index].unreadableFields.filter(f => f !== field);
    }
    setData(newData);
    setSaveStatus('มีการเปลี่ยนแปลงยังไม่ได้บันทึก');
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

        // บันทึกเข้าประวัติให้อัตโนมัติทันทีหลังสแกนสำเร็จ
        autoSaveToHistory(newDate, newCode, formattedRows);
      } else {
        throw new Error("ข้อมูลตอบกลับจาก AI ไม่พบรายการแถว (rows)");
      }
      
      setAppState('ready');
      setSaveStatus('สแกนและบันทึกประวัติเรียบร้อย');
    } catch (error) {
      console.error("Scanning failed:", error);
      setStatusMessage(`⚠️ เกิดข้อผิดพลาดในการสแกน: ${error.message}`);
      setAppState('uploaded');
    }
  };

  // บันทึกรายงานปัจจุบันเข้าสู่ประวัติ
  const autoSaveToHistory = (dateStr, codeStr, rowsData) => {
    const reportId = `${dateStr}_${Date.now()}`;
    const newRecord = {
      id: reportId,
      date: dateStr,
      code: codeStr,
      timestamp: new Date().toISOString(),
      rows: rowsData
    };

    // เช็คว่าเคยมีประวัติของวันที่นี้ไหม ถ้ามีให้แทนที่ ถ้าไม่มีให้เพิ่มใหม่
    const existingIndex = history.findIndex(h => h.date === dateStr);
    let updatedHistory = [...history];
    if (existingIndex >= 0) {
      updatedHistory[existingIndex] = newRecord;
    } else {
      updatedHistory.unshift(newRecord); // เอาอันล่าสุดขึ้นก่อน
    }

    saveHistoryToStorage(updatedHistory);
  };

  const handleManualSave = () => {
    autoSaveToHistory(docInfo.date, docInfo.code, data);
    setSaveStatus('บันทึกประวัติลงเครื่องเรียบร้อยแล้ว');
    setTimeout(() => setSaveStatus(''), 3000);
  };

  // โหลดรายงานเก่าจากประวัติมาดูในแอป
  const loadReportFromHistory = (record) => {
    setDocInfo({ date: record.date, code: record.code });
    setData(record.rows);
    setShowHistoryModal(false);
    setStatusMessage(`โหลดข้อมูลประวัติวันที่ ${record.date} เรียบร้อยแล้ว`);
    setTimeout(() => setStatusMessage(''), 3000);
  };

  // ลบรายงานออกจากประวัติ
  const deleteHistoryRecord = (id) => {
    const filtered = history.filter(h => h.id !== id);
    saveHistoryToStorage(filtered);
  };

  // ส่งออกประวัติทั้งหมดเป็นไฟล์สำรอง .json เก็บไว้ในคอมพิวเตอร์
  const exportHistoryJSON = () => {
    const jsonStr = JSON.stringify(history, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `drying_reports_history_backup_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // นำเข้าไฟล์สำรอง .json จากคอมพิวเตอร์กลับเข้ามาในแอป
  const handleImportJSON = (e) => {
    const file = e.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      try {
        const importedData = JSON.parse(event.target.result);
        if (Array.isArray(importedData)) {
          // รวมข้อมูลเก่าและใหม่เข้าด้วยกัน
          const mergedMap = new Map();
          history.forEach(item => mergedMap.set(item.date, item));
          importedData.forEach(item => mergedMap.set(item.date, item));
          const mergedList = Array.from(mergedMap.values());
          
          saveHistoryToStorage(mergedList);
          setStatusMessage(`นำเข้าประวัติสำเร็จ! รวมทั้งสิ้น ${mergedList.length} รายการ`);
          setTimeout(() => setStatusMessage(''), 4000);
        } else {
          setStatusMessage('รูปแบบไฟล์ JSON ไม่ถูกต้อง');
        }
      } catch (err) {
        setStatusMessage('เกิดข้อผิดพลาดในการอ่านไฟล์ JSON');
      }
    };
    reader.readAsText(file);
    e.target.value = null;
  };

  const triggerFileInput = () => fileInputRef.current.click();

  // คำนวณกรองข้อมูลตามกะการผลิต
  const getFilteredDataForShift = () => {
    if (selectedShift === 'DAY') return data.slice(0, 12);
    if (selectedShift === 'NIGHT') return data.slice(12, 24);
    return data;
  };

  const currentFilteredData = getFilteredDataForShift();

  // คำนวณค่าทางสถิติสำหรับกะปัจจุบัน
  const calculateAnalytics = (dataset) => {
    let totalWet = 0, wetCount = 0;
    let totalProd = 0, prodCount = 0;
    let totalTempIn = 0, tempInCount = 0;
    let totalTempOut = 0, tempOutCount = 0;
    let stopCount = 0;
    const anomalies = [];

    dataset.forEach((row) => {
      const wet = parseFloat(row.wetCakeMoisture);
      if (!isNaN(wet)) { totalWet += wet; wetCount++; }

      const prod = parseFloat(row.productMoisture);
      if (!isNaN(prod)) {
        totalProd += prod; prodCount++;
        if (prod > 2.2) anomalies.push({ time: row.time, issue: `ความชื้นแป้งแห้งสูงเกินเกณฑ์ (${prod}%)` });
      }

      const tempIn = parseFloat(row.hotAirIn);
      if (!isNaN(tempIn)) { totalTempIn += tempIn; tempInCount++; }

      const tempOut = parseFloat(row.hotAirOut);
      if (!isNaN(tempOut)) { totalTempOut += tempOut; tempOutCount++; }

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

  // คำนวณสรุปสถิติมุมมองรายเดือน (สะสมจากทุกวันที่บันทึกในประวัติ)
  const calculateMonthlyAnalytics = () => {
    if (history.length === 0) return { avgTempIn: '0.0', avgTempOut: '0.0', avgWet: '0.00', avgProd: '0.00', totalDays: 0, dailyTrends: [] };

    let sumTempIn = 0, countTempIn = 0;
    let sumTempOut = 0, countTempOut = 0;
    let sumWet = 0, countWet = 0;
    let sumProd = 0, countProd = 0;

    const dailyTrends = history.map(record => {
      let dIn = 0, cIn = 0, dOut = 0, cOut = 0, dWet = 0, cWet = 0, dProd = 0, cProd = 0;
      record.rows.forEach(r => {
        const tin = parseFloat(r.hotAirIn); if (!isNaN(tin)) { dIn += tin; cIn++; sumTempIn += tin; countTempIn++; }
        const tout = parseFloat(r.hotAirOut); if (!isNaN(tout)) { dOut += tout; cOut++; sumTempOut += tout; countTempOut++; }
        const wet = parseFloat(r.wetCakeMoisture); if (!isNaN(wet)) { dWet += wet; cWet++; sumWet += wet; countWet++; }
        const prod = parseFloat(r.productMoisture); if (!isNaN(prod)) { dProd += prod; cProd++; sumProd += prod; countProd++; }
      });

      return {
        date: record.date,
        avgIn: cIn > 0 ? (dIn / cIn).toFixed(1) : '0.0',
        avgOut: cOut > 0 ? (dOut / cOut).toFixed(1) : '0.0',
        avgWet: cWet > 0 ? (dWet / cWet).toFixed(2) : '0.00',
        avgProd: cProd > 0 ? (dProd / cProd).toFixed(2) : '0.00',
      };
    }).reverse(); // ให้เรียงตามลำดับวันที่เก่าไปใหม่

    return {
      avgTempIn: countTempIn > 0 ? (sumTempIn / countTempIn).toFixed(1) : '0.0',
      avgTempOut: countTempOut > 0 ? (sumTempOut / countTempOut).toFixed(1) : '0.0',
      avgWet: countWet > 0 ? (sumWet / countWet).toFixed(2) : '0.00',
      avgProd: countProd > 0 ? (sumProd / countProd).toFixed(2) : '0.00',
      totalDays: history.length,
      dailyTrends
    };
  };

  const monthlyData = calculateMonthlyAnalytics();

  if (appState === 'scanning') {
    return (
      <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center space-y-4">
        <Loader2 className="w-12 h-12 text-blue-600 animate-spin" />
        <h2 className="text-xl font-semibold text-slate-700">กำลังประมวลผลเอกสารและวิเคราะห์...</h2>
        <p className="text-slate-500">ระบบ AI กำลังอ่านข้อมูลและอัปเดตลงตารางประวัติ</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-100 p-2 md:p-4 font-sans flex flex-col">
      <div className="max-w-screen-2xl mx-auto w-full bg-white rounded-xl shadow-lg border border-slate-200 overflow-hidden flex flex-col flex-1 h-[95vh]">
        
        {/* Header Bar */}
        <header className="bg-white border-b border-slate-200 px-4 py-3 flex flex-wrap items-center justify-between gap-4 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="bg-blue-100 p-2 rounded-lg">
              <TableIcon className="w-6 h-6 text-blue-700" />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-bold text-slate-800 leading-tight">ระบบรายงานและวิเคราะห์กระบวนการอบ</h1>
              <p className="text-xs md:text-sm text-slate-500">{docInfo.code} | วันที่เอกสารปัจจุบัน: {docInfo.date}</p>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            {/* ปุ่มเปิดคลังประวัติย้อนหลัง */}
            <button 
              onClick={() => setShowHistoryModal(true)}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold flex items-center transition-colors"
            >
              <Database className="w-4 h-4 mr-1.5 text-blue-600" />
              คลังประวัติย้อนหลัง ({history.length})
            </button>

            {appState === 'ready' && (
              <>
                <div className="bg-slate-100 p-1 rounded-lg flex space-x-1 border border-slate-200">
                  <button 
                    onClick={() => setActiveTab('table')}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${activeTab === 'table' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    <TableIcon className="w-3.5 h-3.5 inline mr-1" /> ตารางบันทึก
                  </button>
                  <button 
                    onClick={() => setActiveTab('analytics')}
                    className={`px-3 py-1.5 rounded-md text-xs font-semibold transition-all ${activeTab === 'analytics' ? 'bg-white text-blue-700 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    <BarChart3 className="w-3.5 h-3.5 inline mr-1" /> แดชบอร์ดวิเคราะห์
                  </button>
                </div>

                <button 
                  onClick={handleManualSave}
                  className="px-3 py-1.5 bg-emerald-50 text-emerald-700 border border-emerald-300 rounded-lg hover:bg-emerald-100 flex items-center text-xs font-semibold"
                >
                  <Save className="w-3.5 h-3.5 mr-1" /> บันทึกประวัติ
                </button>

                {activeTab === 'analytics' && (
                  <button 
                    onClick={() => window.print()}
                    className="px-3 py-1.5 bg-slate-800 text-white rounded-lg hover:bg-slate-700 flex items-center text-xs font-semibold shadow-sm"
                  >
                    <Printer className="w-3.5 h-3.5 mr-1.5" /> พิมพ์รายงาน PDF
                  </button>
                )}
              </>
            )}

            <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageUpload} className="hidden" />
            <input type="file" accept=".json" ref={jsonImportRef} onChange={handleImportJSON} className="hidden" />
            
            {appState === 'uploaded' ? (
              <button onClick={handleScanDocument} className="px-4 py-2 bg-emerald-600 rounded-lg text-white hover:bg-emerald-700 flex items-center text-sm font-bold shadow-md animate-pulse">
                <ScanLine className="w-5 h-5 mr-2" /> สแกนเอกสาร
              </button>
            ) : (
              <button onClick={triggerFileInput} className="px-3 py-2 bg-indigo-50 border border-indigo-200 rounded-lg text-indigo-700 hover:bg-indigo-100 flex items-center text-sm font-medium">
                เปลี่ยนรูป
              </button>
            )}
          </div>
        </header>

        {/* Message Status Bar */}
        {(statusMessage || saveStatus) && (
          <div className="bg-blue-50 px-4 py-1.5 text-xs text-blue-800 border-b border-blue-100 flex justify-between items-center">
            <span>{statusMessage || saveStatus}</span>
          </div>
        )}

        {/* Content Body */}
        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row bg-slate-200">
          
          {/* Image Preview Pane */}
          {(showImagePane || appState === 'uploaded') && imageSrc && (
            <div className={`w-full bg-slate-900 flex flex-col relative shrink-0 ${appState === 'uploaded' ? 'h-full lg:w-full' : 'h-1/2 lg:h-full lg:w-2/5 border-r border-slate-300'}`}>
              <div className="flex-1 overflow-auto p-4 flex items-center justify-center">
                <img src={imageSrc} alt="Document" className="max-w-full h-auto max-h-full object-contain rounded shadow-lg" />
              </div>
            </div>
          )}

          {/* Main View Area */}
          {appState === 'ready' && (
            <div className="flex-1 overflow-auto bg-white flex flex-col">
              
              {/* TAB 1: TABLE VIEW */}
              {activeTab === 'table' && (
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-xs md:text-sm text-left border-collapse min-w-[1000px]">
                    <thead className="bg-slate-100 text-slate-700 sticky top-0 z-10 text-center font-semibold text-[11px] uppercase">
                      <tr>
                        <th rowSpan="2" className="border-b-2 border-r border-slate-300 p-2 bg-slate-200">Time</th>
                        <th rowSpan="2" className="border-b-2 border-r border-slate-300 p-2 bg-slate-200">PRODUCT TYPE</th>
                        <th colSpan="5" className="border-b border-r border-slate-300 p-1 bg-blue-50">DW RUNING</th>
                        <th colSpan="2" className="border-b border-r border-slate-300 p-1 bg-orange-50">HOT AIR TEMP</th>
                        <th rowSpan="2" className="border-b-2 border-r border-slate-300 p-2">% SPEED</th>
                        <th rowSpan="2" className="border-b-2 border-r border-slate-300 p-2">% WET MOIST</th>
                        <th rowSpan="2" className="border-b-2 border-r border-slate-300 p-2">% PROD MOIST</th>
                        <th rowSpan="2" className="border-b-2 border-r border-slate-300 p-2">Filter</th>
                        <th rowSpan="2" className="border-b-2 border-slate-300 p-2">REMARK</th>
                      </tr>
                      <tr>
                        <th className="border-b border-r bg-blue-50">1</th>
                        <th className="border-b border-r bg-blue-50">2</th>
                        <th className="border-b border-r bg-blue-50">3</th>
                        <th className="border-b border-r bg-blue-50">4</th>
                        <th className="border-b border-r bg-blue-50">5</th>
                        <th className="border-b border-r bg-orange-50">IN</th>
                        <th className="border-b border-r bg-orange-50">OUT</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.map((row, index) => (
                        <tr key={row.id} className="hover:bg-blue-50/40 border-b border-slate-200">
                          <td className="border-r text-center bg-slate-50 font-medium">{row.time}</td>
                          <td className="border-r p-0"><input type="text" value={row.productType} onChange={(e) => handleCellChange(index, 'productType', e.target.value)} className="w-full p-1.5 text-center bg-transparent" /></td>
                          {['dw1', 'dw2', 'dw3', 'dw4', 'dw5'].map(f => (
                            <td key={f} className="border-r p-0"><input type="text" value={row[f]} onChange={(e) => handleCellChange(index, f, e.target.value)} className="w-full p-1 text-center font-bold text-blue-600 bg-transparent" /></td>
                          ))}
                          <td className="border-r p-0"><input type="text" value={row.hotAirIn} onChange={(e) => handleCellChange(index, 'hotAirIn', e.target.value)} className="w-full p-1.5 text-center bg-transparent" /></td>
                          <td className="border-r p-0"><input type="text" value={row.hotAirOut} onChange={(e) => handleCellChange(index, 'hotAirOut', e.target.value)} className="w-full p-1.5 text-center bg-transparent" /></td>
                          <td className="border-r p-0"><input type="text" value={row.speed} onChange={(e) => handleCellChange(index, 'speed', e.target.value)} className="w-full p-1.5 text-center bg-transparent" /></td>
                          <td className="border-r p-0"><input type="text" value={row.wetCakeMoisture} onChange={(e) => handleCellChange(index, 'wetCakeMoisture', e.target.value)} className="w-full p-1.5 text-center bg-transparent" /></td>
                          <td className="border-r p-0"><input type="text" value={row.productMoisture} onChange={(e) => handleCellChange(index, 'productMoisture', e.target.value)} className="w-full p-1.5 text-center bg-transparent" /></td>
                          <td className="border-r p-0"><input type="text" value={row.changeDwFilter} onChange={(e) => handleCellChange(index, 'changeDwFilter', e.target.value)} className="w-full p-1.5 text-center font-bold text-blue-600 bg-transparent" /></td>
                          <td className="p-0"><input type="text" value={row.remark} onChange={(e) => handleCellChange(index, 'remark', e.target.value)} className="w-full p-1.5 text-left text-red-600 bg-transparent" /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* TAB 2: ANALYTICS DASHBOARD */}
              {activeTab === 'analytics' && (
                <div className="p-4 md:p-6 overflow-auto flex-1 bg-slate-50 space-y-6">
                  
                  {/* Filter Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                    <div className="flex items-center space-x-2">
                      <Clock className="w-5 h-5 text-blue-600" />
                      <span className="text-sm font-bold text-slate-700">เลือกกะการผลิต:</span>
                      <div className="inline-flex rounded-lg border border-slate-200 p-1 bg-slate-50">
                        <button 
                          onClick={() => setSelectedShift('ALL')}
                          className={`px-3 py-1 rounded-md text-xs font-semibold ${selectedShift === 'ALL' ? 'bg-blue-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}`}
                        >
                          ทั้งวัน (24 ชม.)
                        </button>
                        <button 
                          onClick={() => setSelectedShift('DAY')}
                          className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center ${selectedShift === 'DAY' ? 'bg-amber-500 text-white shadow' : 'text-slate-600 hover:text-slate-900'}`}
                        >
                          <Sun className="w-3.5 h-3.5 mr-1" /> กะกลางวัน (08:00 - 20:00)
                        </button>
                        <button 
                          onClick={() => setSelectedShift('NIGHT')}
                          className={`px-3 py-1 rounded-md text-xs font-semibold flex items-center ${selectedShift === 'NIGHT' ? 'bg-indigo-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}`}
                        >
                          <Moon className="w-3.5 h-3.5 mr-1" /> กะกลางคืน (20:00 - 08:00)
                        </button>
                      </div>
                    </div>

                    <div className="flex items-center space-x-2">
                      <Calendar className="w-5 h-5 text-indigo-600" />
                      <span className="text-sm font-bold text-slate-700">มุมมองรายงาน:</span>
                      <select 
                        value={analyticsPeriod} 
                        onChange={(e) => setAnalyticsPeriod(e.target.value)}
                        className="bg-slate-50 border border-slate-300 rounded-lg px-3 py-1 text-xs font-semibold text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      >
                        <option value="shift">รายงานประจำกะปัจจุบัน ({docInfo.date})</option>
                        <option value="monthly">แนวโน้มรายสถิติสะสม (สะสม {monthlyData.totalDays} วันในประวัติ)</option>
                      </select>
                    </div>
                  </div>

                  {/* Summary Cards */}
                  {analyticsPeriod === 'shift' ? (
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                        <p className="text-xs text-slate-500 font-semibold uppercase">อุณหภูมิลมร้อน IN (เฉลี่ย)</p>
                        <p className="text-3xl font-extrabold text-orange-600 mt-2">{analytics.avgTempIn} <span className="text-sm font-normal text-slate-500">°C</span></p>
                        <p className="text-xs text-slate-500 mt-2">ควบคุมความร้อนเข้า</p>
                      </div>
                      <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                        <p className="text-xs text-slate-500 font-semibold uppercase">อุณหภูมิลมร้อน OUT (เฉลี่ย)</p>
                        <p className="text-3xl font-extrabold text-amber-600 mt-2">{analytics.avgTempOut} <span className="text-sm font-normal text-slate-500">°C</span></p>
                        <p className="text-xs text-slate-500 mt-2">อุณหภูมิไอเสียระบาย</p>
                      </div>
                      <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                        <p className="text-xs text-slate-500 font-semibold uppercase">ความชื้นแป้งหมาด (Wet Moist)</p>
                        <p className="text-3xl font-extrabold text-indigo-600 mt-2">{analytics.avgWetMoist} <span className="text-sm font-normal text-slate-500">%</span></p>
                        <p className="text-xs text-slate-500 mt-2">แป้งก่อนเข้าอบ</p>
                      </div>
                      <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                        <p className="text-xs text-slate-500 font-semibold uppercase">ความชื้นแป้งแห้ง (Prod Moist)</p>
                        <p className="text-3xl font-extrabold text-blue-600 mt-2">{analytics.avgProdMoist} <span className="text-sm font-normal text-slate-500">%</span></p>
                        <p className="text-xs text-emerald-600 mt-2">✓ แป้งสำเร็จรูปออก</p>
                      </div>
                    </div>
                  ) : (
                    /* สรุปภาพรวมสะสมรายวัน/รายเดือน */
                    <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                      <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                        <p className="text-xs text-slate-500 font-semibold uppercase">จำนวนวันที่บันทึกในประวัติ</p>
                        <p className="text-3xl font-extrabold text-indigo-600 mt-2">{monthlyData.totalDays} <span className="text-sm font-normal text-slate-500">วัน</span></p>
                        <p className="text-xs text-slate-500 mt-2">สะสมข้อมูลย้อนหลัง</p>
                      </div>
                      <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                        <p className="text-xs text-slate-500 font-semibold uppercase">อุณหภูมิลม IN เฉลี่ยรวม</p>
                        <p className="text-3xl font-extrabold text-orange-600 mt-2">{monthlyData.avgTempIn} <span className="text-sm font-normal text-slate-500">°C</span></p>
                        <p className="text-xs text-slate-500 mt-2">ค่าเฉลี่ยย้อนหลังสะสม</p>
                      </div>
                      <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                        <p className="text-xs text-slate-500 font-semibold uppercase">ความชื้นแป้งหมาดเฉลี่ยรวม</p>
                        <p className="text-3xl font-extrabold text-indigo-600 mt-2">{monthlyData.avgWet} <span className="text-sm font-normal text-slate-500">%</span></p>
                        <p className="text-xs text-slate-500 mt-2">ก่อนเข้าอบสะสม</p>
                      </div>
                      <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                        <p className="text-xs text-slate-500 font-semibold uppercase">ความชื้นแป้งแห้งเฉลี่ยรวม</p>
                        <p className="text-3xl font-extrabold text-blue-600 mt-2">{monthlyData.avgProd} <span className="text-sm font-normal text-slate-500">%</span></p>
                        <p className="text-xs text-emerald-600 mt-2">สำเร็จรูปสะสม</p>
                      </div>
                    </div>
                  )}

                  {/* Visualization Chart */}
                  <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 space-y-4">
                    <div className="flex justify-between items-center">
                      <h3 className="text-md font-bold text-slate-800 flex items-center">
                        <BarChart3 className="w-5 h-5 mr-2 text-blue-600" /> 
                        {analyticsPeriod === 'shift' 
                          ? `กราฟเปรียบเทียบประจำกะ (${selectedShift === 'DAY' ? 'กะกลางวัน' : selectedShift === 'NIGHT' ? 'กะกลางคืน' : 'ตลอด 24 ชม.'})`
                          : `กราฟเปรียบเทียบแนวโน้มประวัติย้อนหลังรายวัน (สะสม ${monthlyData.totalDays} วัน)`}
                      </h3>
                      <div className="flex flex-wrap items-center gap-3 text-xs font-semibold">
                        <span className="flex items-center text-orange-600"><span className="w-3 h-3 bg-orange-500 rounded-full inline-block mr-1"></span> ลมร้อน IN</span>
                        <span className="flex items-center text-amber-600"><span className="w-3 h-3 bg-amber-500 rounded-full inline-block mr-1"></span> ลมร้อน OUT</span>
                        <span className="flex items-center text-indigo-600"><span className="w-3 h-3 bg-indigo-500 rounded-full inline-block mr-1"></span> แป้งหมาด (Wet)</span>
                        <span className="flex items-center text-blue-600"><span className="w-3 h-3 bg-blue-500 rounded-full inline-block mr-1"></span> แป้งแห้ง (Prod)</span>
                      </div>
                    </div>

                    {/* SVG Multi-Line Chart */}
                    <div className="w-full h-64 bg-slate-50 border border-slate-100 rounded-lg p-2 relative flex items-end">
                      <svg className="w-full h-full overflow-visible" viewBox="0 0 800 200" preserveAspectRatio="none">
                        <line x1="0" y1="50" x2="800" y2="50" stroke="#e2e8f0" strokeDasharray="4" />
                        <line x1="0" y1="100" x2="800" y2="100" stroke="#e2e8f0" strokeDasharray="4" />
                        <line x1="0" y1="150" x2="800" y2="150" stroke="#e2e8f0" strokeDasharray="4" />

                        {(() => {
                          const renderList = analyticsPeriod === 'shift' ? currentFilteredData : monthlyData.dailyTrends;
                          if (!renderList || renderList.length === 0) return null;

                          const ptsIn = renderList.map((d, i) => {
                            const val = parseFloat(analyticsPeriod === 'shift' ? d.hotAirIn : d.avgIn) || 0;
                            const x = (i / (renderList.length - 1 || 1)) * 760 + 20;
                            const y = 180 - (val / 200) * 160;
                            return `${x},${isNaN(y) ? 180 : y}`;
                          }).join(' ');

                          const ptsOut = renderList.map((d, i) => {
                            const val = parseFloat(analyticsPeriod === 'shift' ? d.hotAirOut : d.avgOut) || 0;
                            const x = (i / (renderList.length - 1 || 1)) * 760 + 20;
                            const y = 180 - (val / 200) * 160;
                            return `${x},${isNaN(y) ? 180 : y}`;
                          }).join(' ');

                          const ptsWet = renderList.map((d, i) => {
                            const val = parseFloat(analyticsPeriod === 'shift' ? d.wetCakeMoisture : d.avgWet) || 0;
                            const x = (i / (renderList.length - 1 || 1)) * 760 + 20;
                            const y = 180 - (val / 20) * 160;
                            return `${x},${isNaN(y) ? 180 : y}`;
                          }).join(' ');

                          const ptsProd = renderList.map((d, i) => {
                            const val = parseFloat(analyticsPeriod === 'shift' ? d.productMoisture : d.avgProd) || 0;
                            const x = (i / (renderList.length - 1 || 1)) * 760 + 20;
                            const y = 180 - (val / 10) * 160;
                            return `${x},${isNaN(y) ? 180 : y}`;
                          }).join(' ');

                          return (
                            <>
                              <polyline fill="none" stroke="#f97316" strokeWidth="2.5" points={ptsIn} />
                              <polyline fill="none" stroke="#f59e0b" strokeWidth="2.5" points={ptsOut} />
                              <polyline fill="none" stroke="#6366f1" strokeWidth="2.5" points={ptsWet} />
                              <polyline fill="none" stroke="#3b82f6" strokeWidth="2.5" points={ptsProd} />
                            </>
                          );
                        })()}
                      </svg>
                    </div>
                    <div className="flex justify-between text-[11px] text-slate-400 px-2">
                      {analyticsPeriod === 'shift' 
                        ? currentFilteredData.map((d, i) => <span key={i}>{d.time}</span>)
                        : monthlyData.dailyTrends.map((d, i) => <span key={i}>{d.date}</span>)
                      }
                    </div>
                  </div>

                </div>
              )}

            </div>
          )}
        </div>

        {/* MODAL: คลังประวัติย้อนหลัง */}
        {showHistoryModal && (
          <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl border border-slate-200 max-w-2xl w-full max-h-[80vh] flex flex-col overflow-hidden">
              <div className="p-4 bg-slate-100 border-b border-slate-200 flex justify-between items-center">
                <h3 className="font-bold text-slate-800 flex items-center">
                  <Database className="w-5 h-5 mr-2 text-blue-600" /> คลังประวัติเอกสารย้อนหลังที่บันทึกไว้ในเครื่อง
                </h3>
                <button onClick={() => setShowHistoryModal(false)} className="text-slate-400 hover:text-slate-600 p-1">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-4 overflow-auto flex-1 space-y-3">
                {history.length === 0 ? (
                  <p className="text-center text-slate-500 py-8">ยังไม่มีประวัติบันทึกในเครื่อง สามารถกด "บันทึกประวัติ" ได้เมื่อสแกนเอกสาร</p>
                ) : (
                  history.map((record) => (
                    <div key={record.id} className="p-3 bg-slate-50 hover:bg-blue-50/50 border border-slate-200 rounded-lg flex items-center justify-between">
                      <div>
                        <p className="font-bold text-slate-800 text-sm">📅 วันที่เอกสาร: {record.date}</p>
                        <p className="text-xs text-slate-500">รหัสเอกสาร: {record.code} | บันทึกเมื่อ: {new Date(record.timestamp).toLocaleString('th-TH')}</p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button 
                          onClick={() => loadReportFromHistory(record)}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-xs font-semibold hover:bg-blue-700 flex items-center"
                        >
                          <Eye className="w-3.5 h-3.5 mr-1" /> โหลดข้อมูล
                        </button>
                        <button 
                          onClick={() => deleteHistoryRecord(record.id)}
                          className="p-1.5 text-red-500 hover:bg-red-50 rounded-md"
                          title="ลบรายการนี้"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Modal Footer (Import/Export Backup) */}
              <div className="p-4 bg-slate-100 border-t border-slate-200 flex flex-wrap justify-between items-center gap-2">
                <div className="flex space-x-2">
                  <button 
                    onClick={exportHistoryJSON}
                    className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 text-xs font-semibold flex items-center"
                  >
                    <Download className="w-3.5 h-3.5 mr-1" /> ดาวน์โหลดไฟล์สำรอง (.JSON)
                  </button>
                  <button 
                    onClick={() => jsonImportRef.current.click()}
                    className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 text-xs font-semibold flex items-center"
                  >
                    <Upload className="w-3.5 h-3.5 mr-1" /> นำเข้าไฟล์สำรอง (.JSON)
                  </button>
                </div>
                <button 
                  onClick={() => setShowHistoryModal(false)}
                  className="px-4 py-1.5 bg-slate-800 text-white rounded-lg text-xs font-semibold"
                >
                  ปิดหน้าต่าง
                </button>
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  );
}

