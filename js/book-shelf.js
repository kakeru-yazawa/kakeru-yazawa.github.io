// Selected publications shelf: on touch screens (no hover), the first tap on a cover opens the book
// to show the chapter title and authors; a tap on the open page follows the link.
// The book closes again when the reader taps anywhere else (the swung-open cover included),
// scrolls it out of view, or comes back after following a link.
// Devices with hover use the CSS :hover rule instead.
(function () {
  if (window.matchMedia("(hover: hover)").matches) return;
  var books = document.querySelectorAll(".book-shelf .book");
  function closeAll(except) {
    books.forEach(function (b) { if (b !== except) b.classList.remove("open"); });
  }
  books.forEach(function (book) {
    book.addEventListener("click", function (e) {
      if (book.classList.contains("open")) {
        if (e.target.closest(".book-cover")) {   // tap on the open cover: shut it
          e.preventDefault();
          book.classList.remove("open");
        }
        return;                                    // tap on the page: follow the link
      }
      e.preventDefault();
      closeAll(book);
      book.classList.add("open");
    });
  });
  document.addEventListener("click", function (e) {
    if (!e.target.closest(".book-shelf .book")) closeAll(null);
  });
  if ("IntersectionObserver" in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) { if (!en.isIntersecting) en.target.classList.remove("open"); });
    });
    books.forEach(function (b) { io.observe(b); });
  }
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState === "visible") closeAll(null);
  });
  window.addEventListener("pageshow", function () { closeAll(null); });
})();
