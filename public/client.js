const captions = window.document.getElementById("captions");
let interim_resultId = '';
let is_finals = [];
let connected = false;
let socket = null;
let microphone;
let fileId = null;

function updateUrlWithQueryParams(params){
    const searchParams = new URLSearchParams(params);
    const queryString = searchParams.toString();
  console.log('queryString', queryString)
    if (history.pushState) {
        var newurl = window.location.protocol + "//" + window.location.host + window.location.pathname + '?' + queryString;
        window.history.pushState({path:newurl},'',newurl);
    }
}

function loadUrlParams(){
    const queryString = window.location.search;
    const urlParams = new URLSearchParams(queryString);

    // Strings
    const model = urlParams.get('model') ? urlParams.get('model') : '';
    const language = urlParams.get('language') ? urlParams.get('language') : '';
    const endpointing = urlParams.get('endpointing') ? urlParams.get('endpointing') : '';
    const interim_results = urlParams.get('interim_results') ? urlParams.get('interim_results') : '';
    const utterance_end_ms = urlParams.get('utterance_end_ms') ? urlParams.get('utterance_end_ms') : '';
    const no_delay = urlParams.get('no_delay') ? urlParams.get('no_delay') : '';
    const smart_format = urlParams.get('smart_format') ? urlParams.get('smart_format') : '';
    const params = urlParams.get('params') ? urlParams.get('params') : '';
  
    if(model)
      setValue('model', model);
    if(language)
      setValue('language', language);
    if(endpointing)
      setValue('endpointing', endpointing);
    if(interim_results)
      setValue('interim_results', interim_results);
    if(utterance_end_ms)
      setValue('utterance_end_ms', utterance_end_ms);
    if(no_delay)
      setValue('no_delay', no_delay);
    if(smart_format)
      setValue('smart_format', smart_format);
    if(params)
      setValue('params', params);
}

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
    model: getValue('model'),
    language: getValue('language'),
    endpointing: getValue('endpointing'),
    interim_results: getValue('interim_results') == "false" ? false : true,
    utterance_end_ms: getValue('utterance_end_ms'),
    no_delay: getValue('no_delay') == "false" ? false : true,
    smart_format: getValue('smart_format') == "false" ? false : true,
    params: getValue('params'),
  };
}

