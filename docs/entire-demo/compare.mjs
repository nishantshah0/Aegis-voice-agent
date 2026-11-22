// Run from a checkout of the pinned revision: node /path/to/compare.mjs /path/to/results.json
// Requires git, Entire Graph, Node 22+, and an ANTHROPIC_API_KEY in the environment.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
const revision = "68ef0f482393b79f0beb14ecd53606fdfdf43c6a";
const model = "claude-haiku-5-5";
const output = process.argv[2];
if (!output || !process.env.ANTHROPIC_API_KEY) throw Error("Provide an output file and ANTHROPIC_API_KEY");
const cmd = (bin, args) => execFileSync(bin, args, { encoding: "utf8", maxBuffer: 32e6, stdio: ["ignore", "pipe", "pipe"] });
if (cmd("git", ["rev-parse", "HEAD"]).trim() !== revision) throw Error("Use revision " + revision);
const tasks = [
  ["weekday", "Which helper computes the weekday a patient's current supply will run out, and which time zone does it default to?", "lib/guard/speech.ts", "runOutDay", "America/Toronto"],
  ["label", "Which helper extracts listed side effects from prescription label text, and what does it return if the label lists none?", "lib/agent/lines.ts", "labelSideEffects", "null"],
  ["walkin", "Which simulation helper samples when a patient would walk in for a refill on their own, and what does it return for a sampled skipped refill?", "lib/sim/model.ts", "selfRefillDelay", "null"],
];
const files = new Set(cmd("git", ["ls-files", "*.ts", "*.tsx"]).trim().split("\n"));
const system = "Locate the production function and answer the question. First use the assigned search tool. Then you may search by regex, list paths, or read source lines. Answer as soon as the function and behavior are established. Use one tool per turn.";
const tool = (name, description, properties, required) => ({
  name, description, input_schema: {type:"object", properties, required, additionalProperties:false}
});
const str = {type:"string"};
const toolDefinitions = [
  tool("search","Case-insensitive extended regex in committed TypeScript. Optional directory narrows the search.",{query:str,dir:str},["query"]),
  tool("files","List committed TypeScript file paths matching a case-insensitive substring.",{query:str},["query"]),
  tool("read","Read up to 48 lines of committed TypeScript starting at the one-based start line.",{file:str,start:{type:"integer",minimum:1}},["file","start"]),
  tool("graph","Look up code by a plain-language question in Entire Graph.",{query:str},["query"]),
  tool("answer","Provide the relative path, exact symbol and the answer in a few words.",{file:str,symbol:str,value:str},["file","symbol","value"]),
];
function lookup(a, graphAllowed) {
  if (a.op === "graph" && graphAllowed) return cmd("entire", ["graph","query","--head","--format","agent","--verify-block","off","--max-context-bytes","2800","--query",String(a.query).slice(0,300)]).slice(0,2800);
  if (a.op === "files") return [...files].filter(f=>f.toLowerCase().includes(String(a.query).toLowerCase())).join("\n").slice(0,2800);
  if (a.op === "read" && files.has(a.file)) return cmd("git", ["show","HEAD:"+a.file]).split("\n").slice(Math.max(0,(a.start|0)-1), Math.max(0,(a.start|0)-1)+48).join("\n").slice(0,2800);
  if (a.op === "search") {
    try {const dir = a.dir && /^[a-zA-Z0-9_/-]+$/.test(a.dir) ? a.dir.replace(/\/$/, "") + "/" : "";
      return cmd("git",["grep","--no-recurse-submodules","-Ein","-e",String(a.query).slice(0,160),"HEAD","--",dir+"*.ts",dir+"*.tsx"]).replace(/^HEAD:/gm,"").slice(0,2800);}
    catch(e){if(e.status===1)return "No matches"; throw e;}
  }
  return "Invalid operation or path.";
}
async function run(task, arm, repeat) {
  const [id,question,file,symbol,value]=task;
  const messages=[{role:"user",content:arm+" arm. "+question}];
  const result={id,arm,repeat,input:0,output:0,operations:[],correct:false};
  for(let i=0;i<8;i++) {
    const first = i === 0;
    const allowed = toolDefinitions.filter(t => t.name !== "graph" || (arm === "Graph" && first));
    const tool_choice = first ? {type:"tool",name:arm === "Graph" ? "graph" : "search",disable_parallel_tool_use:true} : {type:"any",disable_parallel_tool_use:true};
    const response=await fetch("https://api.anthropic.com/v1/messages",{method:"POST",headers:{"x-api-key":process.env.ANTHROPIC_API_KEY,"anthropic-version":"2023-06-01","content-type":"application/json"},body:JSON.stringify({model,max_tokens:650,system,messages,tools:allowed,tool_choice}),signal:AbortSignal.timeout(50000)});
    if(!response.ok)throw Error("Anthropic HTTP "+response.status+" "+(await response.json()).error?.type);
    const data=await response.json();
    const {usage}=data;
    result.input+=usage.input_tokens+(usage.cache_read_input_tokens||0)+(usage.cache_creation_input_tokens||0);
    result.output+=usage.output_tokens;
    const use = data.content.find(b=>b.type === "tool_use");
    if (!use) throw Error("No tool call returned: "+data.stop_reason);
    const op = {op:use.name,...use.input};
    result.operations.push(op);
    if (op.op==="answer"){
      result.correct=op.file===file && op.symbol===symbol && String(op.value).toLowerCase().includes(value.toLowerCase()) && result.operations[0].op===(arm==="Graph"?"graph":"search");
      break;
    }
    const evidence=lookup(op,arm==="Graph" && i===0);
    messages.push({role:"assistant",content:data.content},{role:"user",content:[{type:"tool_result",tool_use_id:use.id,content:evidence || "No matches."}]});
  }
  return result;
}
const results=[];
for (let repeat=1; repeat<=2; repeat++) {
 const jobs=tasks.flatMap(t=>(repeat===1?["Graph","Baseline"]:["Baseline","Graph"]).map(a=>[t,a]));
 for(let i=0;i<jobs.length;i+=2){
  const batch=await Promise.all(jobs.slice(i,i+2).map(([t,a])=>run(t,a,repeat)));
  results.push(...batch);
  writeFileSync(output,JSON.stringify({revision,model,metric:"sum of provider input and output per request, including repeated context",tasks,results},null,2));
  for(const r of batch)console.log(r.id,r.arm,r.repeat,r.correct,r.input+r.output);
 }
}
