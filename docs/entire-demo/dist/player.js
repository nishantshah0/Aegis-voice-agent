const el = id => document.getElementById(id);
const buttons = [];
let currentCase, index = 0, audio, playback = "idle", generation = 0;
function element(tag, text, className) {
  const node = document.createElement(tag);
  node.textContent = text;
  if (className) node.className = className;
  return node;
}
function renderPlayback() {
  const total = currentCase.voice.length;
  el("play").textContent = {idle:"Play case",loading:"Pause",playing:"Pause",paused:"Resume",ended:"Replay case"}[playback];
  el("restart").hidden = playback === "idle" || playback === "ended";
  el("linecount").textContent = playback === "idle" ? total + (total === 1 ? " line" : " lines") : "Line " + (index+1) + " of " + total;
  for (const [n,li] of [...el("transcript").children].entries()) li.classList.toggle("active",n === index && ["loading","playing","paused"].includes(playback));
  el("progress").value = playback === "ended" ? total : index + (audio?.duration ? Math.min(1,audio.currentTime / audio.duration) : 0);
}
function clearAudio() {
  generation++;
  if (audio) { audio.pause(); audio.removeAttribute("src"); audio.load(); audio=undefined; }
}
async function speak() {
  if (!audio) {
    const serial = generation;
    audio = new Audio("audio/"+currentCase.voice[index].id+".mp3");
    audio.ontimeupdate = () => { if (serial===generation) renderPlayback(); };
    audio.onended = () => {
      if(serial!==generation) return;
      clearAudio();
      if(index+1===currentCase.voice.length) { playback="ended"; renderPlayback(); return; }
      index++; speak();
    };
  }
  const active = audio;
  playback="loading"; el("audioStatus").textContent=""; renderPlayback();
  try {
    await active.play();
    if(audio === active && !active.paused) { playback="playing"; renderPlayback(); }
  } catch {
    if(audio !== active || playback==="paused") return;
    clearAudio(); playback="paused"; el("audioStatus").textContent="Audio could not start. Press Resume to retry."; renderPlayback();
  }
}
function selectCase(c) {
  clearAudio(); currentCase=c; index=0; playback="idle"; el("audioStatus").textContent="";
  for(const [i,button] of buttons.entries()) button.setAttribute("aria-pressed",String(c===cases[i]));
  for(const key of ["kind","headline","description","foot"]) el(key).textContent=c[key];
  el("progress").max=c.voice.length;
  el("trail").href="https://entire.com/gh/nishantshah0/-/trails/"+c.trail+"/changes/namereserve/"+c.change; el("trail").textContent=c.review;
  el("more").href=c.source; el("more").textContent=c.key==="review"?"Open Trail #25 · Refill routing":"View the team’s "+(c.key==="readiness"?"demo log":"regression test");
  el("checks").replaceChildren(...c.evidence.map(([name,status,detail])=>{
    const box=element("div","","check"); const row=element("div","");
    row.append(element("strong",name),element("span",status,"status"+(status==="Passed"?"":" warn")));
    box.append(row,element("p",detail)); return box;
  }));
  el("transcript").replaceChildren(...c.voice.map(line=>{
    const li=element("li",""); li.append(element("b",line.role),document.createTextNode(line.line)); return li;
  }));
  renderPlayback();
}
for(const c of cases) {
  const button=element("button",c.title); button.type="button"; button.onclick=()=>selectCase(c);
  buttons.push(button); el("tabs").append(button);
}
el("play").onclick=()=>{
  if(["playing","loading"].includes(playback)){playback="paused";audio?.pause();renderPlayback();return;}
  if(playback==="ended"){clearAudio();index=0;}
  speak();
};
el("restart").onclick=()=>{clearAudio();index=0;speak();};
selectCase(cases[0]);
