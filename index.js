const express = require("express");
const bodyParser = require("body-parser");
const path = require("path");
const login = require("./fca-unofficial");
const fs = require("fs");
const detectTyping = require("./handle/detectTyping");
const app = express();
const config = JSON.parse(fs.readFileSync(path.join(__dirname, "fca-unofficial","config.json"), "utf8"));

const PORT = process.env.PORT || 3000;

app.use(bodyParser.json());
app.use(express.static("public"));

global.NashBoT = {
  commands: new Map(),
  events: new Map(),
  onlineUsers: new Map(),
};

global.NashBot = {
  ENDPOINT: "https://nash-rest-api-production.up.railway.app/",
  END: "https://deku-rest-api.gleeze.com/",
  KEN: "https://api.kenliejugarap.com/",
  MONEY: "https://database2.vercel.app/"
};

async function loadCommands() {
  const commandPath = path.join(__dirname, "commands");
  const commandFiles = fs.readdirSync(commandPath).filter(file => file.endsWith(".js"));

  commandFiles.forEach(file => {
    const cmdFile = require(path.join(commandPath, file));
    if (cmdFile && cmdFile.name && cmdFile.execute) {
      cmdFile.nashPrefix = cmdFile.nashPrefix !== undefined ? cmdFile.nashPrefix : true;
      global.NashBoT.commands.set(cmdFile.name, cmdFile);
    }
  });
}

async function loadEvents() {
  const eventPath = path.join(__dirname, "events");
  const eventFiles = fs.readdirSync(eventPath).filter(file => file.endsWith(".js"));

  eventFiles.forEach(file => {
    const evntFile = require(path.join(eventPath, file));
    if (evntFile && evntFile.name && typeof evntFile.onEvent === 'function') {
      global.NashBoT.events.set(evntFile.name, evntFile);
    }
  });
}

async function init() {
  await loadCommands();
  await loadEvents();
  await autoLogin();
}

async function autoLogin() {
  const appStatePath = path.join(__dirname, "appstate.json");
  if (fs.existsSync(appStatePath)) {
    const appState = JSON.parse(fs.readFileSync(appStatePath, "utf8"));
    login({ appState }, config.FCA_OPTIONS, (loginError, api) => { 
      if (loginError) {
        console.error("Failed to login automatically:", loginError);
        return;
      }

      const cuid = api.getCurrentUserID();
      global.NashBoT.onlineUsers.set(cuid, { userID: cuid, prefix: "!" });

      setupBot(api, "!");
    });
  }
}

app.post("/login", (req, res) => {
  const { botState, prefix } = req.body;

  if (!botState || !prefix) {
    return res.status(400).send("Bot state and prefix are required.");
  }

  try {
    const appState = JSON.parse(botState);
    fs.writeFileSync(path.join(__dirname, "appstate.json"), JSON.stringify(appState));
    
    login({ appState }, config.FCA_OPTIONS, (loginError, api) => { 
      if (loginError) {
        console.error("Login failed: ", loginError); 
        return res.status(500).send("Failed to login: " + loginError.message);
      }

      api.setOptions(global.apiOptions);

      const cuid = api.getCurrentUserID();
      global.NashBoT.onlineUsers.set(cuid, { userID: cuid, prefix });

      setupBot(api, prefix);
      res.status(200).json({ message: "Login successful" });
    });
  } catch (error) {
    console.error("Error parsing bot state: ", error);
    res.status(400).send("Invalid appState format");
  }
});

function setupBot(api, prefix) {
  api.setOptions({
    forceLogin: false,
    selfListen: true,
    autoReconnect: true,
    updatePresence: false,
    userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/58.0.3029.110 Safari/537.36",
    autoMarkDelivery: false,
    autoMarkRead: false,
    online: false,
    listenEvents: true,
  });

  setInterval(() => {
    api.getFriendsList(() => {
      console.log("Keep-alive signal sent");
    });
  }, 1000 * 60 * 15);

  api.listenMqtt((err, event) => {
    if (err) {
      return;
    }

    handleMessage(api, event, prefix);
    handleEvent(api, event, prefix);
    detectTyping(api, event);
  });
}

async function handleEvent(api, event, prefix) {
  const { events } = global.NashBoT;
  try {
    for (const { name, onEvent } of events.values()) {
      await onEvent({ prefix, api, event });
    }
  } catch (error) {
    console.error("Error handling event:", error);
  }
}

async function handleMessage(api, event, prefix) {
  if (!event.body) return;
  let [command, ...args] = event.body.trim().split(" ");

  if (command.startsWith(prefix)) {
    command = command.slice(prefix.length);
  }

  const cmdFile = global.NashBoT.commands.get(command.toLowerCase());
  if (cmdFile) {
    const nashPrefix = cmdFile.nashPrefix !== false;
    if (nashPrefix && !event.body.toLowerCase().startsWith(prefix)) {
      return;
    }
    
    try {
      cmdFile.execute(api, event, args, prefix);
    } catch (error) {
      api.sendMessage(`Error executing command: ${error.message}`, event.threadID);
    }
  }
}

app.get("/active-sessions", async (req, res) => {
  const json = {};
  global.NashBoT.onlineUsers.forEach(({ userID, prefix }, uid) => {
    json[uid] = { userID, prefix };
  });
  res.json(json);
});

app.get("/commands", (req, res) => {
  const commands = {};
  global.NashBoT.commands.forEach((command, name) => {
    commands[name] = {
      description: command.description || "No description available",
      nashPrefix: command.nashPrefix,
    };
  });
  res.json(commands);
});

init().then(() => {
  app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
  });
});