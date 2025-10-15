import React, { useState } from 'react';
import Hero from './components/landing/Hero';
import Dashboard from './components/Dashboard';
import UploadModal from './components/UploadModal';

import type { ContractData } from './components/Dashboard';

// --- NEW: Data structure to hold both analysis and the original file ---
export interface AnalyzedContract {
  analysis: ContractData;
  file: File;
}

const App = () => {
  const [view, setView] = useState<'hero' | 'dashboard'>('hero');
  
  // --- UPDATED: State now holds the new AnalyzedContract structure ---
  const [analyzedContracts, setAnalyzedContracts] = useState<AnalyzedContract[] | null>(null);
  
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  /**
   * --- UPDATED: Handler now accepts the new data structure ---
   */
  const handleAnalysisComplete = (data: AnalyzedContract[]) => {
    setIsUploadModalOpen(false);
    setAnalyzedContracts(data);
    setView('dashboard');
  };

  const handleBackToLanding = () => {
    setView('hero');
    setAnalyzedContracts(null);
  };

  return (
    <div>
      {view === 'hero' ? (
        <Hero onUploadClick={() => setIsUploadModalOpen(true)} />
      ) : (
        // --- UPDATED: Pass the new structure to the Dashboard ---
        <Dashboard 
          initialAnalyzedContracts={analyzedContracts}
          onBack={handleBackToLanding}
        />
      )}
      
      <UploadModal 
        isOpen={isUploadModalOpen && view === 'hero'}
        onClose={() => setIsUploadModalOpen(false)}
        onAnalysisComplete={handleAnalysisComplete}
      />
    </div>
  );
};

export default App;
