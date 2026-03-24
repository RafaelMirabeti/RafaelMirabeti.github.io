// Inicialização do Mapa
// Focado no centro estendido para abranger Vila Prudente até Liberdade
const map = L.map('map', { zoomControl: false }).setView([-23.5714, -46.6090], 13);

// Camada de visualização escura (compatível com o tema do site)
L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>',
    subdomains: 'abcd',
    maxZoom: 19
}).addTo(map);

// Ícones Personalizados
const truckIcon = L.divIcon({
    html: '<div style="font-size: 28px; filter: drop-shadow(2px 4px 6px rgba(0,0,0,0.8));">🚛</div>',
    className: 'truck-marker',
    iconSize: [35, 35],
    iconAnchor: [17, 17] // Centro
});

const accidentIcon = L.divIcon({
    html: `<div style="background-color: var(--danger); color: white; width: 30px; height: 30px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-weight: bold; border: 3px solid white; animation: pulse 1s infinite;">!</div>`,
    className: '',
    iconSize: [30, 30],
    iconAnchor: [15, 15]
});

// Definição da Frota Multi-Caminhões
const fleetConfig = [
    {
        id: 'FECAP',
        display: 'FECAP',
        start: [-23.5855, -46.5815], // Vila Prudente
        dest: [-23.5573, -46.6366],  // Liberdade
        hasAccident: true,
        detourStart: [-23.5720, -46.6110], // Av Estado
        collision: [-23.5650, -46.6210],
        detourWaypoints: [[-23.5720, -46.6110], [-23.5750, -46.6180], [-23.5680, -46.6280], [-23.5550, -46.6320], [-23.5573, -46.6366]],
        colorClass: 'fecap-marker',
        speed: 0.00018
    },
    {
        id: 'APPLE',
        display: '🍎 APPLE',
        start: [-23.5615, -46.6559], // Paulista (MASP)
        dest: [-23.5898, -46.6326],  // Vila Mariana
        hasAccident: true,
        detourStart: [-23.5700, -46.6450],
        collision: [-23.5750, -46.6400],
        detourWaypoints: [[-23.5700, -46.6450], [-23.5750, -46.6500], [-23.5850, -46.6450], [-23.5898, -46.6326]],
        colorClass: 'brand-marker apple',
        speed: 0.00021 // Ligeiramente mais rápido
    },
    {
        id: 'NIKE',
        display: '✔️ NIKE',
        start: [-23.5350, -46.6330], // Sé
        dest: [-23.5489, -46.6620],  // Pacaembu
        hasAccident: true,
        detourStart: [-23.5400, -46.6450],
        collision: [-23.5450, -46.6500],
        detourWaypoints: [[-23.5400, -46.6450], [-23.5350, -46.6500], [-23.5400, -46.6600], [-23.5489, -46.6620]],
        colorClass: 'brand-marker nike',
        speed: 0.00016
    }
];

// Instâncias Globais da Frota
let activeFleet = [];
let simInterval = null;

// Função Auxiliar de Criação de Ícone
function createMarkerIcon(text, cssClass) {
    return L.divIcon({
        html: `<div class="${cssClass}">${text}</div>`,
        className: '',
        iconSize: [45, 18],
        iconAnchor: [22, 9]
    });
}

// Inicializa Marcadores Iniciais no Mapa
fleetConfig.forEach(truckDef => {
    // Marcador do Caminhão Inicial
    let tMarker = L.marker(truckDef.start, { icon: truckIcon }).addTo(map);
    // Marcador de Destino
    let dMarker = L.marker(truckDef.dest, { icon: createMarkerIcon(truckDef.display, truckDef.colorClass) }).addTo(map);

    activeFleet.push({
        config: truckDef,
        truckMarker: tMarker,
        destMarker: dMarker,
        routeLine: null,
        detourLine: null,
        accidentMarker: null,
        currentPath: [],
        pathIndex: 0,
        currentLat: truckDef.start[0],
        currentLng: truckDef.start[1],
        detourActive: false,
        finished: false,
        preciseOriginalRoute: [],
        preciseDetourRoute: []
    });
});

// Elementos da UI
const btnStart = document.getElementById('btn-start-sim');
const logPanel = document.getElementById('sim-logs');
const statusText = document.getElementById('status-text');

// Função para adicionar logs
function addLog(message, type = 'info') {
    const p = document.createElement('div');
    p.className = `log-item ${type}`;
    p.innerText = `[${new Date().toLocaleTimeString()}] ${message}`;
    logPanel.prepend(p);
}

// OSRM API - Vai buscar as ruas exatas
async function fetchRealRoute(coordsArr) {
    const coordsString = coordsArr.map(c => `${c[1]},${c[0]}`).join(';');
    const url = `https://router.project-osrm.org/route/v1/driving/${coordsString}?geometries=geojson&overview=full`;
    const response = await fetch(url);
    const data = await response.json();
    return data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]); // Inverte para [Lat, Lng]
}

