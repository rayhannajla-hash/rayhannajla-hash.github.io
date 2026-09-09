document.getElementById('yr').textContent = new Date().getFullYear();
var btn = document.getElementById('themeBtn');
var root = document.documentElement;
var saved = localStorage.getItem('theme');
if (saved) root.setAttribute('data-theme', saved);
btn.addEventListener('click', function () {
  var prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
  var current = root.getAttribute('data-theme') || (prefersDark ? 'dark' : 'light');
  var next = current === 'dark' ? 'light' : 'dark';
  root.setAttribute('data-theme', next);
  localStorage.setItem('theme', next);
});
