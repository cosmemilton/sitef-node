import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { HELP, parseArguments, requireWindows, checkDevelopmentFiles, journalPath } from '../../../examples/cli/runtime.mjs';
import { main, connectClient, runSession } from '../../../examples/windows-cli.mjs';

const configuration = { server:'synthetic', storeId:'00000000', terminalId:'SR000001' };
const input = { functionId:3 };
function io(answers = []) {
  return { writes:[], prompts:[], write(text){this.writes.push(text);}, async ask(prompt){this.prompts.push(prompt); assert.ok(answers.length,'unexpected prompt'); return answers.shift();} };
}
async function fixture(fn) {
  const root = await mkdtemp(join(tmpdir(),'sitef-cli-refactor-'));
  try { await fn(root); } finally { await rm(root,{recursive:true,force:true}); }
}
async function files(root, directory = join(root,'runtime','7.0.117.123.r2-win64')) {
  await mkdir(directory,{recursive:true});
  await writeFile(join(directory,'CliSiTef64I.dll'),'synthetic inert data; never execute');
  await writeFile(join(root,'sitef-bridge.exe'),'synthetic inert data; never execute');
  return directory;
}

test('CLI runtime: updated bytes and arbitrary INI are accepted without a binary allowlist',async()=>{
  await fixture(async root=>{
    const directory=await files(root);
    await writeFile(join(directory,'CliSiTef.ini'),'[Integrator]\nOption=new-value');
    assert.equal(await checkDevelopmentFiles(root),directory);
    await writeFile(join(directory,'CliSiTef64I.dll'),'different synthetic bytes');
    assert.equal(await checkDevelopmentFiles(root),directory);
    assert.equal(await readFile(join(directory,'CliSiTef64I.dll'),'utf8'),'different synthetic bytes');
    assert.deepEqual((await readdir(directory)).sort(),['CliSiTef.ini','CliSiTef64I.dll']);
  });
});

test('CLI runtime: explicit directory accepts an update without moving the journal',async()=>{
  await fixture(async root=>{
    const directory=await files(root,join(root,'updated-runtime'));
    assert.equal(await checkDevelopmentFiles(root,directory),directory);
    assert.equal(journalPath(root,configuration),join(root,'state','45c875fe25ad1f230f16e4c14aff4726d51c9969a0e907af6707ab002696ce60.journal.json'));
    assert.notEqual(journalPath(root,configuration),journalPath(root,{...configuration,terminalId:'OTHER001'}));
    await assert.rejects(checkDevelopmentFiles(root,'relative'),/absoluto/);
    assert.deepEqual((await readdir(root)).sort(),['sitef-bridge.exe','updated-runtime']);
  });
});

test('CLI runtime: missing bridge or DLL-shaped directory has a precise preparation error',async()=>{
  await fixture(async root=>{
    const directory=join(root,'dll');await mkdir(directory);
    await writeFile(join(directory,'CliSiTef64I.dll'),'synthetic');
    await assert.rejects(checkDevelopmentFiles(root,directory),{code:'BRIDGE_FILE_MISSING',stage:'preflight',path:join(root,'sitef-bridge.exe')});
  });
  await fixture(async root=>{
    const directory=join(root,'dll');await mkdir(join(directory,'CliSiTef64I.dll'),{recursive:true});
    await assert.rejects(checkDevelopmentFiles(root,directory),{code:'RUNTIME_FILE_MISSING',stage:'preflight'});
  });
});

test('CLI runtime: arguments retain modes and supported functions without TESTE prompt',()=>{
  assert.deepEqual(parseArguments(['--help','ignored']),{help:true});
  assert.deepEqual(parseArguments(['--verificar','--diagnostico','--diretorio','ROOT','--runtime','DLL','--funcao','3']),{verifyOnly:true,diagnostic:true,root:'ROOT',runtime:'DLL',functionId:3});
  for(const id of [0,2,3,110,111,122,123])assert.equal(parseArguments(['--funcao',String(id)]).functionId,id);
  for(const args of [['--funcao','1'],['--funcao','x'],['--runtime'],['--diretorio','--verificar'],['--unexpected']])assert.throws(()=>parseArguments(args));
  assert.doesNotMatch(HELP,/hash correto|somente kit simulado|Digite TESTE/);
  assert.match(HELP,/nao comprova/);
});