// Evento do Botão
btnStart.addEventListener('click', async () => {
    // Evita cliques múltiplos
    btnStart.disabled = true;
    btnStart.innerText = ">> CALCULANDO ROTAS...";
    btnStart.style.opacity = "0.5";

    // Reset Elements
    if (simInterval) cancelAnimationFrame(simInterval);
    activeFleet.forEach(t => {
        if (t.routeLine) map.removeLayer(t.routeLine);
        if (t.detourLine) map.removeLayer(t.detourLine);
        if (t.accidentMarker) map.removeLayer(t.accidentMarker);
        t.pathIndex = 0;
        t.finished = false;
        t.detourActive = false;
        t.currentLat = t.config.start[0];
        t.currentLng = t.config.start[1];
        t.truckMarker.setLatLng([t.currentLat, t.currentLng]);
    });

    addLog("Big Data: Calculando rotas para 5.000 (Frota Simulada)...", "warning");

    try {
        // Pré-carrega todas as rotas da OSRM para a frota
        for (let t of activeFleet) {
            let mainWaypoints = [t.config.start, t.config.dest];
            if (t.config.hasAccident) {
                mainWaypoints = [t.config.start, t.config.detourStart, t.config.collision, t.config.dest];
                t.preciseDetourRoute = await fetchRealRoute(t.config.detourWaypoints);
            }
            t.preciseOriginalRoute = await fetchRealRoute(mainWaypoints);
            t.currentPath = t.preciseOriginalRoute;

            // Desenha a linha transparente tracejada de cada um
            t.routeLine = L.polyline(t.preciseOriginalRoute, {
                color: t.config.id === 'FECAP' ? 'var(--accent)' : 'rgba(255, 255, 255, 0.3)',
                weight: t.config.id === 'FECAP' ? 4 : 2,
                opacity: 0.8,
                dashArray: '10, 10'
            }).addTo(map);
        }

        // Câmera geral englobando todos
        map.fitBounds(activeFleet[0].routeLine.getBounds(), { padding: [50, 50] });

        btnStart.innerText = ">> TRANSMITINDO...";
        statusText.innerText = "Frota em Movimento";
        statusText.className = "status-moving";
        addLog("Rotas urbanas distribuídas. Operação Iniciada.", "success");

        // Motor de Animação Compartilhado
        function animateFleet() {
            let allFinished = true;

            activeFleet.forEach(t => {
                if (t.finished) return;
                allFinished = false; // Ainda tem gente rodando

                if (t.pathIndex >= t.currentPath.length - 1) {
                    t.finished = true;
                    addLog(`[${t.config.id}] Carga na base com sucesso.`, "success");
                    return;
                }

                const targetLat = t.currentPath[t.pathIndex + 1][0];
                const targetLng = t.currentPath[t.pathIndex + 1][1];
                const speed = t.config.speed;

                const dLat = targetLat - t.currentLat;
                const dLng = targetLng - t.currentLng;
                const dist = Math.sqrt(dLat * dLat + dLng * dLng);

                if (dist < speed) {
                    t.currentLat = targetLat;
                    t.currentLng = targetLng;
                    t.pathIndex++;

                    // Acompanha a câmera se for o caminhão primário (FECAP)
                    if (t.config.id === 'FECAP' && t.pathIndex % 10 === 0) {
                        map.panTo([t.currentLat, t.currentLng], { animate: true, duration: 0.5 });
                    }

                    // Lógica de Detecção de Acidente Específica (FECAP)
                    if (t.config.hasAccident && !t.detourActive) {
                        const triggerIndex = Math.floor(t.preciseOriginalRoute.length * 0.4);
                        if (t.pathIndex === triggerIndex) {
                            cancelAnimationFrame(simInterval);

                            t.accidentMarker = L.marker(t.config.collision, { icon: accidentIcon }).addTo(map);
                            addLog(`[${t.config.id}] ALERTA: Acidente detectado á frente!`, "danger");
                            statusText.innerText = "Risco Detectado";
                            statusText.style.color = "var(--danger)";

                            setTimeout(() => {
                                addLog(`[${t.config.id}] Big Data: Calculando plano de contingência...`, "warning");

                                setTimeout(() => {
                                    map.removeLayer(t.routeLine);

                                    t.detourLine = L.polyline(t.preciseDetourRoute, {
                                        color: 'var(--success)',
                                        weight: 5,
                                        opacity: 0.9,
                                        dashArray: '10, 10'
                                    }).addTo(map);

                                    t.currentPath = t.preciseDetourRoute;
                                    t.pathIndex = 0;
                                    t.currentLat = t.currentPath[0][0];
                                    t.currentLng = t.currentPath[0][1];
                                    t.detourActive = true;

                                    addLog(`[${t.config.id}] Nova Rota Enviada. Desviando.`, "success");
                                    statusText.innerText = "Desvio Ativo";
                                    statusText.style.color = "var(--accent-blue)";

                                    simInterval = requestAnimationFrame(animateFleet);
                                }, 600);
                            }, 400);
                            return; // Interrompe iteração atual para dar foco ao acidente
                        }
                    }
                } else {
                    t.currentLat += (dLat / dist) * speed;
                    t.currentLng += (dLng / dist) * speed;
                    t.truckMarker.setLatLng([t.currentLat, t.currentLng]);
                }
            });

            if (allFinished) {
                statusText.innerText = "FROTA ENTREGUE";
                statusText.className = "status-ready";
                statusText.style.color = "var(--success)";
                btnStart.disabled = false;
                btnStart.innerText = ">> REINICIAR ROTA";
                btnStart.style.opacity = "1";
            } else {
                simInterval = requestAnimationFrame(animateFleet);
            }
        }

        simInterval = requestAnimationFrame(animateFleet);

    } catch (e) {
        addLog("Erro de conexão OSRM. Falha ao calcular rota exata.", "danger");
        btnStart.disabled = false;
        btnStart.innerText = ">> REINICIAR ROTA";
        btnStart.style.opacity = "1";
    }
});
