/**
 * Mobile Elicitation card — simplified JSON schema form for MCP elicitation.
 * Renders form fields based on JSON Schema and submits response.
 */

import { useState } from 'react';
import { mobileApiClient } from '../mobileClient';

interface MobileElicitationCardProps {
  sessionId: string;
  requestId: string;
  message: string;
  schema: Record<string, unknown>;
  onResolved: () => void;
}

export function MobileElicitationCard({
  sessionId,
  requestId,
  message,
  schema,
  onResolved,
}: MobileElicitationCardProps) {
  const [values, setValues] = useState<Record<string, unknown>>({});
  const [submitting, setSubmitting] = useState(false);

  const properties = (schema.properties || {}) as Record<string, Record<string, unknown>>;
  const required = (schema.required || []) as string[];

  const handleChange = (key: string, value: unknown) => {
    setValues((prev) => ({ ...prev, [key]: value }));
  };

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      await mobileApiClient.post(`/sessions/${sessionId}/elicitation-response`, {
        request_id: requestId, action: 'accept', content: values,
      });
      onResolved();
    } catch {
      onResolved();
    }
  };

  const handleCancel = async () => {
    setSubmitting(true);
    try {
      await mobileApiClient.post(`/sessions/${sessionId}/elicitation-response`, {
        request_id: requestId, action: 'cancel',
      });
    } catch { /* ignore */ }
    onResolved();
  };

  // Check if all required fields are filled
  const isValid = required.every((key) => {
    const val = values[key];
    return val !== undefined && val !== '' && val !== null;
  });

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] bg-blue-50 dark:bg-blue-900/20 rounded-2xl rounded-bl-md px-4 py-3 shadow-sm border border-blue-200 dark:border-blue-700/40">
        <div className="text-sm font-medium text-blue-800 dark:text-blue-300 mb-2">
          📋 {message}
        </div>

        <div className="space-y-2 mb-3">
          {Object.entries(properties).map(([key, prop]) => {
            const type = prop.type as string;
            const title = (prop.title as string) || key;
            const isRequired = required.includes(key);
            const enumValues = prop.enum as string[] | undefined;

            if (enumValues) {
              return (
                <div key={key}>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                    {title}{isRequired && ' *'}
                  </label>
                  <select
                    value={(values[key] as string) || ''}
                    onChange={(e) => handleChange(key, e.target.value)}
                    disabled={submitting}
                    className="w-full mt-0.5 text-sm rounded-lg border border-blue-200 dark:border-blue-700/40 bg-white dark:bg-[#2a2a3c] px-2 py-1.5 text-gray-800 dark:text-gray-200"
                  >
                    <option value="">Select...</option>
                    {enumValues.map((v) => (
                      <option key={v} value={v}>{v}</option>
                    ))}
                  </select>
                </div>
              );
            }

            if (type === 'boolean') {
              return (
                <label key={key} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={!!values[key]}
                    onChange={(e) => handleChange(key, e.target.checked)}
                    disabled={submitting}
                    className="text-blue-600"
                  />
                  <span className="text-gray-800 dark:text-gray-200">{title}</span>
                </label>
              );
            }

            if (type === 'number' || type === 'integer') {
              return (
                <div key={key}>
                  <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                    {title}{isRequired && ' *'}
                  </label>
                  <input
                    type="number"
                    value={(values[key] as number) ?? ''}
                    onChange={(e) => handleChange(key, e.target.value ? Number(e.target.value) : '')}
                    disabled={submitting}
                    className="w-full mt-0.5 text-sm rounded-lg border border-blue-200 dark:border-blue-700/40 bg-white dark:bg-[#2a2a3c] px-2 py-1.5 text-gray-800 dark:text-gray-200"
                  />
                </div>
              );
            }

            // Default: string input
            return (
              <div key={key}>
                <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
                  {title}{isRequired && ' *'}
                </label>
                <input
                  type="text"
                  value={(values[key] as string) || ''}
                  onChange={(e) => handleChange(key, e.target.value)}
                  disabled={submitting}
                  className="w-full mt-0.5 text-sm rounded-lg border border-blue-200 dark:border-blue-700/40 bg-white dark:bg-[#2a2a3c] px-2 py-1.5 text-gray-800 dark:text-gray-200"
                />
              </div>
            );
          })}
        </div>

        <div className="flex gap-2">
          <button
            onClick={handleSubmit}
            disabled={!isValid || submitting}
            className="flex-1 px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg disabled:opacity-40"
          >
            {submitting ? 'Sending...' : 'Submit'}
          </button>
          <button
            onClick={handleCancel}
            disabled={submitting}
            className="px-3 py-1.5 text-xs font-medium text-gray-500 dark:text-gray-400 border border-gray-200 dark:border-gray-600 rounded-lg"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
