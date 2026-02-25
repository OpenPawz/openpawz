// Paw Agent Engine — Web Chat HTML Template
//
// Self-contained HTML/CSS/JS chat page served by the webchat bridge.

/// Build the complete HTML page for the chat interface.
pub fn build_chat_html(title: &str) -> String {
    format!(
        r##"<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{title}</title>
<style>
*{{margin:0;padding:0;box-sizing:border-box}}
body{{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#1e1e1e;color:#cccccc;height:100vh;display:flex;flex-direction:column}}
.header{{padding:16px 20px;background:#252526;border-bottom:1px solid #3c3c3c;display:flex;align-items:center;gap:12px}}
.header h1{{font-size:16px;font-weight:600;color:#ff00ff}}
.header .dot{{width:8px;height:8px;border-radius:50%;background:#333;transition:background .3s}}
.header .dot.online{{background:#0f0}}
.name-bar{{padding:10px 20px;background:#252526;border-bottom:1px solid #3c3c3c;display:flex;gap:8px;flex-wrap:wrap}}
.name-bar input{{flex:1;min-width:120px;padding:8px 12px;border:1px solid #3c3c3c;border-radius:6px;background:#313131;color:#cccccc;font-size:14px;outline:none}}
.name-bar input:focus{{border-color:#ff00ff}}
.name-bar button{{padding:8px 16px;background:#ff00ff;color:#fff;border:none;border-radius:6px;font-weight:600;cursor:pointer}}
.messages{{flex:1;overflow-y:auto;padding:20px;display:flex;flex-direction:column;gap:10px}}
.msg{{max-width:80%;padding:10px 14px;border-radius:12px;font-size:14px;line-height:1.5;word-wrap:break-word;white-space:pre-wrap}}
.msg.user{{align-self:flex-end;background:#2a2d2e;border:1px solid #ff00ff33}}
.msg.assistant{{align-self:flex-start;background:#252526;border:1px solid #3c3c3c}}
.msg.system{{align-self:center;color:#888;font-size:12px;font-style:italic}}
.msg.error{{align-self:center;color:#f44;font-size:13px}}
.typing{{align-self:flex-start;color:#888;font-size:13px;padding:4px 14px}}
.typing::after{{content:'...';animation:dots 1.2s infinite}}
@keyframes dots{{0%,20%{{content:'.'}}40%{{content:'..'}}60%,100%{{content:'...'}}}}
.input-bar{{padding:16px 20px;background:#252526;border-top:1px solid #3c3c3c;display:flex;gap:8px}}
.input-bar textarea{{flex:1;padding:10px 14px;border:1px solid #3c3c3c;border-radius:8px;background:#313131;color:#cccccc;font-size:14px;font-family:inherit;resize:none;outline:none;max-height:120px}}
.input-bar textarea:focus{{border-color:#ff00ff}}
.input-bar button{{padding:10px 20px;background:#ff00ff;color:#fff;border:none;border-radius:8px;font-weight:600;cursor:pointer;white-space:nowrap}}
.input-bar button:disabled{{opacity:.4;cursor:not-allowed}}
</style>
</head>
<body>
<div class="header">
  <div class="dot" id="dot"></div>
  <h1>{title}</h1>
</div>
<div class="name-bar" id="nameBar">
  <input id="nameInput" placeholder="Your name" autofocus />
  <input id="tokenInput" type="password" placeholder="Access token" />
  <button onclick="connect()">Join</button>
</div>
<div class="messages" id="messages"></div>
<div class="input-bar" id="inputBar" style="display:none">
  <textarea id="chatInput" placeholder="Type a message..." rows="1"></textarea>
  <button id="sendBtn" onclick="send()">Send</button>
</div>
<script>
let ws,name="";
const msgs=document.getElementById("messages");
const inp=document.getElementById("chatInput");
const dot=document.getElementById("dot");

async function connect(){{
  name=document.getElementById("nameInput").value.trim();
  const token=document.getElementById("tokenInput").value.trim();
  if(!name||!token)return;
  try{{
    const res=await fetch("/auth",{{
      method:"POST",
      headers:{{"Content-Type":"application/json"}},
      body:JSON.stringify({{name,token}}),
      credentials:"same-origin"
    }});
    if(!res.ok){{addMsg("error","Invalid token.");return}}
  }}catch(e){{addMsg("error","Auth failed: "+e.message);return}}
  document.getElementById("nameBar").style.display="none";
  document.getElementById("inputBar").style.display="flex";
  const proto=location.protocol==="https:"?"wss:":"ws:";
  ws=new WebSocket(`${{proto}}//${{location.host}}/ws`);
  ws.onopen=()=>{{dot.classList.add("online");inp.focus()}};
  ws.onclose=()=>{{dot.classList.remove("online");addMsg("system","Disconnected.")}};
  ws.onmessage=(e)=>{{
    try{{
      const d=JSON.parse(e.data);
      removeTyping();
      if(d.type==="typing"){{addTyping();return}}
      addMsg(d.type||"assistant",d.text||"");
    }}catch(err){{addMsg("assistant",e.data)}}
  }};
}}

function send(){{
  const t=inp.value.trim();
  if(!t||!ws||ws.readyState!==1)return;
  addMsg("user",t);
  ws.send(JSON.stringify({{type:"message",text:t}}));
  inp.value="";
  inp.style.height="auto";
}}

function addMsg(type,text){{
  const d=document.createElement("div");
  d.className="msg "+type;
  d.textContent=text;
  msgs.appendChild(d);
  msgs.scrollTop=msgs.scrollHeight;
}}

function addTyping(){{
  removeTyping();
  const d=document.createElement("div");
  d.className="typing";
  d.id="typing";
  d.textContent="Thinking";
  msgs.appendChild(d);
  msgs.scrollTop=msgs.scrollHeight;
}}

function removeTyping(){{
  const el=document.getElementById("typing");
  if(el)el.remove();
}}

inp.addEventListener("keydown",(e)=>{{
  if(e.key==="Enter"&&!e.shiftKey){{e.preventDefault();send()}}
}});
inp.addEventListener("input",()=>{{
  inp.style.height="auto";
  inp.style.height=Math.min(inp.scrollHeight,120)+"px";
}});
document.getElementById("tokenInput").addEventListener("keydown",(e)=>{{
  if(e.key==="Enter"){{e.preventDefault();connect()}}
}});
</script>
</body>
</html>"##,
        title = title
    )
}
