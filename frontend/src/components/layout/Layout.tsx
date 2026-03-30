import { useState, useEffect, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { apiClient } from '../../api/client';

interface UpdateInfo {
  update_available: boolean;
  current_version: string;
  latest_version?: string;
  wheel_url?: string;
  release_url?: string;
}

const INSTALL_CMD = 'irm https://raw.githubusercontent.com/sanchar10/copilot-agent-console/main/scripts/install.ps1 | iex';

function UpdateBanner({ info, onDismiss }: { info: UpdateInfo; onDismiss: () => void }) {
  return (
    <div className="bg-blue-600 dark:bg-blue-700 text-white px-4 py-2 text-sm flex items-center justify-between">
      <div className="flex items-center gap-2">
        <span>🎉</span>
        <span>
          Version <strong>{info.latest_version}</strong> is available (current: {info.current_version}).
          {' '}Run: <code className="bg-blue-700 dark:bg-blue-800 px-1.5 py-0.5 rounded text-xs font-mono">{INSTALL_CMD}</code>
        </span>
        {info.release_url && (
          <a
            href={info.release_url}
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-blue-200"
          >
            Release notes
          </a>
        )}
      </div>
      <button onClick={onDismiss} className="text-blue-200 hover:text-white ml-4" title="Dismiss">✕</button>
    </div>
  );
}

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    apiClient.get<UpdateInfo>('/settings/update-check')
      .then(info => {
        if (info.update_available) setUpdateInfo(info);
      })
      .catch(() => {});
  }, []);

  return (
    <div className="flex flex-col h-screen bg-[#fafafa] dark:bg-[#1e1e2e]">
      {updateInfo && !dismissed && (
        <UpdateBanner info={updateInfo} onDismiss={() => setDismissed(true)} />
      )}
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
