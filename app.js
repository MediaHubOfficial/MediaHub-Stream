// Registro del Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(reg => console.log('Service Worker registrado', reg))
    .catch(err => console.error('Error registrando SW', err));
}

// Función para sanitizar entradas de búsqueda
function sanitizeQuery(query) {
  return query
    .replace(/[<>[\]{}\\|]/g, "")
    .trim()
    .slice(0, 100);
}

// Función fetch con reintentos
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

// Función para descargar con 3 reintentos y espera de 25 seg solo si falla
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

// Función para descargar en blob con progreso
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
    if (total && onProgress) {
      onProgress(loaded / total);
    }
  }
  if (simulatedProgressInterval) {
    clearInterval(simulatedProgressInterval);
    onProgress(1);
  }
  return new Blob(chunks, { type: "audio/mpeg" });
}

// Variables globales
let db;
let audio = new Audio();
audio.autoplay = true;
audio.preload = "auto";
let playQueue = [];
let originalQueue = [];
let currentIndex = -1;
let isPlaying = false;
let repeatMode = false;
let shuffleMode = false;

// Elementos del reproductor y secciones
const playerContainer = document.getElementById("player-container");
const playerThumb = document.getElementById("player-thumb");
const playerTitle = document.getElementById("player-title");
const prevBtn = document.getElementById("prev-btn");
const playPauseBtn = document.getElementById("play-pause-btn");
const playIcon = document.getElementById("play-icon");
const pauseIcon = document.getElementById("pause-icon");
const nextBtn = document.getElementById("next-btn");
const shuffleBtn = document.getElementById("shuffle-btn");
const repeatBtn = document.getElementById("repeat-btn");
const progressBar = document.getElementById("progress-bar");
const currentTimeEl = document.getElementById("current-time");
const durationEl = document.getElementById("duration");

// Sección Principal
const principalSearchInput = document.getElementById("principal-search-input");
const principalSearchButton = document.getElementById("principal-search-button");
const principalGrid = document.getElementById("principal-grid");

// Sección Buscar
const buscarSearchInput = document.getElementById("buscar-search-input");
const buscarSearchButton = document.getElementById("buscar-search-button");
const buscarList = document.getElementById("buscar-list");

// Sección Biblioteca
const offlineSearchInput = document.getElementById("offline-search-input");
const offlineContainer = document.getElementById("offline-container");

// Contenedor de Toasts
const toastContainer = document.getElementById("toast-container");

// IndexedDB
const request = indexedDB.open("YTMusicDB", 2);
request.onupgradeneeded = (e) => {
  db = e.target.result;
  if (!db.objectStoreNames.contains("songs")) {
    const store = db.createObjectStore("songs", { keyPath: "videoId" });
    store.createIndex("downloadTime", "downloadTime", { unique: false });
  }
};
request.onsuccess = (e) => {
  db = e.target.result;
  loadOfflineSongs();
};
request.onerror = (e) => {
  console.error("Error al abrir IndexedDB:", e);
  showToast("Error al acceder al almacenamiento local");
};

// Recuperar estado desde localStorage
window.addEventListener("DOMContentLoaded", () => {
  const lastPrincipalQuery = localStorage.getItem("lastPrincipalQuery") || "";
  principalSearchInput.value = lastPrincipalQuery;
  const lastBuscarQuery = localStorage.getItem("lastBuscarQuery") || "";
  buscarSearchInput.value = lastBuscarQuery;

  const savedQueue = localStorage.getItem("playQueue");
  const savedIndex = localStorage.getItem("currentIndex");
  repeatMode = localStorage.getItem("repeatMode") === "true";
  shuffleMode = localStorage.getItem("shuffleMode") === "true" ? true : false;
  updateControlButtons();
  if (savedQueue) {
    playQueue = JSON.parse(savedQueue);
    originalQueue = [...playQueue];
    currentIndex = parseInt(savedIndex, 10) || 0;
    if (playQueue.length > 0 && currentIndex >= 0 && currentIndex < playQueue.length) {
      loadAndPlayCurrent();
    }
  }
});

