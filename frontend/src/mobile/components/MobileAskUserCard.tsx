/**
 * Mobile AskUser card — simplified version of desktop AskUserCard.
 * Shows question, radio choices (if any), freeform text, and submit/skip buttons.
 */

import { useState } from 'react';
import { respondToUserInput } from '../../api/sessions';

interface MobileAskUserCardProps {
  sessionId: string;
  requestId: string;
  question: string;
  choices?: string[] | null;
  allowFreeform: boolean;
  onResolved: () => void;
}

export function MobileAskUserCard({
  sessionId,
  requestId,
  question,
  choices,
  allowFreeform,
  onResolved,
}: MobileAskUserCardProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [freeform, setFreeform] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const hasChoices = choices && choices.length > 0;
  const useOther = selected === '__other__';

  const handleSubmit = async () => {
    const answer = useOther || !hasChoices ? freeform.trim() : (selected || '');
    if (!answer) return;
    setSubmitting(true);
    try {
      await respondToUserInput(sessionId, requestId, answer, useOther || !hasChoices);
      onResolved();
    } catch {
      // 404 = resolved elsewhere, dismiss gracefully
      onResolved();
    }
  };

  const handleSkip = async () => {
    setSubmitting(true);
    try {
      await respondToUserInput(sessionId, requestId, '', false, true);
    } catch { /* ignore */ }
    onResolved();
  };

  const canSubmit = hasChoices
    ? (useOther ? freeform.trim().length > 0 : !!selected)
    : freeform.trim().length > 0;

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] bg-emerald-50 dark:bg-emerald-900/20 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm border border-emerald-200 dark:border-emerald-700/40">
        <div className="text-sm font-medium text-emerald-800 dark:text-emerald-300 mb-2">
          💬 {question}
        </div>

        {hasChoices && (
          <div className="space-y-1.5 mb-2">
            {choices!.map((choice) => (
              <label key={choice} className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name={`ask-${requestId}`}
                  checked={selected === choice}
                  onChange={() => setSelected(choice)}
                  disabled={submitting}
                  className="text-emerald-600"
                />
                <span className="text-gray-800 dark:text-gray-200">{choice}</span>
              </label>
            ))}
            {allowFreeform && (
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="radio"
                  name={`ask-${requestId}`}
                  checked={useOther}
                  onChange={() => setSelected('__other__')}
                  disabled={submitting}
                  className="text-emerald-600"
                />
                <span className="text-gray-500 dark:text-gray-400 italic">Other...</span>
              </label>
            )}
          </div>
        )}

        {(useOther || !hasChoices) && (
          <textarea
            value={freeform}
            onChange={(e) => setFreeform(e.target.value)}
            placeholder="Type your answer..."
            disabled={submitting}
            rows={2}
            className="w-full text-sm rounded-lg border border-emerald-200 dark:border-emerald-700/40 bg-white dark:bg-[#2a2a3c] px-3 py-2 text-gray-800 dark:text-gray-200 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-emerald-500 resize-none mb-2"
          />
        )}

        <div className="flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || submitting}
            className="flex-1 px-3 py-1.5 text-xs font-medium bg-emerald-600 text-white rounded-lg disabled:opacity-40"
          >
            {submitting ? 'Sending...' : 'Submit'}
          </button>
          <button
            onClick={handleSkip}
            disabled={submitting}
            className="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600 rounded-lg"
          >
            Skip
          </button>
        </div>
      </div>
    </div>
  );
}
