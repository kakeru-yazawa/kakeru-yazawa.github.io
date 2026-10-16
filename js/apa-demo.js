// Pronunciation assessment demo: each button plays its recording; one plays at a time, and the playing
// button turns into a pause button.
(function () {
  var buttons = Array.prototype.slice.call(document.querySelectorAll(".apa-play"));
  buttons.forEach(function (button) {
    var audio = new Audio();
    audio.preload = "none";
    button.audio = audio;
    function set(on) { button.classList.toggle("playing", on); }
    button.addEventListener("click", function () {
      if (!audio.src) audio.src = button.dataset.src;   // loaded on first play
      if (audio.paused) {
        buttons.forEach(function (other) { if (other !== button && other.audio) other.audio.pause(); });
        audio.play();
      } else {
        audio.pause();
      }
    });
    audio.addEventListener("play", function () { set(true); });
    audio.addEventListener("pause", function () { set(false); });
    audio.addEventListener("ended", function () { set(false); audio.currentTime = 0; });
  });
})();