window.addEventListener("beforeunload", () => {
  localStorage.setItem("lastPrincipalQuery", principalSearchInput.value.trim());
  localStorage.setItem("lastBuscarQuery", buscarSearchInput.value.trim());
  localStorage.setItem("playQueue", JSON.stringify(playQueue));
  localStorage.setItem("currentIndex", currentIndex.toString());
  localStorage.setItem("repeatMode", repeatMode.toString());
  localStorage.setItem("shuffleMode", shuffleMode.toString());
});

// Navegación entre secciones
const navButtons = document.querySelectorAll(".nav-btn");
navButtons.forEach(btn => {
  btn.addEventListener("click", () => {
    navButtons.forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const target = btn.getAttribute("data-target");
    showSection(target);
  });
});
function showSection(sectionId) {
  document.querySelectorAll(".section").forEach(sec => { sec.classList.remove("active"); });
  document.getElementById(sectionId).classList.add("active");
}

/* --- PRINCIPAL: Grid --- */
principalSearchButton.addEventListener("click", searchPrincipal);
principalSearchInput.addEventListener("keypress", (e) => { if (e.key === "Enter") searchPrincipal(); });
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
function displayPrincipalResults(results) {
  principalGrid.innerHTML = "";
  results.forEach((item, index) => {
    const card = document.createElement("div");
    card.classList.add("grid-card");
    card.innerHTML = `
      <img src="${item.thumbnail}" alt="${item.title}">
      <div class="grid-info">
        <h3>${item.title}</h3>
        <p>${item.duration} | ${item.views.toLocaleString()} vistas</p>
        <div class="buttons-container">
          <button class="play-btn">Play</button>
          <button class="download-btn">Descargar offline</button>
        </div>
      </div>
      <div class="download-progress">
        <progress value="0" max="100"></progress>
      </div>
      <div class="three-dots" style="display: none;">⋮</div>
      <div class="menu-options">
        <div class="save-to-phone">Guardar en Teléfono</div>
        <div class="delete-offline">Borrar</div>
      </div>
    `;
    const playBtn = card.querySelector(".play-btn");
    playBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      buildQueueAndPlay(results, index, true);
    });
    const downloadBtn = card.querySelector(".download-btn");
    let abortController = null;
    downloadBtn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (ev.target.classList.contains("cancel-download-btn") && abortController) {
        abortController.abort();
        abortController = null;
        const progressContainer = card.querySelector(".download-progress");
        downloadBtn.innerHTML = "Descargar offline";
        downloadBtn.style.display = "inline-block";
        progressContainer.style.display = "none";
        showToast("Descarga cancelada");
        return;
      }
      const videoId = item.videoId;
      const title = item.title;
      const thumb = item.thumbnail;
      const duration = item.duration;
      const tx = db.transaction(["songs"], "readonly");
      const store = tx.objectStore("songs");
      const req = store.get(videoId);
      req.onsuccess = async (e) => {
        if (e.target.result) {
          showToast("Ya descargaste esta canción");
          return;
        }
        showToast("Descargando...");
        try {
          abortController = new AbortController();
          downloadBtn.innerHTML = '<div class="spinner"></div>';
          setTimeout(() => {
            if (downloadBtn.innerHTML.includes('spinner')) {
              downloadBtn.innerHTML = '<button class="cancel-download-btn">✕</button>';
            }
          }, 1000);
          const progressContainer = card.querySelector(".download-progress");
          progressContainer.style.display = "block";
          const progressBar = progressContainer.querySelector("progress");
          const apiUrl = `https://api.agatz.xyz/api/ytmp3?url=https://youtube.com/watch?v=${videoId}`;
          const resApi = await fetchWithRetryDownload(apiUrl, abortController);
          const jsonData = await resApi.json();
          if (jsonData.status !== 200 || !jsonData.data || jsonData.data.length === 0) throw new Error("Error en la conversión");
          let bestQualityObj = jsonData.data.reduce((prev, curr) => {
            return parseInt(curr.quality) > parseInt(prev.quality) ? curr : prev;
          });
          const downloadUrl = bestQualityObj.downloadUrl;
          const blob = await downloadAsBlob(downloadUrl, (percent) => {
            progressBar.value = (percent * 100).toFixed(0);
          }, abortController);
          const coverResponse = await fetchWithRetry(thumb);
          const coverBlob = await coverResponse.blob();
          saveSongToDB({ videoId, title, thumbnail: thumb, blob, coverBlob, duration, downloadTime: Date.now() });
          showToast("Descargada offline en la app");
          downloadBtn.innerHTML = "Descargar offline";
          downloadBtn.style.display = "none";
          card.querySelector(".three-dots").style.display = "block";
          progressContainer.style.display = "none";
        } catch (err) {
          if (err.name === 'AbortError') {
            showToast("Descarga cancelada");
            downloadBtn.innerHTML = "Descargar offline";
            downloadBtn.style.display = "inline-block";
            progressContainer.style.display = "none";
          } else {
            console.error(err);
            showToast("Error al descargar la canción");
            downloadBtn.innerHTML = "Descargar offline";
            downloadBtn.style.display = "inline-block";
            progressContainer.style.display = "none";
          }
        } finally {
          abortController = null;
        }
      };
    });
    const threeDots = card.querySelector(".three-dots");
    const menuOptions = card.querySelector(".menu-options");
    threeDots.addEventListener("click", (ev) => {
      ev.stopPropagation();
      menuOptions.style.display = (menuOptions.style.display === "block") ? "none" : "block";
    });
    const saveToPhone = card.querySelector(".save-to-phone");
    const deleteOffline = card.querySelector(".delete-offline");
    saveToPhone.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const videoId = item.videoId;
      saveToPhoneOffline(videoId);
      menuOptions.style.display = "none";
    });
    deleteOffline.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const videoId = item.videoId;
      deleteSongOffline(videoId);
      menuOptions.style.display = "none";
    });
    checkIfDownloaded(item.videoId, downloadBtn, threeDots);
    principalGrid.appendChild(card);
  });
}

