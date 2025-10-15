import React, { useState, useEffect, useMemo } from 'react';
import {
  ArrowLeft, FileUp, Loader2, AlertCircle, ShieldCheck, Type, Hash, Mail, Phone, MapPin, X, Download, RotateCcw, Pencil
} from 'lucide-react';
import DecorativeBackground from './DecorativeBackground';
import type { AnalyzedContract } from '../App';

// --- INTERFACES AND TYPES ---

interface Redaction {
  text: string;
  start: number;
  end: number;
  type: string;
  page: number;
}

export interface ContractData {
  filename?: string;
  file_size?: number;
  full_text: string;
  redactions: Redaction[];
  page_offsets: number[];
  extraction_timestamp: string;
}

interface DashboardProps {
  onBack: () => void;
  initialAnalyzedContracts?: AnalyzedContract[] | null;
}

interface ActionCandidate {
  redaction: Redaction;
  count: number;
  position: { top: number; left: number };
  mode: 'add' | 'reject';
}

const PII_TYPE_STYLES: Record<string, { icon: React.ElementType; color: string }> = {
  PERSON: { icon: Type, color: 'bg-blue-200' },
  ORG: { icon: Hash, color: 'bg-purple-200' },
  LOCATION: { icon: MapPin, color: 'bg-pink-200' },
  EMAIL: { icon: Mail, color: 'bg-red-200' },
  PHONE: { icon: Phone, color: 'bg-yellow-200' },
  MANUAL: { icon: Pencil, color: 'bg-gray-300' },
  default: { icon: ShieldCheck, color: 'bg-gray-400' },
};


