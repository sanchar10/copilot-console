import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { AskUserRequest } from '../../api/sessions';
import { respondToUserInput } from '../../api/sessions';
import { useChatStore } from '../../stores/chatStore';

interface AskUserCardProps {
  sessionId: string;
  data: AskUserRequest;
}

export function AskUserCard({ sessionId, data }: AskUserCardProps) {
  const { clearAskUser } = useChatStore();
  const [selected, setSelected] = useState<string | null>(null);
  const [freeformText, setFreeformText] = useState('');
  const [useFreeform, setUseFreeform] = useState(!data.choices || data.choices.length === 0);
  const [submitting, setSubmitting] = useState(false);

  const answer = useFreeform ? freeformText : (selected || '');
  const canSubmit = answer.trim().length > 0;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    try {
      await respondToUserInput(sessionId, data.request_id, answer, useFreeform);
      clearAskUser(sessionId);
    } catch (err) {
      console.error('Failed to respond to ask_user:', err);
    } finally {
      setSubmitting(false);
    }
  }, [sessionId, data.request_id, answer, useFreeform, canSubmit, clearAskUser]);

  const handleSkip = useCallback(async () => {
    setSubmitting(true);
    try {
      await respondToUserInput(sessionId, data.request_id, '', true, true);
      clearAskUser(sessionId);
    } catch (err) {
      console.error('Failed to skip ask_user:', err);
    } finally {
      setSubmitting(false);
    }
  }, [sessionId, data.request_id, clearAskUser]);

  return (
    <div className="my-2 border-l-3 border-amber-500 bg-amber-50/50 dark:bg-amber-900/10 rounded-r-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">💬</span>
        <span className="text-xs font-semibold text-amber-700 dark:text-amber-400">Agent is asking</span>
      </div>

      <div className="text-sm text-gray-700 dark:text-gray-300 mb-3 prose prose-sm max-w-none dark:prose-invert">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.question}</ReactMarkdown>
      </div>

      {/* Choice buttons */}
      {data.choices && data.choices.length > 0 && (
        <div className="space-y-1.5 mb-3">
          {data.choices.map((choice) => (
            <button
              key={choice}
              type="button"
              onClick={() => { setSelected(choice); setUseFreeform(false); }}
              className={`w-full text-left px-3 py-1.5 text-sm rounded-md border transition-colors ${
                selected === choice && !useFreeform
                  ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-300'
                  : 'border-gray-200 dark:border-[#3a3a4e] text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#32324a]'
              }`}
            >
              {selected === choice && !useFreeform ? '◉' : '○'} {choice}
            </button>
          ))}
          {/* Other / freeform option */}
          {data.allowFreeform && (
            <button
              type="button"
              onClick={() => setUseFreeform(true)}
              className={`w-full text-left px-3 py-1.5 text-sm rounded-md border transition-colors ${
                useFreeform
                  ? 'bg-amber-100 dark:bg-amber-900/40 border-amber-300 dark:border-amber-600 text-amber-700 dark:text-amber-300'
                  : 'border-gray-200 dark:border-[#3a3a4e] text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-[#32324a]'
              }`}
            >
              {useFreeform ? '◉' : '○'} Other (type your answer)
            </button>
          )}
        </div>
      )}

      {/* Freeform text input */}
      {(useFreeform || (!data.choices || data.choices.length === 0)) && (
        <div className="mb-3">
          <input
            type="text"
            value={freeformText}
            onChange={e => setFreeformText(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && canSubmit) handleSubmit(); }}
            placeholder="Type your answer..."
            autoFocus
            className="w-full px-3 py-1.5 text-sm rounded-md border border-gray-200 dark:border-[#3a3a4e] bg-white dark:bg-[#1e1e2e] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-amber-500/40"
          />
        </div>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={handleSkip}
          disabled={submitting}
          className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors disabled:opacity-50"
        >
          Skip
        </button>
        <button
          type="button"
          onClick={handleSubmit}
          disabled={submitting || !canSubmit}
          className="px-3 py-1.5 text-xs rounded-md bg-amber-600 text-white hover:bg-amber-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {submitting ? 'Sending...' : 'Submit ✓'}
        </button>
      </div>
    </div>
  );
}
