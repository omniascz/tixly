/** Vizuální ověření seated embed widgetu — mapa sedadel + výběr míst. */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const ts = Date.now();
const EID = '00000000-0000-4000-a000-000000000401'; // Romeo a Julie (seated, 308 míst)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class CDP { constructor(ws){this.ws=ws;this.id=0;this.w=new Map();this.ev=[];ws.onmessage=(e)=>{const m=JSON.parse(e.data);if(m.id&&this.w.has(m.id)){this.w.get(m.id)(m);this.w.delete(m.id);}else if(m.method)this.ev.push(m);};}
  send(method,params={}){const id=++this.id;this.ws.send(JSON.stringify({id,method,params}));return new Promise((res)=>this.w.set(id,res));}
  async waitEvent(method,t=8000){const s=Date.now();while(Date.now()-s<t){const i=this.ev.findIndex((e)=>e.method===method);if(i>=0)return this.ev.splice(i,1)[0];await sleep(50);}return null;} }
async function connect(u){const ws=new WebSocket(u);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});return new CDP(ws);}

async function main() {
  const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const proc = spawn(CHROME, ['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars','--remote-debugging-port=9337','--window-size=520,1000','--user-data-dir='+process.env.TEMP+'/cdp-seat-'+ts,'about:blank'],{stdio:'ignore'});
  let ver=null; for(let i=0;i<30;i++){await sleep(700);try{ver=await(await fetch('http://127.0.0.1:9337/json/version')).json();if(ver?.webSocketDebuggerUrl)break;}catch{}}
  let tgt=null; for(let i=0;i<10;i++){const l=await(await fetch('http://127.0.0.1:9337/json')).json();tgt=l.find(t=>t.type==='page');if(tgt?.webSocketDebuggerUrl)break;await sleep(400);}
  const cdp=await connect(tgt.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');
  await cdp.send('Page.navigate',{url:`http://localhost:3000/embed/event/${EID}?variant=card`});
  await cdp.waitEvent('Page.loadEventFired'); await sleep(3500);

  // klikni na 3 volná místa (malé seat buttony s číslem, ne disabled) + vyplň e-mail
  const r=await cdp.send('Runtime.evaluate',{expression:`(()=>{
    const seatBtns=[...document.querySelectorAll('button')].filter(b=>!b.disabled && /^\\d+$/.test(b.textContent.trim()) && b.offsetWidth<=24);
    seatBtns.slice(0,3).forEach(b=>b.click());
    const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;
    const em=document.querySelector('input[type=email]'); if(em){set.call(em,'seat-cdp-${ts}@test.cz');em.dispatchEvent(new Event('input',{bubbles:true}));}
    return 'clicked '+Math.min(3,seatBtns.length)+' seats; map:'+(document.body.innerText.includes('JEVIŠTĚ')?'yes':'no');
  })()`,awaitPromise:false});
  console.log('  interact:', r?.result?.value);
  await sleep(1200);
  const sh=await cdp.send('Page.captureScreenshot',{format:'png'});
  writeFileSync('C:/Users/omnia/Documents/tixly/state/ui-embed-seated.png',Buffer.from(sh.result.data,'base64'));
  console.log('  📸 ui-embed-seated.png');
  proc.kill();
}
main().catch(e=>{console.error('💥',e.message);process.exit(1);});
