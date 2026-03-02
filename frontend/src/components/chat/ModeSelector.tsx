import { useCallback } from 'react';

export type AgentMode = 'interactive' | 'plan' | 'autopilot';

const MODES: { value: AgentMode; label: string; icon: string }[] = [
  { value: 'interactive', label: 'Interactive', icon: '💬' },
  { value: 'plan', label: 'Plan', icon: '📋' },
  { value: 'autopilot', label: 'Autopilot', icon: '🚀' },
];

interface ModeSelectorProps {
  mode: AgentMode;
  onModeChange: (mode: AgentMode) => void;
  disabled?: boolean;
}

export function ModeSelector({ mode, onModeChange, disabled }: ModeSelectorProps) {
  const handleClick = useCallback(
    (newMode: AgentMode) => {
      if (newMode !== mode && !disabled) {
        onModeChange(newMode);
      }
    },
    [mode, onModeChange, disabled]
  );

  return (
    <div className="flex items-center gap-1 mt-2">
      <span className="text-xs text-gray-400 dark:text-gray-500 mr-1">Mode</span>
      <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-[#2a2a3c] p-0.5">
        {MODES.map((m) => {
          const isActive = m.value === mode;
          return (
            <button
              key={m.value}
              onClick={() => handleClick(m.value)}
              disabled={disabled}
              className={`px-2.5 py-1 text-xs font-medium rounded-md border border-transparent transition-colors ${
                isActive
                  ? 'bg-blue-100 text-blue-800 border-blue-200 dark:bg-blue-500/25 dark:text-blue-100 dark:border-blue-400/30'
                  : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-[#33334a]'
              } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
              title={m.label}
            >
              <span className="mr-1">{m.icon}</span>
              {m.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
