import { useState, useEffect, useMemo } from 'react';
import { Modal } from '../common/Modal';
import { Button } from '../common/Button';
import {
  createMCPServer,
  updateMCPServer,
  MCPApiError,
  type MCPWritableScope,
} from '../../api/mcp';
import type { MCPServer } from '../../types/mcp';

export interface MCPServerEditorProps {
  isOpen: boolean;
  mode: 'add' | 'edit';
  /** When mode === 'edit', the server being edited (provides name, scope, prefilled config). */
  server?: MCPServer;
  /** Initial value for the auto-enable flag. Edit mode passes the persisted state. */
  initialAutoEnable?: boolean;
  onClose: () => void;
  /** Called after a successful create/update with the server returned from the API. */
  onSaved: (server: MCPServer, autoEnable: boolean) => void;
}

const NAME_PATTERN = /^[A-Za-z0-9_.\-]{1,64}$/;

/** Fields that belong to the MCP "inner config" — everything else on MCPServer
 *  (name, source) is derived. We round-trip these as JSON. */
const INNER_FIELDS: (keyof MCPServer)[] = [
  'type',
  'command',
  'args',
  'env',
  'cwd',
  'url',
  'headers',
  'timeout',
  'tools',
  'oauthClientId',
  'oauthPublicClient',
];

function extractInnerConfig(server: MCPServer): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of INNER_FIELDS) {
    const v = (server as unknown as Record<string, unknown>)[k as string];
    if (v !== undefined && v !== null) out[k as string] = v;
  }
  return out;
}

function defaultConfigPlaceholder(): string {
  return JSON.stringify(
    {
      command: 'npx',
      args: ['-y', '@example/mcp-server'],
    },
    null,
    2,
  );
}

/** Detect plugin scope (read-only) — only Global / Agent-only are writable. */
function isWritableScope(source: string): source is MCPWritableScope {
  return source === 'global' || source === 'agent-only';
}

