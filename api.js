async function fetchWithRetry(url, options = {}) {
  let attempts = 0;
  const maxAttempts = 3;
  const timeout = options.timeout || 20000;
  while (attempts < maxAttempts) {
    try {
      const controller = new AbortController();
      const id = setTimeout(() => controller.abort(), timeout);
      const response = await fetch(url, { ...options, signal: controller.signal });
      clearTimeout(id);
      if (!response.ok) throw new Error(`Respuesta de red no OK: ${response.status}`);
      return response;
    } catch (error) {
      attempts++;
      if (attempts >= maxAttempts) throw error;
      await new Promise(resolve => setTimeout(resolve, 1000 * attempts));
    }
  }
}

async function fetchWithRetryDownload(url, abortController) {
  let attempts = 0;
  const maxAttempts = 3;
  while (attempts < maxAttempts) {
    try {
      const timeout = 25000;
      const response = await fetch(url, { signal: abortController.signal });
      if (!response.ok) throw new Error(`Respuesta de red no OK: ${response.status}`);
      return response;
    } catch (error) {
      if (error.name === 'AbortError') throw error;
      attempts++;
      if (attempts >= maxAttempts) throw error;
      await new Promise(resolve => setTimeout(resolve, 25000));
    }
  }
}

async function downloadAsBlob(url, onProgress, abortController) {
  const response = await fetchWithRetry(url, { signal: abortController.signal });
  if (!response.body) {
    const blob = await response.blob();
    if (onProgress) onProgress(1);
    return blob;
  }
  const contentLengthHeader = response.headers.get("content-length");
  let total = contentLengthHeader ? parseInt(contentLengthHeader, 10) : 0;
  let loaded = 0;
  const reader = response.body.getReader();
  const chunks = [];
  let simulatedProgressInterval;
  if (!total && onProgress) {
    let simulatedProgress = 0.1;
    onProgress(simulatedProgress);
    simulatedProgressInterval = setInterval(() => {
      simulatedProgress = Math.min(simulatedProgress + 0.05, 0.95);
      onProgress(simulatedProgress);
    }, 500);
  }
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (total && onProgress) onProgress(loaded / total);
  }
  if (simulatedProgressInterval) {
    clearInterval(simulatedProgressInterval);
    onProgress(1);
  }
  return new Blob(chunks, { type: "audio/mpeg" });
}

async function searchPrincipal() {
  const query = sanitizeQuery(principalSearchInput.value);
  if (!query) {
    showToast("Por favor, ingresa una búsqueda válida.");
    return;
  }
  principalGrid.innerHTML = "<p style='grid-column:1/-1;'>Cargando...</p>";
  try {
    const url = `https://delirius-apiofc.vercel.app/search/ytsearch?q=${encodeURIComponent(query)}`;
    const res = await fetchWithRetry(url);
    const data = await res.json();
    if (!data.status) throw new Error("Error en la búsqueda (delirius)");
    displayPrincipalResults(data.data);
  } catch (err) {
    console.error(err);
    principalGrid.innerHTML = "<p style='grid-column:1/-1;'>Error en la búsqueda.</p>";
    showToast("Error al buscar canciones");
  }
}

async function searchBuscar() {
  const query = sanitizeQuery(buscarSearchInput.value);
  if (!query) {
    showToast("Por favor, ingresa una búsqueda válida.");
    return;
  }
  buscarList.innerHTML = "<p>Cargando...</p>";
  try {
    const url = `https://delirius-apiofc.vercel.app/search/searchtrack?q=${encodeURIComponent(query)}`;
    const res = await fetchWithRetry(url);
    const data = await res.json();
    const tracks = data.map(item => ({
      videoId: item.id,
      thumbnail: item.image,
      title: item.title,
      duration: item.duration.label,
      views: 0,
      useStreamApi: true
    }));
    displayBuscarResults(tracks);
  } catch (err) {
    console.error(err);
    buscarList.innerHTML = "<p>Error en la búsqueda.</p>";
    showToast("Error al buscar canciones");
  }
}

async function downloadSong(item, abortController, onProgress) {
  const apiUrl = `https://api.agatz.xyz/api/ytmp3?url=https://youtube.com/watch?v=${item.videoId}`;
  const resApi = await fetchWithRetryDownload(apiUrl, abortController);
  const jsonData = await resApi.json();
  if (jsonData.status !== 200 || !jsonData.data || jsonData.data.length === 0) throw new Error("Error en la conversión");
  let bestQualityObj = jsonData.data.reduce((prev, curr) => {
    return parseInt(curr.quality) > parseInt(prev.quality) ? curr : prev;
  });
  const downloadUrl = bestQualityObj.downloadUrl;
  const blob = await downloadAsBlob(downloadUrl, onProgress, abortController);
  const coverResponse = await fetchWithRetry(item.thumbnail);
  const coverBlob = await coverResponse.blob();
  saveSongToDB({ 
    videoId: item.videoId, 
    title: item.title, 
    thumbnail: item.thumbnail, 
    blob, 
    coverBlob, 
    duration: item.duration, 
    downloadTime: Date.now() 
  });
}

async function loadAndPlayCurrent() {
  if (currentIndex < 0 || currentIndex >= playQueue.length) return;
  const track = playQueue[currentIndex];
  if (track.audioUrl && track.audioUrl.startsWith("blob:")) {
    startPlayback();
    return;
  }
  if (!navigator.onLine) {
    showToast("No hay conexión a internet");
    if (currentIndex < playQueue.length - 1) {
      currentIndex++;
      loadAndPlayCurrent();
    } else {
      showToast("No hay más canciones disponibles offline");
      playerContainer.style.display = "none";
    }
    return;
  }
  document.getElementById("player-thumb-spinner").style.display = "block";
  try {
    const apiUrl = `https://ytdlpyton.nvlgroup.my.id/download/audio?url=https%3A%2F%2Fyoutube.com%2Fwatch%3Fv%3D${track.videoId}&mode=Url`;
    const resApi = await fetchWithRetry(apiUrl, {
      headers: { 'accept': 'application/json' }
    });
    const jsonData = await resApi.json();
    if (jsonData.status !== "Success" || !jsonData.download_url) {
      throw new Error("Error obteniendo enlace de streaming");
    }
    track.audioUrl = jsonData.download_url;
    document.getElementById("player-thumb-spinner").style.display = "none";
    startPlayback();
  } catch (err) {
    document.getElementById("player-thumb-spinner").style.display = "none";
    console.error("Error cargando stream:", err);
    showToast("Error reproduciendo la canción, saltando a la siguiente");
    if (currentIndex < playQueue.length - 1) {
      currentIndex++;
      loadAndPlayCurrent();
    } else {
      showToast("No hay más canciones en la cola");
      playerContainer.style.display = "none";
    }
  }
}