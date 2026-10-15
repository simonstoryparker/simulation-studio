// Run on native macOS/Windows against actual draft release assets. No private robot checkout.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createServer } from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { homedir, tmpdir } from 'node:os';
import { WebSocketServer } from 'ws';
const [assetsArg, fixtureArg, outputArg] = process.argv.slice(2);
const assets = resolve(assetsArg), fixture = resolve(fixtureArg), output = resolve(outputArg);
mkdirSync(output, { recursive: true });
const mac = process.platform === 'darwin';
assert(mac || process.platform === 'win32', 'Native macOS/Windows required');
const platform = mac ? `darwin-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}` : 'windows-x86_64';
const manifest = JSON.parse(readFileSync(join(assets, `artifact-${platform}.json`)));
const root = join(output, 'Installed Apps With Spaces');
const app = mac ? join(root, 'Simulation Studio.app') : root;
const executable = mac ? join(app, 'Contents/MacOS/simulation-studio') : join(app, 'simulation-studio.exe');
const fixtureBundle = mac ? join(fixture, 'macos/Simulation Studio.app') : join(fixture, 'nsis');
const installer = manifest.files.find(f => f.name.endsWith(mac ? '.dmg' : '-setup.exe')).name;
const updaterBytes = readFileSync(join(assets, manifest.updater));
const hash = path => createHash('sha256').update(readFileSync(path)).digest('hex');
const command = (bin, args, extra = {}) => {
  const r = spawnSync(bin, args, { encoding: 'utf8', timeout: 120000, ...extra });
  if (r.error || r.status !== 0) throw Error(`${bin}: ${r.error || r.stderr || r.stdout || r.status}`);
  return r.stdout;
};
const wait = ms => new Promise(r => setTimeout(r, ms));
async function until(check, label, timeout = 90000) {
  const start = Date.now();
  while (Date.now() - start < timeout) { if (check()) return; await wait(200); }
  throw Error(`Timed out: ${label}`);
}
const project = `installation-smoke-${Date.now()}`;
const latestProject = `${project}-latest`;
const data = mac ? join(homedir(), 'Library/Application Support/org.team581.simulation-studio') : join(process.env.APPDATA, 'org.team581.simulation-studio');
const workspacePath = p => join(data, 'workspaces', `${Buffer.from(p).toString('hex')}.json`);
const workspace = { version: 2, tabs: [{id:'smoke', name:'Preserved smoke layout', widgets:[]}], activeTab:'smoke', profiles:Array.from({length:6}, (_,i)=>({source:'none',name:`Saved controller ${i}`,axes:[],buttons:[],pov:['','','','']})), keyboardPort:1, topicsCollapsed:true, matchDurations:{auto:17,transition:4,teleop:129}, overlay:{width:320,height:180,x:120,y:120,controls:['mode','keyboard'],topics:[]} };
mkdirSync(dirname(workspacePath(project)), { recursive:true });
for (const p of [project, latestProject]) writeFileSync(workspacePath(p), JSON.stringify(workspace));
let frames = [], phase = 'initial', badFrame;
const bridge = new WebSocketServer({port:0,host:'127.0.0.1'});
await new Promise(r => bridge.once('listening', r));
bridge.on('connection', socket => socket.on('message', data => {
  const frame = JSON.parse(data.toString());
  if (frame.enabled || frame.joysticks.some(j => j.buttons.some(Boolean) || j.axes.some(a => a !== 0) || j.povs.some(p => p !== -1))) badFrame = frame;
  frames.push({phase, frame});
  socket.send(JSON.stringify({version:1,sequence:frame.sequence,enabled:false,estop:false,attached:true,mode:'teleop'}));
}));
const control = `ws://127.0.0.1:${bridge.address().port}`;
// This socket deliberately never listens, so the older app has no simulation connection.
const dead = createServer(); await new Promise(r=>dead.listen(0,'127.0.0.1',r)); const oldPort = dead.address().port; await new Promise(r=>dead.close(r));
const session = {control, nt:`ws://127.0.0.1:${oldPort}/nt/smoke`, project:latestProject};
let mode = 'install';
const server = createServer((req,res) => {
  if (mode === 'offline') {res.writeHead(503); res.end(); return;}
  if (req.url === '/latest.json') {
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({version:manifest.version,platforms:{[platform]:{signature:manifest.signature,url:`http://127.0.0.1:${server.address().port}/update`}}}));
  } else if (mode === 'interrupted') {
    res.writeHead(200,{'Content-Length':updaterBytes.length}); res.write(updaterBytes.subarray(0,100)); setTimeout(()=>res.destroy(),100);
  } else {
    const bytes=Buffer.from(updaterBytes); if(mode==='tampered') bytes[bytes.length-1]^=1;
    res.writeHead(200,{'Content-Length':bytes.length});res.end(bytes);
  }
});
await new Promise(r=>server.listen(0,'127.0.0.1',r));
function stop() {
  if (mac) {
    const pids = spawnSync('pgrep',['-f',executable],{encoding:'utf8'}).stdout.trim().split('\n').filter(Boolean);
    for (const pid of pids) {try {process.kill(Number(pid),'SIGTERM');}catch{}}
  } else {
    command('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process | Where-Object { $_.ExecutablePath -eq '${executable.replaceAll("'","''")}' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`]);
  }
}
let mounted;
function install(fromFixture = false) {
  if (mac) {
    rmSync(app,{recursive:true,force:true}); mkdirSync(root,{recursive:true});
    command('ditto',[fromFixture ? fixtureBundle : join(mounted,'Simulation Studio.app'),app]);
  } else {
    const file = fromFixture ? join(fixtureBundle, readdir(fixtureBundle).find(n=>n.endsWith('-setup.exe'))) : join(assets,installer);
    command(file,['/S',`/D=${root}`],{windowsVerbatimArguments:true});
  }
}
// Lazy import avoids an unnecessary directory scan on macOS.
import { readdirSync as readdir } from 'node:fs';
function launch(testMode) {
  const log=join(output,`${testMode || phase}.log`); writeFileSync(log,'');
  const child=spawn(executable,['--project',project,'--control',testMode ? `ws://127.0.0.1:${oldPort}` : control,'--nt',session.nt],{env:{...process.env,STUDIO_SMOKE_MODE:testMode || '',STUDIO_SMOKE_FEED:`http://127.0.0.1:${server.address().port}/latest.json`,STUDIO_SMOKE_RESULT:join(output,'result.json'),STUDIO_SMOKE_SESSION:JSON.stringify(session)},stdio:['ignore','pipe','pipe']});
  child.on('error',e=>appendFileSync(log,String(e)));child.stdout.on('data',b=>appendFileSync(log,b));child.stderr.on('data',b=>appendFileSync(log,b));
  return child;
}
try {
  if(mac) {mounted=join(output,'mounted');mkdirSync(mounted,{recursive:true});command('hdiutil',['attach','-readonly','-nobrowse','-mountpoint',mounted,join(assets,installer)]);}
  install();
  assert(existsSync(executable),'Installer must create the native executable');
  const productionHash = hash(executable);
  launch();
  await until(()=>frames.filter(f=>f.phase===phase).length>=10,'installed app sends disabled control frames');
  assert(!badFrame,'Installed app must start disabled with cleared inputs');
  stop(); await wait(1500);
  install(); // Re-running a downloaded installer must upgrade in place.
  assert.equal(hash(executable), productionHash);
  assert.deepEqual(JSON.parse(readFileSync(workspacePath(project))),workspace);
  for (const testMode of ['offline','interrupted','tampered']) {
    install(true); const oldHash=hash(executable);
    mode=testMode;rmSync(join(output,'result.json'),{force:true});
    const child=launch(testMode);
    await until(()=>existsSync(join(output,'result.json')),testMode);
    assert.equal(JSON.parse(readFileSync(join(output,'result.json'))).ok,true,`${testMode} must be rejected safely`);
    await wait(1000);stop(); await wait(1000);
    assert.equal(hash(executable),oldHash,`${testMode} changed the installed app`);
    child.kill();
  }
  mode='install';phase='updated';rmSync(join(output,'result.json'),{force:true});
  install(true); launch('install');
  await until(()=>existsSync(join(output,'result.json')),'update ready and simulation guards tested');
  assert.equal(JSON.parse(readFileSync(join(output,'result.json'))).ok,true);
  await until(()=>hash(executable)===productionHash,'real updater replaces old application',120000);
  await until(()=>frames.filter(f=>f.phase==='updated').length>=10,'updated production app relaunches with latest session',120000);
  assert(!badFrame,'Restart must never enable simulation or restore held inputs');
  assert.deepEqual(JSON.parse(readFileSync(workspacePath(latestProject))),workspace);
  assert(!existsSync(join(app,mac?'Contents/Resources/resources/smoke-obsolete.txt':'resources/smoke-obsolete.txt')),'Obsolete bundled files must be removed');
  writeFileSync(join(output,'acceptance.json'),JSON.stringify({platform,version:manifest.version,passed:['native install','manual replacement','workspace preservation','offline failure','interrupted download','invalid signature','simulation update deferral','reconnect blocked during installation','actual updater replacement','obsolete resource removal','disabled relaunch','latest session restored']},null,2));
  console.log(`PASS ${platform}: installation, replacement, updater failures, safe restart and preserved workspace`);
} finally {
  stop(); for(const s of bridge.clients)s.terminate();bridge.close();server.close();
  for(const p of [project,latestProject])rmSync(workspacePath(p),{force:true});
  if(mounted)spawnSync('hdiutil',['detach',mounted]);
}
