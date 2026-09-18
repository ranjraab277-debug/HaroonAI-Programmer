-- Haroon AI Lite Bridge V3
-- IMPORTANT: This is a project-side bridge, not a Roblox Studio Plugin.
-- It can communicate with Haroon AI when the Lite environment permits HttpService.
-- Roblox runtime scripts cannot generally edit Script.Source, so source-writing jobs are reported as unsupported.

local HttpService = game:GetService("HttpService")

local CONFIG = {
    Backend = "https://YOUR-RENDER-DOMAIN.onrender.com",
    AgentToken = "PASTE_YOUR_AGENT_TOKEN_HERE",
    ProjectId = "main-project",
    AgentName = "Haroon Lite Bridge",
    PollSeconds = 4,
    HeartbeatSeconds = 10,
}

local function request(method, path, body)
    local headers = { ["Content-Type"] = "application/json", ["x-agent-token"] = CONFIG.AgentToken }
    local options = { Url = CONFIG.Backend .. path, Method = method, Headers = headers }
    if body ~= nil then options.Body = HttpService:JSONEncode(body) end
    local ok, response = pcall(function() return HttpService:RequestAsync(options) end)
    if not ok or not response.Success then
        return false, response and response.Body or "HTTP request failed"
    end
    local decoded = HttpService:JSONDecode(response.Body)
    return true, decoded
end

local function findPath(path)
    local current = game
    for segment in string.gmatch(path, "[^/]+") do
        if segment ~= "game" then
            current = current:FindFirstChild(segment)
            if not current then return nil end
        end
    end
    return current
end

local function createInstance(op)
    local parentPath = op.path:match("^(.*)/[^/]+$")
    local name = op.path:match("([^/]+)$")
    local parent = findPath(parentPath or "") or game
    local className = op.className
    if not className or className == "Script" or className == "LocalScript" or className == "ModuleScript" then
        return false, "Runtime bridge cannot safely create source-bearing scripts."
    end
    local ok, obj = pcall(Instance.new, className)
    if not ok then return false, "Unsupported class: " .. tostring(className) end
    obj.Name = name or obj.Name
    obj.Parent = parent
    return true, "Created " .. obj:GetFullName()
end

local function setProperty(op)
    local obj = findPath(op.path)
    if not obj then return false, "Path not found: " .. op.path end
    local ok, err = pcall(function() obj[op.property] = op.value end)
    if not ok then return false, "Property failed: " .. tostring(err) end
    return true, "Updated " .. op.path .. "." .. op.property
end

local function destroy(op)
    local obj = findPath(op.path)
    if not obj then return false, "Path not found: " .. op.path end
    obj:Destroy()
    return true, "Destroyed " .. op.path
end

local function move(op)
    local obj = findPath(op.path)
    local parent = findPath(op.to)
    if not obj or not parent then return false, "Move path not found" end
    obj.Parent = parent
    return true, "Moved " .. op.path
end

local function execute(job)
    local results = {}
    local allOk = true
    for _, op in ipairs(job.plan.operations or {}) do
        local ok, message
        if op.op == "create_instance" then ok, message = createInstance(op)
        elseif op.op == "set_property" then ok, message = setProperty(op)
        elseif op.op == "destroy" then ok, message = destroy(op)
        elseif op.op == "move" then ok, message = move(op)
        elseif op.op == "set_source" then ok, message = false, "Studio Lite runtime cannot write Script.Source through this bridge."
        else ok, message = false, "Unknown operation: " .. tostring(op.op) end
        table.insert(results, { op = op.op, path = op.path, ok = ok, message = message })
        if not ok then allOk = false end
    end
    return allOk, results
end

local function snapshot()
    local function walk(root, depth)
        if depth > 3 then return {} end
        local out = { Name = root.Name, ClassName = root.ClassName, Children = {} }
        for _, child in ipairs(root:GetChildren()) do
            table.insert(out.Children, walk(child, depth + 1))
        end
        return out
    end
    return { Workspace = walk(workspace, 0), ReplicatedStorage = walk(game:GetService("ReplicatedStorage"), 0) }
end

task.spawn(function()
    while true do
        local ok = pcall(function()
            request("POST", "/api/agent/heartbeat", { project_id = CONFIG.ProjectId, agent_name = CONFIG.AgentName, snapshot = snapshot() })
        end)
        task.wait(CONFIG.HeartbeatSeconds)
    end
end)

task.spawn(function()
    while true do
        local ok, data = request("GET", "/api/agent/poll?project_id=" .. HttpService:UrlEncode(CONFIG.ProjectId))
        if ok and data and data.job then
            local success, results = execute(data.job)
            request("POST", "/api/agent/result", { job_id = data.job.id, status = success and "success" or "failed", result = { operations = results, bridge = CONFIG.AgentName } })
        end
        task.wait(CONFIG.PollSeconds)
    end
end)

print("[Haroon AI] Lite Bridge started. Configure Backend, AgentToken and ProjectId first.")
