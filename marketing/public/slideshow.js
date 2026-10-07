/* Screenshot slideshow. Dependency-free. Slides come from slides.json;
   a missing image degrades to a styled placeholder frame so the section
   looks intentional before screenshots are captured. */

(function () {
  var root = document.getElementById('slideshow');
  if (!root) return;

  var AUTO_MS = 5000;
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  fetch('slides.json')
    .then(function (res) { return res.json(); })
    .then(init)
    .catch(function () { root.hidden = true; });

  function el(tag, className, text) {
    var node = document.createElement(tag);
    if (className) node.className = className;
    if (text) node.textContent = text;
    return node;
  }

  function buildSlide(slide) {
    var frame = el('article', 'slide');

    var chrome = el('div', 'slide-chrome');
    for (var i = 0; i < 3; i++) chrome.appendChild(el('i'));
    frame.appendChild(chrome);

    var media = el('div', 'slide-media');
    var img = document.createElement('img');
    img.src = slide.src;
    img.alt = slide.headline;
    img.loading = 'lazy';
    img.addEventListener('error', function () {
      var placeholder = el('div', 'slide-placeholder');
      placeholder.appendChild(el('span', null, slide.headline));
      media.replaceChildren(placeholder);
    });
    media.appendChild(img);
    frame.appendChild(media);

    var caption = el('div', 'slide-caption');
    caption.appendChild(el('strong', null, slide.headline));
    caption.appendChild(el('span', null, slide.caption));
    frame.appendChild(caption);

    return frame;
  }

  function init(slides) {
    if (!Array.isArray(slides) || slides.length === 0) {
      root.hidden = true;
      return;
    }

    var frames = slides.map(buildSlide);
    frames.forEach(function (f) { root.appendChild(f); });

    var controls = el('div', 'slideshow-controls');
    var prevBtn = el('button', 'slide-btn', '←');
    prevBtn.type = 'button';
    prevBtn.setAttribute('aria-label', 'Previous slide');
    var nextBtn = el('button', 'slide-btn', '→');
    nextBtn.type = 'button';
    nextBtn.setAttribute('aria-label', 'Next slide');
    var dots = el('div', 'slide-dots');
    var dotButtons = slides.map(function (slide, i) {
      var dot = el('button', 'slide-dot');
      dot.type = 'button';
      dot.setAttribute('aria-label', 'Go to slide ' + (i + 1) + ': ' + slide.headline);
      dot.addEventListener('click', function () { show(i); });
      dots.appendChild(dot);
      return dot;
    });
    controls.appendChild(prevBtn);
    controls.appendChild(dots);
    controls.appendChild(nextBtn);
    root.after(controls);

    var index = 0;
    var timer = null;

    function show(i) {
      index = (i + frames.length) % frames.length;
      frames.forEach(function (f, j) {
        f.classList.toggle('active', j === index);
        f.setAttribute('aria-hidden', j === index ? 'false' : 'true');
      });
      dotButtons.forEach(function (d, j) {
        d.classList.toggle('active', j === index);
      });
    }

    function next() { show(index + 1); }
    function prev() { show(index - 1); }

    function start() {
      if (reduceMotion || timer) return;
      timer = setInterval(next, AUTO_MS);
    }
    function stop() {
      if (!timer) return;
      clearInterval(timer);
      timer = null;
    }

    prevBtn.addEventListener('click', function () { prev(); stop(); });
    nextBtn.addEventListener('click', function () { next(); stop(); });

    root.addEventListener('mouseenter', stop);
    root.addEventListener('mouseleave', start);
    root.addEventListener('focusin', stop);
    root.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowRight') { next(); stop(); }
      if (e.key === 'ArrowLeft') { prev(); stop(); }
    });

    show(0);
    start();
  }
})();