/* --- BUSCAR: Reproducción y descarga offline --- */
buscarSearchButton.addEventListener("click", searchBuscar);
buscarSearchInput.addEventListener("keypress", (e) => { if (e.key === "Enter") searchBuscar(); });
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
function displayBuscarResults(results) {
  buscarList.innerHTML = "";
  results.forEach((item, index) => {
    const div = document.createElement("div");
    div.classList.add("search-item");
    div.dataset.videoId = item.videoId;
    div.innerHTML = `
      <img src="${item.thumbnail}" alt="${item.title}">
      <div class="search-info">
        <h3>${item.title}</h3>
        <p>${item.duration} | ${item.views.toLocaleString()} vistas</p>
        <div class="buttons-container">
          <button class="play-btn">Play</button>
          <button class="download-btn">Descargar offline</button>
        </div>
        <div class="download-progress">
          <progress value="0" max="100"></progress>
        </div>
      </div>
      <div class="three-dots" style="display: none;">⋮</div>
      <div class="menu-options">
        <div class="save-to-phone">Guardar en Teléfono</div>
        <div class="delete-offline">Borrar</div>
      </div>
    `;
    const playBtn = div.querySelector(".play-btn");
    playBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      buildQueueAndPlay(results, index, true);
    });
    const downloadBtn = div.querySelector(".download-btn");
    let abortController = null;
    downloadBtn.addEventListener("click", async (ev) => {
      ev.stopPropagation();
      if (ev.target.classList.contains("cancel-download-btn") && abortController) {
        abortController.abort();
        abortController = null;
        const progressContainer = div.querySelector(".download-progress");
        downloadBtn.innerHTML = "Descargar offline";
        downloadBtn.style.display = "inline-block";
        progressContainer.style.display = "none";
        showToast("Descarga cancelada");
        return;
      }
      const videoId = item.videoId;
      const title = item.title;
      const thumb = item.thumbnail;
      const duration = item.duration;
      const tx = db.transaction(["songs"], "readonly");
      const store = tx.objectStore("songs");
      const req = store.get(videoId);
      req.onsuccess = async (e) => {
        if (e.target.result) {
          showToast("Ya descargaste esta canción");
          return;
        }
        showToast("Descargando...");
        try {
          abortController = new AbortController();
          downloadBtn.innerHTML = '<div class="spinner"></div>';
          setTimeout(() => {
            if (downloadBtn.innerHTML.includes('spinner')) {
              downloadBtn.innerHTML = '<button class="cancel-download-btn">✕</button>';
            }
          }, 1000);
          const progressContainer = div.querySelector(".download-progress");
          progressContainer.style.display = "block";
          const progressBar = progressContainer.querySelector("progress");
          const apiUrl = `https://api.agatz.xyz/api/ytmp3?url=https://youtube.com/watch?v=${videoId}`;
          const resApi = await fetchWithRetryDownload(apiUrl, abortController);
          const jsonData = await resApi.json();
          if (jsonData.status !== 200 || !jsonData.data || jsonData.data.length === 0) throw new Error("Error en la conversión");
          let bestQualityObj = jsonData.data.reduce((prev, curr) => {
            return parseInt(curr.quality) > parseInt(prev.quality) ? curr : prev;
          });
          const downloadUrl = bestQualityObj.downloadUrl;
          const blob = await downloadAsBlob(downloadUrl, (percent) => {
            progressBar.value = (percent * 100).toFixed(0);
          }, abortController);
          const coverResponse = await fetchWithRetry(thumb);
          const coverBlob = await coverResponse.blob();
          saveSongToDB({ videoId, title, thumbnail: thumb, blob, coverBlob, duration, downloadTime: Date.now() });
          showToast("Descargada offline en la app");
          downloadBtn.innerHTML = "Descargar offline";
          downloadBtn.style.display = "none";
          div.querySelector(".three-dots").style.display = "block";
          progressContainer.style.display = "none";
        } catch (err) {
          if (err.name === 'AbortError') {
            showToast("Descarga cancelada");
            downloadBtn.innerHTML = "Descargar offline";
            downloadBtn.style.display = "inline-block";
            progressContainer.style.display = "none";
          } else {
            console.error(err);
            showToast("Error al descargar la canción");
            downloadBtn.innerHTML = "Descargar offline";
            downloadBtn.style.display = "inline-block";
            progressContainer.style.display = "none";
          }
        } finally {
          abortController = null;
        }
      };
    });
    const threeDots = div.querySelector(".three-dots");
    const menuOptions = div.querySelector(".menu-options");
    threeDots.addEventListener("click", (ev) => {
      ev.stopPropagation();
      menuOptions.style.display = (menuOptions.style.display === "block") ? "none" : "block";
    });
    const saveToPhone = div.querySelector(".save-to-phone");
    const deleteOffline = div.querySelector(".delete-offline");
    saveToPhone.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const videoId = item.videoId;
      saveToPhoneOffline(videoId);
      menuOptions.style.display = "none";
    });
    deleteOffline.addEventListener("click", (ev) => {
      ev.stopPropagation();
      const videoId = item.videoId;
      deleteSongOffline(videoId);
      menuOptions.style.display = "none";
    });
    checkIfDownloaded(item.videoId, downloadBtn, threeDots);
    buscarList.appendChild(div);
  });
}
function checkIfDownloaded(videoId, downloadBtn, threeDots) {
  const tx = db.transaction(["songs"], "readonly");
  const store = tx.objectStore("songs");
  const req = store.get(videoId);
  req.onsuccess = (e) => {
    if (e.target.result) {
      downloadBtn.style.display = "none";
      threeDots.style.display = "block";
    } else {
      downloadBtn.style.display = "inline-block";
      threeDots.style.display = "none";
    }
  };
}
function deleteSongOffline(videoId) {
  const tx = db.transaction(["songs"], "readwrite");
  const store = tx.objectStore("songs");
  store.delete(videoId);
  tx.oncomplete = () => {
    loadOfflineSongs();
    showToast("Canción borrada");
    const item = [...document.querySelectorAll(".search-item")].find(el => el.dataset.videoId === videoId);
    if (item) {
      const downloadBtn = item.querySelector(".download-btn");
      const threeDots = item.querySelector(".three-dots");
      if (downloadBtn) downloadBtn.style.display = "inline-block";
      if (threeDots) threeDots.style.display = "none";
    }
  };
}
async function saveToPhoneOffline(videoId) {
  const tx = db.transaction(["songs"], "readonly");
  const store = tx.objectStore("songs");
  const req = store.get(videoId);
  req.onsuccess = (e) => {
    const song = e.target.result;
    if (!song || !song.blob) return;
    const blobUrl = URL.createObjectURL(song.blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = song.title.replace(/[^a-zA-Z0-9]/g, "_") + ".mp3";
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast("Canción guardada en tu teléfono");
  };
}

/* --- Creación de cola y reproducción --- */
async function buildQueueAndPlay(list, startIndex, clearQueue = false) {
  if (clearQueue) {
    playQueue = [];
    originalQueue = [];
  }
  for (const item of list) {
    const song = await new Promise(resolve => {
      const tx = db.transaction(["songs"], "readonly");
      const store = tx.objectStore("songs");
      const req = store.get(item.videoId);
      req.onsuccess = (e) => resolve(e.target.result);
      req.onerror = () => resolve(null);
    });
    playQueue.push({
      videoId: item.videoId,
      title: item.title,
      thumbnail: song ? (song.coverBlob ? URL.createObjectURL(song.coverBlob) : song.thumbnail) : item.thumbnail,
      audioUrl: song ? URL.createObjectURL(song.blob) : null,
      duration: item.duration || song?.duration || "",
      useStreamApi: !song
    });
  }
  originalQueue = [...playQueue];
  if (shuffleMode) {
    shuffleQueue();
  }
  currentIndex = startIndex;
  loadAndPlayCurrent();
}

function shuffleQueue() {
  const currentTrack = playQueue[currentIndex];
  const otherTracks = playQueue.filter((_, i) => i !== currentIndex);
  for (let i = otherTracks.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [otherTracks[i], otherTracks[j]] = [otherTracks[j], otherTracks[i]];
  }
  playQueue = [...otherTracks.slice(0, currentIndex), currentTrack, ...otherTracks.slice(currentIndex)];
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
    const apiUrl = `https://api.agatz.xyz/api/ytmp3?url=https://youtube.com/watch?v=${track.videoId}`;
    const resApi = await fetchWithRetry(apiUrl);
    const jsonData = await resApi.json();
    if (jsonData.status !== 200 || !jsonData.data || jsonData.data.length === 0) {
      throw new Error("Error obteniendo enlace de streaming");
    }
    let bestQualityObj = jsonData.data.reduce((prev, curr) => {
      return parseInt(curr.quality) > parseInt(prev.quality) ? curr : prev;
    });
    track.audioUrl = bestQualityObj.downloadUrl;
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

function startPlayback() {
  const track = playQueue[currentIndex];
  if (!track.audioUrl) {
    showToast("No se pudo cargar la canción");
    return;
  }
  audio.src = track.audioUrl;
  audio.load();
  audio.play().catch(err => {
    console.error("Error al reproducir:", err);
    showToast("Error reproduciendo la canción, saltando a la siguiente");
    if (currentIndex < playQueue.length - 1) {
      currentIndex++;
      loadAndPlayCurrent();
    } else {
      showToast("No hay más canciones en la cola");
      playerContainer.style.display = "none";
    }
  });
  playerThumb.src = track.thumbnail || "";
  playerTitle.textContent = track.title || "Sin título";
  playerContainer.style.display = "flex";
  isPlaying = true;
  updatePlayPauseIcon();
  updateMediaSession(track);
}

function updateMediaSession(track) {
  if ('mediaSession' in navigator) {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: track.title,
      artwork: [
        { src: track.thumbnail, sizes: "96x96", type: "image/png" },
        { src: track.thumbnail, sizes: "128x128", type: "image/png" },
        { src: track.thumbnail, sizes: "192x192", type: "image/png" }
      ]
    });
    navigator.mediaSession.setActionHandler('play', () => { audio.play(); });
    navigator.mediaSession.setActionHandler('pause', () => { audio.pause(); });
    navigator.mediaSession.setActionHandler('previoustrack', () => {
      if (currentIndex > 0) { currentIndex--; loadAndPlayCurrent(); }
    });
    navigator.mediaSession.setActionHandler('nexttrack', () => {
      if (currentIndex < playQueue.length - 1) { currentIndex++; loadAndPlayCurrent(); }
    });
  }
}