const Dashboard = ({ onBack, initialAnalyzedContracts }: DashboardProps) => {
  const [currentContract, setCurrentContract] = useState<ContractData | null>(null);
  const [activeRedactions, setActiveRedactions] = useState<Redaction[]>([]);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [actionCandidate, setActionCandidate] = useState<ActionCandidate | null>(null);
  const [lastRejected, setLastRejected] = useState<Redaction[] | null>(null);
  const [undoTimer, setUndoTimer] = useState<NodeJS.Timeout | null>(null);
  const [isEditMode, setIsEditMode] = useState(false);

  useEffect(() => {
    if (initialAnalyzedContracts && initialAnalyzedContracts.length > 0) {
      const initialData = initialAnalyzedContracts[0];
      setCurrentContract(initialData.analysis);
      setActiveRedactions(initialData.analysis.redactions);
      setOriginalFile(initialData.file);
    }
  }, [initialAnalyzedContracts]);

  const commitRejection = (itemsToReject: Redaction[]) => {
    if (undoTimer) clearTimeout(undoTimer);
    setLastRejected(itemsToReject);
    setActiveRedactions(current => current.filter(r => !itemsToReject.some(rejected => r.start === rejected.start && r.end === rejected.end)));
    const timer = setTimeout(() => setLastRejected(null), 5000);
    setUndoTimer(timer);
  };

  const handleUndo = () => {
    if (undoTimer) clearTimeout(undoTimer);
    if (lastRejected) {
      setActiveRedactions(current => [...current, ...lastRejected].sort((a, b) => a.start - b.start));
    }
    setLastRejected(null);
  };

  const handleSingleReject = (redactionToReject: Redaction) => {
    commitRejection([redactionToReject]);
    setActionCandidate(null);
  };

  const handleBulkReject = (textToReject: string) => {
    const itemsToReject = activeRedactions.filter(r => r.text === textToReject);
    commitRejection(itemsToReject);
    setActionCandidate(null);
  };

  const handleDeleteClick = (redaction: Redaction, event: React.MouseEvent) => {
    const count = activeRedactions.filter(r => r.text === redaction.text).length;
    if (count <= 1) {
      handleSingleReject(redaction);
    } else {
      setActionCandidate({ redaction, count, position: { top: event.clientY, left: event.clientX }, mode: 'reject' });
    }
  };

  const getPageFromOffset = (offset: number) => {
    if (!currentContract?.page_offsets) return 1;
    const { page_offsets } = currentContract;
    let pageNum = page_offsets.findIndex(p_offset => offset < p_offset);
    if (pageNum === -1) pageNum = page_offsets.length;
    return pageNum > 0 ? pageNum : 1;
  };

  const handleWordSelect = (e: React.MouseEvent<HTMLElement>) => {
    if (!isEditMode || (e.target as HTMLElement).closest('mark')) return;
  
    const selection = window.getSelection();
    const selectedText = selection?.toString().trim();
  
    if (selectedText) { // Handle drag-selection
      const range = selection!.getRangeAt(0);
      const fullText = currentContract?.full_text || '';
      // This is a simplified offset calculation
      const start = fullText.indexOf(selectedText);
      const end = start + selectedText.length;
      if (start === -1) return;
  
      const page = getPageFromOffset(start);
      const newRedaction: Redaction = { text: selectedText, start, end, type: 'MANUAL', page };
      const count = findAllOccurrences(fullText, selectedText).length;
  
      if (count > 1) {
        setActionCandidate({ redaction: newRedaction, count, position: { top: e.clientY, left: e.clientX }, mode: 'add' });
      } else {
        handleSingleAdd(newRedaction);
      }
  
    } else { // Handle click-selection
      const range = document.caretRangeFromPoint(e.clientX, e.clientY);
      if (range) {
        const word = findWordAt(currentContract?.full_text || '', range.startOffset);
        if (word) {
          const page = getPageFromOffset(word.start);
          const newRedaction: Redaction = { ...word, type: 'MANUAL', page };
          const count = findAllOccurrences(currentContract?.full_text || '', word.text).length;
          if (count > 1) {
            setActionCandidate({ redaction: newRedaction, count, position: { top: e.clientY, left: e.clientX }, mode: 'add' });
          } else {
            handleSingleAdd(newRedaction);
          }
        }
      }
    }
  };
  

  const handleSingleAdd = (redactionToAdd: Redaction) => {
        setActiveRedactions(current => [...current, redactionToAdd]);
    setActionCandidate(null);
  };

  const handleBulkAdd = (textToAdd: string) => {
    const occurrences = findAllOccurrences(currentContract?.full_text || '', textToAdd);
    const newRedactions = occurrences.map(occ => ({
      ...occ,
      type: 'MANUAL',
      page: getPageFromOffset(occ.start),
    }));
    setActiveRedactions(current => [...current, ...newRedactions]);
    setActionCandidate(null);
  };

  const handleFileUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsUploading(true);
    setUploadError(null);
    try {
      setOriginalFile(file);
      const formData = new FormData();
      formData.append('file', file);
      const apiUrl = 'http://localhost:5000/api/analyze-contract';
      const response = await fetch(apiUrl, { method: 'POST', body: formData });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to redact document');
      }
      const analysisData: ContractData = await response.json();
      setCurrentContract(analysisData);
      setActiveRedactions(analysisData.redactions);
    } catch (error) {
      console.error('Error uploading file:', error);
      setUploadError(error instanceof Error ? error.message : 'Failed to redact document. Please try again.');
    } finally {
      setIsUploading(false);
      event.target.value = '';
    }
  };

  const handleDownloadRedactedPDF = async () => {
    if (!originalFile) return;
    setIsDownloading(true);
    setUploadError(null);
    try {
      const formData = new FormData();
      formData.append('file', originalFile);
      formData.append('redactions', JSON.stringify(activeRedactions));
      const apiUrl = 'http://localhost:5000/api/generate-redacted-pdf';
      const response = await fetch(apiUrl, { method: 'POST', body: formData });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to generate PDF');
      }
      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `redacted_${originalFile.name}`;
      document.body.appendChild(a);
      a.click();
      window.URL.revokeObjectURL(url);
      a.remove();
    } catch (error) {
      console.error('Error downloading redacted PDF:', error);
      setUploadError(error instanceof Error ? error.message : 'An unknown error occurred during download.');
    } finally {
      setIsDownloading(false);
    }
  };

  const findAllOccurrences = (text: string, searchText: string) => {
    const results = [];
    let startIndex = 0;
    let index = text.indexOf(searchText, startIndex);
    while (index !== -1) {
      results.push({ text: searchText, start: index, end: index + searchText.length });
      startIndex = index + 1;
      index = text.indexOf(searchText, startIndex);
    }
    return results;
  };

  const findWordAt = (text: string, index: number) => {
    if (!text || text[index] === ' ' || text[index] === '\n') return null;
    let start = index;
    let end = index;
    while (start > 0 && text[start - 1] !== ' ' && text[start - 1] !== '\n') start--;
    while (end < text.length - 1 && text[end + 1] !== ' ' && text[end + 1] !== '\n') end++;
    const wordText = text.substring(start, end + 1);
    return { text: wordText, start, end: end + 1 };
  };

  const RedactedTextViewer = ({ 
    text, 
    redactions, 
    onReject, 
    onWordSelect, 
    isEditMode 
  }: { 
    text: string; 
    redactions: Redaction[]; 
    onReject: (r: Redaction, e: React.MouseEvent) => void; 
    onWordSelect: (e: React.MouseEvent<HTMLElement>) => void; 
    isEditMode: boolean; 
  }) => {
    const sortedRedactions = useMemo(
      () => [...redactions].sort((a, b) => a.start - b.start), 
      [redactions]
    );
    
    const parts = [];
    let lastIndex = 0;
    
    sortedRedactions.forEach((r) => {
      if (r.start > lastIndex) {
        parts.push(
          <span key={`text-${lastIndex}`}>
            {text.substring(lastIndex, r.start)}
          </span>
        );
      }
      
      const style = PII_TYPE_STYLES[r.type] || PII_TYPE_STYLES.default;
      
      parts.push(
        <mark 
          key={`${r.start}-${r.end}`} 
          className={`relative group px-1 rounded ${style.color}`}
        >
          {r.text}
          {!isEditMode && (
            <button 
              onClick={(e) => {
                e.stopPropagation();
                onReject(r, e);
              }} 
              className="absolute -top-1.5 -right-1.5 z-10 p-0.5 bg-black text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-150 hover:bg-red-600" 
              aria-label="Reject redaction"
            >
              <X size={12} />
            </button>
          )}
        </mark>
      );
      
      lastIndex = Math.max(lastIndex, r.end);
    });
    
    if (lastIndex < text.length) {
      parts.push(
        <span key="text-end">
          {text.substring(lastIndex)}
        </span>
      );
    }
    
    return (
      <pre 
        onClick={onWordSelect} 
        className={`whitespace-pre-wrap font-mono text-sm leading-relaxed ${isEditMode ? 'cursor-crosshair' : ''}`}
      >
        {parts}
      </pre>
    );
  };
  
  

  const ActionPopover = () => {
    if (!actionCandidate) return null;
    const { redaction, count, position, mode } = actionCandidate;
    return (
      <div className="fixed z-50 p-4 bg-white rounded-lg shadow-xl border border-gray-200 text-sm space-y-3" style={{ top: position.top + 10, left: position.left }}>
        <p className="font-medium">Found {count} instances of "<strong className='truncate max-w-[200px] inline-block align-bottom'>{redaction.text}</strong>".</p>
        <div className="flex justify-end space-x-2">
          <button onClick={() => setActionCandidate(null)} className="px-3 py-1 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md">Cancel</button>
          {mode === 'add' ? (
            <>
              <button onClick={() => handleSingleAdd(redaction)} className="px-3 py-1 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md">Add 1</button>
              <button onClick={() => handleBulkAdd(redaction.text)} className="px-3 py-1 bg-blue-600 text-white hover:bg-blue-700 rounded-md">Add All ({count})</button>
            </>
          ) : (
            <>
              <button onClick={() => handleSingleReject(redaction)} className="px-3 py-1 text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md">Reject 1</button>
              <button onClick={() => handleBulkReject(redaction.text)} className="px-3 py-1 bg-red-600 text-white hover:bg-red-700 rounded-md">Reject All ({count})</button>
            </>
          )}
        </div>
      </div>
    );
  };

  const UndoToast = () => {
    if (!lastRejected) return null;
    return (
      <div className="fixed bottom-5 left-1/2 -translate-x-1/2 z-50 bg-gray-800 text-white px-6 py-3 rounded-lg shadow-lg flex items-center space-x-4">
        <p>{lastRejected.length} item{lastRejected.length > 1 ? 's' : ''} removed.</p>
        <button onClick={handleUndo} className="flex items-center space-x-2 font-bold hover:text-gray-300"><RotateCcw size={16} /><span>Undo</span></button>
      </div>
    );
  };

  if (!currentContract) {
    return (
      <div className="min-h-screen bg-[#F3F3EE] flex items-center justify-center font-editorial"><div className="text-center max-w-md mx-auto p-8"><ShieldCheck className="w-16 h-16 text-gray-300 mx-auto mb-4" /><h2 className="text-xl font-editorial-medium text-gray-800 mb-2">Redaction Tool</h2><p className="text-gray-500 mb-6">Upload a PDF document to find and redact Personally Identifiable Information (PII).</p>{uploadError && <div className="mb-4 p-3 bg-red-100 border border-red-300 rounded-lg text-red-700 text-sm">{uploadError}</div>}<label className={`inline-flex items-center space-x-2 px-6 py-3 rounded-lg transition-colors cursor-pointer font-editorial-medium ${isUploading ? 'bg-gray-400 cursor-not-allowed' : 'bg-forest-600 hover:bg-forest-700'} text-white`}>{isUploading ? (<><Loader2 className="w-5 h-5 animate-spin" /><span>Analysing...</span></>) : (<><FileUp className="w-5 h-5" /><span>Upload Document</span></>)}<input type="file" accept=".pdf" onChange={handleFileUpload} disabled={isUploading} className="hidden" /></label><p className="text-xs text-gray-500 mt-2">PDF files only, max 16MB</p></div></div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F3F3EE] font-editorial text-gray-800" onClick={(e) => { if (actionCandidate && !((e.target as HTMLElement).closest('.fixed.z-50'))) setActionCandidate(null); }}>
      <DecorativeBackground />
      <ActionPopover />
      <UndoToast />
      <header className="bg-[#FCFCF9]/80 backdrop-blur-sm sticky top-0 z-40 border-b border-gray-300">
        <div className="max-w-7xl mx-auto px-6 md:px-10">
          <div className="flex items-center justify-between h-16">
            <button onClick={onBack} className="flex items-center space-x-2 text-sm text-gray-600 hover:text-gray-900"><ArrowLeft className="w-4 h-4" /><span>Back to Home</span></button>
            <div className="flex items-center space-x-4">
              <button onClick={() => setIsEditMode(!isEditMode)} className={`flex items-center space-x-2 px-4 py-2 border rounded-lg transition-colors text-sm font-medium ${isEditMode ? 'bg-blue-100 border-blue-300 text-blue-700' : 'border-gray-300 hover:bg-gray-50'}`}><Pencil className="w-4 h-4" /><span>{isEditMode ? 'Done Editing' : 'Manual Edit'}</span></button>
              <button onClick={handleDownloadRedactedPDF} disabled={isDownloading || !originalFile} className="flex items-center space-x-2 px-4 py-2 bg-forest-600 text-white rounded-lg hover:bg-forest-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors text-sm font-medium">{isDownloading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Download className="w-4 h-4" />}<span>Download</span></button>
            </div>
          </div>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 md:px-10 py-12">
        <div className="mb-8">
          <h1 className="text-2xl font-semibold text-gray-900">Redaction Analysis</h1>
          <p className="text-sm text-gray-600 mt-1">{currentContract.filename || 'Unknown Document'}</p>
        </div>

        {uploadError && <div className="mb-6 p-4 bg-red-100 border border-red-300 rounded-lg text-red-700 flex items-center"><AlertCircle className="w-5 h-5 mr-2" /><p className="text-sm font-medium">{uploadError}</p></div>}

        <div className="grid grid-cols-1 lg:grid-cols-[1fr_350px] gap-8">
          <div className="bg-white p-6 border border-gray-200 rounded-lg shadow-sm">
            <h2 className="text-lg font-bold text-gray-900 mb-4">{isEditMode ? 'Manual Edit Mode' : 'Interactive Document'}</h2>
            <div className="max-h-[800px] overflow-y-auto p-4 bg-gray-50 rounded-md border">
                <RedactedTextViewer text={currentContract.full_text} redactions={activeRedactions} onReject={handleDeleteClick} onWordSelect={handleWordSelect} isEditMode={isEditMode} />
            </div>
          </div>

          <aside className="space-y-6">
            <div className="bg-white p-6 border border-gray-200 rounded-lg shadow-sm">
                <h2 className="text-lg font-bold text-gray-900 mb-4">Detected PII ({activeRedactions.length})</h2>
                <div className="space-y-3 max-h-[750px] overflow-y-auto">
                    {[...activeRedactions].sort((a, b) => a.start - b.start).map((item) => {
                        const style = PII_TYPE_STYLES[item.type] || PII_TYPE_STYLES.default;
                        return (
                            <div key={`${item.start}-${item.end}`} className="relative group p-3 bg-gray-50 rounded-md border border-gray-200">
                                <div className="flex items-center justify-between mb-1">
                                    <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded ${style.color}`}>{item.type}</span>
                                    <span className="text-xs text-gray-500">Page {item.page > 0 ? item.page : 'N/A'}</span>
                                </div>
                                <p className="font-mono text-sm text-gray-800 break-all">{item.text}</p>
                                <button onClick={(e) => handleDeleteClick(item, e)} className="absolute top-1 right-1 z-10 p-0.5 bg-black text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-150 hover:bg-red-600" aria-label="Reject redaction"><X size={10} /></button>
                            </div>
                        );
                    })}
                </div>
            </div>
          </aside>
        </div>
      </main>
    </div>
  );
};

export default Dashboard;
