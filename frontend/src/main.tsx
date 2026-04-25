import { StrictMode, lazy, Suspense } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { ErrorBoundary } from './components/ErrorBoundary'
import { initMcpOAuthBridge } from './api/mcpOAuthBridge'
import './index.css'

const App = lazy(() => import('./App.tsx'));
const MobileApp = lazy(() => import('./mobile/MobileApp.tsx').then(m => ({ default: m.MobileApp })));

// Open the long-lived /events SSE channel and route MCP OAuth events
// to toasts. Module-level so it runs once per tab regardless of route
// or StrictMode double-invoke.
initMcpOAuthBridge();

// Register service worker for PWA support (mobile only)
if ('serviceWorker' in navigator && window.location.pathname.startsWith('/mobile')) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {
      // SW registration failed — PWA install won't be available but app still works
    });
  });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ErrorBoundary>
    <BrowserRouter>
      <Suspense fallback={
        <div className="h-screen flex items-center justify-center bg-[#fafafa] dark:bg-[#1e1e2e]">
          <div className="text-gray-400 dark:text-gray-500 text-sm">Loading...</div>
        </div>
      }>
        <Routes>
          <Route path="/mobile/*" element={<MobileApp />} />
          <Route path="/*" element={<App />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
    </ErrorBoundary>
  </StrictMode>,
)
