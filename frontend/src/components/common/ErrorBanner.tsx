import { useSessionStore } from '../../stores/sessionStore';
import { useAgentStore } from '../../stores/agentStore';
import { useWorkflowStore } from '../../stores/workflowStore';
import { useAutomationStore } from '../../stores/automationStore';

interface StoreError {
  source: string;
  message: string;
  clear: () => void;
}

export function ErrorBanner() {
  const sessionError = useSessionStore((s) => s.error);
  const sessionClearError = useSessionStore((s) => s.clearError);
  const agentError = useAgentStore((s) => s.error);
  const agentClearError = useAgentStore((s) => s.clearError);
  const workflowError = useWorkflowStore((s) => s.error);
  const workflowClearError = useWorkflowStore((s) => s.clearError);
  const automationError = useAutomationStore((s) => s.error);
  const automationClearError = useAutomationStore((s) => s.clearError);

  const errors: StoreError[] = [];
  if (sessionError) errors.push({ source: 'Sessions', message: sessionError, clear: sessionClearError });
  if (agentError) errors.push({ source: 'Agents', message: agentError, clear: agentClearError });
  if (workflowError) errors.push({ source: 'Workflows', message: workflowError, clear: workflowClearError });
  if (automationError) errors.push({ source: 'Automations', message: automationError, clear: automationClearError });

  if (errors.length === 0) return null;

  return (
    <div className="flex flex-col gap-1" role="alert">
      {errors.map((err) => (
        <div
          key={err.source}
          className="flex items-center justify-between gap-2 px-4 py-2 bg-red-50 dark:bg-red-900/30 border-b border-red-200 dark:border-red-800 text-sm text-red-700 dark:text-red-300"
        >
          <span>
            <strong>{err.source}:</strong> {err.message}
          </span>
          <button
            onClick={err.clear}
            className="flex-shrink-0 p-0.5 rounded hover:bg-red-100 dark:hover:bg-red-800/50 transition-colors"
            aria-label={`Dismiss ${err.source} error`}
            title="Dismiss"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      ))}
    </div>
  );
}
