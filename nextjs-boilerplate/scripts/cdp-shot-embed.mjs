/**
 * Vizuální ověření inline prodejního embed widgetu (žádný redirect — celý nákup
 * uvnitř widgetu). Nafotí formulář (typy+e-mail+Koupit) a stav „Objednávka vytvořena".
 */
import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';
const ts = Date.now();
const EID = '4b6d6257-6697-433f-858d-b4d01f2acedf'; // Cyrano z Bergeracu (GA)
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
class CDP { constructor(ws){this.ws=ws;this.id=0;this.w=new Map();this.ev=[];ws.onmessage=(e)=>{const m=JSON.parse(e.data);if(m.id&&this.w.has(m.id)){this.w.get(m.id)(m);this.w.delete(m.id);}else if(m.method)this.ev.push(m);};}
  send(method,params={}){const id=++this.id;this.ws.send(JSON.stringify({id,method,params}));return new Promise((res)=>this.w.set(id,res));}
  async waitEvent(method,t=8000){const s=Date.now();while(Date.now()-s<t){const i=this.ev.findIndex((e)=>e.method===method);if(i>=0)return this.ev.splice(i,1)[0];await sleep(50);}return null;} }
async function connect(u){const ws=new WebSocket(u);await new Promise((r,j)=>{ws.onopen=r;ws.onerror=j;});return new CDP(ws);}

async function main() {
  const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe';
  const proc = spawn(CHROME, ['--headless=new','--disable-gpu','--no-sandbox','--hide-scrollbars','--remote-debugging-port=9336','--window-size=520,900','--user-data-dir='+process.env.TEMP+'/cdp-embed-'+ts,'about:blank'],{stdio:'ignore'});
  let ver=null; for(let i=0;i<30;i++){await sleep(700);try{ver=await(await fetch('http://127.0.0.1:9336/json/version')).json();if(ver?.webSocketDebuggerUrl)break;}catch{}}
  let tgt=null; for(let i=0;i<10;i++){const l=await(await fetch('http://127.0.0.1:9336/json')).json();tgt=l.find(t=>t.type==='page');if(tgt?.webSocketDebuggerUrl)break;await sleep(400);}
  const cdp=await connect(tgt.webSocketDebuggerUrl);
  await cdp.send('Page.enable'); await cdp.send('Runtime.enable');

  await cdp.send('Page.navigate',{url:`http://localhost:3000/embed/event/${EID}?variant=card`});
  await cdp.waitEvent('Page.loadEventFired'); await sleep(2500);
  let p=await cdp.send('Runtime.evaluate',{expression:`document.body.innerText.includes('Koupit')?'form-ready':'no-form'`});
  let s1=await cdp.send('Page.captureScreenshot',{format:'png'});
  writeFileSync('C:/Users/omnia/Documents/tixly/state/ui-embed-form.png',Buffer.from(s1.result.data,'base64'));
  console.log('  📸 ui-embed-form.png', `(${p?.result?.value})`);

  // vyplň e-mail + klikni Koupit
  const email=`embed-cdp-${ts}@test.cz`;
  await cdp.send('Runtime.evaluate',{expression:`(()=>{const set=Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set;const em=document.querySelector('input[type=email]');set.call(em,${JSON.stringify(email)});em.dispatchEvent(new Event('input',{bubbles:true}));})()`});
  await sleep(500);
  await cdp.send('Runtime.evaluate',{expression:`[...document.querySelectorAll('button')].find(b=>/Koupit/.test(b.textContent)).click()`});
  await sleep(2800);
  let p2=await cdp.send('Runtime.evaluate',{expression:`document.body.innerText.includes('Objednávka vytvořena')?'order-created':'state:'+document.body.innerText.slice(0,60)`});
  let s2=await cdp.send('Page.captureScreenshot',{format:'png'});
  writeFileSync('C:/Users/omnia/Documents/tixly/state/ui-embed-success.png',Buffer.from(s2.result.data,'base64'));
  console.log('  📸 ui-embed-success.png', `(${p2?.result?.value})`);
  proc.kill();
}
main().catch(e=>{console.error('💥',e.message);process.exit(1);});