test('CLI runtime: win32 is Windows and x64 is its required architecture',()=>{
  requireWindows('win32','x64');
  for(const [platform,architecture] of [['win32','ia32'],['linux','x64'],['win32','arm64']])assert.throws(()=>requireWindows(platform,architecture));
});

test('CLI connection: incompatible bridge or load failure closes transport without opening journal',async()=>{
  await fixture(async root=>{
    for(const failure of ['load','capability']) {
      const calls=[];
      const transport={async call(method){calls.push(method);if(failure==='load')throw Error('synthetic load error');return{protocolVersion:1,platform:'windows',architecture:'x86',fieldTypeBytes:4};},async close(){calls.push('close');}};
      await assert.rejects(connectClient({transport,directory:root,journalFile:join(root,'state.json'),configuration,io:io()}));
      assert.deepEqual(calls,['load','close']);assert.deepEqual(await readdir(root),[]);
    }
  });
});

test('CLI connection: synthetic configuration without a journal creates no state files',async()=>{
  await fixture(async root=>{
    const calls=[];
    const transport={async call(method,params){calls.push(method);if(method==='load')return{protocolVersion:1,platform:'windows',architecture:'x86_64',fieldTypeBytes:4};if(method==='configure'){assert.equal(params.server,'synthetic');return{status:0};}assert.fail(method);},async close(){calls.push('close');}};
    const client=await connectClient({transport,directory:root,configuration,io:io()});
    await client.close();assert.deepEqual(calls,['load','configure','close']);assert.deepEqual(await readdir(root),[]);
  });
});

test('CLI lifecycle: explicit confirm or undo occurs once after the result and never in cleanup',async()=>{
  for(const [answer,decision] of [['1',true],['2',false]]) {
    const calls=[],terminal=io([answer]);
    const client={state:'idle',async transact(){calls.push('transact');this.state='awaiting-finalization';return{status:0,transactionId:'current',requiresFinalization:true};},async finalizeTransaction(value,id){calls.push(['finalize',value,id]);this.state='idle';},async close(){calls.push('close');},cancel(){calls.push('cancel');}};
    const listeners=process.listenerCount('SIGINT');
    await runSession({client,transport:{async close(){assert.fail('extra close');}},input,io:terminal});
    assert.deepEqual(calls,['transact',['finalize',decision,'current'],'close']);assert.equal(process.listenerCount('SIGINT'),listeners);
  }
});

test('CLI lifecycle: pending closes normally; blocked confirmation preserves its error without undo',async()=>{
  for(const answer of ['','1']) {
    const calls=[],error=Object.assign(Error('synthetic'),{code:'SIGNATURE_REQUIRED'});
    const client={state:'idle',async transact(){calls.push('transact');this.state='awaiting-finalization';return{status:0,transactionId:'current',requiresFinalization:true};},async finalizeTransaction(value,id){calls.push(['finalize',value,id]);throw error;},async close(){calls.push('close');},cancel(){}};
    const listeners=process.listenerCount('SIGINT');
    const operation=runSession({client,transport:{async close(){assert.fail('extra close');}},input,io:io([answer])});
    if(answer==='')await operation;else await assert.rejects(operation,e=>e===error);
    assert.equal(calls.filter(c=>Array.isArray(c)).length,answer===''?0:1);assert.ok(!calls.some(c=>Array.isArray(c)&&c[1]===false));
    assert.equal(calls.at(-1),'close');assert.equal(process.listenerCount('SIGINT'),listeners);
  }
});

test('CLI lifecycle: diagnostics, uncertainty and callback failure never start or finish another sale',async()=>{
  for(const mode of ['diagnostic','uncertain','error']) {
    const calls=[],terminal=io();
    const client={state:mode==='uncertain'?'uncertain':'idle',async transact(){calls.push('transact');throw Error('synthetic error');},async callNative(method){calls.push(method);return{status:1};},async close(){calls.push('close');},async finalize(){assert.fail('finish');},cancel(){}};
    const operation=runSession({client,transport:{async close(){}},input,io:terminal,diagnostic:mode==='diagnostic'});
    if(mode==='diagnostic')await operation;else await assert.rejects(operation);
    assert.deepEqual(calls,mode==='diagnostic'?['pinpadPresent','close']:['transact','close']);
    assert.deepEqual(terminal.prompts,[]);
  }
});

