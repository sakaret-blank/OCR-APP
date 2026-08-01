import React, { useState, useEffect, useRef } from 'react';
import { Download, Upload, FileText, BarChart3, Clock, Calendar, Sun, Moon, Printer, Save, Trash2, Database, AlertTriangle, CheckCircle, Loader2, Table as TableIcon, Eye, EyeOff, X, ScanLine, Thermometer, Droplets, Activity } from 'lucide-react';

const WORKER_API_URL = 'https://ocr-api.sakaretblank.workers.dev'; 
const LOCAL_STORAGE_KEY = 'drying_process_history_v2';

// ฟังก์ชันบีบอัดรูปภาพ
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

export default function App() {
  const [data, setData] = useState(generateEmptyData());
  const [docInfo, setDocInfo] = useState({ date: new Date().toLocaleDateString('th-TH'), code: 'FM-PD-010 Rev.1' });
  const [appState, setAppState] = useState('ready');
  const [activeTab, setActiveTab] = useState('table'); // 'table' | 'analytics'
  const [selectedShift, setSelectedShift] = useState('ALL'); // 'ALL' | 'DAY' | 'NIGHT'
  const [analyticsPeriod, setAnalyticsPeriod] = useState('shift'); // 'shift' | 'monthly'
  const [saveStatus, setSaveStatus] = useState('');
  
  // สถานะการซ่อน/แสดงรูปภาพอ้างอิง
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

  const handleImageUpload = (e) => {
    const file = e.target.files[0];
    if (file) {
      setSelectedFile(file);
      const url = URL.createObjectURL(file);
      setImageSrc(url);
      setShowImagePane(true); // เปิดรูปตอนอัปโหลด
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
        setShowImagePane(false); // ซ่อนรูปหลังสแกนเสร็จเพื่อให้ตารางขยายเต็มจอ
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
    <div className="w-full min-h-screen bg-slate-100 p-2 md:p-3 font-sans flex flex-col">
      {/* Full-width container */}
      <div className="w-full bg-white rounded-xl shadow-md border border-slate-200 overflow-hidden flex flex-col flex-1 min-h-[96vh]">
        
        {/* Header Bar */}
        <header className="bg-white border-b border-slate-200 px-4 py-2.5 flex flex-wrap items-center justify-between gap-3 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="bg-blue-600 text-white p-2 rounded-lg shadow-sm">
              <TableIcon className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg md:text-xl font-bold text-slate-800 leading-tight">ระบบรายงานและวิเคราะห์กระบวนการอบ (DRYING PROCESS)</h1>
              <p className="text-xs text-slate-500">{docInfo.code} | วันที่เอกสาร: <strong className="text-blue-700">{docInfo.date}</strong></p>
            </div>
          </div>
          
          <div className="flex items-center space-x-2">
            {/* ปุ่มสลับรูปภาพอ้างอิง */}
            {imageSrc && (
              <button 
                onClick={() => setShowImagePane(!showImagePane)}
                className={`px-3 py-1.5 border rounded-lg text-xs font-semibold flex items-center transition-all shadow-sm ${showImagePane ? 'bg-slate-800 text-white border-slate-800' : 'bg-white text-slate-700 border-slate-300 hover:bg-slate-50'}`}
              >
                {showImagePane ? <EyeOff className="w-4 h-4 mr-1.5 text-amber-400" /> : <Eye className="w-4 h-4 mr-1.5 text-blue-600" />}
                {showImagePane ? 'ซ่อนรูปอ้างอิง' : 'แสดงรูปอ้างอิง'}
              </button>
            )}

            {/* ปุ่มคลังประวัติ */}
            <button 
              onClick={() => setShowHistoryModal(true)}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 text-slate-700 border border-slate-300 rounded-lg text-xs font-semibold flex items-center transition-colors"
            >
              <Database className="w-4 h-4 mr-1.5 text-blue-600" />
              คลังประวัติ ({history.length})
            </button>

            {appState === 'ready' && (
              <>
                <div className="bg-slate-100 p-1 rounded-lg flex space-x-1 border border-slate-200">
                  <button 
                    onClick={() => setActiveTab('table')}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'table' ? 'bg-blue-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    <TableIcon className="w-3.5 h-3.5 inline mr-1" /> ตารางบันทึก
                  </button>
                  <button 
                    onClick={() => setActiveTab('analytics')}
                    className={`px-3 py-1.5 rounded-md text-xs font-bold transition-all ${activeTab === 'analytics' ? 'bg-blue-600 text-white shadow' : 'text-slate-600 hover:text-slate-900'}`}
                  >
                    <BarChart3 className="w-3.5 h-3.5 inline mr-1" /> แดชบอร์ดวิเคราะห์
                  </button>
                </div>

                <button 
                  onClick={handleManualSave}
                  className="px-3 py-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center text-xs font-semibold shadow-sm"
                >
                  <Save className="w-3.5 h-3.5 mr-1" /> บันทึกประวัติ
                </button>

                {activeTab === 'analytics' && (
                  <button 
                    onClick={() => window.print()}
                    className="px-3 py-1.5 bg-slate-800 text-white rounded-lg hover:bg-slate-700 flex items-center text-xs font-semibold shadow-sm"
                  >
                    <Printer className="w-3.5 h-3.5 mr-1.5" /> พิมพ์ PDF
                  </button>
                )}
              </>
            )}

            <input type="file" accept="image/*" ref={fileInputRef} onChange={handleImageUpload} className="hidden" />
            <input type="file" accept=".json" ref={jsonImportRef} onChange={handleImportJSON} className="hidden" />
            
            {appState === 'uploaded' ? (
              <button onClick={handleScanDocument} className="px-4 py-2 bg-emerald-600 rounded-lg text-white hover:bg-emerald-700 flex items-center text-xs font-bold shadow-md animate-pulse">
                <ScanLine className="w-4 h-4 mr-1.5" /> เริ่มสแกน
              </button>
            ) : (
              <button onClick={triggerFileInput} className="px-3 py-1.5 bg-indigo-50 border border-indigo-200 rounded-lg text-indigo-700 hover:bg-indigo-100 flex items-center text-xs font-semibold">
                อัปโหลดรูป
              </button>
            )}
          </div>
        </header>

        {/* Status Toast */}
        {(statusMessage || saveStatus) && (
          <div className="bg-blue-50 px-4 py-1.5 text-xs text-blue-800 border-b border-blue-100 flex justify-between items-center font-medium">
            <span>{statusMessage || saveStatus}</span>
          </div>
        )}

        {/* Content Area - Full Width Split */}
        <div className="flex-1 overflow-hidden flex flex-col lg:flex-row bg-slate-100">
          
          {/* Image Pane (ซ่อนได้เมื่อกดปุ่ม) */}
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

          {/* Main Content Area (ขยายเต็ม 100% เมื่อซ่อนรูป) */}
          {appState === 'ready' && (
            <div className="flex-1 overflow-auto bg-white flex flex-col w-full">
              
              {/* TAB 1: TABLE VIEW */}
              {activeTab === 'table' && (
                <div className="flex-1 overflow-auto">
                  <table className="w-full text-xs md:text-sm text-left border-collapse min-w-[1100px]">
                    <thead className="bg-slate-100 text-slate-700 sticky top-0 z-10 text-center font-semibold text-[11px] uppercase tracking-wider shadow-sm">
                      <tr>
                        <th rowSpan="2" className="border-b-2 border-r border-slate-300 p-2 min-w-[60px] bg-slate-200">Time</th>
                        <th rowSpan="2" className="border-b-2 border-r border-slate-300 p-2 min-w-[130px] bg-slate-200">PRODUCT TYPE</th>
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
                        <th className="border-b-2 border-r border-slate-300 p-1 min-w-[60px] bg-orange-50">IN</th>
                        <th className="border-b-2 border-r border-slate-300 p-1 min-w-[60px] bg-orange-50">OUT</th>
                      </tr>
                    </thead>
                    <tbody className="text-slate-800">
                      {data.map((row, index) => (
                        <tr key={row.id} className="hover:bg-blue-50/40 border-b border-slate-200 transition-colors">
                          <td className="border-r border-slate-200 text-center bg-slate-50 font-bold text-slate-700">{row.time}</td>
                          <td className="border-r border-slate-200 p-0">
                            <input type="text" value={row.productType} onChange={(e) => handleCellChange(index, 'productType', e.target.value)} className="w-full h-full p-2 text-center bg-transparent focus:bg-white outline-none font-medium" />
                          </td>
                          {['dw1', 'dw2', 'dw3', 'dw4', 'dw5'].map(f => (
                            <td key={f} className="border-r border-slate-200 p-0 text-center">
                              <input type="text" value={row[f]} onChange={(e) => handleCellChange(index, f, e.target.value)} className="w-full h-full p-1 text-center font-bold text-blue-600 bg-transparent focus:bg-white outline-none" />
                            </td>
                          ))}
                          <td className="border-r border-slate-200 p-0">
                            <input type="text" value={row.hotAirIn} onChange={(e) => handleCellChange(index, 'hotAirIn', e.target.value)} className="w-full h-full p-2 text-center bg-transparent focus:bg-white outline-none text-orange-600 font-semibold" />
                          </td>
                          <td className="border-r border-slate-200 p-0">
                            <input type="text" value={row.hotAirOut} onChange={(e) => handleCellChange(index, 'hotAirOut', e.target.value)} className="w-full h-full p-2 text-center bg-transparent focus:bg-white outline-none text-amber-600 font-semibold" />
                          </td>
                          <td className="border-r border-slate-200 p-0">
                            <input type="text" value={row.speed} onChange={(e) => handleCellChange(index, 'speed', e.target.value)} className="w-full h-full p-2 text-center bg-transparent focus:bg-white outline-none" />
                          </td>
                          <td className="border-r border-slate-200 p-0">
                            <input type="text" value={row.wetCakeMoisture} onChange={(e) => handleCellChange(index, 'wetCakeMoisture', e.target.value)} className="w-full h-full p-2 text-center bg-indigo-50/30 focus:bg-white outline-none text-indigo-700 font-semibold" />
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
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              {/* TAB 2: ANALYTICS DASHBOARD */}
              {activeTab === 'analytics' && (
                <div className="p-4 md:p-6 overflow-auto flex-1 bg-slate-50 space-y-6 w-full">
                  
                  {/* Shift Selection Bar */}
                  <div className="flex flex-wrap items-center justify-between gap-4 bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                    <div className="flex items-center space-x-2">
                      <Clock className="w-5 h-5 text-blue-600" />
                      <span className="text-sm font-bold text-slate-700">เลือกกะการผลิต:</span>
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
                  </div>

                  {/* Summary Metric Cards */}
                  <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                      <div className="flex items-center text-orange-600 space-x-2 mb-1">
                        <Thermometer className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase">อุณหภูมิลมเข้า IN (เฉลี่ย)</span>
                      </div>
                      <p className="text-3xl font-extrabold text-orange-600">{analytics.avgTempIn} <span className="text-sm font-normal text-slate-500">°C</span></p>
                    </div>

                    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                      <div className="flex items-center text-amber-600 space-x-2 mb-1">
                        <Thermometer className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase">อุณหภูมิลมออก OUT (เฉลี่ย)</span>
                      </div>
                      <p className="text-3xl font-extrabold text-amber-600">{analytics.avgTempOut} <span className="text-sm font-normal text-slate-500">°C</span></p>
                    </div>

                    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                      <div className="flex items-center text-indigo-600 space-x-2 mb-1">
                        <Droplets className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase">ความชื้นแป้งหมาด WET (เฉลี่ย)</span>
                      </div>
                      <p className="text-3xl font-extrabold text-indigo-600">{analytics.avgWetMoist} <span className="text-sm font-normal text-slate-500">%</span></p>
                    </div>

                    <div className="bg-white p-4 rounded-xl shadow-sm border border-slate-200">
                      <div className="flex items-center text-blue-600 space-x-2 mb-1">
                        <Droplets className="w-4 h-4" />
                        <span className="text-xs font-bold uppercase">ความชื้นแป้งแห้ง PROD (เฉลี่ย)</span>
                      </div>
                      <p className="text-3xl font-extrabold text-blue-600">{analytics.avgProdMoist} <span className="text-sm font-normal text-slate-500">%</span></p>
                    </div>
                  </div>

                  {/* CHART 1: TEMPERATURE CHART (แยกเฉพาะอุณหภูมิ) */}
                  <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 space-y-3">
                    <div className="flex justify-between items-center border-b pb-2">
                      <h3 className="text-md font-bold text-slate-800 flex items-center">
                        <Thermometer className="w-5 h-5 mr-2 text-orange-500" /> กราฟอุณหภูมิลมร้อน (HOT AIR TEMP: 40°C - 200°C)
                      </h3>
                      <div className="flex items-center space-x-4 text-xs font-bold">
                        <span className="flex items-center text-orange-600"><span className="w-3 h-3 bg-orange-500 rounded-full inline-block mr-1"></span> ลมร้อน IN (°C)</span>
                        <span className="flex items-center text-amber-600"><span className="w-3 h-3 bg-amber-500 rounded-full inline-block mr-1"></span> ลมร้อน OUT (°C)</span>
                      </div>
                    </div>

                    {/* Interactive Temperature SVG Chart */}
                    <InteractiveTempChart dataset={currentFilteredData} />
                  </div>

                  {/* CHART 2: MOISTURE CHART (แยกเฉพาะความชื้นแป้ง) */}
                  <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200 space-y-3">
                    <div className="flex justify-between items-center border-b pb-2">
                      <h3 className="text-md font-bold text-slate-800 flex items-center">
                        <Droplets className="w-5 h-5 mr-2 text-blue-500" /> กราฟความชื้นแป้ง (% MOISTURE: 0% - 40%)
                      </h3>
                      <div className="flex items-center space-x-4 text-xs font-bold">
                        <span className="flex items-center text-indigo-600"><span className="w-3 h-3 bg-indigo-500 rounded-full inline-block mr-1"></span> แป้งหมาด WET (%)</span>
                        <span className="flex items-center text-blue-600"><span className="w-3 h-3 bg-blue-500 rounded-full inline-block mr-1"></span> แป้งแห้ง PROD (%)</span>
                      </div>
                    </div>

                    {/* Interactive Moisture SVG Chart */}
                    <InteractiveMoistureChart dataset={currentFilteredData} />
                  </div>

                  {/* Anomaly / Warning Section */}
                  <div className="bg-white p-5 rounded-xl shadow-sm border border-slate-200">
                    <h3 className="text-md font-bold text-slate-700 mb-3 flex items-center">
                      <AlertTriangle className="w-5 h-5 mr-2 text-amber-500" /> สรุปความผิดปกติประจำกะ
                    </h3>
                    {analytics.anomalies.length > 0 ? (
                      <ul className="space-y-2">
                        {analytics.anomalies.map((item, idx) => (
                          <li key={idx} className="bg-amber-50 border border-amber-200 text-amber-800 p-3 rounded-lg text-sm flex justify-between">
                            <span>🕒 เวลา <strong>{item.time}</strong></span>
                            <span>{item.issue}</span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <div className="text-emerald-600 bg-emerald-50 border border-emerald-200 p-4 rounded-lg text-sm flex items-center">
                        <CheckCircle className="w-5 h-5 mr-2" /> ระบบทำงานปกติ ไม่พบความชื้นเกินเกณฑ์มาตรฐาน
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

              <div className="p-4 overflow-auto flex-1 space-y-3">
                {history.length === 0 ? (
                  <p className="text-center text-slate-500 py-8">ยังไม่มีประวัติในเครื่อง กด "บันทึกประวัติ" หลังสแกนเพื่อเก็บบันทึก</p>
                ) : (
                  history.map((record) => (
                    <div key={record.id} className="p-3 bg-slate-50 hover:bg-blue-50/50 border border-slate-200 rounded-lg flex items-center justify-between">
                      <div>
                        <p className="font-bold text-slate-800 text-sm">📅 วันที่: {record.date}</p>
                        <p className="text-xs text-slate-500">รหัสเอกสาร: {record.code} | เวลาสแกน: {new Date(record.timestamp).toLocaleString('th-TH')}</p>
                      </div>
                      <div className="flex items-center space-x-2">
                        <button 
                          onClick={() => loadReportFromHistory(record)}
                          className="px-3 py-1.5 bg-blue-600 text-white rounded-md text-xs font-semibold hover:bg-blue-700 flex items-center"
                        >
                          <Eye className="w-3.5 h-3.5 mr-1" /> ดึงข้อมูล
                        </button>
                        <button 
                          onClick={() => deleteHistoryRecord(record.id)}
                          className="p-1.5 text-red-500 hover:bg-red-50 rounded-md"
                          title="ลบ"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}
              </div>

              <div className="p-4 bg-slate-100 border-t border-slate-200 flex flex-wrap justify-between items-center gap-2">
                <div className="flex space-x-2">
                  <button onClick={exportHistoryJSON} className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 text-xs font-semibold flex items-center">
                    <Download className="w-3.5 h-3.5 mr-1" /> ส่งออกไฟล์สำรอง (.JSON)
                  </button>
                  <button onClick={() => jsonImportRef.current.click()} className="px-3 py-1.5 bg-white border border-slate-300 rounded-lg text-slate-700 hover:bg-slate-50 text-xs font-semibold flex items-center">
                    <Upload className="w-3.5 h-3.5 mr-1" /> นำเข้าไฟล์สำรอง (.JSON)
                  </button>
                </div>
                <button onClick={() => setShowHistoryModal(false)} className="px-4 py-1.5 bg-slate-800 text-white rounded-lg text-xs font-semibold">
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
// COMPONENT 1: Interactive Temperature Chart
// ==========================================
function InteractiveTempChart({ dataset }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  if (!dataset || dataset.length === 0) return null;

  const width = 800;
  const height = 220;
  const padding = 40;

  // Scale Y: 40°C - 200°C
  const minY = 40;
  const maxY = 200;

  const getX = (index) => padding + (index / (dataset.length - 1 || 1)) * (width - padding * 2);
  const getY = (val) => {
    const v = parseFloat(val) || minY;
    const clamped = Math.max(minY, Math.min(maxY, v));
    return height - padding - ((clamped - minY) / (maxY - minY)) * (height - padding * 2);
  };

  const pointsIn = dataset.map((d, i) => `${getX(i)},${getY(d.hotAirIn)}`).join(' ');
  const pointsOut = dataset.map((d, i) => `${getX(i)},${getY(d.hotAirOut)}`).join(' ');

  return (
    <div className="relative w-full overflow-hidden">
      <div className="w-full bg-slate-900 rounded-lg p-2 text-white relative">
        <svg className="w-full h-56 overflow-visible" viewBox={`0 0 ${width} ${height}`}>
          {/* Y-Axis Grid Lines */}
          {[40, 80, 120, 160, 200].map((temp) => (
            <g key={temp}>
              <line x1={padding} y1={getY(temp)} x2={width - padding} y2={getY(temp)} stroke="#334155" strokeDasharray="3 3" />
              <text x={padding - 8} y={getY(temp) + 4} fill="#94a3b8" fontSize="10" textAnchor="end">{temp}°C</text>
            </g>
          ))}

          {/* Polylines */}
          <polyline fill="none" stroke="#f97316" strokeWidth="3" points={pointsIn} />
          <polyline fill="none" stroke="#f59e0b" strokeWidth="3" points={pointsOut} />

          {/* Data Dots & Interactive Hitboxes */}
          {dataset.map((d, i) => {
            const x = getX(i);
            const yIn = getY(d.hotAirIn);
            const yOut = getY(d.hotAirOut);
            const isHovered = hoverIndex === i;

            return (
              <g key={i}>
                <circle cx={x} cy={yIn} r={isHovered ? "6" : "3.5"} fill="#f97316" stroke="#ffffff" strokeWidth="1.5" />
                <circle cx={x} cy={yOut} r={isHovered ? "6" : "3.5"} fill="#f59e0b" stroke="#ffffff" strokeWidth="1.5" />

                {/* Vertical Cursor Line on Hover */}
                {isHovered && (
                  <line x1={x} y1={padding} x2={x} y2={height - padding} stroke="#cbd5e1" strokeDasharray="2 2" strokeWidth="1.5" />
                )}

                {/* Invisible Hover Column Hitbox */}
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

        {/* X-Axis Time Labels */}
        <div className="flex justify-between px-8 text-[11px] text-slate-400 font-mono mt-1">
          {dataset.map((d, i) => (
            <span key={i} className={hoverIndex === i ? "text-amber-400 font-bold" : ""}>{d.time}</span>
          ))}
        </div>

        {/* Floating Tooltip Box */}
        {hoverIndex !== null && dataset[hoverIndex] && (
          <div 
            className="absolute top-3 bg-slate-800/95 border border-slate-600 text-white p-2.5 rounded-lg shadow-xl text-xs space-y-1 pointer-events-none transition-all z-20 backdrop-blur-sm"
            style={{ left: `${Math.min(Math.max(hoverIndex * (100 / dataset.length), 5), 75)}%` }}
          >
            <p className="font-bold text-amber-400 border-b border-slate-700 pb-1">🕒 เวลา {dataset[hoverIndex].time} น.</p>
            <p className="text-orange-400 font-medium">🔥 ลมร้อน IN: <strong>{dataset[hoverIndex].hotAirIn || '-'} °C</strong></p>
            <p className="text-amber-300 font-medium">💨 ลมร้อน OUT: <strong>{dataset[hoverIndex].hotAirOut || '-'} °C</strong></p>
            {dataset[hoverIndex].productType && <p className="text-slate-300 text-[10px]">ชนิดแป้ง: {dataset[hoverIndex].productType}</p>}
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// COMPONENT 2: Interactive Moisture Chart
// ==========================================
function InteractiveMoistureChart({ dataset }) {
  const [hoverIndex, setHoverIndex] = useState(null);

  if (!dataset || dataset.length === 0) return null;

  const width = 800;
  const height = 220;
  const padding = 40;

  // Scale Y: 0% - 40%
  const minY = 0;
  const maxY = 40;

  const getX = (index) => padding + (index / (dataset.length - 1 || 1)) * (width - padding * 2);
  const getY = (val) => {
    const v = parseFloat(val) || minY;
    const clamped = Math.max(minY, Math.min(maxY, v));
    return height - padding - ((clamped - minY) / (maxY - minY)) * (height - padding * 2);
  };

  const pointsWet = dataset.map((d, i) => `${getX(i)},${getY(d.wetCakeMoisture)}`).join(' ');
  const pointsProd = dataset.map((d, i) => `${getX(i)},${getY(d.productMoisture)}`).join(' ');

  return (
    <div className="relative w-full overflow-hidden">
      <div className="w-full bg-slate-900 rounded-lg p-2 text-white relative">
        <svg className="w-full h-56 overflow-visible" viewBox={`0 0 ${width} ${height}`}>
          {/* Y-Axis Grid Lines */}
          {[0, 10, 20, 30, 40].map((m) => (
            <g key={m}>
              <line x1={padding} y1={getY(m)} x2={width - padding} y2={getY(m)} stroke="#334155" strokeDasharray="3 3" />
              <text x={padding - 8} y={getY(m) + 4} fill="#94a3b8" fontSize="10" textAnchor="end">{m}%</text>
            </g>
          ))}

          {/* Polylines */}
          <polyline fill="none" stroke="#6366f1" strokeWidth="3" points={pointsWet} />
          <polyline fill="none" stroke="#3b82f6" strokeWidth="3" points={pointsProd} />

          {/* Data Dots & Interactive Hitboxes */}
          {dataset.map((d, i) => {
            const x = getX(i);
            const yWet = getY(d.wetCakeMoisture);
            const yProd = getY(d.productMoisture);
            const isHovered = hoverIndex === i;

            return (
              <g key={i}>
                <circle cx={x} cy={yWet} r={isHovered ? "6" : "3.5"} fill="#6366f1" stroke="#ffffff" strokeWidth="1.5" />
                <circle cx={x} cy={yProd} r={isHovered ? "6" : "3.5"} fill="#3b82f6" stroke="#ffffff" strokeWidth="1.5" />

                {/* Vertical Cursor Line on Hover */}
                {isHovered && (
                  <line x1={x} y1={padding} x2={x} y2={height - padding} stroke="#cbd5e1" strokeDasharray="2 2" strokeWidth="1.5" />
                )}

                {/* Invisible Hover Column Hitbox */}
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

        {/* X-Axis Time Labels */}
        <div className="flex justify-between px-8 text-[11px] text-slate-400 font-mono mt-1">
          {dataset.map((d, i) => (
            <span key={i} className={hoverIndex === i ? "text-blue-400 font-bold" : ""}>{d.time}</span>
          ))}
        </div>

        {/* Floating Tooltip Box */}
        {hoverIndex !== null && dataset[hoverIndex] && (
          <div 
            className="absolute top-3 bg-slate-800/95 border border-slate-600 text-white p-2.5 rounded-lg shadow-xl text-xs space-y-1 pointer-events-none transition-all z-20 backdrop-blur-sm"
            style={{ left: `${Math.min(Math.max(hoverIndex * (100 / dataset.length), 5), 75)}%` }}
          >
            <p className="font-bold text-blue-400 border-b border-slate-700 pb-1">🕒 เวลา {dataset[hoverIndex].time} น.</p>
            <p className="text-indigo-300 font-medium">💧 แป้งหมาด WET: <strong>{dataset[hoverIndex].wetCakeMoisture || '-'} %</strong></p>
            <p className="text-blue-300 font-medium">✨ แป้งแห้ง PROD: <strong>{dataset[hoverIndex].productMoisture || '-'} %</strong></p>
          </div>
        )}
      </div>
    </div>
  );
}

