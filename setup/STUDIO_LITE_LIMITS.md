# Studio Lite connection — important

This V3 package intentionally does NOT pretend to contain a Studio Plugin. The file in `bridge/` is a normal project-side Lua bridge.

If the exact Studio Lite environment exposes HttpService to the running project, the bridge can poll Haroon AI and perform runtime-safe Instance operations such as creating ordinary Instances, changing writable properties, moving Instances and destroying Instances.

A normal runtime Script cannot generally edit `Script.Source` in the Roblox DataModel. Therefore `set_source` jobs are reported as unsupported by this bridge instead of falsely claiming success.

Automatic editor-level source editing requires an editor API/plugin-style capability. Roblox's official documentation describes these capabilities for Roblox Studio. There is no verified official Studio Lite editor API in this package.

Do not paste an OpenAI API key into the bridge. Only the Haroon Agent Token belongs there.
