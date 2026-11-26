(() => {
"use strict";
const API="https://teslafield-api.onrender.com";
const $=id=>document.getElementById(id);
const root=document.documentElement;
const promptInput=$("promptInput"), messageList=$("messageList"), welcome=$("welcomeScreen");
let chats=[], activeId=null, generating=false, controller=null;
const makeId=()=>"chat-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,6);
const escapeHtml=value=>String(value).replace(/[&<>"']/g,char=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[char]));
function toast(message){const box=$("toastMessage");box.textContent=message;box.classList.add("visible");clearTimeout(toast.timer);toast.timer=setTimeout(()=>box.classList.remove("visible"),2600)}
function save(){try{localStorage.setItem("teslafield.conversations.v2",JSON.stringify(chats.slice(0,80)))}catch(error){toast("Could not save chat history on this device.")}}
function activeChat(){return chats.find(chat=>chat.id===activeId)}
function scrollToBottom(){const area=$("conversationScroll");area.scrollTop=area.scrollHeight}
function inlineMarkup(text){return escapeHtml(text).replace(/\*\*(.*?)\*\*/g,"<strong>$1</strong>").replace(/\*(.*?)\*/g,"<em>$1</em>").replace(/`([^`]+)`/g,"<code>$1</code>")}
function renderMarkdown(source){
  const segments=String(source).split("```");
  return segments.map((segment,index)=>{
    if(index%2===1){const lines=segment.split("\n");if(lines.length>1&&/^[a-z0-9#+.-]{1,20}$/i.test(lines[0].trim()))lines.shift();return "<pre><code>"+escapeHtml(lines.join("\n").trim())+"</code></pre>"}
    const lines=segment.split("\n");let out="",paragraph=[],listType="";
    const flushParagraph=()=>{if(paragraph.length){out+="<p>"+paragraph.map(inlineMarkup).join("<br>")+"</p>";paragraph=[]}};
    const closeList=()=>{if(listType){out+=listType==="ul"?"</ul>":"</ol>";listType=""}};
    for(const line of lines){const trimmed=line.trim();if(!trimmed){flushParagraph();closeList();continue}
      const heading=trimmed.match(/^(#{1,3})\s+(.+)$/);if(heading){flushParagraph();closeList();const level=Math.min(heading[1].length+1,4);out+="<h"+level+">"+inlineMarkup(heading[2])+"</h"+level+">";continue}
      const bullet=trimmed.match(/^[-*]\s+(.+)$/);const numbered=trimmed.match(/^\d+[.)]\s+(.+)$/);
      if(bullet||numbered){flushParagraph();const next=bullet?"ul":"ol";if(listType!==next){closeList();listType=next;out+=next==="ul"?"<ul>":"<ol>"}out+="<li>"+inlineMarkup((bullet||numbered)[1])+"</li>";continue}
      closeList();paragraph.push(trimmed);
    }
    flushParagraph();closeList();return out;
  }).join("");
}
function addMessage(role,content,actions=true){
  const row=document.createElement("article");row.className="message-row "+role;
  const avatar=document.createElement("div");avatar.className="message-avatar";avatar.textContent=role==="user"?"Y":"T";
  const body=document.createElement("div");body.className="message-content";body.innerHTML=renderMarkdown(content);
  if(role==="user"){row.append(body,avatar)}else{row.append(avatar,body)}
  messageList.appendChild(row);
  if(role==="assistant"&&actions){const controls=document.createElement("div");controls.className="message-actions";
    const copy=document.createElement("button");copy.type="button";copy.textContent="Copy";copy.onclick=()=>copyText(content);
    const regen=document.createElement("button");regen.type="button";regen.textContent="Regenerate";regen.onclick=regenerateLast;
    controls.append(copy,regen);messageList.appendChild(controls)}
  scrollToBottom();return row;
}
async function copyText(text){try{await navigator.clipboard.writeText(text);toast("Copied to clipboard")}catch(error){toast("Clipboard access is unavailable in this browser.")}}
function renderHistory(){
  const list=$("historyList"),query=$("historySearch").value.trim().toLowerCase();list.innerHTML="";
  const visible=chats.filter(chat=>!query||chat.title.toLowerCase().includes(query));
  visible.forEach(chat=>{
    const row=document.createElement("div");row.className="history-row"+(chat.id===activeId?" active":"");
    const open=document.createElement("button");open.type="button";open.className="history-title";open.textContent=chat.title;open.onclick=()=>openChat(chat.id);
    const menu=document.createElement("button");menu.type="button";menu.className="history-menu";menu.textContent="•••";menu.setAttribute("aria-label","Conversation options");
    menu.onclick=()=>{const choice=window.prompt("Type R to rename or D to delete this chat:","R");if(!choice)return;if(choice.trim().toLowerCase()==="r"){const name=window.prompt("New conversation name:",chat.title);if(name&&name.trim()){chat.title=name.trim().slice(0,80);save();renderHistory()}}else if(choice.trim().toLowerCase()==="d"){if(window.confirm("Delete this conversation?")){chats=chats.filter(item=>item.id!==chat.id);if(activeId===chat.id)newChat();save();renderHistory()}}};
    row.append(open,menu);list.appendChild(row);
  });
  $("historyEmpty").hidden=visible.length>0;
  if(query&&visible.length===0)$("historyEmpty").textContent="No matching conversations.";
  else $("historyEmpty").textContent=chats.length?"No conversations yet.":"Your conversations will appear here.";
}
function openChat(id){if(generating)stopGeneration();const chat=chats.find(item=>item.id===id);if(!chat)return;activeId=id;welcome.hidden=true;messageList.innerHTML="";chat.messages.forEach(message=>addMessage(message.role,message.content,message.role==="assistant"));renderHistory();closeSidebar();scrollToBottom()}
function closeSidebar(){$("sidebar").classList.remove("open");$("sidebarBackdrop").classList.remove("visible")}
function openSidebar(){$("sidebar").classList.add("open");$("sidebarBackdrop").classList.add("visible")}
function newChat(){if(generating)stopGeneration();activeId=null;messageList.innerHTML="";welcome.hidden=false;promptInput.value="";promptInput.style.height="auto";renderHistory();closeSidebar();promptInput.focus()}
function setGenerating(value){generating=value;const button=$("sendButton");button.textContent=value?"■":"↑";button.classList.toggle("stop",value);button.setAttribute("aria-label",value?"Stop generating":"Send message")}
function showTyping(){const el=document.createElement("div");el.id="typingIndicator";el.className="message-row assistant";el.innerHTML='<div class="message-avatar">T</div><div class="typing-dots"><i></i><i></i><i></i></div>';messageList.appendChild(el);scrollToBottom()}
function stopGeneration(){if(controller)controller.abort();controller=null;$("typingIndicator")?.remove();setGenerating(false)}
async function requestReply(chat){
  showTyping();setGenerating(true);controller=new AbortController();
  try{
    const response=await fetch(API+"/api/v1/chat/completions",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({messages:chat.messages.slice(-24)}),signal:controller.signal});
    const data=await response.json().catch(()=>({}));
    $("typingIndicator")?.remove();
    if(!response.ok)throw new Error(data.message||data.error||"AI service error ("+response.status+")");
    const reply=data.reply||data.choices?.[0]?.message?.content;
    if(typeof reply!=="string"||!reply.trim())throw new Error("The AI provider returned an empty response.");
    chat.messages.push({role:"assistant",content:reply});chat.updated=Date.now();addMessage("assistant",reply);save();
  }catch(error){
    $("typingIndicator")?.remove();
    if(error.name!=="AbortError"){addMessage("assistant","**TESLAFIELD connection notice**\n\n"+(error.message||"The AI service could not complete this request.")+"\n\nYour message remains saved in this conversation.");}
  }finally{controller=null;setGenerating(false);renderHistory()}
}
async function sendMessage(value){
  const text=String(value===undefined?promptInput.value:value).trim();if(!text||generating)return;
  let chat=activeChat();
  if(!chat){chat={id:makeId(),title:text.replace(/\s+/g," ").slice(0,42),messages:[],updated:Date.now()};chats.unshift(chat);activeId=chat.id}
  welcome.hidden=true;chat.messages.push({role:"user",content:text});addMessage("user",text,false);
  promptInput.value="";promptInput.style.height="auto";save();renderHistory();closeSidebar();await requestReply(chat);
}
async function regenerateLast(){
  const chat=activeChat();if(!chat||generating)return;
  if(chat.messages.length&&chat.messages[chat.messages.length-1].role==="assistant")chat.messages.pop();
  if(!chat.messages.length||chat.messages[chat.messages.length-1].role!=="user"){toast("There is no message to regenerate.");return}
  messageList.innerHTML="";chat.messages.forEach(message=>addMessage(message.role,message.content,false));save();await requestReply(chat);
}
$("newChat").onclick=newChat;$("sidebarOpen").onclick=openSidebar;$("sidebarClose").onclick=closeSidebar;$("sidebarBackdrop").onclick=closeSidebar;
$("composer").onsubmit=event=>{event.preventDefault();if(generating)stopGeneration();else sendMessage()};
promptInput.oninput=()=>{promptInput.style.height="auto";promptInput.style.height=Math.min(promptInput.scrollHeight,180)+"px"};
promptInput.onkeydown=event=>{if(event.key==="Enter"&&!event.shiftKey){event.preventDefault();if(!generating)sendMessage()}};
document.querySelectorAll("[data-prompt]").forEach(button=>button.onclick=()=>sendMessage(button.dataset.prompt));
$("historySearch").oninput=renderHistory;
$("clearHistory").onclick=()=>{if(!chats.length)return;if(window.confirm("Clear all conversations saved on this device?")){chats=[];save();newChat();renderHistory();toast("Chat history cleared")}};
$("themeToggle").onclick=()=>{const dark=!root.classList.contains("dark");root.classList.toggle("dark",dark);localStorage.setItem("teslafield.appearance",dark?"dark":"light");$("themeLabel").textContent=dark?"Dark":"Light"};
$("shareChat").onclick=()=>{const chat=activeChat();if(!chat){toast("Start a conversation first.");return}copyText(chat.messages.map(m=>(m.role==="user"?"You: ":"TESLAFIELD: ")+m.content).join("\n\n"))};
$("attachButton").onclick=()=>$("fileInput").click();
$("fileInput").onchange=event=>{const names=Array.from(event.target.files||[]).map(file=>file.name);if(names.length){const preview=$("attachmentPreview");preview.hidden=false;preview.textContent="Selected: "+names.join(", ")+" — file upload and analysis are not enabled yet.";toast("Files selected; upload support is not connected yet.")}event.target.value=""};
$("imageNav").onclick=()=>toast("Image tools will be brought into this chat after the text-chat experience is complete.");
$("videoNav").onclick=()=>toast("Video tools will be brought into this chat after the text-chat experience is complete.");
$("accountButton").onclick=()=>toast("Account settings are not connected yet.");
$("chatNav").onclick=newChat;
$("voiceButton").onclick=()=>{
  const SpeechRecognition=window.SpeechRecognition||window.webkitSpeechRecognition;
  if(!SpeechRecognition){toast("Voice input is not supported in this browser.");return}
  const recognition=new SpeechRecognition();recognition.lang=navigator.language||"en-US";recognition.interimResults=false;recognition.maxAlternatives=1;
  recognition.onresult=event=>{const spoken=event.results[0][0].transcript;promptInput.value=(promptInput.value?promptInput.value+" ":"")+spoken;promptInput.dispatchEvent(new Event("input"));promptInput.focus()};
  recognition.onerror=()=>toast("Voice input could not start. Check microphone permission.");
  recognition.start();toast("Listening… speak now.");
};
async function checkConnection(){try{const response=await fetch(API+"/api/v1/status",{signal:AbortSignal.timeout(7000)});if(!response.ok)throw new Error();$("connectionStatus").classList.add("online");$("connectionStatus").querySelector("span").textContent="API online"}catch(error){$("connectionStatus").classList.remove("online");$("connectionStatus").querySelector("span").textContent="API offline"}}
try{chats=JSON.parse(localStorage.getItem("teslafield.conversations.v2")||"[]");if(!Array.isArray(chats))chats=[]}catch(error){chats=[]}
if(localStorage.getItem("teslafield.appearance")==="dark")root.classList.add("dark");
$("themeLabel").textContent=root.classList.contains("dark")?"Dark":"Light";
renderHistory();checkConnection();setInterval(checkConnection,60000);
document.addEventListener("keydown",event=>{if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="k"){event.preventDefault();newChat()}if((event.ctrlKey||event.metaKey)&&event.key.toLowerCase()==="f"){event.preventDefault();$("historySearch").focus()}if(event.key==="Escape")closeSidebar()});
})();