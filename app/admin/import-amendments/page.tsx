'use client';

import { useState } from 'react';

export default function ImportAmendmentsPage() {
  const [status, setStatus] = useState<string>('Ready');
  const [progress, setProgress] = useState<number>(0);
  const [results, setResults] = useState<any[]>([]);
  const [running, setRunning] = useState(false);

  async function startImport() {
    setRunning(true);
    setStatus('Starting import...');
    setResults([]);
    
    let offset = 0;
    let totalChanges = 0;
    
    while (offset < 49281) {
      try {
        const response = await fetch(
          `/api/cron/import-amendments?offset=${offset}`,
          {
            headers: {
              'Authorization': `Bearer ${process.env.NEXT_PUBLIC_CRON_SECRET || 'your-secret-here'}`
            }
          }
        );
        
        const data = await response.json();
        
        if (data.error) {
          setStatus(`Error: ${data.error}`);
          break;
        }
        
        if (data.done) {
          setStatus('✅ Complete!');
          break;
        }
        
        totalChanges += data.contractorChanges || 0;
        offset = data.nextOffset;
        
        setProgress(Math.round((offset / 49281) * 100));
        setStatus(`Processing... ${data.progress} - ${totalChanges} contractor changes found`);
        setResults(prev => [...prev, data]);
        
        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 500));
        
      } catch (error: any) {
        setStatus(`Error: ${error.message}`);
        break;
      }
    }
    
    setRunning(false);
  }

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">Import Permit Amendments</h1>
      
      <div className="mb-4">
        <button
          onClick={startImport}
          disabled={running}
          className="px-4 py-2 bg-blue-500 text-white rounded disabled:bg-gray-400"
        >
          {running ? 'Running...' : 'Start Import'}
        </button>
      </div>
      
      <div className="mb-4">
        <div className="text-lg font-semibold">{status}</div>
        <div className="w-full bg-gray-200 rounded h-4 mt-2">
          <div 
            className="bg-blue-500 h-4 rounded transition-all"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>
      
      <div className="space-y-2">
        {results.map((r, i) => (
          <div key={i} className="text-sm">
            Batch {i + 1}: {r.totalInserted} amendments, {r.contractorChanges} changes
          </div>
        ))}
      </div>
    </div>
  );
}