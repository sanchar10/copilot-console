import { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ElicitationRequest } from '../../api/sessions';
import { respondToElicitation } from '../../api/sessions';
import { useChatStore, type ResolvedElicitation } from '../../stores/chatStore';
import { Dropdown } from '../common/Dropdown';

interface SchemaProperty {
  type: string;
  title?: string;
  description?: string;
  default?: unknown;
  enum?: string[];
  enumNames?: string[];
  oneOf?: { const: string; title: string }[];
  items?: { enum?: string[]; anyOf?: { const: string; title: string }[] };
  format?: string;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  minItems?: number;
  maxItems?: number;
}

interface ElicitationCardProps {
  sessionId: string;
  data: ElicitationRequest;
}

interface ResolvedCardProps {
  resolved: ResolvedElicitation;
  schema?: Record<string, unknown>;
}

function getFieldLabel(key: string, prop: SchemaProperty): string {
  return prop.title || key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
}

function FormField({ fieldKey, prop, value, onChange, required }: {
  fieldKey: string;
  prop: SchemaProperty;
  value: unknown;
  onChange: (val: unknown) => void;
  required: boolean;
}) {
  const label = getFieldLabel(fieldKey, prop);
  const baseInputClass = "w-full px-3 py-1.5 text-sm rounded-md border border-gray-200 dark:border-[#3a3a4e] bg-white dark:bg-[#1e1e2e] text-gray-900 dark:text-gray-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40";

  // String with enum → dropdown
  if (prop.type === 'string' && prop.enum) {
    const names = prop.enumNames || prop.enum;
    const dropdownOptions = prop.enum!.map((v, i) => ({ value: v, label: names[i] || v }));
    return (
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          {label}{required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        {prop.description && <p className="text-xs text-gray-500 dark:text-gray-500 mb-1">{prop.description}</p>}
        <Dropdown
          options={[{ value: '', label: 'Select...' }, ...dropdownOptions]}
          value={(value as string) || ''}
          onChange={v => onChange(v)}
        />
      </div>
    );
  }

  // String with oneOf → radio buttons
  if (prop.type === 'string' && prop.oneOf) {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          {label}{required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        {prop.description && <p className="text-xs text-gray-500 dark:text-gray-500 mb-1">{prop.description}</p>}
        <div className="flex flex-wrap gap-2">
          {prop.oneOf.map(opt => (
            <button
              key={opt.const}
              type="button"
              onClick={() => onChange(opt.const)}
              className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                value === opt.const
                  ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300'
                  : 'border-gray-200 dark:border-[#3a3a4e] text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#32324a]'
              }`}
            >
              {opt.title}
            </button>
          ))}
        </div>
      </div>
    );
  }

  // Boolean → toggle
  if (prop.type === 'boolean') {
    return (
      <div className="flex items-center justify-between">
        <div>
          <label className="text-xs font-medium text-gray-600 dark:text-gray-400">
            {label}{required && <span className="text-red-400 ml-0.5">*</span>}
          </label>
          {prop.description && <p className="text-xs text-gray-500 dark:text-gray-500 mt-0.5">{prop.description}</p>}
        </div>
        <button
          type="button"
          role="switch"
          aria-checked={!!value}
          onClick={() => onChange(!value)}
          className={`relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${
            value ? 'bg-blue-600' : 'bg-gray-300 dark:bg-gray-600'
          }`}
        >
          <span className={`pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow transition ${
            value ? 'translate-x-4' : 'translate-x-0'
          }`} />
        </button>
      </div>
    );
  }

  // Number / integer
  if (prop.type === 'number' || prop.type === 'integer') {
    return (
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          {label}{required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        {prop.description && <p className="text-xs text-gray-500 dark:text-gray-500 mb-1">{prop.description}</p>}
        <input
          type="number"
          value={value !== undefined && value !== null ? value : ''}
          onChange={e => {
            const v = e.target.value;
            if (v === '') { onChange(undefined); return; }
            onChange(prop.type === 'integer' ? parseInt(v) : parseFloat(v));
          }}
          min={prop.minimum}
          max={prop.maximum}
          step={prop.type === 'integer' ? 1 : undefined}
          className={`${baseInputClass} [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none`}
        />
      </div>
    );
  }

  // Array with items.enum or items.anyOf → multi-select checkboxes
  if (prop.type === 'array' && prop.items) {
    const options = prop.items.anyOf
      ? prop.items.anyOf.map(o => ({ value: o.const, label: o.title }))
      : (prop.items.enum || []).map(v => ({ value: v, label: v }));
    const selected = (value as string[]) || [];

    return (
      <div>
        <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
          {label}{required && <span className="text-red-400 ml-0.5">*</span>}
        </label>
        {prop.description && <p className="text-xs text-gray-500 dark:text-gray-500 mb-1">{prop.description}</p>}
        <div className="flex flex-wrap gap-1.5">
          {options.map(opt => {
            const checked = selected.includes(opt.value);
            return (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  const next = checked
                    ? selected.filter(v => v !== opt.value)
                    : [...selected, opt.value];
                  onChange(next);
                }}
                className={`px-2 py-1 text-xs rounded border transition-colors ${
                  checked
                    ? 'bg-blue-100 dark:bg-blue-900/40 border-blue-300 dark:border-blue-600 text-blue-700 dark:text-blue-300'
                    : 'border-gray-200 dark:border-[#3a3a4e] text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#32324a]'
                }`}
              >
                {checked ? '☑' : '☐'} {opt.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  // Default: string text input
  return (
    <div>
      <label className="block text-xs font-medium text-gray-600 dark:text-gray-400 mb-1">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {prop.description && <p className="text-xs text-gray-500 dark:text-gray-500 mb-1">{prop.description}</p>}
      <input
        type={prop.format === 'email' ? 'email' : prop.format === 'uri' ? 'url' : prop.format === 'date' ? 'date' : 'text'}
        value={(value as string) || ''}
        onChange={e => onChange(e.target.value)}
        minLength={prop.minLength}
        maxLength={prop.maxLength}
        className={baseInputClass}
        placeholder={prop.description || `Enter ${label.toLowerCase()}...`}
      />
    </div>
  );
}

export function ElicitationCard({ sessionId, data }: ElicitationCardProps) {
  const { resolveElicitation } = useChatStore();
  const properties = (data.schema?.properties || {}) as Record<string, SchemaProperty>;
  const requiredFields = (data.schema?.required || []) as string[];

  // Initialize form values from defaults
  const [values, setValues] = useState<Record<string, unknown>>(() => {
    const initial: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(properties)) {
      if (prop.default !== undefined) {
        initial[key] = prop.default;
      } else if (prop.type === 'boolean') {
        initial[key] = false;
      } else if (prop.type === 'array') {
        initial[key] = [];
      }
    }
    return initial;
  });
  const [submitting, setSubmitting] = useState(false);

  const handleFieldChange = useCallback((key: string, val: unknown) => {
    setValues(prev => ({ ...prev, [key]: val }));
  }, []);

  const handleAction = useCallback(async (action: 'accept' | 'decline' | 'cancel') => {
    setSubmitting(true);
    try {
      await respondToElicitation(
        sessionId,
        data.request_id,
        action,
        action === 'accept' ? values : undefined,
      );
      resolveElicitation(sessionId, action, action === 'accept' ? values : undefined);
    } catch (err) {
      console.error('Failed to respond to elicitation:', err);
    } finally {
      setSubmitting(false);
    }
  }, [sessionId, data.request_id, values, resolveElicitation]);

  const fieldEntries = Object.entries(properties);

  // Check if all required fields have values
  const hasRequiredValues = requiredFields.every(key => {
    const val = values[key];
    if (val === undefined || val === null || val === '') return false;
    if (Array.isArray(val) && val.length === 0) return false;
    return true;
  });

  return (
    <div className="my-2 ml-11 border-l-3 border-blue-500 bg-blue-100/80 dark:bg-blue-950/70 rounded-r-lg p-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-sm">📋</span>
        <span className="text-xs font-semibold text-blue-700 dark:text-blue-400">Agent needs your input</span>
        {data.source && (
          <span className="text-xs text-gray-500 dark:text-gray-500">from {data.source}</span>
        )}
      </div>

      {data.message && (
        <div className="text-sm text-gray-700 dark:text-gray-300 mb-3 prose prose-sm max-w-none dark:prose-invert">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>{data.message}</ReactMarkdown>
        </div>
      )}

      {fieldEntries.length > 0 ? (
        <div className="space-y-3 mb-3">
          {fieldEntries.map(([key, prop]) => (
            <FormField
              key={key}
              fieldKey={key}
              prop={prop}
              value={values[key]}
              onChange={val => handleFieldChange(key, val)}
              required={requiredFields.includes(key)}
            />
          ))}
        </div>
      ) : (
        <p className="text-xs text-gray-500 dark:text-gray-500 mb-3 italic">No form fields — respond with Accept or Decline</p>
      )}

      <div className="flex justify-end gap-2">
        <button
          type="button"
          onClick={() => handleAction('cancel')}
          disabled={submitting}
          className="px-3 py-1.5 text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-300 transition-colors disabled:opacity-50"
        >
          Cancel
        </button>
        <button
          type="button"
          onClick={() => handleAction('decline')}
          disabled={submitting}
          className="px-3 py-1.5 text-xs rounded-md border border-gray-200 dark:border-[#3a3a4e] text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-[#32324a] transition-colors disabled:opacity-50"
        >
          Decline
        </button>
        <button
          type="button"
          onClick={() => handleAction('accept')}
          disabled={submitting || !hasRequiredValues}
          className="px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title={!hasRequiredValues ? 'Fill in all required fields' : undefined}
        >
          {submitting ? 'Sending...' : 'Accept ✓'}
        </button>
      </div>
    </div>
  );
}

export function ResolvedElicitationCard({ resolved, schema }: ResolvedCardProps) {
  const properties = (schema as Record<string, unknown>)?.properties as Record<string, SchemaProperty> | undefined;

  const formatValue = (_key: string, val: unknown): string => {
    if (Array.isArray(val)) return val.join(', ');
    if (typeof val === 'boolean') return val ? 'Yes' : 'No';
    if (val === null || val === undefined) return '—';
    return String(val);
  };

  const getLabel = (key: string): string => {
    const prop = properties?.[key];
    return prop?.title || key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
  };

  if (resolved.action !== 'accept') {
    return (
      <div className="my-2 ml-11 border-l-3 border-gray-400 dark:border-gray-600 bg-gray-100/80 dark:bg-gray-800/50 rounded-r-lg px-3 py-2">
        <span className="text-xs text-gray-500 dark:text-gray-400">
          {resolved.action === 'decline' ? '↩ Declined' : '✕ Cancelled'}
          {resolved.message && ` — "${resolved.message}"`}
        </span>
      </div>
    );
  }

  return (
    <div className="my-2 ml-11 border-l-3 border-emerald-500 bg-emerald-100/80 dark:bg-emerald-950/70 rounded-r-lg px-3 py-2">
      <div className="flex items-center gap-1.5 mb-1">
        <span className="text-xs font-medium text-emerald-700 dark:text-emerald-400">✓ You responded</span>
      </div>
      {resolved.values && Object.keys(resolved.values).length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {/* Render in schema property order if available, else value order */}
          {(properties ? Object.keys(properties) : Object.keys(resolved.values))
            .filter(key => resolved.values![key] !== undefined && resolved.values![key] !== '' && !(Array.isArray(resolved.values![key]) && (resolved.values![key] as unknown[]).length === 0))
            .map(key => (
            <span key={key} className="inline-flex items-center gap-1 px-2 py-0.5 text-xs rounded-full bg-emerald-100 dark:bg-emerald-900/30 text-emerald-700 dark:text-emerald-400">
              <span className="font-medium">{getLabel(key)}:</span> {formatValue(key, resolved.values![key])}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
