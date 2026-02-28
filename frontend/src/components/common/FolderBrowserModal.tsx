import { useState, useEffect, useCallback } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import { browseDirectory, type FolderEntry } from '../../api/filesystem';
import { useProjectStore } from '../../stores/projectStore';

interface FolderBrowserModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelect: (path: string) => void;
  initialPath?: string;
  showProjectName?: boolean;
}

export function FolderBrowserModal({ isOpen, onClose, onSelect, initialPath, showProjectName = true }: FolderBrowserModalProps) {
  const [currentPath, setCurrentPath] = useState('');
  const [parentPath, setParentPath] = useState<string | null>(null);
  const [entries, setEntries] = useState<FolderEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectName, setProjectName] = useState('');
  const getProjectName = useProjectStore(s => s.getProjectName);
  const setProject = useProjectStore(s => s.setProject);

  const loadDirectory = useCallback(async (path?: string) => {
    setLoading(true);
    setError(null);
    try {
      const result = await browseDirectory(path);
      setCurrentPath(result.current_path);
      setParentPath(result.parent_path);
      setEntries(result.entries);
      if (showProjectName && result.current_path) {
        setProjectName(getProjectName(result.current_path));
      }
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
      if (showProjectName && projectName) {
        setProject(currentPath, projectName);
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
      <div className="space-y-3">
        {/* Current path bar - click anywhere to go to drives/root */}
        <button
          onClick={() => loadDirectory()}
          className="w-full flex items-center gap-1.5 px-3 py-2 bg-white/50 dark:bg-[#1e1e2e]/50 backdrop-blur rounded-lg text-sm hover:bg-blue-50/60 dark:hover:bg-blue-900/30 transition-colors text-left"
          title="Go to drives / root"
        >
          <svg className="w-4 h-4 text-blue-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
          {currentPath ? (
            <span className="text-gray-700 dark:text-gray-200 font-mono text-xs truncate" title={currentPath}>
              {currentPath}
            </span>
          ) : (
            <span className="text-gray-500 text-xs">My Computer</span>
          )}
        </button>

        {/* Project name field */}
        {showProjectName && currentPath && (
          <div className="flex items-center gap-2 px-1">
            <label className="text-xs text-gray-500 dark:text-gray-400 flex-shrink-0">Project</label>
            <input
              type="text"
              value={projectName}
              onChange={(e) => setProjectName(e.target.value)}
              placeholder="Project name"
              className="flex-1 px-2 py-1 text-xs rounded-md border border-gray-200 dark:border-[#3a3a4e] bg-white dark:bg-[#2a2a3c] text-gray-900 dark:text-gray-100 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500/40"
            />
          </div>
        )}

        {/* Error display */}
        {error && (
          <div className="px-3 py-2 bg-red-50 dark:bg-red-900/30 text-red-700 dark:text-red-400 text-sm rounded-lg flex items-center gap-2">
            <svg className="w-4 h-4 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            {error}
          </div>
        )}

        {/* Directory listing */}
        <div className="border border-white/40 dark:border-[#3a3a4e] rounded-lg overflow-hidden max-h-72 overflow-y-auto">
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
