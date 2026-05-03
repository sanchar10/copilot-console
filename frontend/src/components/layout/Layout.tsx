import { useState, useEffect, type ReactNode } from 'react';
import { Sidebar } from './Sidebar';
import { BannerHost } from './BannerHost';
import { apiClient } from '../../api/client';
import { useBanner } from '../../hooks/useBanner';

interface UpdateInfo {
  update_available: boolean;
  current_version: string;
  latest_version?: string;
  wheel_url?: string;
  release_url?: string;
}

const INSTALL_CMD = 'irm https://raw.githubusercontent.com/sanchar10/copilot-console/main/scripts/install.ps1 | iex';

function UpdateBannerContent({ info }: { info: UpdateInfo }) {
  return (
    <div className="flex items-center gap-2 flex-wrap">
      <span>🎉</span>
      <span>
        Version <strong>{info.latest_version}</strong> is available (current: {info.current_version}).{' '}
        Run: <code className="bg-blue-700 dark:bg-blue-800 px-1.5 py-0.5 rounded text-xs font-mono">{INSTALL_CMD}</code>
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
  );
}

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    apiClient.get<UpdateInfo>('/settings/update-check')
      .then(info => {
        if (info.update_available) setUpdateInfo(info);
      })
      .catch(() => {});
  }, []);

  useBanner(
    updateInfo
      ? {
          id: `update-${updateInfo.latest_version ?? 'available'}`,
          severity: 'info',
          content: <UpdateBannerContent info={updateInfo} />,
        }
      : null,
  );

  return (
    <div className="flex flex-col h-screen bg-[#fafafa] dark:bg-[#1e1e2e]">
      <BannerHost />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 flex flex-col overflow-hidden">
          {children}
        </main>
      </div>
    </div>
  );
}
