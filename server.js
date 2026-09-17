import express from "express";
import OpenAI from "openai";
import path from "node:path";
import { fileURLToPath } from "node:url";
const __filename=fileURLToPath(import.meta.url), __dirname=path.dirname(__filename);
const app=express(); app.use(express.json({limit:"2mb"})); app.use(express.static(path.join(__dirname,"public")));
const PORT=process.env.PORT||3000, MODEL=process.env.OPENAI_MODEL||"gpt-5.6-luna";
function client(){if(!process.env.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not configured on the server."); return new OpenAI({apiKey:process.env.OPENAI_API_KEY});}
const SYSTEM=`You are Haroon AI Programmer, a practical coding agent. Understand Arabic and English. Help users design, write, debug, refactor and explain software. Support JavaScript, TypeScript, HTML/CSS, Python, Lua/Luau, Roblox systems, JSON, APIs and databases. Give complete copy-paste-ready code when requested. Never claim code was executed if it was not. For Roblox, clearly separate ServerScript, LocalScript, ModuleScript and object-tree setup. Be honest that normal game scripts cannot become editor Plugins or freely edit Script.Source at runtime. For large tasks, make a concise plan then implement it.`;
app.get("/health",(_q,r)=>r.json({ok:true,service:"Haroon AI Programmer",model:MODEL}));
app.post("/api/chat",async(req,res)=>{try{const {messages}=req.body;if(!Array.isArray(messages)||!messages.length)return res.status(400).json({error:"messages must be a non-empty array"});const input=messages.slice(-40).map(m=>({role:m.role==="assistant"?"assistant":"user",content:String(m.content??"")}));const out=await client().responses.create({model:MODEL,instructions:SYSTEM,input});res.json({ok:true,text:out.output_text||"",model:MODEL});}catch(e){console.error(e);res.status(500).json({ok:false,error:e?.message||"AI request failed"});}});
app.listen(PORT,"0.0.0.0",()=>console.log(`Haroon AI Programmer running on port ${PORT}`));
