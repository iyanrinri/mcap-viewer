import { useState, useRef } from 'react';
import { Upload, MonitorPlay } from 'lucide-react';
import Dashboard from './components/Dashboard';

export default function App() {
  const [file, setFile] = useState<File | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleFileChange = (selectedFile: File) => {
    setFile(selectedFile);
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault();
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileChange(e.dataTransfer.files[0]);
    }
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  if (file) {
    return <Dashboard file={file} onClose={() => setFile(null)} />;
  }

  return (
    <div className="flex h-screen flex-col bg-canvas text-ink font-sans antialiased overflow-hidden">
      {/* AIRBNB STYLE TOP NAV (Landing) */}
      <header className="flex h-[80px] items-center justify-between border-b border-hairline px-6 lg:px-10 shrink-0">
        <div className="flex items-center gap-2">
          <MonitorPlay className="w-8 h-8 text-primary" />
          <span className="text-xl font-bold tracking-tight text-primary">MCAP Viewer</span>
        </div>

        <div className="flex items-center gap-4 text-sm font-medium">
          <button onClick={() => document.documentElement.classList.toggle('dark')} className="w-10 h-10 rounded-full border border-hairline flex items-center justify-center hover:shadow-airbnb transition-shadow bg-canvas text-ink group relative">
            <span className="absolute -bottom-8 bg-surface-strong px-2 py-1 rounded text-xs opacity-0 group-hover:opacity-100 transition-opacity">Theme</span>
            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" /></svg>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <main className="min-h-0 flex-1 overflow-y-auto">
          <div className="h-full p-4 sm:p-10 lg:px-20 flex flex-col items-center justify-center max-w-[1280px] mx-auto">
            <div className="mb-6 text-center">
              <h1 className="text-[32px] font-bold tracking-tight text-ink mb-2">Inspiration for future playbacks</h1>
              <p className="text-[16px] text-body max-w-xl mx-auto">
                Preview local MCAP sessions in the browser — video streams, IMU, lens undistortion.
                Supports <span className="font-semibold text-ink">.mcap</span> session files.
              </p>
            </div>

            <div className="w-full max-w-2xl bg-canvas border border-hairline p-6 shadow-airbnb rounded-xl">
              <div className="mb-4 flex items-baseline justify-between">
                <h2 className="text-[20px] font-medium tracking-tight text-ink">Open a session</h2>
              </div>

              <div
                onDrop={onDrop}
                onDragOver={onDragOver}
                className="group relative flex flex-col items-center justify-center gap-3 border border-dashed px-6 py-12 text-center transition-colors duration-150 border-hairline bg-surface-soft hover:bg-hairline-soft rounded-lg cursor-pointer"
                onClick={() => fileInputRef.current?.click()}
              >
                <input
                  type="file"
                  accept=".mcap,.enc"
                  className="hidden"
                  ref={fileInputRef}
                  onChange={(e) => {
                    if (e.target.files?.[0]) handleFileChange(e.target.files[0]);
                  }}
                />
                <Upload className="size-10 mb-1 transition-colors duration-150 text-ink" aria-hidden="true" />
                <div>
                  <p className="text-[16px] font-medium text-ink">Drag and drop a session</p>
                  <p className="mt-1 max-w-[42ch] text-[14px] text-ink mx-auto">
                    Drop a <span className="font-semibold text-ink">.mcap</span> file here, or click to browse. Files stay on your machine.
                  </p>
                </div>
                <button
                  type="button"
                  className="mt-4 inline-flex items-center justify-center px-[20px] py-[10px] h-[40px] bg-primary text-white font-medium rounded-sm hover:bg-primary-active transition-colors text-[14px]"
                >
                  Choose a file
                </button>
              </div>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}
