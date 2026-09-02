import http from "node:http";
const targets = await new Promise((resolve,reject)=>{
  http.get({host:"127.0.0.1",port:9433,path:"/json/list"}, res=>{let b="";res.on("data",c=>b+=c);res.on("end",()=>resolve(JSON.parse(b)));}).on("error",reject);
});
const target=targets.find(x=>x.type==="page" && /^https:\/\/chatgpt\.com/.test(x.url));
if(!target) throw new Error("GPT target missing");
const socket=new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve,reject)=>{socket.addEventListener("open",resolve,{once:true});socket.addEventListener("error",reject,{once:true});});
const id=1;
const reply=new Promise((resolve,reject)=>{
 const t=setTimeout(()=>reject(new Error("timeout")),5000);
 socket.addEventListener("message",e=>{const m=JSON.parse(typeof e.data==="string"?e.data:Buffer.from(e.data).toString("utf8"));if(m.id===id){clearTimeout(t);resolve(m);}});
});
socket.send(JSON.stringify({id,method:"Runtime.evaluate",params:{expression:"({href:location.href,readyState:document.readyState,extension:document.documentElement?.dataset?.tbGptProductionExtension||'',body:String(document.body?.innerText||'').slice(0,500)})",returnByValue:true,awaitPromise:false}}));
console.log(JSON.stringify(await reply,null,2));
socket.close();
