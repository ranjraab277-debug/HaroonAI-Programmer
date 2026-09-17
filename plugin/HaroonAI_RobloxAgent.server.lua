-- Haroon AI Roblox Studio Agent core. Intended for an editor/plugin environment.
local ChangeHistoryService=game:GetService('ChangeHistoryService')
local Agent={}
local ALLOWED={create_instance=true,set_property=true,set_source=true,destroy=true,move=true}
local function findPath(root,path)local cur=root for part in string.gmatch(path or '','[^/]+') do cur=cur:FindFirstChild(part) if not cur then return nil end end return cur end
function Agent.execute(plan)
 assert(type(plan)=='table' and type(plan.steps)=='table','Invalid plan')
 local rec=ChangeHistoryService:TryBeginRecording('Haroon AI Build','Haroon AI')
 assert(rec,'Could not start change recording')
 for _,s in ipairs(plan.steps) do
  assert(ALLOWED[s.operation],'Blocked operation: '..tostring(s.operation))
  if s.operation=='create_instance' then local p=findPath(game,s.parent);assert(p,'Parent not found: '..tostring(s.parent));local o=Instance.new(s.className);o.Name=s.name or s.className;for k,v in pairs(s.properties or {}) do pcall(function()o[k]=v end) end;o.Parent=p
  elseif s.operation=='set_property' then local o=findPath(game,s.path);assert(o,'Object not found');o[s.property]=s.value
  elseif s.operation=='set_source' then local o=findPath(game,s.path);assert(o and o:IsA('LuaSourceContainer'),'Script not found');o.Source=s.source
  elseif s.operation=='destroy' then local o=findPath(game,s.path);if o then o:Destroy() end
  elseif s.operation=='move' then local o=findPath(game,s.path);local p=findPath(game,s.parent);assert(o and p,'Move target not found');o.Parent=p end
 end
 ChangeHistoryService:FinishRecording(rec,Enum.FinishRecordingOperation.Commit)
 return true
end
return Agent
