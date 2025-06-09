// Registro del Service Worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js')
    .then(reg => console.log('Service Worker registrado', reg))
    .catch(err => console.error('Error registrando SW', err));
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

// Elementos del DOM
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
const principalSearchInput = document.getElementById("principal-search-input");
const principalSearchButton = document.getElementById("principal-search-button");
const principalGrid = document.getElementById("principal-grid");
const buscarSearchInput = document.getElementById("buscar-search-input");
const buscarSearchButton = document.getElementById("buscar-search-button");
const buscarList = document.getElementById("buscar-list");
const offlineSearchInput = document.getElementById("offline-search-input");
const offlineContainer = document.getElementById("offline-container");
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
  principalSearchInput.value = localStorage.getItem("lastPrincipalQuery") || "";
  buscarSearchInput.value = localStorage.getItem("lastBuscarQuery") || "";
  const savedQueue = localStorage.getItem("playQueue");
  repeatMode = localStorage.getItem("repeatMode") === "true";
  shuffleMode = localStorage.getItem("shuffleMode") === "true";
  updateControlButtons();
  if (savedQueue) {
    playQueue = JSON.parse(savedQueue);
    originalQueue = [...playQueue];
    currentIndex = parseInt(localStorage.getItem("currentIndex"), 10) || 0;
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
document.querySelectorAll(".nav-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".nav-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    showSection(btn.getAttribute("data-target"));
  });
});

function showSection(sectionId) {
  document.querySelectorAll(".section").forEach(sec => sec.classList.remove("active"));
  document.getElementById(sectionId).classList.add("active");
}

// Sección Principal
principalSearchButton.addEventListener("click", searchPrincipal);
principalSearchInput.addEventListener("keypress", (e) => { if (e.key === "Enter") searchPrincipal(); });

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
    setupCardEvents(card, item, results, index);
    principalGrid.appendChild(card);
  });
}

// Sección Buscar
buscarSearchButton.addEventListener("click", searchBuscar);
buscarSearchInput.addEventListener("keypress", (e) => { if (e.key === "Enter") searchBuscar(); });

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
    setupCardEvents(div, item, results, index);
    buscarList.appendChild(div);
  });
}

// Configurar eventos de tarjetas
function setupCardEvents(element, item, results, index) {
  const playBtn = element.querySelector(".play-btn");
  playBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    buildQueueAndPlay(results, index, true);
  });
  const downloadBtn = element.querySelector(".download-btn");
  let abortController = null;
  downloadBtn.addEventListener("click", async (ev) => {
    ev.stopPropagation();
    if (ev.target.classList.contains("cancel-download-btn") && abortController) {
      abortController.abort();
      abortController = null;
      const progressContainer = element.querySelector(".download-progress");
      downloadBtn.innerHTML = "Descargar offline";
      downloadBtn.style.display = "inline-block";
      progressContainer.style.display = "none";
      showToast("Descarga cancelada");
      return;
    }
    const tx = db.transaction(["songs"], "readonly");
    const store = tx.objectStore("songs");
    const req = store.get(item.videoId);
    req.onsuccess = async (e) => {
      if (e.target.result) {
        showToast("Ya descargaste esta canción");
        return;
      }
      showToast("Descargando...");
      abortController = new AbortController();
      downloadBtn.innerHTML = '<div class="spinner"></div>';
      setTimeout(() => {
        if (downloadBtn.innerHTML.includes('spinner')) {
          downloadBtn.innerHTML = '<button class="cancel-download-btn">✕</button>';
        }
      }, 1000);
      const progressContainer = element.querySelector(".download-progress");
      progressContainer.style.display = "block";
      const progressBar = progressContainer.querySelector("progress");
      try {
        await downloadSong(item, abortController, (percent) => {
          progressBar.value = (percent * 100).toFixed(0);
        });
        showToast("Descargada offline en la app");
        downloadBtn.innerHTML = "Descargar offline";
        downloadBtn.style.display = "none";
        element.querySelector(".three-dots").style.display = "block";
        progressContainer.style.display = "none";
      } catch (err) {
        if (err.name === 'AbortError') {
          showToast("Descarga cancelada");
        } else {
          console.error(err);
          showToast("Error al descargar la canción");
        }
        downloadBtn.innerHTML = "Descargar offline";
        downloadBtn.style.display = "inline-block";
        progressContainer.style.display = "none";
      } finally {
        abortController = null;
      }
    };
  });
  const threeDots = element.querySelector(".three-dots");
  const menuOptions = element.querySelector(".menu-options");
  threeDots.addEventListener("click", (ev) => {
    ev.stopPropagation();
    menuOptions.style.display = (menuOptions.style.display === "block") ? "none" : "block";
  });
  const saveToPhone = element.querySelector(".save-to-phone");
  const deleteOffline = element.querySelector(".delete-offline");
  saveToPhone.addEventListener("click", (ev) => {
    ev.stopPropagation();
    saveToPhoneOffline(item.videoId);
    menuOptions.style.display = "none";
  });
  deleteOffline.addEventListener("click", (ev) => {
    ev.stopPropagation();
    deleteSongOffline(item.videoId);
    menuOptions.style.display = "none";
  });
  checkIfDownloaded(item.videoId, downloadBtn, threeDots);
}

// Cola y reproducción
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
  if (shuffleMode) shuffleQueue();
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
    navigator.mediaSession.setActionHandler('play', () => audio.play());
    navigator.mediaSession.setActionHandler('pause', () => audio.pause());
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
  pauseIcon.style.display = isPlaying ? "block" : "none";
  playIcon.style.display = isPlaying ? "none" : "block";
}

function updateControlButtons() {
  shuffleBtn.classList.toggle("active", shuffleMode);
  repeatBtn.classList.toggle("active", repeatMode);
}

function formatTime(sec) {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" + s : s}`;
}

// Sección Biblioteca
offlineSearchInput.addEventListener("input", filterOfflineSongs);

function filterOfflineSongs() {
  const query = sanitizeQuery(offlineSearchInput.value).toLowerCase();
  loadOfflineSongs(query);
}

function loadOfflineSongs(filterQuery = "") {
  if (!db) return_DURATION;
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
      if (!songs.length) {
        offlineContainer.innerHTML = "<p>No hay canciones descargadas.</p>";
        return;
      }
      const filteredSongs = filterQuery ? songs.filter(song => song.title.toLowerCase().includes(filterQuery)) : songs;
      if (!filteredSongs.length) {
        offlineContainer.innerHTML = "<p>No se encontraron canciones.</p>";
        return;
      }
      filteredSongs.forEach(song => {
        const coverUrl = song.coverBlob ? URL.createObjectURL(song.coverBlob) : song.thumbnail;
        const div = document.createElement("div");
        div.classList.add("offline-item");
        div.onclick = (ev) => {
          if (ev.target.classList.contains("three-dots") || ev.target.parentNode.classList.contains("menu-options")) return;
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
    if (!songs || !songs.length) return;
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
    if (shuffleMode) shuffleQueue();
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
  deleteSongOffline(videoId);
};

window.saveToPhone = async function(event, videoId) {
  event.stopPropagation();
  saveToPhoneOffline(videoId);
};

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

function saveToPhoneOffline(videoId) {
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

function showToast(message) {
  const toast = document.createElement("div");
  toast.classList.add("toast");
  toast.textContent = message;
  toastContainer.appendChild(toast);
  setTimeout(() => toast.remove(), 3500);
}

function sanitizeQuery(query) {
  return query.replace(/[<>[\]{}\\|]/g, "").trim().slice(0, 100);
}