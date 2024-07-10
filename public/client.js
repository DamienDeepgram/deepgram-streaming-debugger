const captions = window.document.getElementById("captions");
let interim_resultId = '';
let is_finals = [];
let connected = false;
let socket = null;
let microphone;
async function getMicrophone() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    return new MediaRecorder(stream);
  } catch (error) {
    console.error("Error accessing microphone:", error);
    throw error;
  }
}

function jsonToUrlParams(json) {
  const params = new URLSearchParams();

  for (let key in json) {
      if (json.hasOwnProperty(key)) {
          params.append(key, json[key]);
      }
  }

  return params.toString();
}

async function openMicrophone(microphone, socket) {
  return new Promise((resolve) => {
    microphone.onstart = () => {
      console.log("WebSocket connection opened");
      document.body.classList.add("recording");
      resolve();
    };

    microphone.onstop = () => {
      console.log("WebSocket connection closed");
      document.body.classList.remove("recording");
    };

    microphone.ondataavailable = (event) => {
      if (event.data.size > 0 && socket.readyState === WebSocket.OPEN) {
        socket.send(event.data);
      }
    };

    microphone.start(1000);
  });
}

async function closeMicrophone(microphone) {
  microphone.stop();
}

function getValue(el){
  return document.getElementById(el).value;
}

function setValue(el, val){
  document.getElementById(el).value = val;
}

function getSettings(){
  return {
    endpointing: getValue('endpointing'),
    interim_results: getValue('interim_results'),
    utterance_end_ms: getValue('utterance_end_ms'),
    no_delay: getValue('no_delay'),
    smart_format: getValue('smart_format'),
  };
}

function updateSettingsVals(settings){
  setValue('endpointing', settings.endpointing);
  setValue('interim_results', settings.interim_results);
  setValue('utterance_end_ms', settings.utterance_end_ms);
  setValue('no_delay', settings.no_delay);
  setValue('smart_format', settings.smart_format);
}

async function start(socket) {
  const listenButton = document.querySelector("#record");

  console.log("client: waiting to open microphone");

  listenButton.addEventListener("click", async () => {
    if (!microphone) {
      try {
        microphone = await getMicrophone();
        await openMicrophone(microphone, socket);
      } catch (error) {
        console.error("Error opening microphone:", error);
      }
    } else {
      await closeMicrophone(microphone);
      microphone = undefined;
    }
  });
}

async function updateSettings(){
  if(connected){
    await closeMicrophone(microphone);
    microphone = undefined;
    socket.send(JSON.stringify({ 'type': 'CloseStream' }));
    socket.close();
    connected = false;
    document.getElementById('status').innerHTML = 'Disconnected';
    document.getElementById('status').className = 'disconnected';
    document.getElementById('captions').innerHTML = '';
    document.getElementById('log').innerHTML = '';
  }
  setTimeout(()=>{
    startWebsocket();
  }, 1000)
}

function startWebsocket(){
  let settings = getSettings();
  if(settings.interim_results == 'false'){
    settings.utterance_end_ms = '';
  }
  if(parseInt(settings.utterance_end_ms) < 1000){
    settings.utterance_end_ms = 1000;
  }
  if(parseInt(settings.utterance_end_ms) > 5000){
    settings.utterance_end_ms = 5000;
  }

  updateSettingsVals(settings);

  let params = jsonToUrlParams(settings);
  //endpointing=300&interim_results=true&utterance_end_ms=1000&&no_delay=true&smart_format=true
  socket = new WebSocket("ws://localhost:3000?"+params);

  socket.addEventListener("open", async () => {
    connected = true;
    console.log("WebSocket connection opened");
    document.getElementById('settings_btn').value = 'Update Settings';
    document.getElementById('settings_btn').style.backgroundColor = '#34f037';
    document.getElementById('status').innerHTML = 'Connected';
    document.getElementById('status').className = 'connected';
    await start(socket);
  });

  socket.addEventListener("message", (event) => {
    const data = JSON.parse(event.data);
    if (data && data.channel.alternatives[0].transcript !== "") {
      let interim_result = document.getElementById('interim_result');
      let log = document.getElementById('log');
        if(data.is_final){
            is_finals.push(data.channel.alternatives[0].transcript)
            if(data.speech_final){
                if(interim_result){
                    interim_result.parentNode.removeChild(interim_result);
                }
                // Remove the is_final=true
                let isFinals = document.getElementsByClassName('is_final');
                Array.from(isFinals).forEach((isFinal)=>{
                    isFinal.parentNode.removeChild(isFinal);
                })
                // Add the speech_final
                captions.innerHTML += `<span class="speech_final">${is_finals.join(' ')}</span>`;

                log.innerHTML += `[Speech Final] ${is_finals.join(' ')}<br>`;

                is_finals = [];
            } else {
                if(interim_result){
                    interim_result.parentNode.removeChild(interim_result);
                }
                // Add the is_final
                captions.innerHTML += `<span class="is_final">${data.channel.alternatives[0].transcript}</span>`;
                log.innerHTML += `&nbsp;&nbsp;[Is Final] ${data.channel.alternatives[0].transcript}<br>`;
            }
        } else {
            if(!interim_result){
                captions.innerHTML += `<span id="interim_result">${data.channel.alternatives[0].transcript}</span>`;
            } else {
                interim_result.innerHTML = `<span id="interim_result">${data.channel.alternatives[0].transcript}</span>`;
            }
            log.innerHTML += `&nbsp;&nbsp;&nbsp;&nbsp;[Interim Result] ${data.channel.alternatives[0].transcript}<br>`;
        }
    }
  });

  socket.addEventListener("close", () => {
    console.log("WebSocket connection closed");
  });
}

window.addEventListener("load", () => {
  
});