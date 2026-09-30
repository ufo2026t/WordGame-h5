const info = document.getElementById('splash-info');

try {
  const { boot } = await import('./app.js');
  await boot();
} catch (err) {
  if (info) info.textContent = `\u542f\u52a8\u5931\u8d25\uff1a${err.message || err}`;
  console.error(err);
}