export function MCPServerEditor({
  isOpen,
  mode,
  server,
  initialAutoEnable,
  onClose,
  onSaved,
}: MCPServerEditorProps) {
  const [name, setName] = useState('');
  const [scope, setScope] = useState<MCPWritableScope>('global');
  const [configText, setConfigText] = useState('');
  const [autoEnable, setAutoEnable] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reset form when the modal opens or the target server changes.
  useEffect(() => {
    if (!isOpen) return;
    if (mode === 'edit' && server) {
      setName(server.name);
      setScope(isWritableScope(server.source) ? server.source : 'global');
      setConfigText(JSON.stringify(extractInnerConfig(server), null, 2));
    } else {
      setName('');
      setScope('global');
      setConfigText(defaultConfigPlaceholder());
    }
    setAutoEnable(!!initialAutoEnable);
    setError(null);
    setSaving(false);
  }, [isOpen, mode, server, initialAutoEnable]);

  const nameError = useMemo(() => {
    if (mode === 'edit') return null; // name locked
    if (!name) return null; // don't nag before user types
    return NAME_PATTERN.test(name)
      ? null
      : 'Name must be 1–64 chars: letters, digits, underscore, dot, hyphen.';
  }, [mode, name]);

  const parsedConfig = useMemo<{ ok: true; value: Record<string, unknown> } | { ok: false; err: string }>(() => {
    if (!configText.trim()) return { ok: false, err: 'Config is required.' };
    try {
      const v = JSON.parse(configText);
      if (typeof v !== 'object' || v === null || Array.isArray(v)) {
        return { ok: false, err: 'Config must be a JSON object.' };
      }
      return { ok: true, value: v as Record<string, unknown> };
    } catch (e) {
      return { ok: false, err: `Invalid JSON: ${(e as Error).message}` };
    }
  }, [configText]);

  const canSave =
    !saving &&
    parsedConfig.ok &&
    (mode === 'edit' || (NAME_PATTERN.test(name) && !!name));

  const handleSave = async () => {
    if (!parsedConfig.ok) {
      setError(parsedConfig.err);
      return;
    }
    if (mode === 'add' && !NAME_PATTERN.test(name)) {
      setError('Invalid server name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const saved =
        mode === 'add'
          ? await createMCPServer({
              scope,
              name,
              config: parsedConfig.value,
              autoEnable,
            })
          : await updateMCPServer(server!.name, {
              config: parsedConfig.value,
              autoEnable,
            });
      onSaved(saved, autoEnable);
      onClose();
    } catch (err) {
      const detail = err instanceof MCPApiError ? err.detail : (err as Error)?.message;
      setError(detail || 'Failed to save MCP server');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={saving ? () => undefined : onClose}
      title={mode === 'add' ? 'Add MCP Server' : `Edit ${server?.name ?? 'MCP Server'}`}
      size="lg"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? 'Saving…' : 'Save'}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        {error && (
          <div
            role="alert"
            className="p-3 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-800 rounded-md"
          >
            <p className="text-sm text-red-700 dark:text-red-400">{error}</p>
          </div>
        )}

        {/* Scope */}
        <div>
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Scope
          </label>
          {mode === 'edit' ? (
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {scope === 'global'
                ? 'Global (~/.copilot/mcp-config.json)'
                : 'Agent-only (~/.copilot-console/mcp-config.json)'}{' '}
              <span className="text-xs italic">— scope cannot be changed; delete + add to move.</span>
            </p>
          ) : (
            <div className="flex gap-4">
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mcp-scope"
                  value="global"
                  checked={scope === 'global'}
                  onChange={() => setScope('global')}
                />
                <span className="text-sm">Global <span className="text-xs text-gray-500">(shared with Copilot CLI)</span></span>
              </label>
              <label className="inline-flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="mcp-scope"
                  value="agent-only"
                  checked={scope === 'agent-only'}
                  onChange={() => setScope('agent-only')}
                />
                <span className="text-sm">Agent-only <span className="text-xs text-gray-500">(this app only)</span></span>
              </label>
            </div>
          )}
        </div>

        {/* Name */}
        <div>
          <label htmlFor="mcp-name" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Name
          </label>
          <input
            id="mcp-name"
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            disabled={mode === 'edit' || saving}
            placeholder="my-server"
            className="w-full px-3 py-2 text-sm border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-[#1e1e2e] text-gray-900 dark:text-gray-100 disabled:opacity-60"
          />
          {nameError && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">{nameError}</p>
          )}
        </div>

        {/* Config JSON */}
        <div>
          <label htmlFor="mcp-config" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Config (JSON)
          </label>
          <textarea
            id="mcp-config"
            value={configText}
            onChange={e => setConfigText(e.target.value)}
            disabled={saving}
            rows={8}
            spellCheck={false}
            style={{ minHeight: '12rem', maxHeight: '30rem' }}
            className="w-full px-3 py-2 text-xs font-mono border border-gray-300 dark:border-gray-600 rounded-md bg-white dark:bg-[#1e1e2e] text-gray-900 dark:text-gray-100 disabled:opacity-60 resize-y"
          />
          {!parsedConfig.ok && configText.trim() !== '' && (
            <p className="text-xs text-red-600 dark:text-red-400 mt-1">{parsedConfig.err}</p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Inner MCP server config. Use <code>{'{ "command", "args", ... }'}</code> for stdio
            servers or <code>{'{ "type": "http", "url", "headers" }'}</code> for remote servers.
          </p>
        </div>

        {/* Auto-enable */}
        <label className="inline-flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={autoEnable}
            onChange={e => setAutoEnable(e.target.checked)}
            disabled={saving}
            className="h-4 w-4 accent-blue-600"
          />
          <span className="text-sm text-gray-700 dark:text-gray-300">
            Auto-enable on new sessions
          </span>
        </label>

        <p className="text-xs text-gray-500 dark:text-gray-400 italic">
          Open chats keep their current MCP setup — start a new chat to use changes.
        </p>
      </div>
    </Modal>
  );
}
