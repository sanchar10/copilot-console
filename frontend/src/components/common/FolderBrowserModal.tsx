import { useState, useEffect, useCallback, useRef } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { browseDirectory, type FolderEntry } from '../../api/filesystem';
import { useProjectStore } from '../../stores/projectStore';
import { deleteProject as apiDeleteProject } from '../../api/projects';

interface FolderBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  showProjectName?: boolean;
}

export function FolderBrowserModal({ isOpen, onClose, onSelect, initialPath, showProjectName = true }: FolderBrowserModalProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [pathInput, setPathInput] = useState('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FolderEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const pathInputRef = useRef<HTMLInputElement>(null);
  const getProjectName = useProjectStore(s => s.getProjectName);
  const setProject = useProjectStore(s => s.setProject);
  const removeProject = useProjectStore(s => s.removeProject);

  const loadDirectory = useCallback(async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await browseDirectory(path);
      setCurrentPath(result.current_path);
      setPathInput(result.current_path);
      setParentPath(result.parent_path);
      setEntries(result.entries);
      if (showProjectName && result.current_path) {
        setProjectName(getProjectName(result.current_path));
      }
      // Focus path input so Enter works immediately after navigation
      setTimeout(() => pathInputRef.current?.focus(), 0);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to browse directory';
      setError(message);
    } finally {
      setLoading(false);
    }
  }, [showProjectName, getProjectName]);

  // Load initial directory when modal opens
  useEffect(() => {
    if (isOpen) {
      loadDirectory(initialPath || undefined);
    }
  }, [isOpen, initialPath, loadDirectory]);

  const handleNavigate = (path: string) => {
    loadDirectory(path);
  };

  const handleGoUp = () => {
    if (parentPath !== null) {
      loadDirectory(parentPath || undefined);
    }
  };

  const handleSelect = () => {
    if (currentPath) {
      if (showProjectName) {
        const defaultName = currentPath.replace(/\\/g, '/').replace(/\/+$/, '').split('/').pop() || '';
        if (!projectName.trim() || projectName.trim() === defaultName) {
          // Cleared or matches default — remove override, fall back to folder name
          removeProject(currentPath);
          apiDeleteProject(currentPath).catch(() => {});
        } else {
          setProject(currentPath, projectName.trim());
        }
      }
      onSelect(currentPath);
      onClose();
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Browse Folders"
      footer={
        <>
          <Button variant="secondary" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button size="sm" onClick={handleSelect} disabled={!currentPath}>
            Select
          </Button>
        </>
      }
    >
      <div className="space-y-3" onKeyDown={(e) => {
        if (e.key === 'Enter' && currentPath) {
          const tag = (e.target as HTMLElement).tagName;
          // Don't intercept Enter on input fields — they handle it themselves
          if (tag !== 'INPUT') {
            e.preventDefault();
            handleSelect();
          }
        }
      }}>
        {/* Editable path bar */}
        <div className="relative">
          <input
            ref={pathInputRef}
            type="text"
            value={pathInput}
            onChange={(e) => { setPathInput(e.target.value); if (error) setError(null); }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && pathInput.trim()) {
                if (pathInput.trim() === currentPath) {
                  handleSelect();
                } else {
                  loadDirectory(pathInput.trim());
                }
              }
            }}
            placeholder={error || "Type or paste a path, then press Enter"}
            title={error || undefined}
            className={`w-full pl-3 pr-9 py-2 text-xs font-mono rounded-lg border bg-white dark:bg-[#2a2a3c] focus:outline-none focus:ring-2 ${
              error
                ? 'border-red-400 dark:border-red-600 text-red-700 dark:text-red-400 placeholder-red-400 focus:ring-red-500/40'
                : 'border-gray-200 dark:border-[#3a3a4e] text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:ring-blue-500/40'
            }`}
          />
          <button
            onClick={() => loadDirectory()}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded hover:bg-blue-50 dark:hover:bg-blue-900/30 transition-colors"
            title="Go to drives / root"
          >
            <svg className="w-4 h-4 text-blue-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-4 0h4" />
            </svg>
          </button>
        </div>

        {/* Project name field — always rendered to prevent layout shift */}
        <div className={`flex items-center gap-2 px-1 ${showProjectName && currentPath ? 'visible' : 'invisible'}`}>
          <label className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0 whitespace-nowrap">Folder Name</label>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSelect(); }}
            placeholder="Project name"
            maxLength={30}
            className="flex-1 min-w-0 px-2 py-1 text-xs rounded-md border border-gray-200 dark:border-[#3a3a4e] bg-white dark:bg-[#2a2a3c] text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
            tabIndex={showProjectName && currentPath ? 0 : -1}
          />
        </div>

        {/* Directory listing */}
        <div className="border border-white/40 dark:border-[#3a3a4e] rounded-lg overflow-hidden h-72 overflow-y-auto">
          {/* Go up button */}
          {parentPath !== null && (
            <button
              onClick={handleGoUp}
              className="w-full flex items-center gap-2 px-3 py-2 text-sm hover:bg-blue-50/60 dark:hover:bg-blue-900/30 text-blue-600 border-b border-white/40 dark:border-[#3a3a4e] transition-colors"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 11l5-5m0 0l5 5m-5-5v12" />
              </svg>
              ..
            </button>
          )}

          {/* Loading state */}
          {loading && (
            <div className="flex items-center justify-center py-8 text-gray-400">
              <svg className="w-5 h-5 animate-spin mr-2" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              Loading...
            </div>
          )}

          {/* Entries */}
          {!loading && entries.length === 0 && !error && (
            <div className="py-8 text-center text-gray-400 text-sm">
              No subdirectories found
            </div>
          )}

          {!loading && entries.map((entry) => (
            <button
              key={entry.path}
              onClick={() => handleNavigate(entry.path)}
              disabled={entry.accessible === false}
              className={`w-full flex items-center gap-2 px-3 py-2 text-sm text-left transition-colors ${
                entry.accessible === false
                  ? 'text-gray-400 cursor-not-allowed bg-white/30 dark:bg-[#252536]/30'
                  : 'text-gray-700 dark:text-gray-200 hover:bg-blue-50/60 dark:hover:bg-blue-900/30 hover:text-blue-700 dark:hover:text-blue-400'
              }`}
              title={entry.accessible === false ? 'Permission denied' : entry.path}
            >
              {/* Icon */}
              {entry.is_drive ? (
                <svg className="w-4 h-4 text-blue-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 7v10c0 2.21 3.582 4 8 4s8-1.79 8-4V7M4 7c0 2.21 3.582 4 8 4s8-1.79 8-4M4 7c0-2.21 3.582-4 8-4s8 1.79 8 4" />
                </svg>
              ) : (
                <svg className={`w-4 h-4 flex-shrink-0 ${entry.accessible === false ? 'text-gray-300' : 'text-yellow-500'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
                </svg>
              )}

              {/* Name */}
              <span className="truncate">{entry.name}</span>

              {/* Lock icon for inaccessible */}
              {entry.accessible === false && (
                <svg className="w-3 h-3 text-gray-400 ml-auto flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                </svg>
              )}
            </button>
          ))}
        </div>
      </div>
    </Modal>
  );
}