audio.addEventListener("timeupdate", () => {
  if (audio.duration) {
    const percent = (audio.currentTime / audio.duration) * 100;
    progressBar.value = percent;
    currentTimeEl.textContent = formatTime(audio.currentTime);
    durationEl.textContent = formatTime(audio.duration);
  }
});
progressBar.addEventListener("input", () => {
  if (audio.duration) {
    const seekTime = (progressBar.value / 100) * audio.duration;
    audio.currentTime = seekTime;
  }
});
audio.addEventListener("ended", () => {
  progressBar.value = 0;
  currentTimeEl.textContent = "0:00";
  isPlaying = false;
  updatePlayPauseIcon();
  if (repeatMode) {
    audio.currentTime = 0;
    audio.play();
    isPlaying = true;
    updatePlayPauseIcon();
  } else if (currentIndex < playQueue.length - 1) {
    currentIndex++;
    loadAndPlayCurrent();
  } else {
    showToast("Fin de la cola de reproducción");
    playerContainer.style.display = "none";
  }
});
prevBtn.addEventListener("click", () => {
  if (currentIndex > 0) {
    currentIndex--;
    loadAndPlayCurrent();
  }
});
nextBtn.addEventListener("click", () => {
  if (currentIndex < playQueue.length - 1) {
    currentIndex++;
    loadAndPlayCurrent();
  }
});
playPauseBtn.addEventListener("click", () => {
  if (audio.paused) {
    audio.play();
    isPlaying = true;
  } else {
    audio.pause();
    isPlaying = false;
  }
  updatePlayPauseIcon();
});
shuffleBtn.addEventListener("click", () => {
  shuffleMode = !shuffleMode;
  updateControlButtons();
  if (shuffleMode) {
    shuffleQueue();
  } else {
    const currentTrack = playQueue[currentIndex];
    playQueue = [...originalQueue];
    currentIndex = playQueue.findIndex(track => track.videoId === currentTrack.videoId);
  }
  showToast(shuffleMode ? "Reproducción aleatoria activada" : "Reproducción aleatoria desactivada");
});
repeatBtn.addEventListener("click", () => {
  repeatMode = !repeatMode;
  updateControlButtons();
  audio.loop = repeatMode;
  showToast(repeatMode ? "Repetición activada" : "Repetición desactivada");
});
audio.addEventListener("play", () => { isPlaying = true; updatePlayPauseIcon(); });
audio.addEventListener("pause", () => { isPlaying = false; updatePlayPauseIcon(); });
function updatePlayPauseIcon() {
  if (isPlaying) {
    pauseIcon.style.display = "block";
    playIcon.style.display = "none";
  } else {
    pauseIcon.style.display = "none";
    playIcon.style.display = "block";
  }
}
function updateControlButtons() {
  shuffleBtn.classList.toggle("active", shuffleMode);
  repeatBtn.classList.toggle("active", repeatMode);
}
function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0"+s : s}`;
}

