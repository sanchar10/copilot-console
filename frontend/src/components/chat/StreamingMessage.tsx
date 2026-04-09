import { useRef, useEffect, useMemo, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import type { ChatStep } from '../../types/message';
import type { Components } from 'react-markdown';
import { processFileLinks, isFilePath, resolveFileHref, handleFilePathClick } from '../../utils/processFileLinks';

interface StreamingMessageProps {
  content: string;
  steps?: ChatStep[];
  cwd?: string | null;
}

// --- Segment splitting: extract code fences before ReactMarkdown sees them ---

interface TextSegment {
  type: 'text';
  content: string;
}

interface CodeSegment {
  type: 'code';
  language: string;
  content: string;
  closed: boolean; // whether the closing ``` was received
}

type Segment = TextSegment | CodeSegment;

/**
 * Parse streaming content into alternating text and code segments.
 * Code fences are extracted so ReactMarkdown never sees backticks,
 * eliminating parse oscillation during streaming.
 *
 * This is language-agnostic — it handles ALL fenced code blocks the same way.
 * Specific viewer components (mermaid, 3D, graph, etc.) are only relevant
 * in MessageBubble after streaming completes.
 */
function splitSegments(content: string): Segment[] {
  const segments: Segment[] = [];
  const lines = content.split('\n');
  let currentText = '';
  let currentCode = '';
  let codeLang = '';
  let insideFence = false;

  for (const line of lines) {
    const fenceMatch = /^(`{3,})(\w*)/.exec(line.trimStart());

    if (fenceMatch && !insideFence) {
      // Opening fence — flush text segment
      if (currentText) {
        segments.push({ type: 'text', content: currentText });
        currentText = '';
      }
      codeLang = fenceMatch[2] || '';
      currentCode = '';
      insideFence = true;
    } else if (insideFence && /^`{3,}\s*$/.test(line.trimStart())) {
      // Closing fence — flush code segment
      segments.push({ type: 'code', language: codeLang, content: currentCode, closed: true });
      currentCode = '';
      codeLang = '';
      insideFence = false;
    } else if (insideFence) {
      // Inside code block
      currentCode += (currentCode ? '\n' : '') + line;
    } else {
      // Regular text
      currentText += (currentText ? '\n' : '') + line;
    }
  }

  // Flush remaining
  if (insideFence) {
    // Unclosed fence (still streaming)
    segments.push({ type: 'code', language: codeLang, content: currentCode, closed: false });
  } else if (currentText) {
    segments.push({ type: 'text', content: currentText });
  }

  return segments;
}

// --- Markdown components for text segments only (no code blocks) ---

function createStreamingMarkdownComponents(cwd?: string | null): Components {
  return {
  pre({ children }) {
    return <>{children}</>;
  },
  code({ children }) {
    // Only inline code reaches here — all fenced blocks are handled by splitSegments
    const text = String(children);
    if (isFilePath(text)) {
      return (
        <code
          data-filepath={text}
          className="bg-blue-50/80 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 px-1.5 py-0.5 rounded text-[0.9rem] font-mono cursor-pointer hover:underline"
        >
          📄 {children}
        </code>
      );
    }
    return (
      <code className="bg-gray-100 dark:bg-[#1e1e2e] text-pink-600 dark:text-pink-400 px-1.5 py-0.5 rounded text-[0.9rem] font-mono">
        {children}
      </code>
    );
  },
  table({ children }) {
    return (
      <div className="overflow-x-auto my-3">
        <table className="min-w-full border-collapse border border-gray-300 dark:border-gray-600">
          {children}
        </table>
      </div>
    );
  },
  thead({ children }) {
    return <thead className="bg-gray-100 dark:bg-[#2a2a3c]">{children}</thead>;
  },
  th({ children }) {
    return (
      <th className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-left font-semibold text-sm">
        {children}
      </th>
    );
  },
  td({ children }) {
    return (
      <td className="border border-gray-300 dark:border-gray-600 px-3 py-2 text-sm">
        {children}
      </td>
    );
  },
  a({ href, children }) {
    const resolvedPath = resolveFileHref(href, cwd);
    if (resolvedPath) {
      return (
        <span
          data-filepath={resolvedPath}
          className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 hover:underline cursor-pointer"
          title={`Click to open: ${resolvedPath}`}
        >
          📄 {children}
        </span>
      );
    }
    const safeHref = href && /^www\./i.test(href) ? `https://${href}` : href;
    return (
      <a href={safeHref} target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 hover:underline">
        {children}
      </a>
    );
  },
  ul({ children }) {
    return <ul className="list-disc list-inside my-2 space-y-1">{children}</ul>;
  },
  ol({ children }) {
    return <ol className="list-decimal list-inside my-2 space-y-1">{children}</ol>;
  },
  blockquote({ children }) {
    return (
      <blockquote className="border-l-4 border-gray-300 dark:border-gray-600 pl-4 italic text-gray-600 dark:text-gray-400 my-3">
        {children}
      </blockquote>
    );
  },
  h1({ children }) {
    return <h1 className="text-xl font-bold mt-4 mb-2">{children}</h1>;
  },
  h2({ children }) {
    return <h2 className="text-lg font-bold mt-3 mb-2">{children}</h2>;
  },
  h3({ children }) {
    return <h3 className="text-base font-bold mt-3 mb-1">{children}</h3>;
  },
  p({ children }) {
    return <p className="my-2">{processFileLinks(children)}</p>;
  },
  hr() {
    return <hr className="my-4 border-gray-300 dark:border-gray-600" />;
  },
  };
}

// --- Code segment renderer (stable <pre> — no heavy components) ---

function StreamingCodeBlock({ segment }: { segment: CodeSegment }) {
  const lang = segment.language || 'code';
  return (
    <div className="my-3 not-prose overflow-hidden rounded-md">
      <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-800 text-gray-400 text-xs">
        <span>{lang}</span>
        {!segment.closed && (
          <span className="ml-auto inline-block w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse" />
        )}
      </div>
      <pre className="p-3 bg-gray-900 text-gray-100 text-sm overflow-hidden whitespace-pre-wrap break-words"><code>{segment.content}</code></pre>
    </div>
  );
}

// --- Main component ---

export function StreamingMessage({ content, steps, cwd }: StreamingMessageProps) {
  const stepsRef = useRef<HTMLDivElement>(null);
  const stepsUserScrolledRef = useRef(false);
  const stepsIsProgrammaticRef = useRef(false);
  const mdComponents = useMemo(() => createStreamingMarkdownComponents(cwd), [cwd]);

  // Auto-scroll steps only if user hasn't manually scrolled up
  useEffect(() => {
    if (stepsRef.current && !stepsUserScrolledRef.current) {
      stepsIsProgrammaticRef.current = true;
      stepsRef.current.scrollTop = stepsRef.current.scrollHeight;
      requestAnimationFrame(() => { stepsIsProgrammaticRef.current = false; });
    }
  }, [steps?.length]);

  const handleStepsScroll = useCallback(() => {
    if (stepsIsProgrammaticRef.current) return;
    const el = stepsRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    stepsUserScrolledRef.current = !nearBottom;
  }, []);

  const segments = splitSegments(content);

  return (
    <div className="flex gap-3">
      {/* Avatar */}
      <div className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium bg-emerald-600">
        <span className="text-sm leading-none">🤖</span>
      </div>

      {/* Message content */}
      <div className="flex-1 min-w-0">
        {/* Label */}
        <div className="text-sm font-medium mb-1 text-emerald-600">
          Copilot
          <span className="ml-2 inline-block w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
        </div>

        {/* Message body */}
        <div onClick={handleFilePathClick} className="rounded-lg px-4 py-3 bg-white dark:bg-[#2a2a3c] border border-gray-200 dark:border-gray-700">
          {steps && steps.length > 0 && (
            <div className="mb-2 text-sm">
              <div className="text-gray-600 dark:text-gray-400 font-medium mb-2">
                Steps ({steps.length})
              </div>
              <div ref={stepsRef} onScroll={handleStepsScroll} className="space-y-2 text-gray-700 dark:text-gray-300 max-h-[300px] overflow-y-auto pr-1">
                {steps.map((s, idx) => (
                  <div key={idx} className="border-l-2 border-emerald-300 pl-3">
                    <div className="font-medium">{s.title}</div>
                    {s.detail && <pre className="mt-1 whitespace-pre-wrap break-words text-xs">{s.detail}</pre>}
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="prose prose-sm max-w-none prose-gray dark:prose-invert">
            {segments.map((seg, i) =>
              seg.type === 'text' ? (
                <ReactMarkdown key={i} remarkPlugins={[remarkGfm]} components={mdComponents}>
                  {seg.content}
                </ReactMarkdown>
              ) : (
                <StreamingCodeBlock key={i} segment={seg} />
              )
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