test('CLI lifecycle: SIGINT cancels cooperatively, avoids decision and removes its listener',async()=>{
  const calls=[],terminal=io(),listeners=process.listenerCount('SIGINT');
  const client={state:'idle',async transact(_input,{signal}){calls.push('transact');process.emit('SIGINT');assert.equal(signal.aborted,true);return{status:-2};},cancel(){calls.push('cancel');},async close(){calls.push('close');},async finalize(){assert.fail('finish');}};
  await runSession({client,transport:{async close(){}},input,io:terminal});
  assert.deepEqual(calls,['transact','cancel','close']);assert.equal(process.listenerCount('SIGINT'),listeners);assert.deepEqual(terminal.prompts,[]);
});

test('CLI lifecycle: protocol error never retries and failed SDK close only closes the raw transport',async()=>{
  const calls=[],error=Object.assign(Error('synthetic'),{code:'RECONNECT_REQUIRED'});
  const client={async transact(){calls.push('transact');throw error;},async close(){calls.push('close');throw Error('active protocol');},cancel(){}};
  const listeners=process.listenerCount('SIGINT');
  await assert.rejects(runSession({client,transport:{async close(){calls.push('transport.close');}},input,io:io()}),e=>e===error);
  assert.deepEqual(calls,['transact','close','transport.close']);
  assert.equal(process.listenerCount('SIGINT'),listeners);
});

test('CLI entry: main is first function and importing does not start it',async()=>{
  const source=await readFile(new URL('../../../examples/windows-cli.mjs',import.meta.url),'utf8');
  assert.match(source.match(/(?:export )?(?:async )?function \w+/)?.[0]??'',/function main$/);
  assert.doesNotMatch(source,/SIMULATED_HASHES|verifySimulatedRuntime/);
  const exports=await import('../../../examples/windows-cli.mjs');
  for(const name of ['main','fiscalInput','runSimulation','developmentRoot','checkDevelopmentFiles','preflightTerminal','cliErrorLines'])assert.equal(typeof exports[name],'function');
});

test('CLI entry: --verificar on Windows accepts changed files without running the inert executable or touching state',{skip:process.platform!=='win32'},async()=>{
  await fixture(async root=>{
    const directory=await files(root,join(root,'different-runtime'));
    const journal=journalPath(root,configuration);await mkdir(join(root,'state'));
    await writeFile(journal,'synthetic journal must not be parsed or changed by --verificar');
    await writeFile(journal+'.lock','synthetic lock must remain');
    const cli=fileURLToPath(new URL('../../../examples/windows-cli.mjs',import.meta.url));
    const result=spawnSync(process.execPath,[cli,'--verificar','--diagnostico','--diretorio',root,'--runtime',directory],{encoding:'utf8',timeout:20000});
    assert.equal(result.status,0,result.stderr);assert.match(result.stdout,/DLL nao carregada/);assert.match(result.stdout,/Origem, dependencias e ambiente simulado nao verificados/);
    assert.equal(await readFile(journal,'utf8'),'synthetic journal must not be parsed or changed by --verificar');assert.equal(await readFile(journal+'.lock','utf8'),'synthetic lock must remain');
    assert.deepEqual((await readdir(root)).sort(),['different-runtime','sitef-bridge.exe','state']);
  });
});

test('CLI entry: Windows main warns on historical lock and starts a separate synthetic run',{skip:process.platform!=='win32'},async()=>{
  await fixture(async root=>{
    const directory=await files(root,join(root,'new-runtime'));
    await mkdir(join(root,'state'));
    const lock=journalPath(root,configuration)+'.lock';await writeFile(lock,'synthetic lock');
    const terminal=io(),calls=[];
    await main(['--diagnostico','--diretorio',root,'--runtime',directory],{
      createIO:()=>terminal,
      createTransport:()=>({async call(method){calls.push(method);
        if(method==='load')return{protocolVersion:1,platform:'windows',architecture:'x86_64',fieldTypeBytes:4};
        if(method==='configure')return{status:0};if(method==='pinpadPresent')return{status:1};assert.fail(method);
      },async close(){calls.push('close');}})
    });
    assert.deepEqual(calls,['load','configure','pinpadPresent','close']);
    assert.match(terminal.writes.join('\n'),/Lock de registro anterior/);
    assert.match(terminal.writes.join('\n'),/Registro desta execucao:/);
    assert.equal(await readFile(lock,'utf8'),'synthetic lock');
    assert.deepEqual(await readdir(join(root,'state','automation')),[]);
  });
});
