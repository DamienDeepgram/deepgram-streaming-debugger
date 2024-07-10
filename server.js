const express = require("express");
const http = require("http");
const WebSocket = require("ws");
const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const url = require("url");
const dotenv = require("dotenv");
dotenv.config();

const app = express();
const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);
let keepAlive;

function urlParamsToJson(url) {
  const params = new URLSearchParams(url.split('?')[1]);
  const jsonObject = {};

  for (const [key, value] of params.entries()) {
      jsonObject[key] = value;
  }

  return jsonObject;
}

const setupDeepgram = (ws, parameters) => {
  if (!parameters.model) {
    parameters.model = "nova-2-general";
  }
  let deepgram = null;
  try{
    deepgram = deepgramClient.listen.live(parameters);

    if (keepAlive) clearInterval(keepAlive);
    keepAlive = setInterval(() => {
      console.log("deepgram: keepalive");
      deepgram.keepAlive();
    }, 10 * 1000);

    deepgram.addListener(LiveTranscriptionEvents.Open, async () => {
      console.log("deepgram: connected");

      deepgram.addListener(LiveTranscriptionEvents.Transcript, (data) => {
        console.log("deepgram: packet received");
        console.log("deepgram: transcript received");
        console.log("socket: transcript sent to client");
        ws.send(JSON.stringify(data));
      });

      deepgram.on(LiveTranscriptionEvents.UtteranceEnd, (data) => {
        console.log("deepgram: utterance end received");
        console.log("socket: utterance end sent to client");
        ws.send(JSON.stringify(data));
      });

      deepgram.addListener(LiveTranscriptionEvents.Close, async () => {
        console.log("deepgram: disconnected");
        clearInterval(keepAlive);
        deepgram.finish();
      });

      deepgram.addListener(LiveTranscriptionEvents.Error, async (error) => {
        console.log("deepgram: error received");
        console.error(error);
      });

      deepgram.addListener(LiveTranscriptionEvents.Warning, async (warning) => {
        console.log("deepgram: warning received");
        console.warn(warning);
      });

      deepgram.addListener(LiveTranscriptionEvents.Metadata, (data) => {
        console.log("deepgram: packet received");
        console.log("deepgram: metadata received");
        console.log("ws: metadata sent to client");
        ws.send(JSON.stringify({ metadata: data }));
      });
    });
  } catch(e){
    console.log('Failed to connect to Deepgram: ', e);
  }

  return deepgram;
};

wss.on("connection", (ws, req) => {
  const parameters = urlParamsToJson(req.url);
  console.log("parameters:", parameters);
  console.log("socket: client connected");

  try { 
    let deepgram = setupDeepgram(ws, parameters);
      if(deepgram){

      ws.on("message", (message) => {
        console.log("socket: client data received");

        if (deepgram.getReadyState() === 1 /* OPEN */) {
          console.log("socket: data sent to deepgram");
          deepgram.send(message);
        } else if (deepgram.getReadyState() >= 2 /* 2 = CLOSING, 3 = CLOSED */) {
          console.log("socket: data couldn't be sent to deepgram");
          console.log("socket: retrying connection to deepgram");
          /* Attempt to reopen the Deepgram connection */
          // deepgram.finish();
          // deepgram.removeAllListeners();
          // deepgram = setupDeepgram(socket);
        } else {
          console.log("socket: data couldn't be sent to deepgram");
        }
      });

      ws.on("close", () => {
        console.log("socket: client disconnected");
        deepgram.finish();
        deepgram.removeAllListeners();
        deepgram = null;
      });
    } else {
      ws.send(JSON.stringify({error: 'invalid params'}))
    }

  } catch(e){
    console.log('Failed to start websocket:', e);
  }
});

app.use(express.static("public/"));
app.get("/", (req, res) => {
  res.sendFile(__dirname + "/public/index.html");
});

server.listen(3000, () => {
  console.log("Server is listening on port 3000");
});
