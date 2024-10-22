const express = require("express");
const fileUpload = require('express-fileupload');
const fs = require('fs');
const http = require("http");
const WebSocket = require("ws");
const { createClient, LiveTranscriptionEvents } = require("@deepgram/sdk");
const url = require("url");
const path = require('path');
const dotenv = require("dotenv");
dotenv.config(); 
const { Blob } = require('blob-polyfill');
global.Blob = Blob; 
const { v4: uuidv4 } = require('uuid');
const ffmpeg = require('fluent-ffmpeg');

let deepgram = null;
const app = express();
app.use(fileUpload());

let connected = false;
let buffer = {};
let filePaths = {};
let fileLoaded = false;
// Stream audio in 20ms chunks
const CHUNK_DURATION_MS = 200; // 20ms chunk

// Ensure uploads directory exists
const uploadsDir = './uploads';
if (!fs.existsSync(uploadsDir)){
    fs.mkdirSync(uploadsDir);
}

const server = http.createServer(app);
const wss = new WebSocket.Server({ server });

const deepgramClient = createClient(process.env.DEEPGRAM_API_KEY);
let keepAlive;

function getAudioMetadata(filePath, callback) {
  ffmpeg.ffprobe(filePath, (err, metadata) => {
    if (err) {
      return callback(err);
    }

    const audioStream = metadata.streams.find(stream => stream.codec_type === 'audio');
    const sampleRate = parseInt(audioStream.sample_rate);
    const channels = audioStream.channels;
    const bytesPerSample = 2; // Assuming 16-bit PCM audio

    callback(null, { sampleRate, channels, bytesPerSample });
  });
}

function urlParamsToJson(url) {
  const params = new URLSearchParams(url.split('?')[1]);
  const jsonObject = {};

  for (const [key, value] of params.entries()) {
    if(key == 'params'){
      console.log('params:', value);
      let additionalParams = new URLSearchParams(value);
      for (const [key, value] of additionalParams.entries()) {
        jsonObject[key] = value;
      }
    }else {
      jsonObject[key] = value;
    }
  }

  return jsonObject;
}

function replayBuffer(fileId){
  if(fileLoaded){
    try{
      buffer[fileId].forEach((chunk, index) => {
        setTimeout(() => {
          if(filePaths[fileId]){
            if(index % 10 == 0){
              console.log("socket: buffer data sent to deepgram");
            }
            deepgram.send(chunk);
          } else {
            // console.log("socket: file not found skipping playback");
            // Skip sending to deepgram
          }
        }, CHUNK_DURATION_MS*index); // Delay each chunk by 20ms to simulate real-time streaming
      });
    } catch(e){
      console.log('Failed to replay buffer:', e);
    }
  } else {
    setTimeout(()=>{
      replayBuffer(fileId);
    }, 200);
  }
}

const setupDeepgram = (ws, parameters) => {
  if (!parameters.model) {
    parameters.model = "nova-2-general";
  }
  if(parameters.utterance_end_ms == ""){
      delete parameters.utterance_end_ms;
  }
  console.log('parameters:', parameters);
  try{
    deepgram = deepgramClient.listen.live(parameters);

    if (keepAlive) clearInterval(keepAlive);
    keepAlive = setInterval(() => {
      // console.log("deepgram: keepalive");
      deepgram.keepAlive();
    }, 10 * 1000);

    deepgram.addListener(LiveTranscriptionEvents.Open, async () => {
      console.log("deepgram: connected");
      connected = true;

      if(buffer[parameters.fileId] && buffer[parameters.fileId].length > 0){
        console.log("Playing buffer");
        replayBuffer(parameters.fileId);
      }

      deepgram.addListener(LiveTranscriptionEvents.Transcript, (data) => {
        // console.log("deepgram: packet received");
        // console.log("deepgram: transcript received");
        // console.log("socket: transcript sent to client");
        ws.send(JSON.stringify(data));
      });

      deepgram.on(LiveTranscriptionEvents.UtteranceEnd, (data) => {
        // console.log("deepgram: utterance end received");
        // console.log("socket: utterance end sent to client");
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

app.post('/upload', (req, res) => {
  console.log('/upload');
  if (!req.files || !req.files.audio) {
    return res.status(400).send('No audio file uploaded.');
  }

  const audioFile = req.files.audio;
  const fileId = uuidv4(); // Generate a unique ID for this file
  const audioPath = path.join(uploadsDir, `${fileId}-${audioFile.name}`);
  filePaths[fileId] = audioPath;
  buffer[fileId] = [];
  // Save the file to the uploads folder
  audioFile.mv(audioPath, (err) => {
    if (err) {
      return res.status(500).send(err);
    }
    console.log('/upload fileId:', fileId);
    res.json({ fileId });
  });
});

wss.on("connection", (ws, req) => {
  const parameters = urlParamsToJson(req.url);
  console.log("parameters:", parameters);
  console.log("socket: client connected");

  try { 
    let deepgram = setupDeepgram(ws, parameters);
    if(deepgram){

      if(parameters.fileId){
        console.log("socket: using fileId");
        fileLoaded = false;
        const audioFilePath = filePaths[parameters.fileId]; 
        getAudioMetadata(audioFilePath, (err, metadata) => {
          if (err) {
            console.error('Error getting sample rate:', err);
          } else {

            const { sampleRate, channels, bytesPerSample } = metadata;
            console.log(`Sample Rate: ${sampleRate}, Channels: ${channels}`);

            // Calculate the chunk size in bytes for 200ms chunks
            const chunkSizeInBytes = sampleRate * bytesPerSample * channels * (CHUNK_DURATION_MS / 1000);

            console.log(`Chunk Size (in bytes): ${chunkSizeInBytes}`);

            // Create a read stream with the calculated chunk size
            const readStream = fs.createReadStream(audioFilePath, { highWaterMark: chunkSizeInBytes });

            readStream.on('data', (chunk) => {
              buffer[parameters.fileId].push(chunk);
            });

            readStream.on('end', () => {
              // deepgram.requestClose(); // End the stream
              console.log('Audio file fully streamed to Deepgram.');
              fileLoaded = true;
              if(connected){
                if(buffer[parameters.fileId].length > 0){
                  console.log("Playing buffer");
                  replayBuffer(parameters.fileId);
                }
              }
            });
          }
        });
      } else {
        console.log("socket: using mic data");

        ws.on("message", (message) => {
          // console.log("socket: client data received");

          if (deepgram.getReadyState() === 1 /* OPEN */) {
            // console.log("socket: data sent to deepgram");
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
      }

      ws.on("close", () => {
        console.log("socket: client disconnected");
        let filePath = filePaths[parameters.fileId];
        try{
        fs.unlink(filePath, (err) => {
          if (err) {
            console.error('Error deleting file:', err);
          } else {
            console.log('File successfully deleted:', filePath);
          }
        });
        } catch(e){
          // console.log(e);
        }
        delete filePaths[parameters.fileId];
        delete buffer[parameters.fileId];
        deepgram.finish();
        deepgram.removeAllListeners();
        deepgram = null;
        connected = false;
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
