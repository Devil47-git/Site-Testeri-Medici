if (location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
  if (!window.si) {
    window.si = function (...params) {
      window.siq = window.siq || [];
      window.siq.push(params);
    };
  }

  const script = document.createElement('script');
  script.src = '/_vercel/speed-insights/script.js';
  script.defer = true;
  script.dataset.sdkn = '@vercel/speed-insights/html';
  script.dataset.sdkv = '2.1.0';
  document.head.appendChild(script);
}
