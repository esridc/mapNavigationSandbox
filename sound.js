export default (function () {

var source, audioCtx, myBuffer;

function soundSetup () {
  // use XHR to load audio file
  var request = new XMLHttpRequest();
  request.open('GET', 'blip.wav', true);
  request.responseType = 'arraybuffer';
  request.onload = function() {
    var data = request.response;

    if(window.webkitAudioContext) {
      audioCtx = new window.webkitAudioContext();
    } else {
      audioCtx = new window.AudioContext();
    }

    // use decodeAudioData to decode it and stick it in a buffer
    audioCtx.decodeAudioData(data, function(buffer) {
        myBuffer = buffer;
      },

      function(e){"Error with decoding audio data" + e.error}
    );
  }

  request.send();
}

function start() {
  // have to make a new source every time
  source = audioCtx.createBufferSource();
  source.buffer = myBuffer;
  source.connect(audioCtx.destination);
  source.start(0);
}

soundSetup();

return {
  start
}
})();