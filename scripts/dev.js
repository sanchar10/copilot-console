const { execSync, spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.dirname(__dirname);
const FRONTEND = path.join(ROOT, 'frontend');
const BACKEND_MODULE = 'copilot_console.app.main';

function run(cmd, cwd = ROOT) {
  console.log(`\x1b[36m> ${cmd}\x1b[0m`);
  execSync(cmd, { cwd, stdio: 'inherit', shell: true });
}

function tryRun(cmd, cwd = ROOT) {
  try {
    execSync(cmd, { cwd, stdio: 'ignore', shell: true });
    return true;
  } catch {
    return false;
  }
}

function checkPythonPackage(pkg) {
  return tryRun(`python -c "import ${pkg}"`);
}

function checkCommand(cmd) {
  return tryRun(process.platform === 'win32' ? `where ${cmd}` : `which ${cmd}`);
}

async function main() {
  console.log('\x1b[33m=== Copilot Console - Checking Prerequisites ===\x1b[0m\n');

  // Check Python
  if (!checkCommand('python')) {
    console.error('\x1b[31mError: Python not found. Please install Python 3.11+\x1b[0m');
    process.exit(1);
  }
  console.log('\x1b[32m✓ Python found\x1b[0m');

  // Check Node
  if (!checkCommand('node')) {
    console.error('\x1b[31mError: Node.js not found. Please install Node.js 18+\x1b[0m');
    process.exit(1);
  }
  console.log('\x1b[32m✓ Node.js found\x1b[0m');

  // Check Copilot CLI executable
  if (!checkCommand('copilot')) {
    console.error('\x1b[31mError: GitHub Copilot CLI not found.\x1b[0m');
    console.error('\x1b[33mThe Copilot CLI must be installed and on your PATH.\x1b[0m');
    console.error('');
    console.error('Install instructions: https://docs.github.com/en/copilot/using-github-copilot/using-github-copilot-in-the-command-line');
    console.error('');
    console.error('After installing, authenticate with:');
    console.error('  copilot login');
    process.exit(1);
  }
  console.log('\x1b[32m✓ Copilot CLI found\x1b[0m');

  // Check Copilot SDK (required prerequisite)
  if (!checkPythonPackage('copilot')) {
    console.error('\x1b[31mError: copilot-sdk not installed.\x1b[0m');
    console.error('\x1b[33mInstall from PyPI:\x1b[0m');
    console.error('  pip install github-copilot-sdk');
    process.exit(1);
  }
  console.log('\x1b[32m✓ Copilot SDK found\x1b[0m');

  console.log('\n\x1b[33m=== Checking Dependencies ===\x1b[0m\n');

  // Check frontend node_modules
  const frontendModules = path.join(FRONTEND, 'node_modules');
  if (!fs.existsSync(frontendModules)) {
    console.log('Installing frontend dependencies...');
    run('npm install', FRONTEND);
    console.log('');
  } else {
    console.log('\x1b[32m✓ Frontend dependencies OK\x1b[0m');
  }

  // Check backend Python dependencies (only third-party; our code is loaded via PYTHONPATH)
  const backendDeps = ['fastapi', 'uvicorn', 'pydantic', 'sse_starlette'];
  const missingDeps = backendDeps.filter(dep => !checkPythonPackage(dep));
  
  if (missingDeps.length > 0) {
    console.log(`Installing backend dependencies (missing: ${missingDeps.join(', ')})...`);
    run('pip install -e . --pre', ROOT);  // --pre needed for agent-framework pre-release
    console.log('');
  } else {
    console.log('\x1b[32m✓ Backend dependencies OK\x1b[0m');
  }

  console.log('\n\x1b[32m=== Starting Servers ===\x1b[0m\n');
  console.log('Frontend: \x1b[36mhttp://localhost:5173\x1b[0m');
  console.log('Backend:  \x1b[36mhttp://localhost:8765\x1b[0m');
  console.log('\nPress \x1b[33mCtrl+C\x1b[0m to stop both servers.\n');

  // Check for --no-sleep flag
  const noSleep = process.argv.includes('--no-sleep');
  const verbose = process.argv.includes('--verbose');
  const env = { ...process.env };

  // Point Python directly at this repo's src/ — no pip install -e . needed
  const srcDir = path.join(ROOT, 'src');
  env.PYTHONPATH = env.PYTHONPATH ? `${srcDir}${path.delimiter}${env.PYTHONPATH}` : srcDir;

  if (noSleep) {
    env.COPILOT_NO_SLEEP = '1';
    console.log('\x1b[33m🔋 Sleep prevention enabled (--no-sleep)\x1b[0m');
  }

  if (verbose) {
    env.COPILOT_VERBOSE = '1';
    console.log('\x1b[33m🔍 Verbose logging enabled (--verbose)\x1b[0m');
  }

  // Check for --expose flag (bind to 0.0.0.0 for mobile companion via tunnel)
  const expose = process.argv.includes('--expose');
  const backendHost = expose ? '0.0.0.0' : '127.0.0.1';
  if (expose) {
    env.COPILOT_EXPOSE = '1';
    console.log('\x1b[33m📱 Expose mode enabled — backend bound to 0.0.0.0\x1b[0m');
  }

  // Build commands that work on Windows
  const isWin = process.platform === 'win32';
  const backendCmd = `"python -m uvicorn ${BACKEND_MODULE}:app --reload --host ${backendHost} --port 8765"`;
  const frontendCmd = `"npm --prefix ${FRONTEND} run dev"`;

  // If --expose, also start devtunnel and register the URL with the backend
  let tunnelProc = null;
  if (expose) {
    if (!checkCommand('devtunnel')) {
      console.error('\x1b[31mError: devtunnel CLI not found.\x1b[0m');
      console.error('\x1b[33mInstall: winget install Microsoft.devtunnel\x1b[0m');
      console.error('Then: devtunnel user login');
      process.exit(1);
    }

    // Persistent tunnel: create once, reuse across restarts for stable URL
    const settingsPath = path.join(process.env.USERPROFILE || process.env.HOME || '', '.copilot-console', 'settings.json');
    let tunnelId = null;

    // Try to load saved tunnel ID
    try {
      if (fs.existsSync(settingsPath)) {
        const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
        tunnelId = settings.devtunnel_id || null;
      }
    } catch {}

    // Verify saved tunnel still exists
    if (tunnelId) {
      const exists = tryRun(`devtunnel show ${tunnelId}`);
      if (!exists) {
        console.log(`\x1b[33m⚠ Saved tunnel ${tunnelId} no longer exists, creating new one...\x1b[0m`);
        tunnelId = null;
      }
    }

    // Create persistent tunnel if none exists
    if (!tunnelId) {
      console.log('\x1b[33m🔗 Creating persistent devtunnel...\x1b[0m');
      try {
        const result = execSync('devtunnel create -j', { shell: true, encoding: 'utf-8' });
        // devtunnel may print banner text before JSON — extract the JSON object
        const jsonMatch = result.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON in devtunnel output');
        const parsed = JSON.parse(jsonMatch[0]);
        tunnelId = parsed.tunnel?.tunnelId || parsed.tunnelId;
        console.log(`\x1b[32m✓ Created tunnel: ${tunnelId}\x1b[0m`);

        // Add port 5173
        execSync(`devtunnel port create ${tunnelId} -p 5173`, { shell: true, stdio: 'ignore' });
        console.log('\x1b[32m✓ Port 5173 configured\x1b[0m');

        // Save tunnel ID to settings
        let settings = {};
        try {
          if (fs.existsSync(settingsPath)) {
            settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
          }
        } catch {}
        settings.devtunnel_id = tunnelId;
        fs.mkdirSync(path.dirname(settingsPath), { recursive: true });
        fs.writeFileSync(settingsPath, JSON.stringify(settings, null, 2), 'utf-8');
        console.log('\x1b[32m✓ Tunnel ID saved to settings\x1b[0m');
      } catch (err) {
        console.error('\x1b[31mFailed to create persistent tunnel:\x1b[0m', err.message);
        console.error('\x1b[33mFalling back to ephemeral tunnel\x1b[0m');
      }
    } else {
      console.log(`\x1b[32m✓ Reusing persistent tunnel: ${tunnelId}\x1b[0m`);
    }

    // Handle anonymous access
    const allowAnon = process.argv.includes('--allow-anonymous');
    if (allowAnon && tunnelId) {
      try {
        execSync(`devtunnel access create ${tunnelId} -a`, { shell: true, stdio: 'ignore' });
      } catch {} // May already have anonymous access
    }

    // Start devtunnel host — Vite serves /mobile and proxies /api to backend
    const tunnelArgs = tunnelId ? ['host', tunnelId] : ['host', '-p', '5173'];
    if (!tunnelId && allowAnon) tunnelArgs.push('--allow-anonymous');
    console.log(`\x1b[33m🔗 Starting devtunnel${allowAnon ? ' (anonymous access)' : ' (authenticated — same account only)'}...\x1b[0m`);
    tunnelProc = spawn('devtunnel', tunnelArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: true,
    });

    let tunnelUrl = null;
    const urlPattern = /Connect via browser:\s+(https:\/\/[^\s,]+)/;

    const handleTunnelOutput = (data) => {
      const text = data.toString();
      process.stderr.write(`\x1b[35m[tunnel]\x1b[0m ${text}`);
      if (!tunnelUrl) {
        const match = text.match(urlPattern);
        if (match) {
          tunnelUrl = match[1].replace(/\/$/, '');
          console.log(`\n\x1b[32m📱 Tunnel active: ${tunnelUrl}\x1b[0m`);
          console.log(`\x1b[32m   Mobile URL: ${tunnelUrl}/mobile\x1b[0m`);
          // Register tunnel URL with backend (retry a few times since backend may still be starting)
          const registerUrl = async (retries = 10) => {
            for (let i = 0; i < retries; i++) {
              try {
                const http = require('http');
                const postData = JSON.stringify({ tunnel_url: tunnelUrl });
                await new Promise((resolve, reject) => {
                  const req = http.request({
                    hostname: '127.0.0.1', port: 8765,
                    path: '/api/settings/mobile-companion/tunnel-url',
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', 'Content-Length': postData.length },
                  }, (res) => { res.resume(); resolve(); });
                  req.on('error', reject);
                  req.write(postData);
                  req.end();
                });
                console.log('\x1b[32m   ✓ Tunnel URL registered with backend\x1b[0m');
                console.log('\x1b[32m   Open Settings in desktop UI to see the QR code\x1b[0m\n');
                return;
              } catch {
                await new Promise(r => setTimeout(r, 2000));
              }
            }
            console.log('\x1b[33m   ⚠ Could not register tunnel URL — enter it manually in Settings\x1b[0m\n');
          };
          registerUrl();
        }
      }
    };

    tunnelProc.stdout.on('data', handleTunnelOutput);
    tunnelProc.stderr.on('data', handleTunnelOutput);
    tunnelProc.on('exit', (code) => {
      if (code !== 0 && code !== null) {
        console.error(`\x1b[31mdevtunnel exited with code ${code}\x1b[0m`);
      }
    });

    // Clean up tunnel on process exit
    process.on('exit', () => { if (tunnelProc) try { tunnelProc.kill(); } catch {} });
    process.on('SIGINT', () => { if (tunnelProc) try { tunnelProc.kill(); } catch {} process.exit(); });
  }

  const proc = spawn('npx', [
    'concurrently', '-k',
    '-n', 'backend,frontend',
    '-c', 'yellow,cyan',
    backendCmd,
    frontendCmd
  ], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: true,
    env,
  });

  proc.on('exit', (code) => process.exit(code || 0));
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