/* --- BIBLIOTECA: Buscador de canciones descargadas --- */
offlineSearchInput.addEventListener("input", filterOfflineSongs);
function filterOfflineSongs() {
  const query = sanitizeQuery(offlineSearchInput.value).toLowerCase();
  loadOfflineSongs(query);
}
function loadOfflineSongs(filterQuery = "") {
  if (!db) return;
  offlineContainer.innerHTML = "<p>Cargando...</p>";
  const tx = db.transaction(["songs"], "readonly");
  const store = tx.objectStore("songs");
  const req = store.index("downloadTime").openCursor(null, "prev");
  const songs = [];
  req.onsuccess = (e) => {
    const cursor = e.target.result;
    if (cursor) {
      songs.push(cursor.value);
      cursor.continue();
    } else {
      offlineContainer.innerHTML = "";
      if (!songs || songs.length === 0) {
        offlineContainer.innerHTML = "<p>No hay canciones descargadas.</p>";
        return;
      }
      const filteredSongs = filterQuery !== null && filterQuery !== undefined
        ? songs.filter(song => song.title.toLowerCase().includes(filterQuery))
        : songs;
      if (filteredSongs.length === 0) {
        offlineContainer.innerHTML = "<p>No se encontraron canciones.</p>";
        return;
      }
      filteredSongs.forEach(song => {
        const coverUrl = song.coverBlob ? URL.createObjectURL(song.coverBlob) : song.thumbnail;
        const div = document.createElement("div");
        div.classList.add("offline-item");
        div.onclick = (ev) => {
          if (ev.target.classList.contains("three-dots") || ev.target.parentNode.classList.contains("menu-options")) { return; }
          playOffline(song.videoId);
        };
        div.innerHTML = `
          <div class="offline-left">
            <img src="${coverUrl}" alt="${song.title}">
            <div class="offline-info">
              <span>${song.title}</span>
              <p>${song.duration || "Desconocida"}</p>
            </div>
          </div>
          <div class="three-dots" onclick="openMenu(event, '${song.videoId}')">⋮</div>
          <div class="menu-options" id="menu-${song.videoId}">
            <div onclick="deleteSong(event, '${song.videoId}')">Borrar</div>
            <div onclick="saveToPhone(event, '${song.videoId}')">Guardar en Teléfono</div>
          </div>
        `;
        offlineContainer.appendChild(div);
      });
    }
  };
  req.onerror = () => {
    offlineContainer.innerHTML = "<p>Error al cargar canciones.</p>";
    showToast("Error al cargar canciones descargadas");
  };
}
function saveSongToDB(songData) {
  const tx = db.transaction(["songs"], "readwrite");
  const store = tx.objectStore("songs");
  store.put(songData);
  tx.oncomplete = () => {
    loadOfflineSongs(null);
    updateBuscarDownloaded(songData.videoId);
  };
  tx.onerror = () => {
    console.error("Error guardando la canción en IndexedDB.");
    showToast("Error al guardar la canción");
  };
}
function updateBuscarDownloaded(videoId) {
  const item = [...document.querySelectorAll(".search-item")].find(el => el.dataset.videoId === videoId);
  if (item) {
    const downloadBtn = item.querySelector(".download-btn");
    const threeDots = item.querySelector(".three-dots");
    if (downloadBtn) downloadBtn.style.display = "none";
    if (threeDots) threeDots.style.display = "block";
  }
}
function playOffline(videoId) {
  const tx = db.transaction(["songs"], "readonly");
  const store = tx.objectStore("songs");
  const req = store.getAll();
  req.onsuccess = (e) => {
    const songs = e.target.result;
    if (!songs || songs.length === 0) return;
    playQueue = songs.map(song => ({
      videoId: song.videoId,
      title: song.title,
      thumbnail: song.coverBlob ? URL.createObjectURL(song.coverBlob) : song.thumbnail,
      audioUrl: URL.createObjectURL(song.blob),
      duration: song.duration || ""
    }));
    originalQueue = [...playQueue];
    currentIndex = playQueue.findIndex(item => item.videoId === videoId);
    if (currentIndex < 0) currentIndex = 0;
    if (shuffleMode) {
      shuffleQueue();
    }
    loadAndPlayCurrent();
  };
}
window.openMenu = function(event, videoId) {
  event.stopPropagation();
  const menu = document.getElementById(`menu-${videoId}`);
  menu.style.display = (menu.style.display === "block") ? "none" : "block";
};
window.deleteSong = function(event, videoId) {
  event.stopPropagation();
  const tx = db.transaction(["songs"], "readwrite");
  const store = tx.objectStore("songs");
  store.delete(videoId);
  tx.oncomplete = () => {
    loadOfflineSongs();
    showToast("Canción borrada");
    const item = [...document.querySelectorAll(".search-item")].find(el => el.dataset.videoId === videoId);
    if (item) {
      const downloadBtn = item.querySelector(".download-btn");
      const threeDots = item.querySelector(".three-dots");
      if (downloadBtn) downloadBtn.style.display = "inline-block";
      if (threeDots) threeDots.style.display = "none";
    }
  };
};
window.saveToPhone = async function(event, videoId) {
  event.stopPropagation();
  const tx = db.transaction(["songs"], "readonly");
  const store = tx.objectStore("songs");
  const req = store.get(videoId);
  req.onsuccess = (e) => {
    const song = e.target.result;
    if (!song || !song.blob) return;
    const blobUrl = URL.createObjectURL(song.blob);
    const a = document.createElement("a");
    a.href = blobUrl;
    a.download = song.title.replace(/[^a-zA-Z0-9]/g, "_") + ".mp3";
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast("Canción guardada en tu teléfono");
  };
};

function showToast(message) {
  const toast = document.createElement("div");
  toast.classList.add("toast");
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => { toast.remove(); }, 3500);
}