function updateSettingsVals(settings){
  setValue('model', settings.model);
  setValue('language', settings.language);
  setValue('endpointing', settings.endpointing);
  setValue('interim_results', settings.interim_results);
  setValue('utterance_end_ms', settings.utterance_end_ms);
  setValue('no_delay', settings.no_delay);
  setValue('smart_format', settings.smart_format);
  setValue('params', settings.params);
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
  console.log(settings);
  if(fileId != null){
    settings.fileId = fileId;
  }
  if(settings.interim_results == false){
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
  
  updateUrlWithQueryParams(params);
  socket = new WebSocket("wss://deepgram-streaming-debugger.fly.dev?"+params);
  

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
    if(data){
      let interim_result = document.getElementById('interim_result');
      let log = document.getElementById('log');
      if (data.type == "Results" && data.channel.alternatives[0].transcript !== "") {  
          let duration = (data.start+data.duration).toFixed(2);
          let start = data.start.toFixed(2);
          if(data.is_final){
              is_finals.push(data.channel.alternatives[0].transcript);
              
              if(settings.diarize){
                let speaker_phrases = {}

                // Populate the dictionary with phrases for each speaker
                data.channel.alternatives[0].words.forEach((word)=>{
                  let speaker = word['speaker']
                  if (!speaker_phrases[speaker]){
                      speaker_phrases[speaker] = word['word'];
                  }
                  else{
                      // Add a space before the next word for the same speaker
                      speaker_phrases[speaker] += " " + word['word']
                  }
                });

                // Print the phrases for each speaker
                Object.keys(speaker_phrases).forEach((speaker)=>{
                    let phrase = speaker_phrases[speaker]
                    console.log(`Speaker ${speaker}: ${phrase}`)   
                    log.innerHTML += `Speaker ${speaker}: ${phrase}<br>`;
                })   
              }
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

                  log.innerHTML += `${start}-${duration} [Speech Final] ${is_finals.join(' ')}<br>`;

                  is_finals = [];
              } else {
                  if(interim_result){
                      interim_result.parentNode.removeChild(interim_result);
                  }
                  console.log('data', data);
                  // Add the is_final
                  captions.innerHTML += `<span class="is_final">${data.channel.alternatives[0].transcript}</span>`;
                  log.innerHTML += `${start}-${duration} &nbsp;&nbsp;[Is Final] ${data.channel.alternatives[0].transcript}<br>`;
              }
          } else {
              if(!interim_result){
                  captions.innerHTML += `<span id="interim_result">${data.channel.alternatives[0].transcript}</span>`;
              } else {
                  interim_result.innerHTML = `<span id="interim_result">${data.channel.alternatives[0].transcript}</span>`;
              }
              log.innerHTML += `${start}-${duration} &nbsp;&nbsp;&nbsp;&nbsp;[Interim Result] ${data.channel.alternatives[0].transcript}<br>`;
          }
      } else if (data.type == 'UtteranceEnd') {
        if(is_finals.length > 0){
          console.log(`[UtteranceEnd] ${is_finals.join(' ')}`);
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

          log.innerHTML += `[Utterance End] ${is_finals.join(' ')}<br>`;

          is_finals = [];
        }
      }
    }
  });

  socket.addEventListener("close", () => {
    console.log("WebSocket connection closed");
  });
}



  // Open a WebSocket connection to listen for Deepgram transcriptions
  function openWebSocket(fileId) {
    websocket = new WebSocket('ws://localhost:3000');

    websocket.onopen = function () {
        console.log('WebSocket connection established.');
    };

    websocket.onmessage = function (event) {
        console.log('Transcription:', event.data);
        transcriptionOutput.textContent += event.data + '\n'; // Append transcription result
    };

    websocket.onerror = function (error) {
        console.error('WebSocket error:', error);
    };

    websocket.onclose = function () {
        console.log('WebSocket connection closed.');
    };
}

function setupTabs(){
  const tabButtons = document.querySelectorAll('.tab-button');
  const tabContents = document.querySelectorAll('.tab-content');

  tabButtons.forEach(button => {
      button.addEventListener('click', (el) => {
          if(el.id != 'tab2'){
            fileId = null;
          }
          const targetTab = button.getAttribute('data-tab');

          // Remove active class from all buttons and contents
          tabButtons.forEach(btn => btn.classList.remove('active'));
          tabContents.forEach(content => content.classList.remove('active'));

          // Add active class to the clicked button and corresponding content
          button.classList.add('active');
          document.getElementById(targetTab).classList.add('active');
      });
  });
}

function setupFileUpload(){
  const form = document.getElementById('uploadForm');
  const transcriptionOutput = document.getElementById('transcriptionOutput');
  let websocket;

  form.addEventListener('submit', (event) => {
      event.preventDefault(); // Prevent the default form submission behavior

      const fileInput = document.getElementById('audioFile');
      const file = fileInput.files[0];
      if (!file) {
          alert('Please select an audio file.');
          return;
      }

      // Create a FormData object to hold the file
      const formData = new FormData();
      formData.append('audio', file);

      // Upload the file to the server via a POST request
      fetch('/upload', {
          method: 'POST',
          body: formData,
      })
      .then(response => response.json())
      .then(response => {
          if (response.fileId) {
              // Once the file is uploaded, start listening for transcription WebSocket messages
              fileId = response.fileId;
              startWebsocket();
          } else {
              alert('Failed to upload the file.');
          }
      })
      .catch(error => {
          console.error('Error during upload:', error);
          alert('Error uploading the file.');
      });
  });

}

document.addEventListener('DOMContentLoaded', () => {

  // Handle the file upload form
  
  setupTabs();

  setupFileUpload();
  
  loadUrlParams();
  
});